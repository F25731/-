"use client";

import { create } from "zustand";
import { persist, type PersistStorage, type StorageValue } from "zustand/middleware";

import { nanoid } from "nanoid";
import { localForageStorage } from "@/lib/localforage-storage";
import type { CanvasBackgroundMode } from "@/lib/canvas-theme";
import type { CanvasAssistantReference, CanvasAssistantSession, CanvasConnection, CanvasNodeData, ViewportTransform } from "../types";
import { applyCanvasOperation, type CanvasOperation } from "../utils/canvas-operations";
import { canWriteCanvasProject, getCanvasTabId } from "../utils/canvas-tab-lock";

export const CANVAS_PROJECT_SCHEMA_VERSION = 4;
const MAX_ASSISTANT_SESSIONS = 30;
const MAX_ASSISTANT_MESSAGES = 80;
const MAX_ASSISTANT_REFERENCES = 12;
const MAX_ASSISTANT_TEXT_LENGTH = 8000;
const MAX_ASSISTANT_LOGS = 12;

export type CanvasProject = {
    id: string;
    schemaVersion: number;
    canvasRevision: number;
    lastSavedAt?: string;
    lastWriterTabId?: string;
    title: string;
    createdAt: string;
    updatedAt: string;
    nodes: CanvasNodeData[];
    connections: CanvasConnection[];
    chatSessions: CanvasAssistantSession[];
    activeChatId: string | null;
    backgroundMode: CanvasBackgroundMode;
    showImageInfo: boolean;
    viewport: ViewportTransform;
};

type CanvasProjectPatch = Partial<Pick<CanvasProject, "nodes" | "connections" | "chatSessions" | "activeChatId" | "backgroundMode" | "showImageInfo" | "viewport">>;

export type CanvasProjectWriteOptions = {
    expectedRevision?: number;
    sourceTabId?: string;
    force?: boolean;
};

type CanvasStore = {
    hydrated: boolean;
    projects: CanvasProject[];
    createProject: (title?: string) => string;
    importProject: (project: Partial<CanvasProject>) => string;
    openProject: (id: string) => CanvasProject | null;
    renameProject: (id: string, title: string) => void;
    deleteProjects: (ids: string[]) => void;
    updateProject: (id: string, patch: CanvasProjectPatch, options?: CanvasProjectWriteOptions) => boolean;
    applyProjectOperation: (id: string, operation: CanvasOperation, options?: CanvasProjectWriteOptions) => boolean;
};

const initialViewport: ViewportTransform = { x: 0, y: 0, k: 1 };
const CANVAS_STORE_KEY = "infinite-canvas:canvas_store";
type PersistedCanvasState = Pick<CanvasStore, "projects">;
let saveTimer: ReturnType<typeof setTimeout> | null = null;
let queuedPersistState: PersistedCanvasState | null = null;

const canvasStorage: PersistStorage<CanvasStore> = {
    getItem: async (name) => {
        const value = await localForageStorage.getItem(name);
        if (!value) return null;
        const parsed = JSON.parse(value) as StorageValue<CanvasStore>;
        if (parsed.state?.projects) {
            parsed.state.projects = parsed.state.projects.map(normalizeCanvasProject);
        }
        queuedPersistState = parsed.state as PersistedCanvasState;
        return parsed;
    },
    setItem: (name, value) => {
        const nextState = value.state as PersistedCanvasState;
        if (queuedPersistState && queuedPersistState.projects === nextState.projects) return;
        queuedPersistState = nextState;
        if (saveTimer) clearTimeout(saveTimer);
        saveTimer = setTimeout(() => {
            saveTimer = null;
            void localForageStorage.setItem(name, JSON.stringify(value));
        }, 400);
    },
    removeItem: (name) => localForageStorage.removeItem(name),
};

