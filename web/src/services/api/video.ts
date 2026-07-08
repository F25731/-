import axios from "axios";

import { ensureReferenceImagesRemoteUrls, imageAiUrl } from "@/services/image-bed";
import { buildApiUrl, resolveModelRuntimeConfig, videoCapabilitiesForModel, type AiConfig } from "@/stores/use-config-store";
import { useUserStore } from "@/stores/use-user-store";
import type { ReferenceImage } from "@/types/image";

export type VideoReferenceMaterial = {
    type: "video" | "audio";
    url: string;
    name?: string;
};

type VideoResponse = {
    id?: string;
    task_id?: string;
    status?: string;
    url?: string;
    video_url?: string;
    result_url?: string;
    output?: string[];
    video?: { url?: string };
    error?: { message?: string; code?: string };
    metadata?: { url?: string };
};
type ApiVideoResponse = VideoResponse | { code?: number; data?: VideoResponse | null; msg?: string };
type VideoRequestBody = {
    model: string;
    prompt: string;
    size?: string;
    aspect_ratio?: string;
    resolution?: string;
    quality?: string;
    duration: number;
    seconds: string;
    image?: string;
    images?: string[];
    input_reference?: string;
    metadata?: Record<string, unknown>;
};

function aiApiUrl(config: AiConfig, path: string) {
    if (config.channelMode === "remote") return `/api/v1${path}`;
    const runtime = resolveModelRuntimeConfig(config, config.model || config.videoModel);
    return buildApiUrl(runtime.baseUrl || config.baseUrl, path);
}

function aiHeaders(config: AiConfig) {
    const token = useUserStore.getState().token;
    const runtime = config.channelMode === "remote" ? { apiKey: config.apiKey } : resolveModelRuntimeConfig(config, config.model || config.videoModel);
    const authToken = config.channelMode === "remote" ? token : runtime.apiKey || config.apiKey || token;
    return authToken ? { Authorization: `Bearer ${authToken}` } : undefined;
}

export async function requestVideoGeneration(config: AiConfig, prompt: string, references: ReferenceImage[] = [], mediaReferences: VideoReferenceMaterial[] = []) {
    const displayModel = config.model || config.videoModel;
    const model = config.channelMode === "remote" ? displayModel : resolveModelRuntimeConfig(config, displayModel).modelId || displayModel;
    const body = await buildVideoRequestBody(config, model, prompt, references, mediaReferences);
    try {
        const created = unwrapVideoResponse((await axios.post<ApiVideoResponse>(aiApiUrl(config, "/videos"), body, { headers: aiHeaders(config) })).data);
        const taskId = created.id || created.task_id;
        if (!taskId) throw new Error("视频接口没有返回任务 ID");
        let resultUrl = extractVideoUrl(created);
        for (;;) {
            const video = unwrapVideoResponse((await axios.get<ApiVideoResponse>(aiApiUrl(config, `/videos/${taskId}`), { headers: aiHeaders(config), params: config.channelMode === "remote" ? { model } : undefined })).data);
            resultUrl = extractVideoUrl(video) || resultUrl;
            if (isVideoTaskCompleted(video.status) || resultUrl) break;
            if (video.status === "failed" || video.status === "cancelled") throw new Error(video.error?.message || "视频生成失败");
            await new Promise((resolve) => setTimeout(resolve, 2500));
        }
        if (resultUrl) return fetchVideoResultBlob(resultUrl);
        const content = await axios.get<Blob>(aiApiUrl(config, `/videos/${taskId}/content`), { headers: aiHeaders(config), params: config.channelMode === "remote" ? { model } : undefined, responseType: "blob" });
        const contentUrl = await extractVideoBlobUrl(content.data);
        if (contentUrl) return fetchVideoResultBlob(contentUrl);
        return content.data;
    } catch (error) {
        throw new Error(readAxiosError(error, "视频生成失败"));
    }
}

async function buildVideoRequestBody(config: AiConfig, model: string, prompt: string, references: ReferenceImage[], mediaReferences: VideoReferenceMaterial[]): Promise<VideoRequestBody> {
    const capabilities = videoCapabilitiesForModel(config, config.videoModel || config.model);
    const seconds = normalizeVideoSeconds(config.videoSeconds);
    const size = normalizeVideoSizeForModel(config, model);
    const resolution = normalizeVideoResolution(config.vquality, size);
    const imageLimit = Math.max(0, Math.floor(Number(capabilities.referenceImageLimit) || 0));
    const videoLimit = Math.max(0, Math.floor(Number(capabilities.referenceVideoLimit) || 0));
    const audioLimit = Math.max(0, Math.floor(Number(capabilities.referenceAudioLimit) || 0));
    const remoteReferences = imageLimit > 0 ? await ensureReferenceImagesRemoteUrls(references.slice(0, imageLimit)) : [];
    const images = remoteReferences.map(imageAiUrl).filter((url): url is string => Boolean(url));
    const videos = videoLimit > 0 ? mediaReferences.filter((item) => item.type === "video").slice(0, videoLimit).map((item) => item.url.trim()).filter(Boolean) : [];
    const audios = audioLimit > 0 ? mediaReferences.filter((item) => item.type === "audio").slice(0, audioLimit).map((item) => item.url.trim()).filter(Boolean) : [];
    const body: VideoRequestBody = {
        model,
        prompt,
        duration: Number(seconds),
        seconds,
        resolution,
        quality: resolution,
        metadata: {
            durationSeconds: Number(seconds),
            resolution,
            quality: resolution,
            aspectRatio: size,
        },
    };
    if (size) {
        body.size = size;
        body.aspect_ratio = size;
    }
    applyReferenceImages(body, model, images);
    applyReferenceContent(body, images, videos, audios);
    return body;
}

