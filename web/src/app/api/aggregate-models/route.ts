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
    const payload = (await request.json().catch(() => null)) as { baseUrl?: string; baseUrls?: string[]; apiKey?: string } | null;
    const baseUrls = Array.from(new Set([...(payload?.baseUrls || []), payload?.baseUrl || ""].map(normalizeBaseUrl).filter(Boolean)));
    const apiKey = String(payload?.apiKey || "").trim();
    if (!baseUrls.length) return Response.json({ code: 1, data: null, msg: "请先配置后台模型请求地址" }, { status: 400 });
    if (!apiKey) return Response.json({ code: 1, data: null, msg: "请先填写 API Key" }, { status: 400 });

    const catalogs: Record<string, string[]> = Object.fromEntries(await Promise.all(baseUrls.map(async (baseUrl) => [baseUrl, await fetchModelIds(baseUrl, apiKey)])));
    if (!Object.values(catalogs).some((ids) => ids.length > 0)) return Response.json({ code: 1, data: null, msg: "接口没有返回可识别的模型列表" }, { status: 400 });
    return Response.json({ code: 0, data: catalogs, msg: "ok" });
}

function normalizeBaseUrl(value: string) {
    return value.trim().replace(/\/+$/, "");
}

async function fetchModelIds(baseUrl: string, apiKey: string) {
    const target = `${baseUrl.endsWith("/v1") ? baseUrl : `${baseUrl}/v1`}/models`;
    try {
        const response = await fetch(target, {
            method: "GET",
            headers: { Authorization: `Bearer ${apiKey}` },
            cache: "no-store",
        });
        const data = (await response.json().catch(() => null)) as ModelListPayload | null;
        if (!response.ok) return [];
        return readModelIds(data);
    } catch {
        return [];
    }
}

function readModelIds(payload: ModelListPayload | null): string[] {
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
