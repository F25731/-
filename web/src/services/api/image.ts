import axios from "axios";

import { buildApiUrl, type AiConfig } from "@/stores/use-config-store";
import { useUserStore } from "@/stores/use-user-store";
import { nanoid } from "nanoid";
import { dataUrlToFile } from "@/lib/image-utils";
import { buildImageReferencePromptText } from "@/lib/image-reference-prompt";
import { imageToDataUrl } from "@/services/image-storage";
import { normalizeImageApiKeys, normalizeImageKeyTier } from "@/types/api-keys";
import type { ReferenceImage } from "@/types/image";

export type ChatCompletionMessage = {
    role: "system" | "user" | "assistant";
    content: string | Array<{ type: "text"; text: string } | { type: "image_url"; image_url: { url: string } }>;
};

type ImageApiResponse = {
    data?: Array<Record<string, unknown>>;
    error?: { message?: string };
    code?: number;
    msg?: string;
};

export type AiRequestErrorKind = "auth" | "quota" | "upstream_auth" | "other";

export class AiRequestError extends Error {
    kind: AiRequestErrorKind;
    status?: number;

    constructor(message: string, kind: AiRequestErrorKind = "other", status?: number) {
        super(message);
        this.name = "AiRequestError";
        this.kind = kind;
        this.status = status;
    }
}

const QUALITY_BASE: Record<string, number> = {
    low: 1024,
    medium: 2048,
    high: 2880,
    standard: 1024,
    hd: 2048,
};
const MAX_IMAGE_GENERATION_COUNT = 8;
const ALLOWED_REQUEST_SIZES = new Set(["1:1", "16:9", "4:3", "3:4", "9:16"]);
const IMAGE_JOB_CREATE_TIMEOUT_MS = 30_000;
const IMAGE_JOB_POLL_TIMEOUT_MS = 10 * 60_000;
const IMAGE_JOB_POLL_INTERVAL_MS = 2_500;
const IMAGE_JOB_POLL_REQUEST_TIMEOUT_MS = 15_000;

type ImageJobStatus = "pending" | "running" | "succeeded" | "failed";

type ImageJobCreateResponse = {
    code?: number;
    data?: {
        id?: string;
        status?: ImageJobStatus;
    };
    msg?: string;
};

type ImageJobStatusResponse = {
    code?: number;
    data?: {
        id: string;
        status: ImageJobStatus;
        data?: ImageApiResponse;
        error?: string;
    };
    msg?: string;
};

function normalizeQuality(_quality: string) {
    return undefined;
}

/** Map "quality + ratio" to an explicit pixel dimension like "3840x2160". Returns undefined when quality is auto. */
function resolveSize(quality: string, ratio: string): string | undefined {
    const basePixels = QUALITY_BASE[quality];
    if (!basePixels || ratio === "auto" || !ratio) return undefined;

    const parts = ratio.split(":");
    if (parts.length !== 2) return undefined;
    const w = Number(parts[0]);
    const h = Number(parts[1]);
    if (!w || !h) return undefined;

    const targetPixels = basePixels * basePixels;
    const isLandscape = w >= h;
    const longRatio = isLandscape ? w / h : h / w;

    const longSideRaw = Math.sqrt(targetPixels * longRatio);
    const longSide = Math.floor(longSideRaw / 16) * 16;
    const shortSide = Math.round((longSide / longRatio) / 16) * 16;

    const width = isLandscape ? longSide : shortSide;
    const height = isLandscape ? shortSide : longSide;

    return `${width}x${height}`;
}

function resolveRequestSize(quality: string | undefined, size: string) {
    const value = size.trim();
    if (!value || value === "auto") return undefined;
    if (!ALLOWED_REQUEST_SIZES.has(value)) return undefined;
    return (quality && resolveSize(quality, value)) || value;
}

function resolveImageDataUrl(item: Record<string, unknown>) {
    if (typeof item.b64_json === "string" && item.b64_json) {
        return `data:image/png;base64,${item.b64_json}`;
    }
    if (typeof item.url === "string" && item.url) {
        return item.url;
    }
    return null;
}

function parseImagePayload(payload: ImageApiResponse) {
    if (typeof payload.code === "number" && payload.code !== 0) {
        throw new Error(payload.msg || "请求失败");
    }
    const images =
        payload.data
            ?.map(resolveImageDataUrl)
            .filter((value): value is string => Boolean(value))
            .map((dataUrl) => ({ id: nanoid(), dataUrl })) || [];

    if (images.length === 0) {
        throw new Error("接口没有返回图片");
    }

    return images;
}

function requestErrorKind(status: number | undefined, message: string): AiRequestErrorKind {
    const text = message.toLowerCase();
    if (text.includes("token_revoked") || text.includes("invalidated oauth token") || text.includes("encountered invalidated oauth token")) return "upstream_auth";
    if (text.includes("key") && (text.includes("invalid") || text.includes("not found") || text.includes("revoked") || text.includes("unauthorized"))) return "auth";
    if ((status === 401 || status === 403) && !text.includes("/backend-api/")) return "auth";
    if (status === 402 || text.includes("quota") || text.includes("balance") || text.includes("insufficient_quota") || text.includes("no available image quota")) return "quota";
    return "other";
}

