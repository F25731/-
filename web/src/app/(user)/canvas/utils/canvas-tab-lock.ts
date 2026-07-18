"use client";

const LOCK_TTL_MS = 8000;
const LOCK_RENEW_MS = 2500;
const TAB_ID_KEY = "infinite-canvas:tab-id";
const LOCK_KEY_PREFIX = "infinite-canvas:canvas-lock:";

export type CanvasProjectLock = {
    projectId: string;
    tabId: string;
    expiresAt: number;
};

let memoryTabId = "";

export function getCanvasTabId() {
    if (memoryTabId) return memoryTabId;
    if (typeof window === "undefined") {
        memoryTabId = `server-${Math.random().toString(36).slice(2)}`;
        return memoryTabId;
    }
    const existing = window.sessionStorage.getItem(TAB_ID_KEY);
    if (existing) {
        memoryTabId = existing;
        return memoryTabId;
    }
    memoryTabId = `tab-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    window.sessionStorage.setItem(TAB_ID_KEY, memoryTabId);
    return memoryTabId;
}

export function canvasProjectLockKey(projectId: string) {
    return `${LOCK_KEY_PREFIX}${projectId}`;
}

export function readCanvasProjectLock(projectId: string): CanvasProjectLock | null {
    if (typeof window === "undefined") return null;
    try {
        const value = window.localStorage.getItem(canvasProjectLockKey(projectId));
        if (!value) return null;
        const lock = JSON.parse(value) as CanvasProjectLock;
        if (!lock.tabId || lock.expiresAt <= Date.now()) return null;
        return lock;
    } catch {
        return null;
    }
}

export function canWriteCanvasProject(projectId: string, tabId = getCanvasTabId()) {
    const lock = readCanvasProjectLock(projectId);
    return !lock || lock.tabId === tabId;
}

export function claimCanvasProjectLock(projectId: string, tabId = getCanvasTabId()) {
    if (typeof window === "undefined") return true;
    const lock = readCanvasProjectLock(projectId);
    if (lock && lock.tabId !== tabId) return false;
    const next: CanvasProjectLock = { projectId, tabId, expiresAt: Date.now() + LOCK_TTL_MS };
    window.localStorage.setItem(canvasProjectLockKey(projectId), JSON.stringify(next));
    return true;
}

export function releaseCanvasProjectLock(projectId: string, tabId = getCanvasTabId()) {
    if (typeof window === "undefined") return;
    const lock = readCanvasProjectLock(projectId);
    if (lock?.tabId === tabId) window.localStorage.removeItem(canvasProjectLockKey(projectId));
}

export function startCanvasProjectLock(projectId: string, onChange: (canWrite: boolean) => void) {
    if (typeof window === "undefined") return () => undefined;
    const tabId = getCanvasTabId();
    let stopped = false;
    const renew = () => {
        if (stopped) return;
        onChange(claimCanvasProjectLock(projectId, tabId));
    };
    const onStorage = (event: StorageEvent) => {
        if (event.key === canvasProjectLockKey(projectId)) renew();
    };
    const onBeforeUnload = () => releaseCanvasProjectLock(projectId, tabId);

    renew();
    const timer = window.setInterval(renew, LOCK_RENEW_MS);
    window.addEventListener("storage", onStorage);
    window.addEventListener("beforeunload", onBeforeUnload);

    return () => {
        stopped = true;
        window.clearInterval(timer);
        window.removeEventListener("storage", onStorage);
        window.removeEventListener("beforeunload", onBeforeUnload);
        releaseCanvasProjectLock(projectId, tabId);
    };
}