export const useCanvasStore = create<CanvasStore>()(
    persist(
        (set, get) => ({
            hydrated: false,
            projects: [],
            createProject: (title = "未命名画布") => {
                const now = new Date().toISOString();
                const id = nanoid();
                const project = normalizeCanvasProject({
                    id,
                    title,
                    createdAt: now,
                    updatedAt: now,
                    nodes: [],
                    connections: [],
                    chatSessions: [],
                    activeChatId: null,
                    backgroundMode: "lines",
                    showImageInfo: false,
                    viewport: initialViewport,
                    schemaVersion: CANVAS_PROJECT_SCHEMA_VERSION,
                    canvasRevision: 1,
                    lastSavedAt: now,
                    lastWriterTabId: getCanvasTabId(),
                });
                set((state) => ({ projects: [project, ...state.projects] }));
                return id;
            },
            importProject: (source) => {
                const now = new Date().toISOString();
                const project = normalizeCanvasProject({
                    ...source,
                    id: nanoid(),
                    title: source.title || "导入画布",
                    createdAt: source.createdAt || now,
                    updatedAt: now,
                    canvasRevision: 1,
                    lastSavedAt: now,
                    lastWriterTabId: getCanvasTabId(),
                });
                set((state) => ({ projects: [project, ...state.projects] }));
                return project.id;
            },
            openProject: (id) => {
                const project = get().projects.find((item) => item.id === id) || null;
                return project ? normalizeCanvasProject(project) : null;
            },
            renameProject: (id, title) => {
                set((state) => ({
                    projects: state.projects.map((project) => (project.id === id ? markCanvasProjectWrite({ ...project, title: title.trim() || project.title }, { title: true }, { force: true }) : project)),
                }));
            },
            deleteProjects: (ids) => {
                set((state) => ({ projects: state.projects.filter((project) => !ids.includes(project.id)) }));
            },
            updateProject: (id, patch, options) => {
                let written = false;
                set((state) => ({
                    projects: state.projects.map((project) => {
                        if (project.id !== id || !canPersistCanvasWrite(project, options)) return project;
                        written = true;
                        const changedPatch = pickChangedProjectPatch(project, patch);
                        return markCanvasProjectWrite({ ...project, ...patch }, changedPatch, options);
                    }),
                }));
                return written;
            },
            applyProjectOperation: (id, operation, options) => {
                let written = false;
                set((state) => ({
                    projects: state.projects.map((project) => {
                        if (project.id !== id || !canPersistCanvasWrite(project, options)) return project;
                        const result = applyCanvasOperation(project, operation, options?.expectedRevision);
                        written = true;
                        const patch: CanvasProjectPatch = {};
                        if (result.project.nodes !== project.nodes) patch.nodes = result.project.nodes;
                        if (result.project.connections !== project.connections) patch.connections = result.project.connections;
                        if (result.viewport) patch.viewport = result.viewport;
                        return markCanvasProjectWrite(result.project, patch, options);
                    }),
                }));
                return written;
            },
        }),
        {
            name: CANVAS_STORE_KEY,
            storage: canvasStorage,
            partialize: (state) =>
                ({
                    projects: state.projects.map(normalizeCanvasProject),
                }) as StorageValue<CanvasStore>["state"],
            onRehydrateStorage: () => () => {
                useCanvasStore.setState({ hydrated: true });
            },
        },
    ),
);

export function normalizeCanvasProject(source: Partial<CanvasProject>): CanvasProject {
    const now = new Date().toISOString();
    return {
        id: source.id || nanoid(),
        schemaVersion: CANVAS_PROJECT_SCHEMA_VERSION,
        canvasRevision: positiveRevision(source.canvasRevision),
        lastSavedAt: source.lastSavedAt || source.updatedAt || now,
        lastWriterTabId: source.lastWriterTabId,
        title: source.title || "未命名画布",
        createdAt: source.createdAt || now,
        updatedAt: source.updatedAt || now,
        nodes: Array.isArray(source.nodes) ? source.nodes : [],
        connections: Array.isArray(source.connections) ? source.connections : [],
        chatSessions: normalizeAssistantSessions(source.chatSessions),
        activeChatId: source.activeChatId || null,
        backgroundMode: source.backgroundMode || "lines",
        showImageInfo: Boolean(source.showImageInfo),
        viewport: source.viewport || initialViewport,
    };
}

function canPersistCanvasWrite(project: CanvasProject, options?: CanvasProjectWriteOptions) {
    if (!options?.force && !canWriteCanvasProject(project.id, options?.sourceTabId || getCanvasTabId())) return false;
    if (typeof options?.expectedRevision === "number" && project.canvasRevision !== options.expectedRevision) return false;
    return true;
}

function markCanvasProjectWrite(project: CanvasProject, patch: Partial<Record<keyof CanvasProject | "title", unknown>>, options?: CanvasProjectWriteOptions): CanvasProject {
    const now = new Date().toISOString();
    const bumpsRevision = shouldBumpCanvasRevision(patch);
    return normalizeCanvasProject({
        ...project,
        updatedAt: now,
        lastSavedAt: now,
        lastWriterTabId: options?.sourceTabId || getCanvasTabId(),
        canvasRevision: project.canvasRevision + (bumpsRevision ? 1 : 0),
    });
}

