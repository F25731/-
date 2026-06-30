import { randomUUID } from "node:crypto";

type ImageJobStatus = "pending" | "running" | "succeeded" | "failed";

export type ImageJobSnapshot = {
    id: string;
    status: ImageJobStatus;
    data?: unknown;
    error?: string;
    createdAt: number;
    updatedAt: number;
};

type ImageJobStore = {
    jobs: Map<string, ImageJobSnapshot>;
};

const globalStore = globalThis as typeof globalThis & {
    __infiniteCanvasImageJobs?: ImageJobStore;
};

const store = globalStore.__infiniteCanvasImageJobs || { jobs: new Map<string, ImageJobSnapshot>() };
globalStore.__infiniteCanvasImageJobs = store;

const IMAGE_JOB_TTL_MS = 30 * 60 * 1000;
const MAX_IMAGE_JOBS = 300;

export function createImageJob(run: () => Promise<unknown>) {
    cleanupImageJobs();
    const now = Date.now();
    const id = randomUUID();
    const job: ImageJobSnapshot = {
        id,
        status: "pending",
        createdAt: now,
        updatedAt: now,
    };
    store.jobs.set(id, job);

    void runImageJob(id, run);
    return job;
}

export function getImageJob(id: string) {
    cleanupImageJobs();
    return store.jobs.get(id) || null;
}

async function runImageJob(id: string, run: () => Promise<unknown>) {
    updateImageJob(id, { status: "running" });
    try {
        updateImageJob(id, { status: "succeeded", data: await run() });
    } catch (error) {
        updateImageJob(id, { status: "failed", error: readErrorMessage(error) });
    }
}

function updateImageJob(id: string, patch: Partial<ImageJobSnapshot>) {
    const current = store.jobs.get(id);
    if (!current) return;
    store.jobs.set(id, {
        ...current,
        ...patch,
        updatedAt: Date.now(),
    });
}

function cleanupImageJobs() {
    const now = Date.now();
    for (const [id, job] of store.jobs) {
        if (now - job.updatedAt > IMAGE_JOB_TTL_MS) store.jobs.delete(id);
    }
    if (store.jobs.size <= MAX_IMAGE_JOBS) return;
    const removable = [...store.jobs.values()]
        .sort((a, b) => a.updatedAt - b.updatedAt)
        .slice(0, store.jobs.size - MAX_IMAGE_JOBS);
    removable.forEach((job) => store.jobs.delete(job.id));
}

function readErrorMessage(error: unknown) {
    return error instanceof Error ? error.message : "Image generation failed";
}
