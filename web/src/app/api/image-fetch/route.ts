import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

export const runtime = "nodejs";
export const maxDuration = 120;

const MAX_IMAGE_FETCH_BYTES = 40 * 1024 * 1024;
const MAX_REDIRECTS = 3;

export async function GET(request: NextRequest) {
    const url = request.nextUrl.searchParams.get("url") || "";
    if (!(await isSafeRemoteUrl(url))) {
        return NextResponse.json({ code: 1, msg: "Invalid image url" }, { status: 400 });
    }

    const response = await fetchRemote(url, MAX_REDIRECTS);
    if (!response.ok) {
        return NextResponse.json({ code: 1, msg: `Image fetch failed, HTTP ${response.status}` }, { status: response.status });
    }
    const contentType = response.headers.get("content-type") || "application/octet-stream";
    if (!contentType.startsWith("image/")) {
        return NextResponse.json({ code: 1, msg: "URL is not an image" }, { status: 415 });
    }
    const contentLength = Number(response.headers.get("content-length") || "0");
    if (contentLength > MAX_IMAGE_FETCH_BYTES) {
        return NextResponse.json({ code: 1, msg: "Image is too large" }, { status: 413 });
    }

    const body = await readLimited(response, MAX_IMAGE_FETCH_BYTES);
    if (!body) return NextResponse.json({ code: 1, msg: "Image is too large" }, { status: 413 });

    return new Response(body, {
        headers: {
            "content-type": contentType,
            "cache-control": "no-store",
        },
    });
}

async function fetchRemote(url: string, redirectsLeft: number): Promise<Response> {
    const response = await fetch(url, { redirect: "manual", cache: "no-store" });
    if (response.status >= 300 && response.status < 400 && response.headers.get("location")) {
        if (redirectsLeft <= 0) return new Response(null, { status: 508, statusText: "Too many redirects" });
        const next = new URL(response.headers.get("location") || "", url).toString();
        if (!(await isSafeRemoteUrl(next))) return new Response(null, { status: 400, statusText: "Invalid redirect url" });
        return fetchRemote(next, redirectsLeft - 1);
    }
    return response;
}

async function readLimited(response: Response, maxBytes: number) {
    const reader = response.body?.getReader();
    if (!reader) return response.arrayBuffer();
    const chunks: Uint8Array[] = [];
    let total = 0;
    while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (!value) continue;
        total += value.byteLength;
        if (total > maxBytes) {
            await reader.cancel();
            return null;
        }
        chunks.push(value);
    }
    const output = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
        output.set(chunk, offset);
        offset += chunk.byteLength;
    }
    return output.buffer;
}

async function isSafeRemoteUrl(value: string) {
    let parsed: URL;
    try {
        parsed = new URL(value);
    } catch {
        return false;
    }
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return false;
    const host = parsed.hostname.toLowerCase().replace(/\.$/, "");
    if (!host || host === "localhost" || host.endsWith(".localhost")) return false;
    if (isBlockedIP(host)) return false;
    if (isIP(host)) return true;
    try {
        const addresses = await lookup(host, { all: true });
        return addresses.length > 0 && addresses.every((item) => !isBlockedIP(item.address));
    } catch {
        return false;
    }
}

function isBlockedIP(value: string) {
    const normalized = value.replace(/^\[|\]$/g, "");
    if (normalized === "::1" || normalized === "::" || normalized.toLowerCase().startsWith("fe80:") || normalized.toLowerCase().startsWith("fc") || normalized.toLowerCase().startsWith("fd")) return true;
    const parts = normalized.split(".").map((part) => Number(part));
    if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return false;
    const [a, b] = parts;
    return a === 10 || a === 127 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 169 && b === 254) || a === 0 || a >= 224;
}