function shouldBumpCanvasRevision(patch: Partial<Record<keyof CanvasProject | "title", unknown>>) {
    return Boolean(patch.title || patch.nodes || patch.connections || patch.backgroundMode || "showImageInfo" in patch);
}

function pickChangedProjectPatch(project: CanvasProject, patch: CanvasProjectPatch): CanvasProjectPatch {
    const changed: CanvasProjectPatch = {};
    if ("nodes" in patch && patch.nodes !== project.nodes) changed.nodes = patch.nodes;
    if ("connections" in patch && patch.connections !== project.connections) changed.connections = patch.connections;
    if ("chatSessions" in patch && patch.chatSessions !== project.chatSessions) changed.chatSessions = patch.chatSessions;
    if ("activeChatId" in patch && patch.activeChatId !== project.activeChatId) changed.activeChatId = patch.activeChatId;
    if ("backgroundMode" in patch && patch.backgroundMode !== project.backgroundMode) changed.backgroundMode = patch.backgroundMode;
    if ("showImageInfo" in patch && patch.showImageInfo !== project.showImageInfo) changed.showImageInfo = patch.showImageInfo;
    if ("viewport" in patch && patch.viewport !== project.viewport) changed.viewport = patch.viewport;
    return changed;
}

function positiveRevision(value: unknown) {
    return typeof value === "number" && Number.isFinite(value) && value > 0 ? Math.floor(value) : 1;
}

function normalizeAssistantSessions(value: unknown): CanvasAssistantSession[] {
    if (!Array.isArray(value)) return [];
    return value
        .slice(0, MAX_ASSISTANT_SESSIONS)
        .map((session) => {
            const raw = session && typeof session === "object" ? (session as Partial<CanvasAssistantSession>) : {};
            const now = new Date().toISOString();
            return {
                id: safeString(raw.id, nanoid(), 120),
                title: safeString(raw.title, "新 Agent", 80),
                summary: safeString(raw.summary, "", 1200),
                messages: normalizeAssistantMessages(raw.messages),
                createdAt: safeString(raw.createdAt, now, 80),
                updatedAt: safeString(raw.updatedAt, now, 80),
            };
        })
        .filter((session) => session.id);
}

function normalizeAssistantMessages(value: unknown): CanvasAssistantSession["messages"] {
    if (!Array.isArray(value)) return [];
    return value.slice(-MAX_ASSISTANT_MESSAGES).map((message) => {
        const raw = message && typeof message === "object" ? (message as CanvasAssistantSession["messages"][number]) : undefined;
        return {
            id: safeString(raw?.id, nanoid(), 120),
            runId: safeString(raw?.runId, "", 120) || undefined,
            turnId: safeString(raw?.turnId, "", 120) || undefined,
            role: raw?.role === "assistant" ? "assistant" : "user",
            mode: "agent" as const,
            agentMode: raw?.agentMode === "detail" ? "detail" : "general",
            detailOptions: normalizeDetailOptions(raw?.detailOptions),
            text: safeString(raw?.text, "", MAX_ASSISTANT_TEXT_LENGTH),
            isLoading: undefined,
            startedAt: undefined,
            references: normalizeAssistantReferences(raw?.references),
            toolRequest: undefined,
            toolRequests: normalizeToolRequests(raw?.toolRequests),
            toolName: (typeof raw?.toolName === "string" ? raw.toolName : undefined) as CanvasAssistantSession["messages"][number]["toolName"],
            toolStatus:
                raw?.toolStatus === "pending" ||
                raw?.toolStatus === "approved" ||
                raw?.toolStatus === "applying" ||
                raw?.toolStatus === "applied" ||
                raw?.toolStatus === "submitted" ||
                raw?.toolStatus === "running" ||
                raw?.toolStatus === "rejected" ||
                raw?.toolStatus === "completed" ||
                raw?.toolStatus === "failed"
                    ? raw.toolStatus
                    : undefined,
            toolResult: safeString(raw?.toolResult, "", 500) || undefined,
            logs: Array.isArray(raw?.logs)
                ? raw.logs
                      .slice(-MAX_ASSISTANT_LOGS)
                      .map((log) => safeString(log, "", 300))
                      .filter(Boolean)
                : undefined,
            activityText: safeString(raw?.activityText, "", 500) || undefined,
            events: normalizeAgentEvents(raw?.events),
        };
    });
}

