"use client";

import { readImageMeta } from "@/lib/image-utils";
import { getImageBlob, imageToDataUrl, uploadImage, type UploadedImage } from "@/services/image-storage";
import type { ReferenceImage } from "@/types/image";

type ImageBedUploadResponse = {
    code?: number;
    data?: {
        url?: string;
    };
    msg?: string;
};

const IMAGE_BED_CACHE_KEY = "infinite-canvas:image-bed-reference-urls:v2";
const MAX_REFERENCE_IMAGES = 20;
const MAX_REFERENCE_IMAGE_BYTES = 40 * 1024 * 1024;
const MAX_REFERENCE_IMAGE_PIXELS = 64 * 1000 * 1000;
const REFERENCE_UPLOAD_CONCURRENCY = 4;
const remoteUploadPromises = new Map<string, Promise<string>>();

export function isRemoteImageUrl(value?: string) {
    return /^https?:\/\//i.test(String(value || ""));
}

export function imageAiUrl(image: Pick<ReferenceImage, "remoteUrl" | "url" | "dataUrl">) {
    if (isRemoteImageUrl(image.remoteUrl)) return image.remoteUrl;
    return "";
}

export async function ensureReferenceImagesRemoteUrls(images: ReferenceImage[]) {
    if (images.length > MAX_REFERENCE_IMAGES) {
        throw new Error(`参考图最多支持 ${MAX_REFERENCE_IMAGES} 张`);
    }
    return mapWithConcurrency(images, REFERENCE_UPLOAD_CONCURRENCY, ensureReferenceImageRemoteUrl);
}

export async function ensureReferenceImageRemoteUrl(image: ReferenceImage): Promise<ReferenceImage> {
    const existing = imageAiUrl(image);
    if (existing) return { ...image, remoteUrl: existing };

    const cacheKey = referenceCacheKey(image);
    const cached = readCachedUrl(cacheKey);
    if (cached) return { ...image, remoteUrl: cached };

    const inflight = cacheKey ? remoteUploadPromises.get(cacheKey) : undefined;
    if (inflight) return { ...image, remoteUrl: await inflight };

    const blob = await referenceImageBlob(image);
    const checked = await validateReferenceBlob(blob);
    const blobKey = `blob:${checked.hash}`;
    const blobCached = readCachedUrl(blobKey);
    if (blobCached) return { ...image, remoteUrl: blobCached };

    const inflightBlob = remoteUploadPromises.get(blobKey);
    if (inflightBlob) return { ...image, remoteUrl: await inflightBlob };

    const upload = uploadReferenceBlobToImageBed(blob, image.name || "reference.png");
    remoteUploadPromises.set(blobKey, upload);
    if (cacheKey) remoteUploadPromises.set(cacheKey, upload);
    try {
        const remoteUrl = await upload;
        writeCachedUrl(cacheKey, remoteUrl);
        writeCachedUrl(blobKey, remoteUrl);
        return { ...image, remoteUrl };
    } finally {
        if (cacheKey) remoteUploadPromises.delete(cacheKey);
        remoteUploadPromises.delete(blobKey);
    }
}

export async function uploadReferenceImage(input: File | Blob): Promise<UploadedImage & { remoteUrl: string }> {
    await validateReferenceBlob(input);
    const uploaded = await uploadImage(input);
    const name = input instanceof File ? input.name || "reference.png" : "reference.png";
    const remoteUrl = await uploadReferenceBlobToImageBed(input, name);
    writeCachedUrl(uploaded.storageKey, remoteUrl);
    return { ...uploaded, remoteUrl };
}

export async function uploadReferenceBlobToImageBed(blob: Blob, name: string) {
    await validateReferenceBlob(blob);
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
    const sourceUrl = isRemoteImageUrl(image.url) ? image.url : isRemoteImageUrl(image.dataUrl) ? image.dataUrl : "";
    if (sourceUrl) return fetchImageBlob(sourceUrl);
    const dataUrl = await imageToDataUrl(image);
    if (!dataUrl) throw new Error("参考图已丢失，无法上传图床");
    return fetch(dataUrl).then((response) => response.blob());
}

async function fetchImageBlob(url: string) {
    try {
        const response = await fetch(url);
        if (response.ok) return response.blob();
    } catch {
        // Cross-origin images can fail in the browser; use the same-origin proxy below.
    }
    const response = await fetch(`/api/image-fetch?url=${encodeURIComponent(url)}`);
    if (!response.ok) throw new Error(`参考图读取失败：${response.status}`);
    return response.blob();
}

function referenceCacheKey(image: ReferenceImage) {
    const storageKey = image.storageKey?.trim();
    if (storageKey) return storageKey;
    const remoteSource = [image.remoteUrl, image.url, image.dataUrl].find((value) => isRemoteImageUrl(value));
    if (remoteSource) return `url:${stableReferenceHash(remoteSource)}`;
    if (image.dataUrl?.startsWith("data:")) return `data:${stableReferenceHash(image.dataUrl)}`;
    return "";
}

function stableReferenceHash(value: string) {
    let hash = 2166136261;
    for (let index = 0; index < value.length; index += 1) {
        hash ^= value.charCodeAt(index);
        hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0).toString(36);
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

async function validateReferenceBlob(blob: Blob) {
    if (!blob.type.startsWith("image/")) {
        throw new Error("参考图格式不支持");
    }
    if (blob.size > MAX_REFERENCE_IMAGE_BYTES) {
        throw new Error("参考图文件过大，请换一张参考图");
    }
    const url = URL.createObjectURL(blob);
    try {
        const meta = await readImageMeta(url);
        if (meta.width * meta.height > MAX_REFERENCE_IMAGE_PIXELS) {
            throw new Error("参考图像素过大，请换一张参考图");
        }
        return { ...meta, hash: await blobHash(blob) };
    } finally {
        URL.revokeObjectURL(url);
    }
}

async function blobHash(blob: Blob) {
    const data = await blob.arrayBuffer();
    if (!globalThis.crypto?.subtle) {
        return stableReferenceHash(`${blob.type}:${blob.size}:${simpleBufferHash(data)}`);
    }
    const digest = await crypto.subtle.digest("SHA-256", data);
    return Array.from(new Uint8Array(digest))
        .map((value) => value.toString(16).padStart(2, "0"))
        .join("");
}

function simpleBufferHash(data: ArrayBuffer) {
    let hash = 2166136261;
    const bytes = new Uint8Array(data);
    for (let index = 0; index < bytes.length; index += 1) {
        hash ^= bytes[index];
        hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0).toString(36);
}

async function mapWithConcurrency<T, R>(items: T[], concurrency: number, mapper: (item: T, index: number) => Promise<R>) {
    const result = new Array<R>(items.length);
    let nextIndex = 0;
    const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
        while (nextIndex < items.length) {
            const index = nextIndex;
            nextIndex += 1;
            result[index] = await mapper(items[index], index);
        }
    });
    await Promise.all(workers);
    return result;
}
