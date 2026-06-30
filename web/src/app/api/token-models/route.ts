import type { NextRequest } from "next/server";

export const runtime = "nodejs";

type UpstreamModelsResponse = {
    data?: unknown;
    success?: boolean;
    error?: { message?: string };
};

export async function GET(request: NextRequest) {
    const authorization = request.headers.get("authorization") || "";
    if (!authorization.trim()) {
        return Response.json({ code: 1, data: null, msg: "请先填写 API Key" }, { status: 401 });
    }

    const baseUrl = (process.env.IMAGE_API_BASE_URL || "https://api.zmoapi.cn").replace(/\/+$/, "");
    const target = `${baseUrl}/v1/models`;

    try {
        const response = await fetch(target, {
            method: "GET",
            headers: { Authorization: authorization },
            cache: "no-store",
        });
        const payload = (await response.json().catch(() => null)) as UpstreamModelsResponse | null;
        if (!response.ok || !payload?.success || !Array.isArray(payload.data)) {
            const status = response.status >= 400 ? response.status : 401;
            return Response.json({ code: 1, data: null, msg: payload?.error?.message || "API Key 无效或不属于当前站点" }, { status });
        }
        return Response.json({ code: 0, data: payload.data, msg: "ok" });
    } catch (error) {
        console.error("Failed to query token models", target, error);
        return Response.json({ code: 1, data: null, msg: "API Key 检测失败，请稍后重试" }, { status: 502 });
    }
}
