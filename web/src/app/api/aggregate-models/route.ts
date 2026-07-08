import type { NextRequest } from "next/server";

export const runtime = "nodejs";

type ModelListPayload = {
    data?: unknown;
    success?: boolean;
    error?: { message?: string };
    msg?: string;
    message?: string;
};

export async function POST(request: NextRequest) {
    const payload = (await request.json().catch(() => null)) as { baseUrl?: string; apiKey?: string } | null;
    const baseUrl = normalizeBaseUrl(payload?.baseUrl || "");
    const apiKey = String(payload?.apiKey || "").trim();
    if (!baseUrl) return Response.json({ code: 1, data: null, msg: "请先填写请求地址" }, { status: 400 });
    if (!apiKey) return Response.json({ code: 1, data: null, msg: "请先填写 API Key" }, { status: 400 });

    const target = `${baseUrl.endsWith("/v1") ? baseUrl : `${baseUrl}/v1`}/models`;
    try {
        const response = await fetch(target, {
            method: "GET",
            headers: { Authorization: `Bearer ${apiKey}` },
            cache: "no-store",
        });
        const data = (await response.json().catch(() => null)) as ModelListPayload | null;
        if (!response.ok) return Response.json({ code: 1, data: null, msg: readError(data) || `模型列表检测失败：${response.status}` }, { status: response.status });
        const modelIds = readModelIds(data);
        if (!modelIds.length) return Response.json({ code: 1, data: null, msg: "接口没有返回可识别的模型列表" }, { status: 400 });
        return Response.json({ code: 0, data: modelIds, msg: "ok" });
    } catch {
        return Response.json({ code: 1, data: null, msg: "模型列表检测失败，请检查请求地址或网络" }, { status: 502 });
    }
}

function normalizeBaseUrl(value: string) {
    return value.trim().replace(/\/+$/, "");
}

function readModelIds(payload: ModelListPayload | null) {
    const data = Array.isArray(payload?.data) ? payload.data : [];
    return Array.from(
        new Set(
            data
                .map((item) => {
                    if (typeof item === "string") return item;
                    if (item && typeof item === "object" && "id" in item) return String((item as { id?: unknown }).id || "");
                    return "";
                })
                .map((item) => item.trim())
                .filter(Boolean),
        ),
    );
}

function readError(payload: ModelListPayload | null) {
    return payload?.error?.message || payload?.msg || payload?.message || "";
}
