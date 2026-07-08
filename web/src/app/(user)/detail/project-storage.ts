import localforage from "localforage";

const DETAIL_PROJECTS_KEY = "detail-workbench:projects";

export const detailProjectStore = localforage.createInstance({ name: "infinite-canvas", storeName: "detail_projects" });

export async function readStoredDetailProjects<T>() {
    const stored = await detailProjectStore.getItem<T[]>(DETAIL_PROJECTS_KEY);
    if (Array.isArray(stored)) return stored;
    const legacy = JSON.parse(localStorage.getItem(DETAIL_PROJECTS_KEY) || "[]") as T[];
    if (Array.isArray(legacy) && legacy.length) await detailProjectStore.setItem(DETAIL_PROJECTS_KEY, serializeDetailProjects(legacy));
    return Array.isArray(legacy) ? legacy : [];
}

export function serializeDetailProjects<T extends { references?: Array<Record<string, unknown>>; screens?: Array<Record<string, unknown>> }>(items: T[]) {
    return items.map((project) => ({
        ...project,
        references: (project.references || []).map((reference) => ({
            ...reference,
            url: reference.storageKey ? String(reference.remoteUrl || "") : stableImageValue(reference.url),
            dataUrl: reference.storageKey ? "" : stableImageValue(reference.dataUrl),
            uploadStatus: reference.uploadStatus === "uploading" ? "failed" : reference.uploadStatus,
        })),
        screens: (project.screens || []).map((screen) => ({
            ...screen,
            imageUrl: screen.storageKey ? "" : stableImageValue(screen.imageUrl),
            status: screen.status === "generating" ? "failed" : screen.status,
            error: screen.status === "generating" ? "上次生成中断，请重新生成" : screen.error,
        })),
    }));
}

function stableImageValue(value: unknown) {
    return typeof value === "string" && value.startsWith("blob:") ? "" : value;
}
