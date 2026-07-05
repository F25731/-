"use client";

import { getImageBlob, imageToDataUrl, uploadImage, type UploadedImage } from "@/services/image-storage";
import type { ReferenceImage } from "@/types/image";

type ImageBedUploadResponse = {
    code?: number;
    data?: {
        url?: string;
    };
    msg?: string;
};

const IMAGE_BED_CACHE_KEY = "infinite-canvas:image-bed-reference-urls:v1";
const remoteUploadPromises = new Map<string, Promise<string>>();

export function isRemoteImageUrl(value?: string) {
    return /^https?:\/\//i.test(String(value || ""));
}

export function imageAiUrl(image: Pick<ReferenceImage, "remoteUrl" | "url" | "dataUrl">) {
    if (isRemoteImageUrl(image.remoteUrl)) return image.remoteUrl;
    if (isRemoteImageUrl(image.url)) return image.url;
    if (isRemoteImageUrl(image.dataUrl)) return image.dataUrl;
    return "";
}

export async function ensureReferenceImagesRemoteUrls(images: ReferenceImage[]) {
    return Promise.all(images.map((image) => ensureReferenceImageRemoteUrl(image)));
}

export async function ensureReferenceImageRemoteUrl(image: ReferenceImage): Promise<ReferenceImage> {
    const existing = imageAiUrl(image);
    if (existing) return { ...image, remoteUrl: existing };

    const cacheKey = referenceCacheKey(image);
    const cached = readCachedUrl(cacheKey);
    if (cached) return { ...image, remoteUrl: cached };

    const inflight = cacheKey ? remoteUploadPromises.get(cacheKey) : undefined;
    if (inflight) return { ...image, remoteUrl: await inflight };

    const upload = (async () => uploadReferenceBlobToImageBed(await referenceImageBlob(image), image.name || "reference.png"))();
    if (cacheKey) remoteUploadPromises.set(cacheKey, upload);
    try {
        const remoteUrl = await upload;
        writeCachedUrl(cacheKey, remoteUrl);
        return { ...image, remoteUrl };
    } finally {
        if (cacheKey) remoteUploadPromises.delete(cacheKey);
    }
}

export async function uploadReferenceImage(input: File | Blob): Promise<UploadedImage & { remoteUrl: string }> {
    const uploaded = await uploadImage(input);
    const name = input instanceof File ? input.name || "reference.png" : "reference.png";
    const remoteUrl = await uploadReferenceBlobToImageBed(input, name);
    writeCachedUrl(uploaded.storageKey, remoteUrl);
    return { ...uploaded, remoteUrl };
}

export async function uploadReferenceBlobToImageBed(blob: Blob, name: string) {
    const formData = new FormData();
    formData.set("file", blob, name || "reference.png");

    const response = await fetch("/api/image-bed/upload", {
        method: "POST",
        body: formData,
    });
    const payload = (await response.json().catch(() => null)) as ImageBedUploadResponse | null;
    const remoteUrl = payload?.data?.url || "";
    if (!response.ok || payload?.code !== 0 || !remoteUrl) {
        throw new Error(payload?.msg || "参考图上传图床失败");
    }
    return remoteUrl;
}

async function referenceImageBlob(image: ReferenceImage) {
    if (image.storageKey?.startsWith("image:")) {
        const blob = await getImageBlob(image.storageKey);
        if (blob) return blob;
    }
    const dataUrl = await imageToDataUrl(image);
    if (!dataUrl) throw new Error("参考图已丢失，无法上传图床");
    return fetch(dataUrl).then((response) => response.blob());
}

function referenceCacheKey(image: ReferenceImage) {
    return image.storageKey || image.id || image.name || "";
}

function readCache() {
    if (typeof window === "undefined") return {};
    try {
        return JSON.parse(window.localStorage.getItem(IMAGE_BED_CACHE_KEY) || "{}") as Record<string, string>;
    } catch {
        return {};
    }
}

function readCachedUrl(key: string) {
    if (!key) return "";
    const value = readCache()[key] || "";
    return isRemoteImageUrl(value) ? value : "";
}

function writeCachedUrl(key: string, url: string) {
    if (typeof window === "undefined" || !key || !isRemoteImageUrl(url)) return;
    const cache = readCache();
    cache[key] = url;
    window.localStorage.setItem(IMAGE_BED_CACHE_KEY, JSON.stringify(cache));
}
