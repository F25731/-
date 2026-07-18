import type { NextRequest } from "next/server";

export const runtime = "nodejs";

type RouteContext = {
    params: Promise<{ id: string }>;
};

function responseHeaders(response: Response) {
    const headers = new Headers(response.headers);
    headers.delete("content-length");
    headers.delete("content-encoding");
    headers.delete("transfer-encoding");
    return headers;
}

export async function POST(_request: NextRequest, context: RouteContext) {
    const { id } = await context.params;
    const apiBaseUrl = process.env.API_BASE_URL || "http://127.0.0.1:8080";
    const target = `${apiBaseUrl.replace(/\/$/, "")}/api/image-jobs/cancel/${encodeURIComponent(id)}`;
    const response = await fetch(target, { method: "POST", redirect: "manual", cache: "no-store" });
    const headers = responseHeaders(response);
    headers.set("cache-control", "no-store");
    return new Response(response.body, {
        status: response.status,
        statusText: response.statusText,
        headers,
    });
}
