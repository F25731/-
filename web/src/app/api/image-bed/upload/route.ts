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

type InternalImageBedSettingsResponse = {
    code?: number;
    data?: {
        uploadUrl?: string;
        apiKey?: string;
    };
};

const DEFAULT_IMAGE_BED_UPLOAD_URL = "https://tc.zmoapi.cn/api/upload";
const MAX_REFERENCE_IMAGE_BYTES = 40 * 1024 * 1024;

export async function POST(request: NextRequest) {
    const { uploadUrl, apiKey } = await resolveImageBedConfig();
    if (!apiKey) {
        return NextResponse.json({ code: 1, data: null, msg: "图床 API Key 未配置" }, { status: 500 });
    }

    const input = await request.formData();
    const file = input.get("file");
    if (!(file instanceof File)) {
        return NextResponse.json({ code: 1, data: null, msg: "请上传图片文件" }, { status: 400 });
    }

    if (!file.type.startsWith("image/")) {
        return NextResponse.json({ code: 1, data: null, msg: "Uploaded file is not an image" }, { status: 415 });
    }
    if (file.size > MAX_REFERENCE_IMAGE_BYTES) {
        return NextResponse.json({ code: 1, data: null, msg: "Reference image is too large" }, { status: 413 });
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

async function resolveImageBedConfig() {
    let uploadUrl = (process.env.IMAGE_BED_UPLOAD_URL || DEFAULT_IMAGE_BED_UPLOAD_URL).trim();
    let apiKey = (process.env.IMAGE_BED_API_KEY || "").trim();
    const token = (process.env.JWT_SECRET || "").trim();
    if (!token) return { uploadUrl, apiKey };

    try {
        const baseURL = (process.env.INTERNAL_API_BASE_URL || process.env.API_BASE_URL || "http://127.0.0.1:8080").replace(/\/+$/, "");
        const response = await fetch(`${baseURL}/api/internal/image-bed-settings`, {
            headers: { "x-infinite-canvas-internal-token": token },
            cache: "no-store",
        });
        if (!response.ok) return { uploadUrl, apiKey };
        const payload = (await response.json().catch(() => null)) as InternalImageBedSettingsResponse | null;
        const configuredUploadUrl = payload?.data?.uploadUrl?.trim();
        const configuredApiKey = payload?.data?.apiKey?.trim();
        if (configuredUploadUrl) uploadUrl = configuredUploadUrl;
        if (configuredApiKey) apiKey = configuredApiKey;
    } catch {
        // Fall back to environment variables if the API service is unavailable.
    }
    return { uploadUrl, apiKey };
}

function parseResponseBody(text: string): ImageBedResponse {
    if (!text) return {};
    try {
        return JSON.parse(text) as ImageBedResponse;
    } catch {
        return { msg: text.slice(0, 160) };
    }
}
