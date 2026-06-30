import type { NextRequest } from "next/server";

export const runtime = "nodejs";

type UpstreamTokenUsageResponse = {
    code?: boolean;
    success?: boolean;
    data?: unknown;
    message?: string;
};

export async function GET(request: NextRequest) {
    const authorization = request.headers.get("authorization") || "";
    if (!authorization.trim()) {
        return Response.json({ code: 1, data: null, msg: "请先填写 API Key" }, { status: 401 });
    }

    const baseUrl = (process.env.IMAGE_API_BASE_URL || "https://api.zmoapi.cn").replace(/\/+$/, "");
    const target = `${baseUrl}/api/usage/token/`;

    try {
        const response = await fetch(target, {
            method: "GET",
            headers: { Authorization: authorization },
            cache: "no-store",
        });
        const payload = (await response.json().catch(() => null)) as UpstreamTokenUsageResponse | null;
        if (response.status === 429) {
            return Response.json({ code: 1, data: null, msg: "余额查询过于频繁，请几分钟后再刷新" }, { status: 429 });
        }
        if (!response.ok || !payload?.code || !payload.data) {
            const status = response.status >= 400 ? response.status : 401;
            return Response.json({ code: 1, data: null, msg: payload?.message || "API Key 无效或不属于当前站点" }, { status });
        }
        return Response.json({ code: 0, data: payload.data, msg: payload.message || "ok" });
    } catch (error) {
        console.error("Failed to query token usage", target, error);
        return Response.json({ code: 1, data: null, msg: "余额查询失败，请稍后重试" }, { status: 502 });
    }
}