function readResponseErrorMessage(data: unknown) {
    if (!data || typeof data !== "object") return "";
    const payload = data as { detail?: string | { error?: string }; error?: { message?: string } | string; msg?: string; message?: string };
    if (typeof payload.detail === "string") return payload.detail;
    if (payload.detail && typeof payload.detail === "object" && payload.detail.error) return payload.detail.error;
    if (typeof payload.error === "string") return payload.error;
    if (payload.error?.message) return payload.error.message;
    return payload.msg || payload.message || "";
}

function normalizeAiError(error: unknown, fallback: string) {
    if (error instanceof AiRequestError) return error;
    if (axios.isAxiosError(error)) {
        if (error.code === "ECONNABORTED") {
            return new AiRequestError("生成失败，请重新生成", "other");
        }
        const responseData = error.response?.data;
        const status = error.response?.status;
        const message = readResponseErrorMessage(responseData) || (status ? `${fallback}：${status}` : fallback);
        const kind = requestErrorKind(status, message);
        if (kind === "auth") return new AiRequestError("API Key 无效或已失效", "auth", status);
        if (kind === "quota") return new AiRequestError("余额不足或配额已用完", "quota", status);
        if (kind === "upstream_auth") return new AiRequestError("上游认证失败", "upstream_auth", status);
        return new AiRequestError(message, "other", status);
    }
    const message = error instanceof Error ? error.message : fallback;
    const kind = requestErrorKind(undefined, message);
    if (kind === "auth") return new AiRequestError("API Key 无效或已失效", "auth");
    if (kind === "quota") return new AiRequestError("余额不足或配额已用完", "quota");
    if (kind === "upstream_auth") return new AiRequestError("上游认证失败", "upstream_auth");
    return new AiRequestError(message, "other");
}

function parseStreamChunk(chunk: string, onDelta: (value: string) => void) {
    let deltaText = "";
    for (const eventBlock of chunk.split("\n\n")) {
        const data = eventBlock
            .split("\n")
            .find((line) => line.startsWith("data: "))
            ?.slice(6);
        if (!data || data === "[DONE]") continue;
        const delta = (JSON.parse(data) as { choices?: Array<{ delta?: { content?: string } }> }).choices?.[0]?.delta?.content || "";
        deltaText += delta;
    }
    if (deltaText) onDelta(deltaText);
}

function withSystemPrompt(config: AiConfig, prompt: string) {
    const systemPrompt = config.systemPrompt.trim();
    return systemPrompt ? `${systemPrompt}\n\n${prompt}` : prompt;
}

function aiApiUrl(config: AiConfig, path: string) {
    return config.channelMode === "remote" ? `/api/v1${path}` : buildApiUrl(config.baseUrl, path);
}

function aiHeaders(config: AiConfig, contentType?: string) {
    const userStore = useUserStore.getState();
    const token = userStore.token.trim();
    const imageTier = normalizeImageKeyTier(config.imageTier);
    const tierApiKey = normalizeImageApiKeys(userStore.apiKeys)[imageTier]?.trim() || "";
    const apiKey = String(config.apiKey || "").trim();
    const authToken = config.channelMode === "remote" ? token : tierApiKey || apiKey || token;
    return config.channelMode === "remote"
        ? {
              ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
              ...(contentType ? { "Content-Type": contentType } : {}),
          }
        : {
              ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
              ...(contentType ? { "Content-Type": contentType } : {}),
          };
}


function withSystemMessage(config: AiConfig, messages: ChatCompletionMessage[]) {
    const systemPrompt = config.systemPrompt.trim();
    return systemPrompt ? [{ role: "system" as const, content: systemPrompt }, ...messages] : messages;
}

export async function requestGeneration(config: AiConfig, prompt: string) {
    const n = Math.max(1, Math.min(MAX_IMAGE_GENERATION_COUNT, Math.floor(Math.abs(Number(config.count)) || 1)));
    const quality = normalizeQuality(config.quality);
    const requestSize = resolveRequestSize(quality, config.size);
    try {
        const images = await requestImageJob(
            "generations",
            {
                model: config.model,
                prompt: withSystemPrompt(config, prompt),
                n,
                ...(quality ? { quality } : {}),
                ...(requestSize ? { size: requestSize } : {}),
                response_format: "b64_json",
            },
            aiHeaders(config, "application/json"),
        );
        return images;
    } catch (error) {
        throw normalizeAiError(error, "请求失败");
    }
}

