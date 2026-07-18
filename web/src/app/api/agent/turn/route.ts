import type { NextRequest } from "next/server";

import { runCanvasAgent } from "../runtime/agent-runtime";
import type { AgentCanvasSnapshot, AgentEventEmitter, AgentHistoryItem, AgentRunPayload } from "../runtime/types";

export const runtime = "nodejs";
export const maxDuration = 900;

export async function POST(request: NextRequest) {
    const payload = (await request.json().catch(() => null)) as AgentRunPayload | null;
    const prompt = String(payload?.prompt || "").trim();
    const apiKey = String(payload?.apiKey || "").trim();
    const baseUrl = String(payload?.baseUrl || "").trim();
    const model = String(payload?.modelId || payload?.model || "").trim();
    const agentMode = payload?.agentMode === "detail" ? "detail" : "general";
    const detailOptions = sanitizeDetailOptions(payload?.detailOptions);
    const runId = safeId(payload?.runId, "agent-run");
    const turnId = safeId(payload?.turnId, "agent-turn");
    const snapshot = sanitizeSnapshot(payload?.snapshot);

    if (!prompt) return Response.json({ code: 1, data: null, msg: "请输入 Agent 指令" }, { status: 400 });
    if (!apiKey) return Response.json({ code: 1, data: null, msg: "请先配置 Agent 模型密钥" }, { status: 400 });
    if (!baseUrl) return Response.json({ code: 1, data: null, msg: "请先配置 Agent 模型请求地址" }, { status: 400 });
    if (!model) return Response.json({ code: 1, data: null, msg: "请先选择 Agent 模型" }, { status: 400 });
    if (!snapshot) return Response.json({ code: 1, data: null, msg: "画布快照无效" }, { status: 400 });

    const encoder = new TextEncoder();
    const runAbortController = new AbortController();
    const streamState = { closed: false };
    const abortRun = () => runAbortController.abort();
    if (request.signal.aborted) abortRun();
    else request.signal.addEventListener("abort", abortRun, { once: true });
    const stream = new ReadableStream({
        start(controller) {
            let sequence = 0;
            const emit: AgentEventEmitter = (event) => {
                if (streamState.closed) return;
                const payload = { id: event.id || `${turnId}:${sequence}`, runId, turnId, timestamp: Date.now(), sequence: sequence++, ...event };
                try {
                    controller.enqueue(encoder.encode(`data: ${JSON.stringify(payload)}\n\n`));
                } catch (error) {
                    if (isClosedStreamError(error)) {
                        streamState.closed = true;
                        abortRun();
                        return;
                    }
                    throw error;
                }
            };
            void runCanvasAgent({
                runId,
                turnId,
                prompt,
                summary: String(payload?.summary || "").slice(0, 2000),
                history: sanitizeHistory(payload?.history),
                snapshot,
                baseUrl,
                apiKey,
                model,
                agentMode,
                detailOptions,
                signal: runAbortController.signal,
                emit,
            })
                .then((result) => emit({ type: "done", data: result, status: "completed" }))
                .catch((error) => {
                    if (runAbortController.signal.aborted || (error instanceof DOMException && error.name === "AbortError")) return;
                    emit({ type: "error", text: error instanceof Error ? error.message : "Agent 运行失败", status: "failed" });
                })
                .finally(() => {
                    request.signal.removeEventListener("abort", abortRun);
                    if (streamState.closed) return;
                    streamState.closed = true;
                    try {
                        controller.close();
                    } catch (error) {
                        if (!isClosedStreamError(error)) console.warn("[canvas-agent] failed to close event stream", error);
                    }
                });
        },
        cancel() {
            streamState.closed = true;
            abortRun();
        },
    });
    return new Response(stream, {
        headers: {
            "Content-Type": "text/event-stream; charset=utf-8",
            "Cache-Control": "no-cache, no-transform",
            Connection: "keep-alive",
            "X-Accel-Buffering": "no",
        },
    });
}

function sanitizeDetailOptions(value: AgentRunPayload["detailOptions"]) {
    return {
        generationMode: value?.generationMode === "rough" ? ("rough" as const) : ("precise" as const),
        executionMode: value?.executionMode === "step" ? ("step" as const) : ("continuous" as const),
        composeWhenComplete: value?.composeWhenComplete !== false,
    };
}

function isClosedStreamError(error: unknown) {
    if (!(error instanceof TypeError)) return false;
    const message = String(error.message || "");
    return message.includes("Controller is already closed") || message.includes("Invalid state");
}

function sanitizeHistory(value: AgentRunPayload["history"]): AgentHistoryItem[] {
    if (!Array.isArray(value)) return [];
    return value.slice(-16).flatMap((item) => {
        const text = String(item?.text || "")
            .trim()
            .slice(0, 8000);
        if (!text) return [];
        return [{ role: item?.role === "assistant" ? "assistant" : "user", text } as AgentHistoryItem];
    });
}

function sanitizeSnapshot(value: AgentRunPayload["snapshot"]): AgentCanvasSnapshot | null {
    if (!value || !Array.isArray(value.nodes) || !Array.isArray(value.connections) || !Array.isArray(value.selectedNodeIds)) return null;
    return {
        ...value,
        canvasRevision: Math.max(1, Math.floor(Number(value.canvasRevision) || 1)),
        nodes: value.nodes.slice(0, 500),
        connections: value.connections.slice(0, 1000),
        selectedNodeIds: value.selectedNodeIds.slice(0, 200),
        attachments: Array.isArray(value.attachments) ? value.attachments.slice(0, 6) : [],
        imageModels: Array.isArray(value.imageModels) ? value.imageModels.slice(0, 100) : [],
    };
}

function safeId(value: unknown, prefix: string) {
    const candidate = String(value || "").trim();
    if (/^[a-zA-Z0-9:_-]{1,160}$/.test(candidate)) return candidate;
    return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}
