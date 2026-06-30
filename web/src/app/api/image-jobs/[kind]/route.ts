import type { NextRequest } from "next/server";

import { createImageJob } from "@/server/image-jobs/store";

export const runtime = "nodejs";
export const maxDuration = 300;

type RouteContext = {
    params: Promise<{ kind: string }>;
};

const imageApiBaseUrl = (process.env.IMAGE_API_BASE_URL || "https://api.zmoapi.cn").replace(/\/+$/, "");
const imageJobTargets: Record<string, string> = {
    generations: `${imageApiBaseUrl}/v1/images/generations`,
    edits: `${imageApiBaseUrl}/v1/images/edits`,
};

export async function POST(request: NextRequest, context: RouteContext) {
    const { kind } = await context.params;
    const target = imageJobTargets[kind];
    if (!target) {
        return Response.json({ code: 1, data: null, msg: "Unsupported image job type" }, { status: 404 });
    }

    const body = await request.arrayBuffer();
    const headers = forwardHeaders(request);
    const job = createImageJob(() => forwardImageRequest(target, body, headers));
    return Response.json({ code: 0, data: { id: job.id, status: job.status }, msg: "ok" });
}

function forwardHeaders(request: NextRequest) {
    const headers = new Headers();
    const authorization = request.headers.get("authorization");
    const contentType = request.headers.get("content-type");
    if (authorization) headers.set("authorization", authorization);
    if (contentType) headers.set("content-type", contentType);
    return headers;
}

async function forwardImageRequest(target: string, body: ArrayBuffer, headers: Headers) {
    const response = await fetch(target, {
        method: "POST",
        headers,
        body,
    });
    const text = await response.text();
    const payload = parseResponseBody(text);
    if (!response.ok) {
        throw new Error(readResponseError(payload) || `Image generation failed, HTTP ${response.status}`);
    }
    return payload;
}

function parseResponseBody(text: string) {
    if (!text) return null;
    try {
        return JSON.parse(text) as unknown;
    } catch {
        return { message: text };
    }
}

function readResponseError(payload: unknown) {
    if (!payload || typeof payload !== "object") return "";
    const data = payload as {
        detail?: string | { error?: string };
        error?: string | { message?: string };
        msg?: string;
        message?: string;
    };
    if (typeof data.detail === "string") return data.detail;
    if (data.detail && typeof data.detail === "object") return data.detail.error || "";
    if (typeof data.error === "string") return data.error;
    return data.error?.message || data.msg || data.message || "";
}
