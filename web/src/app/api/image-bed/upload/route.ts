import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const maxDuration = 120;

type ImageBedResponse = {
    code?: number;
    data?: {
        url?: string;
    };
    msg?: string;
};

const DEFAULT_IMAGE_BED_UPLOAD_URL = "https://tc.zmoapi.cn/api/upload";

export async function POST(request: NextRequest) {
    const uploadUrl = (process.env.IMAGE_BED_UPLOAD_URL || DEFAULT_IMAGE_BED_UPLOAD_URL).trim();
    const apiKey = (process.env.IMAGE_BED_API_KEY || "").trim();
    if (!apiKey) {
        return NextResponse.json({ code: 1, data: null, msg: "图床 API Key 未配置" }, { status: 500 });
    }

    const input = await request.formData();
    const file = input.get("file");
    if (!(file instanceof File)) {
        return NextResponse.json({ code: 1, data: null, msg: "请上传图片文件" }, { status: 400 });
    }

    const formData = new FormData();
    formData.set("file", file, file.name || "reference.png");

    const response = await fetch(uploadUrl, {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}` },
        body: formData,
    });
    const text = await response.text();
    const payload = parseResponseBody(text);
    if (!response.ok || payload.code !== 0 || !payload.data?.url) {
        return NextResponse.json({ code: 1, data: null, msg: payload.msg || `图床上传失败：${response.status}` }, { status: response.ok ? 502 : response.status });
    }
    return NextResponse.json({ code: 0, data: { url: payload.data.url }, msg: "ok" });
}

function parseResponseBody(text: string): ImageBedResponse {
    if (!text) return {};
    try {
        return JSON.parse(text) as ImageBedResponse;
    } catch {
        return { msg: text.slice(0, 160) };
    }
}
