import type { NextRequest } from "next/server";

export const runtime = "nodejs";
export const maxDuration = 180;

type DetailLlmRequest = {
    baseUrl?: string;
    apiKey?: string;
    model?: string;
    messages?: unknown[];
};

export async function POST(request: NextRequest) {
    let payload: DetailLlmRequest;
    try {
        payload = (await request.json()) as DetailLlmRequest;
    } catch {
        return Response.json({ code: 1, data: null, msg: "请求参数无效" }, { status: 400 });
    }

    const baseUrl = String(payload.baseUrl || "").trim().replace(/\/+$/, "");
    const apiKey = String(payload.apiKey || "").trim();
    const model = String(payload.model || "").trim();
    if (!baseUrl || !apiKey || !model) {
        return Response.json({ code: 1, data: null, msg: "缺少 LLM 请求地址、模型或 API Key" }, { status: 400 });
    }

    const apiBaseUrl = baseUrl.endsWith("/v1") ? baseUrl : `${baseUrl}/v1`;
    const upstream = `${apiBaseUrl}/chat/completions`;
    const response = await fetch(upstream, {
        method: "POST",
        headers: {
            Authorization: `Bearer ${apiKey}`,
            "Content-Type": "application/json",
        },
        body: JSON.stringify({
            model,
            messages: payload.messages || [],
            temperature: 0.7,
        }),
    });

    const text = await response.text();
    const data = parseJSON(text);
    if (!response.ok) {
        return Response.json({ code: 1, data: null, msg: readUpstreamError(data) || `LLM 请求失败：${response.status}` }, { status: response.status });
    }

    const content = readAssistantContent(data);
    if (!content) {
        return Response.json({ code: 1, data: null, msg: "LLM 没有返回内容" }, { status: 502 });
    }
    return Response.json({ code: 0, data: content, msg: "ok" });
}

function parseJSON(text: string) {
    if (!text) return null;
    try {
        return JSON.parse(text) as unknown;
    } catch {
        return { message: text };
    }
}

function readAssistantContent(data: unknown) {
    if (!data || typeof data !== "object") return "";
    const payload = data as { choices?: Array<{ message?: { content?: string | Array<{ text?: string }> } }> };
    const content = payload.choices?.[0]?.message?.content;
    if (typeof content === "string") return content.trim();
    if (Array.isArray(content)) return content.map((item) => item.text || "").join("").trim();
    return "";
}

function readUpstreamError(data: unknown) {
    if (!data || typeof data !== "object") return "";
    const payload = data as { error?: string | { message?: string }; msg?: string; message?: string };
    if (typeof payload.error === "string") return payload.error;
    return payload.error?.message || payload.msg || payload.message || "";
}