function normalizeDetailOptions(value: CanvasAssistantSession["messages"][number]["detailOptions"]) {
    if (!value || typeof value !== "object") return undefined;
    return {
        generationMode: value.generationMode === "rough" ? ("rough" as const) : ("precise" as const),
        executionMode: value.executionMode === "step" ? ("step" as const) : ("continuous" as const),
        editScope: value.editScope === "downstream" ? ("downstream" as const) : value.editScope === "all" ? ("all" as const) : ("current" as const),
        composeWhenComplete: value.composeWhenComplete !== false,
    };
}

function normalizeToolRequests(value: unknown): CanvasAssistantSession["messages"][number]["toolRequests"] {
    if (!Array.isArray(value)) return undefined;
    const requests = value.slice(-12).flatMap((item) => {
        if (!item || typeof item !== "object") return [];
        const raw = item as NonNullable<CanvasAssistantSession["messages"][number]["toolRequests"]>[number];
        if (!raw.id || !raw.name) return [];
        return [
            {
                ...raw,
                id: safeString(raw.id, nanoid(), 120),
                runId: safeString(raw.runId, "", 120) || undefined,
                turnId: safeString(raw.turnId, "", 120) || undefined,
                toolCallId: safeString(raw.toolCallId, "", 120) || undefined,
                description: safeString(raw.description, "画布工具", 500),
                expectedRevision: Number.isFinite(raw.expectedRevision) ? Number(raw.expectedRevision) : 1,
                status: raw.status === "completed" || raw.status === "failed" || raw.status === "rejected" ? raw.status : "failed",
                result: safeString(raw.result, "", 500) || undefined,
                error: safeString(raw.error, "", 500) || undefined,
            },
        ];
    });
    return requests.length ? requests : undefined;
}

function normalizeAgentEvents(value: unknown): CanvasAssistantSession["messages"][number]["events"] {
    if (!Array.isArray(value)) return undefined;
    const events = value
        .slice(-80)
        .map((event, index) => {
            const raw = event && typeof event === "object" ? (event as NonNullable<CanvasAssistantSession["messages"][number]["events"]>[number]) : undefined;
            if (!raw?.type || !raw.runId) return null;
            return {
                id: safeString(raw.id, nanoid(), 120),
                type: raw.type,
                runId: safeString(raw.runId, "", 120),
                turnId: safeString(raw.turnId, "", 120) || undefined,
                toolCallId: safeString(raw.toolCallId, "", 120) || undefined,
                generationRunId: safeString(raw.generationRunId, "", 120) || undefined,
                imageJobId: safeString(raw.imageJobId, "", 160) || undefined,
                nodeId: safeString(raw.nodeId, "", 120) || undefined,
                targetNodeId: safeString(raw.targetNodeId, "", 120) || undefined,
                text: safeString(raw.text, "", 500),
                status: raw.status,
                timestamp: Number.isFinite(raw.timestamp) ? Number(raw.timestamp) : Date.now(),
                sequence: Number.isFinite(raw.sequence) ? Number(raw.sequence) : index,
            };
        })
        .filter((event): event is NonNullable<typeof event> => Boolean(event));
    return events.length ? events : undefined;
}

function normalizeAssistantReferences(value: unknown): CanvasAssistantReference[] | undefined {
    if (!Array.isArray(value)) return undefined;
    const references = value
        .slice(0, MAX_ASSISTANT_REFERENCES)
        .map((item) => {
            const raw = item && typeof item === "object" ? (item as Record<string, unknown>) : {};
            const type = (raw.type === "image" || raw.type === "text" || raw.type === "config" ? raw.type : "text") as CanvasAssistantReference["type"];
            return {
                id: safeString(raw.id, nanoid(), 120),
                type,
                title: safeString(raw.title, "引用", 120),
                dataUrl: safeString(raw.dataUrl, "", 2_500_000) || undefined,
                remoteUrl: safeString(raw.remoteUrl, "", 2000) || undefined,
                storageKey: safeString(raw.storageKey, "", 200) || undefined,
                text: safeString(raw.text, "", 4000) || undefined,
            };
        })
        .filter((item) => item.id);
    return references.length ? references : undefined;
}

function safeString(value: unknown, fallback: string, maxLength: number) {
    const text = typeof value === "string" ? value : fallback;
    return text.slice(0, maxLength);
}
