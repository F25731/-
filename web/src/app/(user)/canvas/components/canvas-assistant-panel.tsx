"use client";

import { Component, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { ArrowUp, Bot, Check, CheckCircle2, ChevronDown, CircleAlert, ImagePlus, Layers3, LoaderCircle, PanelRightClose, Plus, RotateCcw, Settings2, Square, Trash2, UserRound, X, XCircle } from "lucide-react";
import { App, Button, Modal, Segmented, Switch, Tooltip } from "antd";
import { motion } from "motion/react";
import { Streamdown } from "streamdown";

import { useConfigStore, useEffectiveConfig, type AiConfig } from "@/stores/use-config-store";
import { canvasThemes } from "@/lib/canvas-theme";
import { nanoid } from "nanoid";
import { cn } from "@/lib/utils";
import { buildCanvasAgentSnapshot, listCanvasAgentModels, requestCanvasAgentTurnStream, type CanvasAgentHistoryItem, type CanvasAgentStreamEvent } from "@/services/api/agent";
import { ModelPicker } from "@/components/model-picker";
import { uploadReferenceImage } from "@/services/image-bed";
import { useAssetStore } from "@/stores/use-asset-store";
import { useThemeStore } from "@/stores/use-theme-store";
import {
    CanvasNodeType,
    type CanvasAgentApplyResult,
    type CanvasAgentEvent,
    type CanvasAgentToolRequest,
    type CanvasAssistantMessage,
    type CanvasAssistantReference,
    type CanvasAssistantSession,
    type CanvasConnection,
    type CanvasDetailAgentOptions,
    type CanvasNodeData,
} from "../types";
const PANEL_MOTION_MS = 500;
const PANEL_MOTION_SECONDS = PANEL_MOTION_MS / 1000;
const AGENT_MODEL_STORAGE_KEY = "canvas-agent:selected-model-v1";
const AGENT_FULL_ACCESS_STORAGE_KEY = "canvas-agent:full-access-v1";
const AGENT_MODE_STORAGE_KEY = "canvas-agent:mode-v1";
const DETAIL_GENERATION_MODE_STORAGE_KEY = "canvas-agent:detail-generation-mode-v1";
const DETAIL_EXECUTION_MODE_STORAGE_KEY = "canvas-agent:detail-execution-mode-v1";
const DETAIL_COMPOSE_STORAGE_KEY = "canvas-agent:detail-compose-v1";
const MAX_AGENT_ATTACHMENTS = 6;

type AgentComposerReference = CanvasAssistantReference & {
    uploadStatus?: "uploading" | "ready" | "error";
    uploadError?: string;
};

type CanvasAssistantPanelProps = {
    projectId?: string;
    nodes: CanvasNodeData[];
    connections: CanvasConnection[];
    selectedNodeIds: Set<string>;
    viewport: { x: number; y: number; k: number };
    projectRevision: number;
    canWriteProject: boolean;
    sessions: CanvasAssistantSession[];
    activeSessionId: string | null;
    onSelectNodeIds: (ids: Set<string>) => void;
    onSessionsChange: (sessions: CanvasAssistantSession[], activeSessionId: string | null) => void;
    onApplyAgentTool: (request: CanvasAgentToolRequest, onEvent: (event: CanvasAgentEvent) => void) => Promise<CanvasAgentApplyResult>;
    onCollapseStart: () => void;
    onCollapse: () => void;
};

type CanvasAssistantPanelBoundaryState = { error: Error | null };

class CanvasAssistantPanelBoundary extends Component<{ children: ReactNode }, CanvasAssistantPanelBoundaryState> {
    state: CanvasAssistantPanelBoundaryState = { error: null };

    static getDerivedStateFromError(error: Error) {
        return { error };
    }

    componentDidCatch(error: Error) {
        console.error("Canvas Agent panel crashed", error);
    }

    render() {
        if (this.state.error) {
            return (
                <div className="flex w-[390px] shrink-0 flex-col border-l border-red-200 bg-red-50 p-4 text-sm text-red-700 dark:border-red-900/50 dark:bg-red-950/30 dark:text-red-200">
                    <div className="font-medium">画布 Agent 面板出错</div>
                    <div className="mt-2 break-words opacity-80">{this.state.error.message || "未知前端错误"}</div>
                    <Button className="mt-4 !w-fit" size="small" onClick={() => this.setState({ error: null })}>
                        重新打开面板
                    </Button>
                </div>
            );
        }
        return this.props.children;
    }
}

export function CanvasAssistantPanel(props: CanvasAssistantPanelProps) {
    return (
        <CanvasAssistantPanelBoundary>
            <CanvasAssistantPanelContent {...props} />
        </CanvasAssistantPanelBoundary>
    );
}

function CanvasAssistantPanelContent({
    projectId,
    nodes,
    connections,
    selectedNodeIds,
    viewport,
    projectRevision,
    canWriteProject,
    sessions,
    activeSessionId,
    onSelectNodeIds,
    onSessionsChange,
    onApplyAgentTool,
    onCollapseStart,
    onCollapse,
}: CanvasAssistantPanelProps) {
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    const { message } = App.useApp();
    const effectiveConfig = useEffectiveConfig();
    const cleanupImages = useAssetStore((state) => state.cleanupImages);
    const openConfigDialog = useConfigStore((state) => state.openConfigDialog);
    const [width, setWidth] = useState(390);
    const [view, setView] = useState<"chat" | "history">("chat");
    const [prompt, setPrompt] = useState("");
    const [isRunning, setIsRunning] = useState(false);
    const [checkedChatIds, setCheckedChatIds] = useState<string[]>([]);
    const [deleteChatIds, setDeleteChatIds] = useState<string[]>([]);
    const [closing, setClosing] = useState(false);
    const [resizing, setResizing] = useState(false);
    const [removedReferenceIds, setRemovedReferenceIds] = useState<Set<string>>(new Set());
    const [uploadedReferences, setUploadedReferences] = useState<AgentComposerReference[]>([]);
    const [agentModel, setAgentModel] = useState(() => (typeof window === "undefined" ? "" : window.localStorage.getItem(AGENT_MODEL_STORAGE_KEY) || ""));
    const [agentMode, setAgentMode] = useState<"general" | "detail">(() => (typeof window !== "undefined" && window.localStorage.getItem(AGENT_MODE_STORAGE_KEY) === "detail" ? "detail" : "general"));
    const [detailGenerationMode, setDetailGenerationMode] = useState<CanvasDetailAgentOptions["generationMode"]>(() => (typeof window !== "undefined" && window.localStorage.getItem(DETAIL_GENERATION_MODE_STORAGE_KEY) === "rough" ? "rough" : "precise"));
    const [detailExecutionMode, setDetailExecutionMode] = useState<CanvasDetailAgentOptions["executionMode"]>(() => (typeof window !== "undefined" && window.localStorage.getItem(DETAIL_EXECUTION_MODE_STORAGE_KEY) === "step" ? "step" : "continuous"));
    const [detailComposeWhenComplete, setDetailComposeWhenComplete] = useState(() => typeof window === "undefined" || window.localStorage.getItem(DETAIL_COMPOSE_STORAGE_KEY) !== "false");
    const [fullAccess, setFullAccess] = useState(() => (typeof window === "undefined" ? true : window.localStorage.getItem(AGENT_FULL_ACCESS_STORAGE_KEY) !== "false"));
    const [localSessions, setLocalSessions] = useState<CanvasAssistantSession[]>(() => (sessions.length ? sessions : [createSession()]));
    const [localActiveSessionId, setLocalActiveSessionId] = useState<string | null>(activeSessionId);
    const [transientToolRequests, setTransientToolRequests] = useState<Record<string, CanvasAgentToolRequest[]>>({});
    const abortControllerRef = useRef<AbortController | null>(null);
    const pendingApprovalRef = useRef(new Map<string, { resolve: (result: CanvasAgentApplyResult) => void }>());
    const messagesViewportRef = useRef<HTMLDivElement | null>(null);
    const lastEmittedSessionsRef = useRef<CanvasAssistantSession[] | null>(null);
    const lastEmittedActiveIdRef = useRef<string | null>(null);

    useEffect(() => {
        if (!sessions.length) return;
        if (sessions === lastEmittedSessionsRef.current && activeSessionId === lastEmittedActiveIdRef.current) return;
        setLocalSessions(sessions);
        setLocalActiveSessionId(activeSessionId);
    }, [activeSessionId, sessions]);

    useEffect(() => {
        lastEmittedSessionsRef.current = localSessions;
        lastEmittedActiveIdRef.current = localActiveSessionId;
        onSessionsChange(localSessions, localActiveSessionId);
    }, [localActiveSessionId, localSessions, onSessionsChange]);

    const safeSessions = localSessions.length ? localSessions : [createSession()];
    const activeSession = useMemo(() => safeSessions.find((session) => session.id === localActiveSessionId) || safeSessions[0] || null, [localActiveSessionId, safeSessions]);
    const historySessions = safeSessions.filter((session) => session.messages.length > 0);
    const messages = activeSession?.messages || [];
    const hasMessages = messages.length > 0;
    const selectedNodeKey = useMemo(() => Array.from(selectedNodeIds).sort().join(","), [selectedNodeIds]);
    const allSelectedReferences = useMemo(() => buildAssistantReferences(nodes, selectedNodeIds), [nodes, selectedNodeIds]);
    const selectedReferences = useMemo(() => allSelectedReferences.filter((item) => !removedReferenceIds.has(item.id)), [allSelectedReferences, removedReferenceIds]);
    const agentModels = useMemo(() => listCanvasAgentModels(), [effectiveConfig.models]);
    const composerReferences = useMemo<AgentComposerReference[]>(() => [...selectedReferences, ...uploadedReferences], [selectedReferences, uploadedReferences]);
    const hasUploadingReference = uploadedReferences.some((item) => item.uploadStatus === "uploading");
    const iconButtonStyle = { color: theme.node.muted };
    const detailOptions = useMemo<CanvasDetailAgentOptions>(
        () => ({ generationMode: detailGenerationMode, executionMode: detailExecutionMode, composeWhenComplete: detailComposeWhenComplete }),
        [detailComposeWhenComplete, detailExecutionMode, detailGenerationMode],
    );

    useEffect(() => {
        if (agentModels.some((item) => item.name === agentModel)) return;
        const next = agentModels.find((item) => item.isDefault)?.name || agentModels[0]?.name || "";
        setAgentModel(next);
        if (next) window.localStorage.setItem(AGENT_MODEL_STORAGE_KEY, next);
    }, [agentModel, agentModels]);

    useEffect(() => {
        if (view !== "chat" || !messages.length) return;
        const frame = window.requestAnimationFrame(() => {
            const viewport = messagesViewportRef.current;
            if (viewport) viewport.scrollTop = viewport.scrollHeight;
        });
        return () => window.cancelAnimationFrame(frame);
    }, [activeSession?.id, messages, view]);

    useEffect(() => {
        setRemovedReferenceIds(new Set());
    }, [selectedNodeKey]);

    const addReferenceFiles = async (files: FileList | File[] | null) => {
        const images = Array.from(files || []).filter((file) => file.type.startsWith("image/"));
        const slots = Math.max(0, MAX_AGENT_ATTACHMENTS - uploadedReferences.length);
        if (!images.length || !slots) return;
        const selected = images.slice(0, slots);
        const pending = selected.map((file) => ({
            id: `agent-upload-${nanoid()}`,
            type: CanvasNodeType.Image,
            title: file.name || "Agent 参考图",
            dataUrl: URL.createObjectURL(file),
            uploadStatus: "uploading" as const,
        }));
        setUploadedReferences((prev) => [...prev, ...pending]);
        await Promise.all(
            pending.map(async (item, index) => {
                try {
                    const uploaded = await uploadReferenceImage(selected[index]);
                    if (item.dataUrl?.startsWith("blob:")) URL.revokeObjectURL(item.dataUrl);
                    setUploadedReferences((prev) =>
                        prev.map((reference) => (reference.id === item.id ? { ...reference, dataUrl: uploaded.remoteUrl, remoteUrl: uploaded.remoteUrl, storageKey: uploaded.storageKey, uploadStatus: "ready", uploadError: undefined } : reference)),
                    );
                } catch (error) {
                    const uploadError = error instanceof Error ? error.message : "上传失败";
                    setUploadedReferences((prev) => prev.map((reference) => (reference.id === item.id ? { ...reference, uploadStatus: "error", uploadError } : reference)));
                    message.error(uploadError);
                }
            }),
        );
    };

    const removeComposerReference = (id: string) => {
        const uploaded = uploadedReferences.find((item) => item.id === id);
        if (uploaded) {
            if (uploaded.dataUrl?.startsWith("blob:")) URL.revokeObjectURL(uploaded.dataUrl);
            setUploadedReferences((prev) => prev.filter((item) => item.id !== id));
            return;
        }
        setRemovedReferenceIds((prev) => new Set(prev).add(id));
        if (selectedNodeIds.has(id)) onSelectNodeIds(new Set(Array.from(selectedNodeIds).filter((nodeId) => nodeId !== id)));
    };

    const updateSession = (sessionId: string, updater: (session: CanvasAssistantSession) => CanvasAssistantSession) => {
        setLocalSessions((prev) => prev.map((session) => (session.id === sessionId ? updater(session) : session)));
    };

    const appendMessage = (sessionId: string, message: CanvasAssistantMessage) => {
        updateSession(sessionId, (session) => ({
            ...session,
            title: session.messages.length ? session.title : message.text.slice(0, 18) || "新 Agent",
            messages: [...session.messages, message],
            updatedAt: new Date().toISOString(),
        }));
    };

    const updateMessage = (sessionId: string, messageId: string, patch: Partial<CanvasAssistantMessage>) => {
        updateSession(sessionId, (session) => ({
            ...session,
            messages: session.messages.map((message) => (message.id === messageId ? { ...message, ...patch } : message)),
            updatedAt: new Date().toISOString(),
        }));
    };

    const appendMessageLog = (sessionId: string, messageId: string, text: string) => {
        updateSession(sessionId, (session) => ({
            ...session,
            messages: session.messages.map((message) =>
                message.id === messageId
                    ? {
                          ...message,
                          logs: [...(message.logs || []).slice(-20), text],
                          activityText: text,
                      }
                    : message,
            ),
            updatedAt: new Date().toISOString(),
        }));
    };

    const appendMessageEvent = (sessionId: string, messageId: string, event: CanvasAgentEvent) => {
        updateSession(sessionId, (session) => ({
            ...session,
            messages: session.messages.map((message) => {
                if (message.id !== messageId) return message;
                const events = message.events || [];
                if (events.some((item) => item.id === event.id)) return message;
                return { ...message, events: [...events.slice(-79), event], activityText: event.type === "assistant.delta" ? message.activityText : event.text || message.activityText };
            }),
            updatedAt: new Date().toISOString(),
        }));
    };

    const handleExecutionEvent = (sessionId: string, messageId: string, toolCallId: string, event: CanvasAgentEvent) => {
        appendMessageEvent(sessionId, messageId, event);
        if (event.type === "canvas.applied") updateToolRequestBySession(sessionId, messageId, toolCallId, { status: "applied", result: event.text });
        if (event.type === "image-job.submitted") updateToolRequestBySession(sessionId, messageId, toolCallId, { status: "submitted" });
        if (event.type === "image-job.running") updateToolRequestBySession(sessionId, messageId, toolCallId, { status: "running" });
    };

    const updateMessageActivity = (sessionId: string, messageId: string, text: string, mode: "replace" | "append" = "replace") => {
        updateSession(sessionId, (session) => ({
            ...session,
            messages: session.messages.map((message) => {
                if (message.id !== messageId) return message;
                const nextText = mode === "append" ? `${message.activityText || ""}${text}` : text;
                return { ...message, activityText: nextText.replace(/\s+/g, " ").trim().slice(-320) };
            }),
            updatedAt: new Date().toISOString(),
        }));
    };

    const setMessageToolRequest = (sessionId: string, messageId: string, request: CanvasAgentToolRequest) => {
        setTransientToolRequests((prev) => {
            const current = prev[messageId] || [];
            const key = request.toolCallId || request.id;
            const exists = current.some((item) => (item.toolCallId || item.id) === key);
            return { ...prev, [messageId]: exists ? current.map((item) => ((item.toolCallId || item.id) === key ? request : item)) : [...current, request] };
        });
        updateSession(sessionId, (session) => ({
            ...session,
            messages: session.messages.map((message) =>
                message.id === messageId
                    ? {
                          ...message,
                          toolName: request.name,
                          toolStatus: request.status,
                          toolResult: request.result || request.error,
                          toolRequests: [...(message.toolRequests || []).filter((item) => (item.toolCallId || item.id) !== (request.toolCallId || request.id)), request],
                      }
                    : message,
            ),
            updatedAt: new Date().toISOString(),
        }));
    };

    const executeAgentTool = async (sessionId: string, messageId: string, request: CanvasAgentToolRequest) => {
        const toolCallId = request.toolCallId || request.id;
        updateToolRequestBySession(sessionId, messageId, toolCallId, { status: "applying" });
        appendMessageEvent(sessionId, messageId, createPanelEvent("tool.approved", request.runId || "", request.turnId || "", "已批准执行画布工具", "running", toolCallId));
        const result = await onApplyAgentTool(request, (event) => handleExecutionEvent(sessionId, messageId, toolCallId, event));
        updateToolRequestBySession(sessionId, messageId, toolCallId, {
            status: result.ok ? "completed" : "failed",
            result: result.ok ? result.message : undefined,
            error: result.ok ? undefined : result.message,
            generationRunIds: result.generationRunIds,
            imageJobIds: result.imageJobIds,
            artifacts: result.artifacts,
        });
        appendMessageEvent(sessionId, messageId, createPanelEvent(result.ok ? "tool.completed" : "tool.failed", request.runId || "", request.turnId || "", result.message, result.ok ? "completed" : "failed", toolCallId));
        return result;
    };

    const startChatSession = () => {
        if (activeSession && activeSession.messages.length === 0) {
            setLocalActiveSessionId(activeSession.id);
            return;
        }
        const session = createSession();
        setLocalSessions((prev) => [session, ...prev]);
        setLocalActiveSessionId(session.id);
    };

    const removeSessions = (ids: string[]) => {
        const removedMessageIds = new Set(safeSessions.filter((session) => ids.includes(session.id)).flatMap((session) => session.messages.map((message) => message.id)));
        const next = safeSessions.filter((session) => !ids.includes(session.id));
        if (!next.length) {
            const session = createSession();
            setLocalSessions([session]);
            setLocalActiveSessionId(session.id);
        } else {
            setLocalSessions(next);
            setLocalActiveSessionId(localActiveSessionId && ids.includes(localActiveSessionId) ? next[0].id : localActiveSessionId);
        }
        cleanupImages({ sessions: next });
        setCheckedChatIds((prev) => prev.filter((id) => !ids.includes(id)));
        setTransientToolRequests((prev) => Object.fromEntries(Object.entries(prev).filter(([messageId]) => !removedMessageIds.has(messageId))));
    };

    const clearSessions = () => {
        const session = createSession();
        setLocalSessions([session]);
        setLocalActiveSessionId(session.id);
        setCheckedChatIds([]);
        setTransientToolRequests({});
        cleanupImages({ sessions: [session] });
    };

    const sendMessage = async (text: string, savedReferences?: CanvasAssistantReference[], savedAgentMode: "general" | "detail" = agentMode, savedDetailOptions: CanvasDetailAgentOptions = detailOptions) => {
        if (isRunning || hasUploadingReference) return;
        const session = activeSession || createSession("Agent 会话");
        if (!activeSession) {
            setLocalSessions([session]);
            setLocalActiveSessionId(session.id);
        }
        const refs = savedReferences || composerReferences.filter((item) => item.uploadStatus !== "error");
        const runId = `agent-run-${nanoid()}`;
        appendMessage(session.id, { id: nanoid(), runId, role: "user", mode: "agent", agentMode: savedAgentMode, detailOptions: savedAgentMode === "detail" ? savedDetailOptions : undefined, text, references: refs });
        setPrompt("");
        setIsRunning(true);
        const controller = new AbortController();
        abortControllerRef.current = controller;
        const assistantId = nanoid();
        const turnId = `agent-turn-${nanoid()}`;
        appendMessage(session.id, {
            id: assistantId,
            runId,
            turnId,
            role: "assistant",
            mode: "agent",
            agentMode: savedAgentMode,
            detailOptions: savedAgentMode === "detail" ? savedDetailOptions : undefined,
            text: "",
            isLoading: true,
            startedAt: Date.now(),
            logs: ["开始处理当前任务"],
            activityText: "正在读取画布",
            events: [],
        });
        try {
            const canvasNodeIds = new Set(nodes.map((node) => node.id));
            const snapshot = buildCanvasAgentSnapshot({
                projectId,
                canvasRevision: projectRevision,
                viewport,
                nodes,
                connections,
                selectedNodeIds,
                config: effectiveConfig,
                attachments: refs.filter((item) => !canvasNodeIds.has(item.id)),
            });
            const response = await requestCanvasAgentTurnStream(effectiveConfig, text, snapshot, [...buildAgentHistory(session.messages), { role: "user", text }], session.summary || "", {
                signal: controller.signal,
                agentModel,
                agentMode: savedAgentMode,
                detailOptions: savedAgentMode === "detail" ? savedDetailOptions : undefined,
                runId,
                turnId,
                onEvent: (event) => {
                    const structured = streamEventToAgentEvent(event);
                    if (!structured) return;
                    appendMessageEvent(session.id, assistantId, structured);
                    if (event.type === "assistant.delta" && event.text) updateMessage(session.id, assistantId, { text: event.text });
                    else if (event.text) updateMessageActivity(session.id, assistantId, event.text, event.mode);
                },
                onToolRequest: async (request) => {
                    setMessageToolRequest(session.id, assistantId, request);
                    const detailWorkflowAccess = savedAgentMode === "detail" && request.name === "canvas.detailWorkflow";
                    appendMessageLog(session.id, assistantId, fullAccess || detailWorkflowAccess ? `正在执行：${agentToolSummary(request) || request.description}` : "等待批准画布工具");
                    if (fullAccess || detailWorkflowAccess) return executeAgentTool(session.id, assistantId, request);
                    return new Promise<CanvasAgentApplyResult>((resolve) => pendingApprovalRef.current.set(request.toolCallId || request.id, { resolve }));
                },
            });
            updateSession(session.id, (current) => ({
                ...current,
                summary: response.summary || current.summary,
                messages: current.messages.map((message) => (message.id === assistantId ? { ...message, text: response.reply, isLoading: false, activityText: "任务完成" } : message)),
                updatedAt: new Date().toISOString(),
            }));
            if (!savedReferences) setUploadedReferences([]);
        } catch (error) {
            const errorMessage = error instanceof DOMException && error.name === "AbortError" ? "已停止本次 Agent 运行" : error instanceof Error ? error.message : "Agent 调用失败";
            updateMessage(session.id, assistantId, { text: errorMessage, isLoading: false, activityText: errorMessage });
            if (errorMessage.includes("配置") || errorMessage.includes("密钥") || errorMessage.includes("Key")) openConfigDialog(true);
        } finally {
            setIsRunning(false);
            if (abortControllerRef.current === controller) abortControllerRef.current = null;
        }
    };

    const submit = async () => {
        const text = prompt.trim();
        const readyUploads = uploadedReferences.some((item) => item.uploadStatus === "ready");
        if ((!text && !readyUploads) || isRunning || hasUploadingReference) return;
        await sendMessage(text || "请读取我上传的参考图，并根据图片内容处理当前画布。");
    };

    const retryMessage = (message: CanvasAssistantMessage) => {
        const index = messages.findIndex((item) => item.id === message.id);
        const userIndex = messages.slice(0, index).findLastIndex((item) => item.role === "user");
        const user = messages[userIndex];
        if (user) void sendMessage(user.text, user.references, user.agentMode || "general", user.detailOptions || detailOptions);
    };

    const stopAgentTurn = () => {
        abortControllerRef.current?.abort();
        abortControllerRef.current = null;
        pendingApprovalRef.current.forEach(({ resolve }) => resolve({ ok: false, message: "用户停止了本次 Agent 运行" }));
        pendingApprovalRef.current.clear();
        setIsRunning(false);
        const current = activeSession?.messages.findLast((message) => message.role === "assistant" && message.isLoading);
        if (activeSession && current?.runId) {
            appendMessageEvent(activeSession.id, current.id, createPanelEvent("run.stopped", current.runId, current.turnId || `agent-turn-${nanoid()}`, "已停止本次 Agent 运行", "stopped"));
            updateMessage(activeSession.id, current.id, { isLoading: false, activityText: "已停止" });
        }
    };

    const updateToolRequestBySession = (sessionId: string, messageId: string, toolCallId: string, patch: Partial<CanvasAgentToolRequest>) => {
        setTransientToolRequests((prev) => ({
            ...prev,
            [messageId]: (prev[messageId] || []).map((request) => ((request.toolCallId || request.id) === toolCallId ? { ...request, ...patch } : request)),
        }));
        updateSession(sessionId, (session) => ({
            ...session,
            messages: session.messages.map((message) =>
                message.id === messageId
                    ? {
                          ...message,
                          toolName: message.toolName || message.toolRequests?.find((request) => (request.toolCallId || request.id) === toolCallId)?.name || message.toolRequest?.name,
                          toolStatus: patch.status || message.toolStatus,
                          toolResult: patch.result || patch.error || message.toolResult,
                          toolRequests: (message.toolRequests || []).map((request) => ((request.toolCallId || request.id) === toolCallId ? { ...request, ...patch } : request)),
                          ...(message.toolRequest ? { toolRequest: { ...message.toolRequest, ...patch } } : {}),
                      }
                    : message,
            ),
            updatedAt: new Date().toISOString(),
        }));
    };

    const updateToolRequest = (messageId: string, toolCallId: string, patch: Partial<CanvasAgentToolRequest>) => {
        if (!activeSession) return;
        updateToolRequestBySession(activeSession.id, messageId, toolCallId, patch);
    };

    const approveToolRequest = async (messageId: string, request: CanvasAgentToolRequest) => {
        if (!activeSession) return;
        const toolCallId = request.toolCallId || request.id;
        const pending = pendingApprovalRef.current.get(toolCallId);
        if (!pending) return;
        pendingApprovalRef.current.delete(toolCallId);
        pending.resolve(await executeAgentTool(activeSession.id, messageId, request));
    };

    const rejectToolRequest = (messageId: string, request: CanvasAgentToolRequest) => {
        const toolCallId = request.toolCallId || request.id;
        updateToolRequest(messageId, toolCallId, { status: "rejected", result: "用户已拒绝" });
        const pending = pendingApprovalRef.current.get(toolCallId);
        if (!pending) return;
        pendingApprovalRef.current.delete(toolCallId);
        pending.resolve({ ok: false, message: "用户拒绝了画布工具调用" });
    };

    const startResize = () => {
        const move = (event: MouseEvent) => setWidth(Math.min(760, Math.max(320, window.innerWidth - event.clientX)));
        const stop = () => {
            setResizing(false);
            document.body.style.cursor = "";
            document.body.style.userSelect = "";
            document.removeEventListener("mousemove", move);
            document.removeEventListener("mouseup", stop);
        };
        setResizing(true);
        document.body.style.cursor = "col-resize";
        document.body.style.userSelect = "none";
        document.addEventListener("mousemove", move);
        document.addEventListener("mouseup", stop);
    };

    const collapse = () => {
        setClosing(true);
        onCollapseStart();
        window.setTimeout(onCollapse, PANEL_MOTION_MS);
    };

    return (
        <motion.div
            className="flex shrink-0"
            initial={{ width: 0, opacity: 0 }}
            animate={{ width: closing ? 0 : width + 1, opacity: closing ? 0 : 1 }}
            transition={{ duration: resizing ? 0 : PANEL_MOTION_SECONDS, ease: [0.22, 1, 0.36, 1] }}
            style={{ overflow: "clip", pointerEvents: closing ? "none" : undefined }}
        >
            <motion.aside
                className="relative flex shrink-0 flex-col border-l"
                initial={{ x: 48 }}
                animate={{ x: closing ? 28 : 0 }}
                transition={{ duration: resizing ? 0 : PANEL_MOTION_SECONDS, ease: [0.22, 1, 0.36, 1] }}
                style={{ width, background: theme.node.panel, borderColor: theme.node.stroke, color: theme.node.text }}
            >
                <button type="button" className="absolute inset-y-0 left-0 z-40 w-4 -translate-x-1/2 cursor-col-resize" onMouseDown={startResize} aria-label="调整右侧面板宽度" />
                <div className="flex items-center justify-between border-b px-4 py-3" style={{ borderColor: theme.node.stroke }}>
                    <div className="flex min-w-0 items-center gap-2 text-sm font-medium">
                        <Bot className="size-4" />
                        <div className="min-w-0">
                            <div className="leading-5">{view === "history" ? "Agent 记录" : "Agent"}</div>
                            {view === "chat" ? <div className="text-[11px] font-normal opacity-55">画布助手</div> : null}
                        </div>
                    </div>
                    <div className="flex items-center gap-1">
                        {view === "chat" ? (
                            <label className="mr-1 flex items-center gap-1.5 text-[11px]" style={{ color: theme.node.muted }}>
                                <Switch
                                    size="small"
                                    checked={fullAccess}
                                    onChange={(checked) => {
                                        setFullAccess(checked);
                                        window.localStorage.setItem(AGENT_FULL_ACCESS_STORAGE_KEY, String(checked));
                                    }}
                                />
                                完全访问
                            </label>
                        ) : null}
                        {view === "history" ? (
                            <>
                                <Tooltip title="删除选中">
                                    <Button type="text" shape="circle" className="!h-8 !w-8 !min-w-8" style={iconButtonStyle} icon={<Trash2 className="size-4" />} disabled={!checkedChatIds.length} onClick={() => setDeleteChatIds(checkedChatIds)} />
                                </Tooltip>
                                <Tooltip title="删除全部">
                                    <Button
                                        type="text"
                                        shape="circle"
                                        className="!h-8 !w-8 !min-w-8"
                                        style={iconButtonStyle}
                                        icon={<X className="size-4" />}
                                        disabled={!historySessions.length}
                                        onClick={() => setDeleteChatIds(historySessions.map((session) => session.id))}
                                    />
                                </Tooltip>
                            </>
                        ) : null}
                        <Tooltip title="新建 Agent 会话">
                            <Button
                                type="text"
                                shape="circle"
                                className="!h-8 !w-8 !min-w-8"
                                style={iconButtonStyle}
                                icon={<Plus className="size-4" />}
                                disabled={!hasMessages}
                                onClick={() => {
                                    startChatSession();
                                    setView("chat");
                                }}
                            />
                        </Tooltip>
                        <Tooltip title="配置">
                            <Button type="text" shape="circle" className="!h-8 !w-8 !min-w-8" style={iconButtonStyle} icon={<Settings2 className="size-4" />} onClick={() => openConfigDialog(false)} />
                        </Tooltip>
                        <Tooltip title="收起助手">
                            <Button type="text" shape="circle" className="!h-8 !w-8 !min-w-8" style={iconButtonStyle} icon={<PanelRightClose className="size-4" />} onClick={collapse} />
                        </Tooltip>
                    </div>
                </div>
                <div className="flex h-11 shrink-0 items-center gap-4 border-b px-4 text-sm" style={{ borderColor: theme.node.stroke }}>
                    <button type="button" className="relative h-full px-0.5" style={{ color: view === "chat" ? theme.node.text : theme.node.muted }} onClick={() => setView("chat")}>
                        对话
                        {view === "chat" ? <span className="absolute inset-x-0 bottom-0 h-0.5" style={{ background: theme.node.text }} /> : null}
                    </button>
                    <button type="button" className="relative h-full px-0.5" style={{ color: view === "history" ? theme.node.text : theme.node.muted }} onClick={() => setView("history")}>
                        历史{historySessions.length ? ` ${historySessions.length}` : ""}
                        {view === "history" ? <span className="absolute inset-x-0 bottom-0 h-0.5" style={{ background: theme.node.text }} /> : null}
                    </button>
                </div>

                <div ref={messagesViewportRef} className="thin-scrollbar min-h-0 flex-1 space-y-4 overflow-y-auto px-4 py-4">
                    {view === "history" ? (
                        <AssistantHistory
                            sessions={historySessions}
                            activeSession={activeSession}
                            checkedIds={checkedChatIds.filter((id) => historySessions.some((session) => session.id === id))}
                            onToggleChecked={(id, checked) => setCheckedChatIds((prev) => (checked ? [...new Set([...prev, id])] : prev.filter((item) => item !== id)))}
                            onOpen={(id) => {
                                setLocalActiveSessionId(id);
                                setView("chat");
                            }}
                            onDelete={(id) => setDeleteChatIds([id])}
                        />
                    ) : messages.length ? (
                        <AssistantMessages messages={messages} toolRequests={transientToolRequests} canWriteProject={canWriteProject} onRetry={retryMessage} onApproveTool={approveToolRequest} onRejectTool={rejectToolRequest} />
                    ) : (
                        <div className="flex h-full flex-col items-center justify-center px-1 text-center opacity-55">
                            <span className="grid size-10 place-items-center rounded-full border" style={{ borderColor: theme.node.stroke }}>
                                <Bot className="size-5" />
                            </span>
                            <div className="mt-3 text-sm">Agent 已就绪</div>
                        </div>
                    )}
                </div>

                {view === "chat" ? (
                    <AssistantComposer
                        prompt={prompt}
                        isRunning={isRunning}
                        references={composerReferences}
                        hasUploadingReference={hasUploadingReference}
                        config={effectiveConfig}
                        agentModel={agentModel}
                        agentMode={agentMode}
                        detailOptions={detailOptions}
                        onPromptChange={setPrompt}
                        onSubmit={submit}
                        onStop={stopAgentTurn}
                        onAgentModelChange={(model) => {
                            setAgentModel(model);
                            window.localStorage.setItem(AGENT_MODEL_STORAGE_KEY, model);
                        }}
                        onAgentModeChange={(mode) => {
                            setAgentMode(mode);
                            window.localStorage.setItem(AGENT_MODE_STORAGE_KEY, mode);
                        }}
                        onDetailOptionsChange={(next) => {
                            setDetailGenerationMode(next.generationMode);
                            setDetailExecutionMode(next.executionMode);
                            setDetailComposeWhenComplete(next.composeWhenComplete);
                            window.localStorage.setItem(DETAIL_GENERATION_MODE_STORAGE_KEY, next.generationMode);
                            window.localStorage.setItem(DETAIL_EXECUTION_MODE_STORAGE_KEY, next.executionMode);
                            window.localStorage.setItem(DETAIL_COMPOSE_STORAGE_KEY, String(next.composeWhenComplete));
                        }}
                        onAddFiles={addReferenceFiles}
                        onMissingConfig={() => openConfigDialog(true)}
                        onRemoveReference={removeComposerReference}
                    />
                ) : null}

                <Modal
                    title="删除记录"
                    open={deleteChatIds.length > 0}
                    centered
                    onCancel={() => setDeleteChatIds([])}
                    footer={
                        <>
                            <Button onClick={() => setDeleteChatIds([])}>取消</Button>
                            <Button
                                danger
                                type="primary"
                                onClick={() => {
                                    deleteChatIds.length === historySessions.length ? clearSessions() : removeSessions(deleteChatIds);
                                    setDeleteChatIds([]);
                                }}
                            >
                                删除
                            </Button>
                        </>
                    }
                >
                    <p className="text-sm opacity-60">确认删除 {deleteChatIds.length} 条 Agent 记录？</p>
                </Modal>
            </motion.aside>
        </motion.div>
    );
}

function AssistantComposer({
    prompt,
    isRunning,
    references,
    hasUploadingReference,
    config,
    agentModel,
    agentMode,
    detailOptions,
    onPromptChange,
    onSubmit,
    onStop,
    onAgentModelChange,
    onAgentModeChange,
    onDetailOptionsChange,
    onAddFiles,
    onMissingConfig,
    onRemoveReference,
}: {
    prompt: string;
    isRunning: boolean;
    references: AgentComposerReference[];
    hasUploadingReference: boolean;
    config: AiConfig;
    agentModel: string;
    agentMode: "general" | "detail";
    detailOptions: CanvasDetailAgentOptions;
    onPromptChange: (prompt: string) => void;
    onSubmit: () => void;
    onStop: () => void;
    onAgentModelChange: (model: string) => void;
    onAgentModeChange: (mode: "general" | "detail") => void;
    onDetailOptionsChange: (options: CanvasDetailAgentOptions) => void;
    onAddFiles: (files: FileList | File[] | null) => void | Promise<void>;
    onMissingConfig: () => void;
    onRemoveReference: (id: string) => void;
}) {
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    const fileInputRef = useRef<HTMLInputElement>(null);
    const canSubmit = !isRunning && !hasUploadingReference && Boolean(prompt.trim() || references.some((item) => item.uploadStatus === "ready"));

    return (
        <div className="px-2 pb-2 pt-2" onWheelCapture={(event) => event.stopPropagation()}>
            <div className="rounded-[24px] border px-3 pb-3 pt-3 shadow-lg" style={{ background: theme.toolbar.panel, borderColor: theme.node.stroke }}>
                {references.length ? (
                    <div className="thin-scrollbar mb-2 flex max-w-full gap-2 overflow-x-auto pb-1">
                        {references.map((item) => (
                            <AssistantReferenceChip key={item.id} item={item} onRemove={() => onRemoveReference(item.id)} />
                        ))}
                    </div>
                ) : null}
                <textarea
                    value={prompt}
                    onChange={(event) => onPromptChange(event.target.value)}
                    onPaste={(event) => {
                        const files = Array.from(event.clipboardData.files).filter((item) => item.type.startsWith("image/"));
                        if (!files.length) return;
                        event.preventDefault();
                        void onAddFiles(files);
                    }}
                    onKeyDown={(event) => {
                        if (event.key !== "Enter" || event.ctrlKey || event.metaKey || event.shiftKey) return;
                        event.preventDefault();
                        void onSubmit();
                    }}
                    className="thin-scrollbar max-h-36 min-h-20 w-full resize-none border-0 bg-transparent px-1 py-1 text-sm leading-5 outline-none placeholder:text-stone-400"
                    style={{ color: theme.node.text }}
                    placeholder={agentMode === "detail" ? "描述商品、平台、风格、屏数和生成方式" : "告诉 Agent 你想怎样整理、修改或连接当前画布"}
                />
                {agentMode === "detail" ? (
                    <div className="mt-2 grid grid-cols-2 gap-2 border-t pt-2" style={{ borderColor: theme.node.stroke }}>
                        <Segmented
                            block
                            size="small"
                            value={detailOptions.generationMode}
                            disabled={isRunning}
                            options={[
                                { label: "精细", value: "precise" },
                                { label: "粗略", value: "rough" },
                            ]}
                            onChange={(value) => onDetailOptionsChange({ ...detailOptions, generationMode: value as CanvasDetailAgentOptions["generationMode"] })}
                        />
                        <Segmented
                            block
                            size="small"
                            value={detailOptions.executionMode}
                            disabled={isRunning}
                            options={[
                                { label: "逐屏", value: "step" },
                                { label: "自动", value: "continuous" },
                            ]}
                            onChange={(value) => onDetailOptionsChange({ ...detailOptions, executionMode: value as CanvasDetailAgentOptions["executionMode"] })}
                        />
                        <label className="col-span-2 flex h-7 items-center justify-between px-1 text-xs" style={{ color: theme.node.muted }}>
                            完成后合成长图
                            <Switch size="small" checked={detailOptions.composeWhenComplete} disabled={isRunning} onChange={(checked) => onDetailOptionsChange({ ...detailOptions, composeWhenComplete: checked })} />
                        </label>
                    </div>
                ) : null}
                <div className="mt-2 flex items-center justify-between gap-2">
                    <div className="canvas-composer-tools flex min-w-0 flex-1 items-center gap-1">
                        <input
                            ref={fileInputRef}
                            hidden
                            type="file"
                            accept="image/*"
                            multiple
                            onChange={(event) => {
                                void onAddFiles(event.target.files);
                                event.target.value = "";
                            }}
                        />
                        <Tooltip title="添加参考图">
                            <Button
                                type="text"
                                shape="circle"
                                className="!h-8 !w-8 !min-w-8"
                                disabled={isRunning || references.filter((item) => item.id.startsWith("agent-upload-")).length >= MAX_AGENT_ATTACHMENTS}
                                style={{ color: theme.node.muted }}
                                icon={<ImagePlus className="size-4" />}
                                onClick={() => fileInputRef.current?.click()}
                            />
                        </Tooltip>
                        <ModelPicker
                            config={config}
                            value={agentModel}
                            onChange={onAgentModelChange}
                            onMissingConfig={onMissingConfig}
                            type="detail_prompt"
                            placeholder="选择 Agent 模型"
                            className="!h-8 !min-w-0 !max-w-[155px] !border-0 !bg-transparent !px-2 !shadow-none"
                        />
                        <Tooltip title={agentMode === "detail" ? "退出详情图模式" : "进入详情图模式"}>
                            <Button
                                type={agentMode === "detail" ? "default" : "text"}
                                className={cn("!h-8 !shrink-0 !gap-1 !rounded-full !px-2", agentMode === "detail" && "!border-emerald-500/50 !bg-emerald-500/10 !text-emerald-500")}
                                icon={<Layers3 className="size-3.5" />}
                                disabled={isRunning}
                                onClick={() => onAgentModeChange(agentMode === "detail" ? "general" : "detail")}
                            >
                                详情图
                            </Button>
                        </Tooltip>
                        {hasUploadingReference ? <LoaderCircle className="size-3.5 shrink-0 animate-spin opacity-60" /> : null}
                    </div>
                    <Button type="primary" danger={isRunning} className="!h-10 !min-w-16 shrink-0 !rounded-full !px-3" disabled={!isRunning && !canSubmit} onClick={() => (isRunning ? onStop() : void onSubmit())} aria-label={isRunning ? "停止" : "发送"}>
                        <span className="flex items-center gap-1.5">{isRunning ? <Square className="size-4" /> : <ArrowUp className="size-4" />}</span>
                    </Button>
                </div>
            </div>
        </div>
    );
}

function AssistantMessages({
    messages,
    toolRequests,
    canWriteProject,
    onRetry,
    onApproveTool,
    onRejectTool,
}: {
    messages: CanvasAssistantMessage[];
    toolRequests: Record<string, CanvasAgentToolRequest[]>;
    canWriteProject: boolean;
    onRetry: (message: CanvasAssistantMessage) => void;
    onApproveTool: (messageId: string, request: CanvasAgentToolRequest) => void;
    onRejectTool: (messageId: string, request: CanvasAgentToolRequest) => void;
}) {
    const theme = canvasThemes[useThemeStore((state) => state.theme)];

    return (
        <div className="space-y-5">
            {messages.map((message) => {
                const messageToolRequests = toolRequests[message.id] || message.toolRequests || (message.toolRequest ? [message.toolRequest] : []);
                const isUser = message.role === "user";
                return (
                    <div key={message.id} className="space-y-3">
                        <div className={cn("flex items-start gap-3", isUser ? "justify-end" : "justify-start")}>
                            {!isUser ? <AgentAvatar /> : null}
                            <div className={cn("min-w-0 max-w-[82%] text-sm leading-6", isUser ? "text-right" : "text-left")} style={{ color: theme.node.text }}>
                                {isUser ? (
                                    <div className="whitespace-pre-wrap break-words text-left">{message.text}</div>
                                ) : message.text ? (
                                    <Streamdown animated isAnimating={Boolean(message.isLoading)}>
                                        {message.text}
                                    </Streamdown>
                                ) : null}
                                {message.references?.length ? <MessageReferences message={message} /> : null}
                            </div>
                            {isUser ? (
                                <span className="grid size-8 shrink-0 place-items-center rounded-full border" style={{ borderColor: theme.node.stroke }}>
                                    <UserRound className="size-4" />
                                </span>
                            ) : null}
                        </div>
                        {messageToolRequests.length ? (
                            <div className="space-y-2 pl-11">
                                {messageToolRequests.map((request) => (
                                    <AgentToolApprovalCard key={request.toolCallId || request.id} messageId={message.id} request={request} canWriteProject={canWriteProject} onApprove={onApproveTool} onReject={onRejectTool} />
                                ))}
                            </div>
                        ) : null}
                        {message.logs?.length || message.activityText ? (
                            <div className="pl-11">
                                <AgentActivity events={message.events || []} logs={message.logs || []} activityText={message.activityText} running={Boolean(message.isLoading)} />
                            </div>
                        ) : null}
                        {message.role === "assistant" && !message.isLoading ? (
                            <div className="flex gap-1 pl-11">
                                <Button type="text" shape="circle" size="small" icon={<RotateCcw className="size-3.5" />} onClick={() => onRetry(message)} title="重试" />
                            </div>
                        ) : null}
                    </div>
                );
            })}
        </div>
    );
}

function AgentAvatar() {
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    return (
        <span className="grid size-8 shrink-0 place-items-center" aria-label="Agent">
            <Bot className="size-4" style={{ color: theme.node.text }} />
        </span>
    );
}

function AssistantHistory({
    sessions,
    activeSession,
    checkedIds,
    onToggleChecked,
    onOpen,
    onDelete,
}: {
    sessions: CanvasAssistantSession[];
    activeSession: CanvasAssistantSession | null;
    checkedIds: string[];
    onToggleChecked: (id: string, checked: boolean) => void;
    onOpen: (id: string) => void;
    onDelete: (id: string) => void;
}) {
    const theme = canvasThemes[useThemeStore((state) => state.theme)];

    return (
        <div className="space-y-1">
            {sessions.map((session) => (
                <div key={session.id} className="group flex items-center gap-2 rounded-lg px-2 py-1.5 transition hover:bg-black/5 dark:hover:bg-white/10" style={session.id === activeSession?.id ? { background: theme.node.fill } : undefined}>
                    <input type="checkbox" className="size-4 accent-stone-950" checked={checkedIds.includes(session.id)} onChange={(event) => onToggleChecked(session.id, event.target.checked)} />
                    <button type="button" className="min-w-0 flex-1 text-left text-sm" onClick={() => onOpen(session.id)}>
                        <span className="block truncate">{session.title}</span>
                        <span className="text-xs opacity-50">{session.messages.length} 条记录</span>
                    </button>
                    <Button type="text" shape="circle" size="small" className="opacity-0 transition group-hover:opacity-100" icon={<Trash2 className="size-3.5" />} onClick={() => onDelete(session.id)} title="删除" />
                </div>
            ))}
        </div>
    );
}

function AgentToolApprovalCard({
    messageId,
    request,
    canWriteProject,
    onApprove,
    onReject,
}: {
    messageId: string;
    request: CanvasAgentToolRequest;
    canWriteProject: boolean;
    onApprove: (messageId: string, request: CanvasAgentToolRequest) => void;
    onReject: (messageId: string, request: CanvasAgentToolRequest) => void;
}) {
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    const isPending = request.status === "pending";
    const summary = agentToolSummary(request);
    const state =
        request.status === "completed"
            ? { color: "#16a34a", border: "rgba(22,163,74,.25)", icon: <CheckCircle2 className="size-4" /> }
            : request.status === "failed" || request.status === "rejected"
              ? { color: "#dc2626", border: "rgba(220,38,38,.25)", icon: <XCircle className="size-4" /> }
              : { color: "#d97706", border: "rgba(217,119,6,.28)", icon: <CircleAlert className="size-4" /> };
    return (
        <div className="w-full max-w-[520px] rounded-xl border p-4 text-sm" style={{ background: "transparent", borderColor: theme.node.stroke, color: theme.node.text }}>
            <div className="flex items-start gap-3">
                <span className="grid size-8 shrink-0 place-items-center rounded-lg border" style={{ borderColor: state.border, color: state.color }}>
                    {state.icon}
                </span>
                <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2 font-semibold">
                        <span>画布工具</span>
                        <span className="rounded-full border px-2 py-0.5 text-[11px] font-medium" style={{ borderColor: state.border, color: state.color }}>
                            {toolStatusLabel(request.status)}
                        </span>
                    </div>
                    <p className="mt-2 leading-5 opacity-80">{request.description}</p>
                </div>
            </div>
            {summary ? (
                <div className="mt-3 rounded-lg border px-3 py-2 text-xs leading-5 opacity-70" style={{ borderColor: theme.node.stroke }}>
                    {summary}
                </div>
            ) : null}
            {request.result ? <p className="mt-2 text-xs text-emerald-500">{request.result}</p> : null}
            {request.error ? <p className="mt-2 text-xs text-red-500">{request.error}</p> : null}
            {request.artifacts?.length ? (
                <div className="mt-3 grid gap-2">
                    {request.artifacts.map((artifact) => (
                        <div key={artifact.id} className="overflow-hidden rounded-lg border" style={{ borderColor: theme.node.stroke }}>
                            <img src={artifact.url} alt={artifact.title} className="max-h-80 w-full bg-black/20 object-contain" />
                            <div className="truncate px-3 py-2 text-xs opacity-70">{artifact.title}</div>
                        </div>
                    ))}
                </div>
            ) : null}
            {isPending ? (
                <div className="mt-4 grid grid-cols-2 gap-2">
                    <Button danger icon={<X className="size-3.5" />} onClick={() => onReject(messageId, request)}>
                        拒绝
                    </Button>
                    <Button type="primary" icon={<Check className="size-3.5" />} disabled={!canWriteProject} onClick={() => onApprove(messageId, request)}>
                        批准
                    </Button>
                </div>
            ) : null}
            {!canWriteProject && isPending ? <p className="mt-2 text-xs text-amber-500">当前标签页没有写入权限。</p> : null}
        </div>
    );
}

function agentToolSummary(request: CanvasAgentToolRequest) {
    const operation = request.operation && typeof request.operation === "object" ? (request.operation as { type?: string; operations?: Array<{ type?: string }> }) : null;
    const operations = operation?.type === "canvas.applyOps" && Array.isArray(operation.operations) ? operation.operations : operation ? [operation] : [];
    const labels = operations.map((item) => {
        if (item.type === "canvas.addNode") return "创建节点";
        if (item.type === "canvas.createTextNodes") return "批量创建文本";
        if (item.type === "canvas.updateNode") return "更新节点";
        if (item.type === "canvas.moveNodes") return "移动节点";
        if (item.type === "canvas.resizeNode") return "调整尺寸";
        if (item.type === "canvas.removeNodes") return "删除节点";
        if (item.type === "canvas.addConnection") return "连接节点";
        if (item.type === "canvas.removeConnections") return "删除连线";
        if (item.type === "canvas.selectNodes") return "更新选区";
        if (item.type === "canvas.setViewport") return "调整视口";
        if (item.type === "canvas.runGeneration") return "启动生成";
        if (item.type === "canvas.retryFailedNodes") return "重试失败节点";
        if (item.type === "canvas.runDetailWorkflow") return "详情图工作流";
        return item.type || "画布操作";
    });
    const counts = labels.reduce<Record<string, number>>((result, label) => ({ ...result, [label]: (result[label] || 0) + 1 }), {});
    return Object.entries(counts)
        .map(([label, count]) => `${label}${count > 1 ? ` x${count}` : ""}`)
        .join(" · ");
}

function toolStatusLabel(status: CanvasAgentToolRequest["status"]) {
    if (status === "completed") return "已完成";
    if (status === "failed") return "失败";
    if (status === "rejected") return "已拒绝";
    if (status === "applying") return "正在应用";
    if (status === "applied") return "画布已应用";
    if (status === "submitted") return "任务已提交";
    if (status === "running") return "生成中";
    if (status === "approved") return "已批准";
    return "待审批";
}

function MessageReferences({ message }: { message: CanvasAssistantMessage }) {
    return (
        <div className={cn("flex max-w-[88%] flex-wrap gap-2", message.role === "user" ? "justify-end" : "justify-start")}>
            {message.references?.map((item) => (
                <AssistantReferenceChip key={item.id} item={item} />
            ))}
        </div>
    );
}

function AgentActivity({ events, logs, activityText, running }: { events: CanvasAgentEvent[]; logs: string[]; activityText?: string; running: boolean }) {
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    const eventItems = events.slice(-16).map((event) => ({ text: agentEventLabel(event), meta: agentEventMeta(event), failed: event.status === "failed" || event.type === "error" }));
    const legacyItems = logs.slice(-12).map((log) => ({ text: friendlyAgentLog(log), meta: "", failed: false }));
    const items = eventItems.length ? eventItems : legacyItems;
    const latestText = friendlyAgentLog(activityText || items.at(-1)?.text || (running ? "正在处理" : "已完成"));
    const timeline = running && latestText !== items.at(-1)?.text ? [...items, { text: latestText, meta: "", failed: false }] : items;
    return (
        <details className="group max-w-[560px] text-xs" style={{ color: theme.node.muted }}>
            <summary className="flex h-8 cursor-pointer list-none items-center gap-2 overflow-hidden rounded-md px-1 transition hover:bg-white/5">
                {running ? <AgentActivityIndicator /> : <CheckCircle2 className="size-4 shrink-0 text-emerald-500" />}
                <span className="relative min-w-0 flex-1 overflow-hidden">
                    <motion.span key={latestText} initial={{ opacity: 0, y: 5 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.2 }} className="block truncate">
                        {latestText}
                    </motion.span>
                </span>
                <span className="shrink-0 opacity-45">{running ? "实时" : `${Math.max(1, items.length)} 步`}</span>
                <ChevronDown className="size-3.5 shrink-0 opacity-45 transition-transform group-open:rotate-180" />
            </summary>
            <div className="ml-2 mt-1 space-y-0 border-l pb-1 pl-4" style={{ borderColor: theme.node.stroke }}>
                {timeline.map((item, index) => (
                    <div key={`${item.text}-${index}`} className={cn("relative py-1.5 leading-5", index === timeline.length - 1 && running ? "opacity-100" : "opacity-65", item.failed && "text-red-500")}>
                        <span className="absolute -left-[19px] top-[13px] size-1.5 rounded-full" style={{ background: index === timeline.length - 1 && running ? theme.node.text : theme.node.stroke }} />
                        <span>{item.text}</span>
                        {item.meta ? <span className="ml-2 font-mono text-[10px] opacity-45">{item.meta}</span> : null}
                    </div>
                ))}
            </div>
        </details>
    );
}

function agentEventLabel(event: CanvasAgentEvent) {
    const labels: Partial<Record<CanvasAgentEvent["type"], string>> = {
        "run.started": "开始处理当前任务",
        "turn.started": "已读取画布，开始本轮处理",
        "turn.activity": event.text,
        "reasoning.delta": event.text ? `正在分析：${event.text}` : "正在分析任务",
        "assistant.delta": "正在组织回复",
        "model.response": event.text || "模型已返回结构化结果",
        "tool.requested": "已准备画布工具",
        "tool.validation_failed": event.text || "工具校验失败，Agent 正在纠错",
        "tool.result": event.text || "工具结果已返回 Agent",
        "tool.approved": "已批准执行画布工具",
        "canvas.applied": event.text || "画布操作已应用",
        "generation.started": "已启动生成流程",
        "image-job.submitted": "图片任务已提交，开始轮询",
        "image-job.running": "图片任务正在生成",
        "image-job.completed": "图片已生成并写入画布",
        "image-job.failed": event.text || "图片任务失败",
        "generation.completed": event.text || "生成流程完成",
        "generation.failed": event.text || "生成流程失败",
        "detail.workflow.created": event.text || "详情图工作流已创建",
        "detail.workflow.updated": event.text || "详情图工作流已增量更新",
        "detail.workflow.regenerating": event.text || "正在重新生成全部详情图屏幕",
        "detail.screen.started": event.text || "正在生成详情图屏幕",
        "detail.screen.completed": event.text || "详情图屏幕已完成",
        "detail.screen.failed": event.text || "详情图屏幕生成失败",
        "detail.workflow.completed": event.text || "详情图屏幕全部完成",
        "detail.long-image.completed": event.text || "详情页长图已合成",
        "tool.completed": event.text || "画布工具执行完成",
        "tool.failed": event.text || "画布工具执行失败",
        "turn.completed": event.text || "本轮完成",
        "run.completed": event.text || "任务完成",
        "run.stopped": "已停止本次运行",
        error: event.text || "Agent 运行出错",
    };
    return labels[event.type] || event.text || event.type;
}

function agentEventMeta(event: CanvasAgentEvent) {
    if (event.imageJobId) return `job ${event.imageJobId.slice(0, 8)}`;
    if (event.generationRunId) return `gen ${event.generationRunId.slice(-8)}`;
    if (event.toolCallId) return `tool ${event.toolCallId.slice(-8)}`;
    return "";
}

function AgentActivityIndicator() {
    return (
        <span className="flex size-4 shrink-0 items-center justify-center gap-[2px]" aria-hidden="true">
            {[0, 1, 2].map((index) => (
                <motion.span key={index} className="w-[2px] rounded-full bg-current" animate={{ height: [4, 12, 5], opacity: [0.35, 1, 0.45] }} transition={{ duration: 0.9, repeat: Infinity, ease: "easeInOut", delay: index * 0.13 }} />
            ))}
        </span>
    );
}

function friendlyAgentLog(log: string) {
    const value = String(log || "").trim();
    if (value === "Agent turn started") return "开始处理";
    if (value.includes("开始处理当前任务")) return "开始处理当前任务";
    if (value.includes("继续处理当前任务")) return "继续完成画布任务";
    if (value.includes("已读取当前画布快照")) return "已读取画布";
    if (value.includes("已连接 Agent 模型")) return "已连接 Agent 模型";
    if (value.includes("正在请求已配置的 Agent 模型")) return "正在思考";
    if (value.includes("已完成任务分析")) return "已完成任务分析";
    if (value.includes("模型正在生成工具请求")) return "正在规划画布操作";
    if (value.includes("正在校验模型返回的画布工具")) return "正在检查画布操作";
    if (value.includes("已生成待审批工具")) return "已准备画布操作";
    if (value.includes("已完成，无需工具审批")) return "分析完成";
    return value;
}

function AssistantReferenceChip({ item, onRemove }: { item: AgentComposerReference; onRemove?: () => void }) {
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    const text = (item.text || item.title).replace(/\s+/g, " ").trim().slice(0, 1) || "?";
    return (
        <div
            className="group/chip relative inline-flex size-14 shrink-0 items-center overflow-hidden rounded-xl border text-sm"
            style={{ color: theme.node.text, borderColor: item.uploadStatus === "error" ? "rgba(220,38,38,.5)" : theme.node.stroke }}
            title={item.uploadError || item.title}
        >
            {item.dataUrl ? (
                <img src={item.dataUrl} alt="" className="size-full object-cover" />
            ) : (
                <span className="grid size-full place-items-center text-sm font-medium" style={{ background: theme.node.panel }}>
                    {text}
                </span>
            )}
            {item.uploadStatus === "uploading" ? (
                <span className="absolute inset-0 grid place-items-center bg-black/45 text-white">
                    <LoaderCircle className="size-5 animate-spin" />
                </span>
            ) : null}
            {item.uploadStatus === "error" ? (
                <span className="absolute inset-0 grid place-items-center bg-red-950/70 text-white">
                    <CircleAlert className="size-5" />
                </span>
            ) : null}
            {onRemove ? (
                <button
                    type="button"
                    className="absolute -right-1 -top-1 grid size-4 place-items-center rounded-full border opacity-0 shadow-sm transition group-hover/chip:opacity-100"
                    style={{ background: theme.toolbar.panel, borderColor: theme.node.stroke }}
                    onClick={onRemove}
                    aria-label="移除引用"
                >
                    <X className="size-3" />
                </button>
            ) : null}
        </div>
    );
}

function nodeToReference(node: CanvasNodeData): CanvasAssistantReference | null {
    if (node.type === CanvasNodeType.Image && node.metadata?.content) {
        return { id: node.id, type: node.type, title: node.title, dataUrl: node.metadata.content, remoteUrl: node.metadata.remoteUrl, storageKey: node.metadata.storageKey };
    }
    if (node.type === CanvasNodeType.Text && node.metadata?.content) {
        return { id: node.id, type: node.type, title: node.title, text: node.metadata.content };
    }
    return null;
}

function buildAssistantReferences(nodes: CanvasNodeData[], selectedNodeIds: Set<string>) {
    const nodeById = new Map(nodes.map((node) => [node.id, node]));
    return Array.from(selectedNodeIds)
        .map((id) => nodeById.get(id))
        .filter((node): node is CanvasNodeData => Boolean(node))
        .map(nodeToReference)
        .filter((item): item is CanvasAssistantReference => Boolean(item));
}

function buildAgentSummary(text: string, nodes: CanvasNodeData[], selectedNodeIds: Set<string>) {
    const selected = nodes.filter((node) => selectedNodeIds.has(node.id));
    const counts = nodes.reduce<Record<string, number>>((acc, node) => {
        acc[node.type] = (acc[node.type] || 0) + 1;
        return acc;
    }, {});
    return [
        "我已读取当前画布，但这个请求没有匹配到可安全自动执行的工具。",
        `当前画布：${nodes.length} 个节点（图片 ${counts.image || 0}，文本 ${counts.text || 0}，配置 ${counts.config || 0}）。`,
        selected.length ? `当前选中：${selected.map((node) => node.title || node.id).join("、")}` : "当前没有选中节点。",
        `你的请求：${text}`,
    ].join("\n");
}

function buildAgentHistory(messages: CanvasAssistantMessage[]): CanvasAgentHistoryItem[] {
    return messages
        .filter((message) => !message.isLoading)
        .slice(-12)
        .map((message) => ({
            role: message.role,
            text: message.text,
            toolName: message.toolName || message.toolRequest?.name,
            toolStatus: message.toolStatus || message.toolRequest?.status,
        }));
}

function streamEventToAgentEvent(event: CanvasAgentStreamEvent): CanvasAgentEvent | null {
    if (event.type === "done") return null;
    return {
        id: event.id,
        type: event.type,
        runId: event.runId,
        turnId: event.turnId,
        toolCallId: event.toolCallId,
        text: event.text || "",
        status: event.status,
        timestamp: event.timestamp,
        sequence: event.sequence,
    };
}

function createPanelEvent(type: CanvasAgentEvent["type"], runId: string, turnId: string, text: string, status: CanvasAgentEvent["status"], toolCallId?: string): CanvasAgentEvent {
    return {
        id: `agent-event-${nanoid()}`,
        type,
        runId,
        turnId,
        toolCallId,
        text,
        status,
        timestamp: Date.now(),
        sequence: Date.now(),
    };
}

function createSession(title = "新 Agent"): CanvasAssistantSession {
    const now = new Date().toISOString();
    return { id: nanoid(), title, summary: "", messages: [], createdAt: now, updatedAt: now };
}
