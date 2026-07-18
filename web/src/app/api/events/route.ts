import type { NextRequest } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

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
    headers.set("cache-control", "no-store, no-transform");
    headers.set("content-type", "text/event-stream; charset=utf-8");
    return headers;
}

export async function GET(request: NextRequest) {
    const apiBaseUrl = process.env.API_BASE_URL || "http://127.0.0.1:8080";
    const target = `${apiBaseUrl.replace(/\/$/, "")}/api/events${request.nextUrl.search}`;
    const response = await fetch(target, {
        method: "GET",
        headers: proxyHeaders(request),
        redirect: "manual",
        cache: "no-store",
    });

    return new Response(response.body, {
        status: response.status,
        statusText: response.statusText,
        headers: responseHeaders(response),
    });
}