export async function requestEdit(config: AiConfig, prompt: string, references: ReferenceImage[]) {
    const n = Math.max(1, Math.min(MAX_IMAGE_GENERATION_COUNT, Math.floor(Math.abs(Number(config.count)) || 1)));
    const quality = normalizeQuality(config.quality);
    const requestSize = resolveRequestSize(quality, config.size);
    const requestPrompt = buildImageReferencePromptText(prompt, references);
    const formData = new FormData();
    formData.set("model", config.model);
    formData.set("prompt", withSystemPrompt(config, requestPrompt));
    formData.set("n", String(n));
    formData.set("response_format", "b64_json");
    if (quality) {
        formData.set("quality", quality);
    }
    if (requestSize) {
        formData.set("size", requestSize);
    }
    const files = await Promise.all(references.map(async (image) => dataUrlToFile({ ...image, dataUrl: await imageToDataUrl(image) })));
    files.forEach((file) => formData.append("image", file));

    try {
        const images = await requestImageJob("edits", formData, aiHeaders(config));
        return images;
    } catch (error) {
        throw normalizeAiError(error, "请求失败");
    }
}

async function requestImageJob(kind: "generations" | "edits", body: unknown, headers?: ReturnType<typeof aiHeaders>) {
    const created = await axios.post<ImageJobCreateResponse>(`/api/image-jobs/${kind}`, body, {
        headers,
        timeout: IMAGE_JOB_CREATE_TIMEOUT_MS,
        validateStatus: () => true,
    });
    const jobId = created.data?.data?.id;
    if (created.status < 200 || created.status >= 300 || created.data?.code !== 0 || !jobId) {
        throw new Error(created.data?.msg || "Image job creation failed");
    }
    return pollImageJob(jobId);
}

async function pollImageJob(jobId: string) {
    const startedAt = Date.now();
    while (Date.now() - startedAt < IMAGE_JOB_POLL_TIMEOUT_MS) {
        await sleep(IMAGE_JOB_POLL_INTERVAL_MS);
        try {
            const response = await axios.get<ImageJobStatusResponse>(`/api/image-jobs/status/${encodeURIComponent(jobId)}`, {
                timeout: IMAGE_JOB_POLL_REQUEST_TIMEOUT_MS,
                validateStatus: () => true,
            });
            if (response.status < 200 || response.status >= 300 || response.data?.code !== 0) {
                const message = response.data?.msg || "Image job status request failed";
                if (response.status === 404) throw new Error(message);
                continue;
            }

            const job = response.data.data;
            if (!job) continue;
            if (job.status === "succeeded") return parseImagePayload(job.data || {});
            if (job.status === "failed") throw new Error(job.error || "Image generation failed");
        } catch (error) {
            if (axios.isAxiosError(error) && !error.response) continue;
            throw error;
        }
    }
    throw new Error("Image generation timed out");
}

function sleep(ms: number) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function requestImageQuestion(config: AiConfig, messages: ChatCompletionMessage[], onDelta: (text: string) => void) {
    let buffer = "";
    let answer = "";
    let processedLength = 0;

    try {
        const response = await axios.post(
            aiApiUrl(config, "/chat/completions"),
            {
                model: config.model,
                messages: withSystemMessage(config, messages),
                stream: true,
            },
            {
                headers: {
                    ...aiHeaders(config, "application/json"),
                } as Record<string, string>,
                responseType: "text",
                onDownloadProgress: (event) => {
                    const responseText = String(event.event?.target?.responseText || "");
                    const nextText = responseText.slice(processedLength);
                    processedLength = responseText.length;
                    buffer += nextText;
                    const chunks = buffer.split("\n\n");
                    buffer = chunks.pop() || "";
                    for (const chunk of chunks) {
                        parseStreamChunk(chunk, (delta) => {
                            answer += delta;
                            onDelta(answer);
                        });
                    }
                },
            },
        );
        if (typeof response.data === "object" && response.data && "code" in response.data && (response.data as { code?: number; msg?: string }).code !== 0) {
            throw new Error((response.data as { msg?: string }).msg || "请求失败");
        }
        if (typeof response.data === "string") {
            let apiError = "";
            try {
                const payload = JSON.parse(response.data) as { code?: number; msg?: string };
                if (typeof payload.code === "number" && payload.code !== 0) {
                    apiError = payload.msg || "请求失败";
                }
            } catch {
                // ignore plain text stream content
            }
            if (apiError) throw new Error(apiError);
        }
        if (buffer) {
            parseStreamChunk(buffer, (delta) => {
                answer += delta;
                onDelta(answer);
            });
        }
    } catch (error) {
        throw normalizeAiError(error, "请求失败");
    }
    return answer || "没有返回内容";
}

export async function fetchImageModels(config: AiConfig) {
    if (config.channelMode === "remote") return config.models;
    try {
        const response = await axios.get<{ data?: Array<{ id?: string }>; error?: { message?: string } }>(buildApiUrl(config.baseUrl, "/models"), {
            headers: aiHeaders(config),
        });
        return (response.data.data || [])
            .map((model) => model.id)
            .filter((id): id is string => Boolean(id))
            .sort((a, b) => a.localeCompare(b));
    } catch (error) {
        throw normalizeAiError(error, "读取模型失败");
    }
}

