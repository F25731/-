import axios from "axios";

import { buildApiUrl, resolveModelRuntimeConfig, type AiConfig } from "@/stores/use-config-store";

export type ParseMediaItem = {
    label?: string;
    url: string;
    type?: string;
    filename?: string;
};

export type ParseResult = {
    ok?: boolean;
    status?: number;
    error?: string;
    api?: {
        id?: string;
        name?: string;
        group?: string;
        method?: string;
    };
    input?: {
        originalUrl?: string;
        normalizedUrl?: string;
    };
    normalized?: {
        title?: string;
        author?: string;
        avatar?: string;
        cover?: string;
        videos?: ParseMediaItem[];
        images?: ParseMediaItem[];
        audios?: ParseMediaItem[];
        links?: ParseMediaItem[];
    };
    durationMs?: number;
};

type ChatCompletionResponse = {
    choices?: Array<{ message?: { content?: string | ParseResult } }>;
    error?: { message?: string };
};

export async function requestLinkParse(config: AiConfig, modelName: string, content: string) {
    const runtime = resolveModelRuntimeConfig(config, modelName);
    const model = runtime.modelId || modelName;
    const apiKey = runtime.apiKey || config.apiKey;
    if (!apiKey) throw new Error("请先在 API Key 配置里填写解析模型密钥");

    try {
        const response = await axios.post<ChatCompletionResponse>(
            buildApiUrl(runtime.baseUrl || config.baseUrl, "/chat/completions"),
            {
                model,
                messages: [{ role: "user", content }],
            },
            {
                headers: {
                    Authorization: `Bearer ${apiKey}`,
                    "Content-Type": "application/json",
                },
                timeout: 90000,
            },
        );
        return readParseResult(response.data);
    } catch (error) {
        throw new Error(readAxiosError(error, "解析失败"));
    }
}

function readParseResult(payload: ChatCompletionResponse) {
    if (payload.error?.message) throw new Error(payload.error.message);
    const content = payload.choices?.[0]?.message?.content;
    if (!content) throw new Error("解析接口没有返回内容");
    const result = typeof content === "string" ? parseJsonContent(content) : content;
    if (result.ok === false) throw new Error(result.error || "解析失败");
    return result;
}

function parseJsonContent(content: string) {
    try {
        return JSON.parse(content) as ParseResult;
    } catch {
        const start = content.indexOf("{");
        const end = content.lastIndexOf("}");
        if (start >= 0 && end > start) return JSON.parse(content.slice(start, end + 1)) as ParseResult;
        throw new Error("解析接口返回内容不是有效 JSON");
    }
}

function readAxiosError(error: unknown, fallback: string) {
    if (axios.isAxiosError<ChatCompletionResponse>(error)) {
        return error.response?.data?.error?.message || (error.response?.status ? `${fallback}: ${error.response.status}` : error.message || fallback);
    }
    return error instanceof Error ? error.message : fallback;
}
