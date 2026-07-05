import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const maxDuration = 120;

export async function GET(request: NextRequest) {
    const url = request.nextUrl.searchParams.get("url") || "";
    if (!/^https?:\/\//i.test(url)) {
        return NextResponse.json({ code: 1, msg: "Invalid image url" }, { status: 400 });
    }

    const response = await fetch(url);
    if (!response.ok) {
        return NextResponse.json({ code: 1, msg: `Image fetch failed, HTTP ${response.status}` }, { status: response.status });
    }
    const contentType = response.headers.get("content-type") || "application/octet-stream";
    if (!contentType.startsWith("image/")) {
        return NextResponse.json({ code: 1, msg: "URL is not an image" }, { status: 415 });
    }

    return new Response(await response.arrayBuffer(), {
        headers: {
            "content-type": contentType,
            "cache-control": "no-store",
        },
    });
}
