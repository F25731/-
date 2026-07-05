import type { NextRequest } from "next/server";

import { createImageJob } from "@/server/image-jobs/store";

export const runtime = "nodejs";
export const maxDuration = 300;

type RouteContext = {
    params: Promise<{ kind: string }>;
};

export async function POST(request: NextRequest, context: RouteContext) {
    const { kind } = await context.params;
    const target = imageJobTarget(request, kind);
    if (!target) {
        return Response.json({ code: 1, data: null, msg: "Unsupported image job type" }, { status: 404 });
    }

    const headers = forwardHeaders(request);
    const body = await request.arrayBuffer();
    const job = createImageJob(() => forwardImageRequest(target, kind, body, headers));
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

function imageJobTarget(request: NextRequest, kind: string) {
    if (kind !== "generations" && kind !== "edits") return "";
    const baseUrl = (request.headers.get("x-image-api-base-url") || process.env.IMAGE_API_BASE_URL || "https://api.zmoapi.cn").trim().replace(/\/+$/, "");
    const apiBaseUrl = baseUrl.endsWith("/v1") ? baseUrl : `${baseUrl}/v1`;
    return `${apiBaseUrl}/images/${kind}`;
}

async function forwardImageRequest(target: string, kind: string, body: ArrayBuffer, headers: Headers) {
    const requestBody = kind === "edits" && isJsonRequest(headers) ? await buildEditFormData(body) : body;
    if (requestBody instanceof FormData) headers.delete("content-type");
    const response = await fetch(target, {
        method: "POST",
        headers,
        body: requestBody,
    });
    const text = await response.text();
    const payload = parseResponseBody(text);
    if (!response.ok) {
        throw new Error(readResponseError(payload) || `Image generation failed, HTTP ${response.status}`);
    }
    return payload;
}

function isJsonRequest(headers: Headers) {
    return (headers.get("content-type") || "").toLowerCase().includes("application/json");
}

async function buildEditFormData(body: ArrayBuffer) {
    const payload = JSON.parse(Buffer.from(body).toString("utf8")) as {
        model?: string;
        prompt?: string;
        n?: number | string;
        quality?: string;
        size?: string;
        referenceUrls?: string[];
    };
    const formData = new FormData();
    if (payload.model) formData.set("model", payload.model);
    if (payload.prompt) formData.set("prompt", payload.prompt);
    if (payload.n) formData.set("n", String(payload.n));
    if (payload.quality) formData.set("quality", payload.quality);
    if (payload.size) formData.set("size", payload.size);

    const urls = (payload.referenceUrls || []).filter((url) => /^https?:\/\//i.test(url));
    if (!urls.length) throw new Error("No reference image URLs provided");
    const files = await Promise.all(urls.map((url, index) => fetchReferenceImage(url, index)));
    files.forEach(({ blob, name }) => formData.append("image", blob, name));
    return formData;
}

async function fetchReferenceImage(url: string, index: number) {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`Reference image ${index + 1} download failed, HTTP ${response.status}`);
    const blob = await response.blob();
    const contentType = response.headers.get("content-type") || blob.type || "image/png";
    return { blob: new Blob([blob], { type: contentType }), name: referenceFileName(url, contentType, index) };
}

function referenceFileName(url: string, contentType: string, index: number) {
    const pathname = new URL(url).pathname;
    const name = pathname.split("/").filter(Boolean).pop();
    if (name && /\.[a-z0-9]+$/i.test(name)) return name;
    const ext = contentType.match(/image\/([a-z0-9.+-]+)/i)?.[1] || "png";
    return `reference-${index + 1}.${ext === "jpeg" ? "jpg" : ext}`;
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
