import type { NextRequest } from "next/server";

export const runtime = "nodejs";
export const maxDuration = 300;

type RouteContext = {
    params: Promise<{ kind: string }>;
};

function proxyHeaders(request: NextRequest) {
    const headers = new Headers(request.headers);
    headers.delete("host");
    headers.delete("content-length");
    headers.delete("connection");
    headers.set("x-forwarded-host", request.nextUrl.host);
    headers.set("x-forwarded-proto", request.nextUrl.protocol.replace(":", ""));
    return headers;
}

function responseHeaders(response: Response) {
    const headers = new Headers(response.headers);
    headers.delete("content-length");
    headers.delete("content-encoding");
    headers.delete("transfer-encoding");
    return headers;
}

export async function POST(request: NextRequest, context: RouteContext) {
    const { kind } = await context.params;
    const apiBaseUrl = process.env.API_BASE_URL || "http://127.0.0.1:8080";
    const target = `${apiBaseUrl.replace(/\/$/, "")}/api/image-jobs/${encodeURIComponent(kind)}`;
    const response = await fetch(target, {
        method: "POST",
        headers: proxyHeaders(request),
        body: request.body,
        duplex: "half",
        redirect: "manual",
    } as RequestInit & { duplex: "half" });
    return new Response(response.body, {
        status: response.status,
        statusText: response.statusText,
        headers: responseHeaders(response),
    });
}