function applyReferenceImages(body: VideoRequestBody, model: string, images: string[]) {
    if (images.length === 0) return;
    const modelName = model.toLowerCase();
    if (modelName.includes("kling")) {
        body.image = images[0];
        if (images[1]) body.metadata = { ...(body.metadata || {}), image_tail: images[1] };
        return;
    }
    if (modelName.includes("sora")) {
        body.input_reference = images[0];
        return;
    }
    body.images = images;
}

function applyReferenceContent(body: VideoRequestBody, images: string[], videos: string[], audios: string[]) {
    const content = [
        ...images.map((url) => ({ type: "image_url", image_url: { url } })),
        ...videos.map((url) => ({ type: "video_url", video_url: { url } })),
        ...audios.map((url) => ({ type: "audio_url", audio_url: { url } })),
    ];
    if (!content.length) return;
    body.metadata = { ...(body.metadata || {}), content };
}

function normalizeVideoSeconds(value: string) {
    const seconds = Math.floor(Number(value) || 6);
    return String(Math.max(1, Math.min(20, seconds)));
}

function normalizeVideoSize(value: string) {
    if (value === "auto") return null;
    const size = value || "1280x720";
    if (/^\d+:\d+$/.test(size)) return size;
    if (/^\d+x\d+$/.test(size)) return size;
    return ["9:16", "2:3", "3:4"].includes(size) ? "720x1280" : "1280x720";
}

function normalizeVideoSizeForModel(config: AiConfig, model: string) {
    const supported = (config.modelSupportedSizes[model] || []).filter(Boolean);
    const requested = normalizeVideoSize(config.size);
    if (!supported.length) return requested;
    if (requested && supported.includes(requested)) return requested;
    const fallback = supported.find((size) => size !== "auto") || "auto";
    return normalizeVideoSize(fallback);
}

function normalizeVideoResolution(value: string, size: string | null) {
    if (/4k/i.test(value)) return "4k";
    if (value === "low") return "480p";
    if (value === "auto" || value === "high" || value === "medium") return "720p";
    if (size && /^(\d+)x(\d+)$/i.test(size)) {
        const [, width, height] = size.match(/^(\d+)x(\d+)$/i) || [];
        const maxSide = Math.max(Number(width) || 0, Number(height) || 0);
        if (maxSide >= 3840) return "4k";
        if (maxSide >= 1920) return "1080p";
    }
    const resolution = value.replace(/p$/i, "") || "720";
    return `${resolution}p`;
}

function unwrapVideoResponse(payload: ApiVideoResponse) {
    if (!payload) throw new Error("接口没有返回视频任务");
    if ("code" in payload && typeof payload.code === "number") {
        if (payload.code !== 0) throw new Error(payload.msg || "请求失败");
        if (!payload.data) throw new Error("接口没有返回视频任务");
        return payload.data;
    }
    return payload;
}

function isVideoTaskCompleted(status = "") {
    return ["completed", "done", "succeeded", "success", "finished"].includes(status.toLowerCase());
}

function extractVideoUrl(video: VideoResponse) {
    return [video.url, video.video?.url, video.video_url, video.result_url, video.metadata?.url, ...(video.output || [])].find((url) => /^https?:\/\//i.test(String(url || ""))) || "";
}

async function fetchVideoResultBlob(url: string) {
    try {
        const response = await axios.get<Blob>(url, { responseType: "blob" });
        if (!response.data.type.includes("json")) return response.data;
    } catch {
        // Cross-origin video URLs can fail in the browser; retry through the same-origin proxy.
    }
    const proxied = await axios.get<Blob>(`/api/media-fetch?url=${encodeURIComponent(url)}`, { responseType: "blob" });
    if (proxied.data.type.includes("json")) {
        const errorUrl = await extractVideoBlobUrl(proxied.data);
        if (errorUrl && errorUrl !== url) return fetchVideoResultBlob(errorUrl);
        throw new Error("视频结果下载失败");
    }
    return proxied.data;
}

function readAxiosError(error: unknown, fallback: string) {
    if (axios.isAxiosError<{ error?: { message?: string }; msg?: string; code?: number; message?: string }>(error)) {
        const responseData = error.response?.data;
        return responseData?.msg || responseData?.error?.message || responseData?.message || (error.response?.status ? `${fallback}：${error.response.status}` : fallback);
    }
    return error instanceof Error ? error.message : fallback;
}

async function extractVideoBlobUrl(blob: Blob) {
    if (!blob.type.includes("json")) return;
    let payload: ApiVideoResponse & { error?: { message?: string }; message?: string };
    try {
        payload = JSON.parse(await blob.text()) as ApiVideoResponse & { error?: { message?: string }; message?: string };
    } catch {
        return;
    }
    if (typeof payload.code === "number" && payload.code !== 0) throw new Error(payload.msg || "视频下载失败");
    if (payload.error?.message || payload.message) throw new Error(payload.error?.message || payload.message);
    const video = unwrapVideoResponse(payload as ApiVideoResponse);
    return extractVideoUrl(video);
}
