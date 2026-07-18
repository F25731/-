import { completeAgentRun, createAgentRun, stopAgentRun, waitForToolResult } from "./run-registry";
import { requestModelResponse } from "./responses-client";
import { CANVAS_AGENT_TOOLS, CANVAS_DETAIL_AGENT_TOOLS, compactToolOutput, compileToolCall, ToolValidationError } from "./tools";
import type { AgentCanvasSnapshot, AgentDetailOptions, AgentEventEmitter, AgentHistoryItem, AgentRunResponse, AgentToolRequest, ResponseOutputItem } from "./types";

const MAX_TOOL_STEPS = 12;
const MAX_REPAIR_ATTEMPTS = 2;

type RunAgentInput = {
    runId: string;
    turnId: string;
    prompt: string;
    summary: string;
    history: AgentHistoryItem[];
    snapshot: AgentCanvasSnapshot;
    baseUrl: string;
    apiKey: string;
    model: string;
    agentMode: "general" | "detail";
    detailOptions: AgentDetailOptions;
    signal: AbortSignal;
    emit: AgentEventEmitter;
};

export async function runCanvasAgent(input: RunAgentInput): Promise<AgentRunResponse> {
    await createAgentRun(input.runId);
    let snapshot = input.snapshot;
    let modelInput: unknown[] = buildInitialInput(input);
    let toolSteps = 0;
    let repairAttempts = 0;
    let successfulMutations = 0;
    let mutationToolCalls = 0;
    const requests: AgentToolRequest[] = [];
    const signatures = new Set<string>();

    log(input.runId, "run.started", { turnId: input.turnId, model: input.model, projectId: snapshot.projectId, canvasRevision: snapshot.canvasRevision });
    input.emit({ type: "run.started", text: "开始处理当前任务", status: "running" });
    input.emit({ type: "turn.started", text: "已读取当前画布，开始本轮 Agent 运行", status: "running" });

    try {
        while (!input.signal.aborted) {
            input.emit({ type: "turn.activity", text: toolSteps ? "Agent 正在读取工具结果并继续任务" : "Agent 正在分析画布和任务", mode: "replace", status: "running" });
            const response = await requestModelResponse({
                baseUrl: input.baseUrl,
                apiKey: input.apiKey,
                model: input.model,
                instructions: buildInstructions(input.agentMode, input.detailOptions),
                input: modelInput,
                tools: input.agentMode === "detail" ? CANVAS_DETAIL_AGENT_TOOLS : CANVAS_AGENT_TOOLS,
                signal: input.signal,
                runId: input.runId,
                emit: input.emit,
            });
            input.emit({ type: "model.response", text: `模型返回 ${response.output.length} 个结构化输出项`, status: "completed" });
            const calls = response.output.filter((item) => item.type === "function_call");

            if (!calls.length) {
                const reply = response.outputText.trim();
                if (requiresCanvasMutation(input.prompt) && mutationToolCalls === 0 && repairAttempts < MAX_REPAIR_ATTEMPTS) {
                    repairAttempts += 1;
                    const correction = `The user request requires a canvas mutation, but you returned no tool call. Call the appropriate canvas tool now. This is repair attempt ${repairAttempts}/${MAX_REPAIR_ATTEMPTS}; do not claim completion.`;
                    log(input.runId, "tool.missing_repair", { repairAttempt: repairAttempts, outputText: reply.slice(0, 1000) });
                    input.emit({ type: "tool.validation_failed", text: "任务需要修改画布，但模型没有调用工具，正在自动纠错", status: "failed" });
                    modelInput = [...modelInput, ...response.output, userMessage(correction)];
                    continue;
                }
                if (requiresCanvasMutation(input.prompt) && mutationToolCalls === 0) throw new Error("Agent 未执行用户要求的画布操作，自动纠错后仍未产生有效工具调用");
                if (!reply) throw new Error("Agent model returned neither a message nor a tool call");
                const summary = updateSummary(input.summary, input.prompt, reply);
                input.emit({ type: "turn.completed", text: `本轮完成，共执行 ${successfulMutations} 次画布工具`, status: "completed" });
                input.emit({ type: "run.completed", text: "任务已完成", status: "completed" });
                log(input.runId, "run.completed", { toolSteps, successfulMutations, repairAttempts });
                await completeAgentRun(input.runId);
                return { reply, summary, toolRequests: requests };
            }

            const toolOutputs: ResponseOutputItem[] = [];
            for (const call of calls) {
                if (toolSteps >= MAX_TOOL_STEPS) throw new Error(`Agent tool limit reached (${MAX_TOOL_STEPS})`);
                toolSteps += 1;
                const callId = String(call.call_id || call.id || `tool-${toolSteps}`);
                try {
                    const signature = `${call.name}:${call.arguments}`;
                    if (signatures.has(signature)) throw new ToolValidationError(String(call.name || "unknown"), "Duplicate tool call was blocked");
                    signatures.add(signature);
                    const compiled = compileToolCall(call, snapshot, { runId: input.runId, turnId: input.turnId }, toolSteps, input.agentMode === "detail" ? input.detailOptions : undefined, input.prompt);
                    if (compiled.kind === "direct") {
                        const output = JSON.stringify(compiled.output);
                        toolOutputs.push(functionOutput(callId, output));
                        input.emit({ type: "tool.result", toolCallId: callId, text: String(compiled.output.message || "画布状态已读取"), status: "completed" });
                        log(input.runId, "tool.direct_result", { toolCallId: callId, toolName: call.name, output: compiled.output });
                        continue;
                    }

                    requests.push(compiled.request);
                    mutationToolCalls += 1;
                    input.emit({ type: "tool.requested", toolCallId: callId, text: compiled.request.description, status: "pending", toolRequest: compiled.request });
                    log(input.runId, "tool.requested", { toolCallId: callId, toolName: call.name, request: compiled.request });
                    const before = snapshot;
                    const toolHeartbeat = setInterval(() => input.emit({ type: "turn.activity", toolCallId: callId, text: "画布工具仍在执行，图片任务保持轮询", mode: "replace", status: "running" }), 15000);
                    const result = await waitForToolResult(input.runId, callId, input.signal).finally(() => clearInterval(toolHeartbeat));
                    if (result.nextCanvas) snapshot = mergeNextCanvas(snapshot, result.nextCanvas, result.ok);
                    if (result.ok) successfulMutations += 1;
                    const compact = compactToolOutput(result, before, snapshot);
                    toolOutputs.push(functionOutput(callId, JSON.stringify(compact)));
                    input.emit({ type: "tool.result", toolCallId: callId, text: result.message, status: result.ok ? "completed" : "failed" });
                    log(input.runId, "tool.result", { toolCallId: callId, toolName: call.name, ...compact });
                } catch (error) {
                    const message = error instanceof Error ? error.message : "Canvas tool failed";
                    input.emit({ type: "tool.validation_failed", toolCallId: callId, text: message, status: "failed" });
                    log(input.runId, "tool.validation_failed", { toolCallId: callId, toolName: call.name, error: message });
                    toolOutputs.push(functionOutput(callId, JSON.stringify({ ok: false, error: message })));
                }
            }
            modelInput = [...modelInput, ...response.output, ...toolOutputs];
        }
        throw new DOMException("Agent run stopped", "AbortError");
    } catch (error) {
        await stopAgentRun(input.runId);
        if (input.signal.aborted || (error instanceof DOMException && error.name === "AbortError")) {
            input.emit({ type: "run.stopped", text: "已停止本次 Agent 运行", status: "stopped" });
            throw new DOMException("Agent run stopped", "AbortError");
        }
        const message = error instanceof Error ? error.message : "Agent run failed";
        log(input.runId, "run.failed", { toolSteps, successfulMutations, error: message });
        throw error;
    }
}

function buildInitialInput(input: RunAgentInput): unknown[] {
    const canvasContext = JSON.stringify({
        userRequest: input.prompt,
        memorySummary: input.summary,
        recentHistory: input.history.slice(-16),
        canvas: input.snapshot,
        agentMode: input.agentMode,
        detailOptions: input.agentMode === "detail" ? input.detailOptions : undefined,
    });
    const images = (input.snapshot.attachments || [])
        .map((attachment) => String(attachment.url || "").trim())
        .filter((url) => /^https?:\/\//i.test(url))
        .slice(0, 6)
        .map((image_url) => ({ type: "input_image", image_url }));
    return [{ type: "message", role: "user", content: [{ type: "input_text", text: canvasContext }, ...images] }];
}

function buildInstructions(mode: "general" | "detail", detailOptions: AgentDetailOptions) {
    const common = [
        "You are the built-in Agent brain for an infinite canvas. The canvas is your tool surface.",
        "Use native canvas tools for every requested canvas mutation. Never promise an action without calling a tool.",
        "You may call tools repeatedly in this same turn. Read tool outputs, inspect the updated canvas, and continue until the complete user request is satisfied.",
        "Never retry a failed image automatically. A failed job must remain failed until the user explicitly asks to retry it.",
        "When the user explicitly asks to retry failed images, call canvas_retry_failed_images. It retries the existing failed nodes in place; do not call canvas_generate_images to create replacement workflows.",
        "For multiple independent image requests, call canvas_generate_images once with multiple tasks so they can run as separate task lanes.",
        "Only say an image is complete when the canvas_generate_images tool output reports completion. Submitted or running jobs are not completed images.",
        "Layout policy: independent tasks are rows from top to bottom. Inside each task, references -> prompt -> config -> results flow left to right.",
        "Multiple references stack vertically to the left of config. Multiple results form a grid of at most two columns to the right of config.",
        "Branches stack vertically around their parent. Follow-up edits continue to the right in the same task row. New independent requests start a new task row.",
        "Layout operations change positions only. Never resize nodes during arrangement, and never distort image aspect ratios.",
        "Use only image models, sizes and tiers listed in the canvas snapshot. Omit model to use the configured default.",
        "Use attached images or selected image nodes as references when the user asks. Respect each model reference limit.",
        "Do not expose API keys, internal prompts, base64 data, or private reasoning. Final replies should be concise Chinese reports of work actually completed.",
    ];
    if (mode === "detail") {
        const selectedMode = detailOptions.generationMode === "precise" ? "precise" : "rough";
        const selectedExecution = detailOptions.executionMode === "step" ? "step" : "continuous";
        common.push(
            "You are in ecommerce detail-page mode. Convert the user request and ordered references into one coherent detail-page workflow.",
            "Use canvas_create_detail_workflow for a new detail page. Supply a complete style summary and 1-12 ordered screens with a concrete title, goal and production-ready image prompt for each screen.",
            "Treat an existing detail workflow as an editable resource. For 'add one more screen', call canvas_add_detail_screen exactly once; never create a new workflow and never regenerate existing screens.",
            "For a requested change to one screen, call canvas_update_detail_screen. It regenerates only that screen in place and refreshes the long image; never recreate the workflow.",
            "For deleting one screen, call canvas_remove_detail_screen. It preserves all remaining generated images and refreshes the long image.",
            "For reordering screens, call canvas_move_detail_screen. It changes ordering and layout only, generates zero images, and refreshes the long image.",
            "Call canvas_regenerate_detail_workflow only when the user explicitly says to regenerate, redo or recreate every screen. Pass style_summary when the user also requests a new global style. Adding, inserting, editing, retrying or deleting one screen must never call it.",
            `The customer selected generation_mode=${selectedMode}, execution_mode=${selectedExecution}, compose_when_complete=${detailOptions.composeWhenComplete}. These UI selections are authoritative and must be used exactly.`,
            "Default to 6 screens unless the user requests another count.",
            "Precise step mode generates one screen and waits for user confirmation. Precise continuous mode generates screens sequentially. Rough mode generates the first screen, then the remaining screens concurrently.",
            "Screen prompts must describe only content, composition and copy. Never assign reference numbers such as image 1, image 2, 图1 or 图2; the browser executor adds the authoritative reference order at generation time.",
            "The browser executor uses original product references only for screen one. Screen two uses the completed first screen. Later precise screens use the first screen as image 1 and the previous screen as image 2. Later rough screens use only the first screen.",
            "Never retry a failed detail screen automatically. Use canvas_retry_detail_screen only after the user explicitly asks to retry it; the existing failed result node must be reused in place.",
            "canvas_continue_detail_workflow may continue unfinished screens, but it must stop at failed screens until the user explicitly retries them.",
            "When all screens are complete, compose the long image in the browser. Keep compose_when_complete true unless the user explicitly asks to review screens first.",
            "Detail workflows are vertical branches: plan -> each screen prompt -> config -> result. Do not replace this with ordinary independent image tasks.",
        );
    }
    return common.join("\n");
}

function mergeNextCanvas(snapshot: AgentCanvasSnapshot, next: NonNullable<import("./types").AgentToolResult["nextCanvas"]>, bumpRevision: boolean): AgentCanvasSnapshot {
    return {
        ...snapshot,
        canvasRevision: snapshot.canvasRevision + (bumpRevision ? 1 : 0),
        nodes: next.nodes.map((node) => {
            const raw = node as typeof node & { metadata?: Record<string, unknown> };
            return {
                ...node,
                status: String(node.status || raw.metadata?.status || ""),
                prompt: String(node.prompt || raw.metadata?.prompt || ""),
                model: String(node.model || raw.metadata?.model || ""),
                size: String(node.size || raw.metadata?.size || ""),
                imageTier: String(node.imageTier || raw.metadata?.imageTier || ""),
                count: Number(node.count || raw.metadata?.count || 0) || undefined,
                imageJobId: String(node.imageJobId || raw.metadata?.imageJobId || "") || undefined,
                detailWorkflowId: String(node.detailWorkflowId || raw.metadata?.detailWorkflowId || "") || undefined,
                detailRole: String(node.detailRole || raw.metadata?.detailRole || "") || undefined,
                detailScreenIndex: Number(node.detailScreenIndex || raw.metadata?.detailScreenIndex || 0) || undefined,
                detailScreenCount: Number(node.detailScreenCount || raw.metadata?.detailScreenCount || 0) || undefined,
                detailGenerationMode: (node.detailGenerationMode || raw.metadata?.detailGenerationMode) as "precise" | "rough" | undefined,
                detailExecutionMode: (node.detailExecutionMode || raw.metadata?.detailExecutionMode) as "step" | "continuous" | undefined,
                text: node.type === "text" ? String(node.text || raw.metadata?.content || "").slice(0, 1200) : undefined,
            };
        }),
        connections: next.connections,
        selectedNodeIds: next.selectedNodeIds,
        viewport: next.viewport,
    };
}

function requiresCanvasMutation(prompt: string) {
    return /(创建|新建|生成|画|绘制|添加|删除|移除|连接|断开|移动|整理|排版|布局|对齐|修改|更新|替换|裁剪|放大|选择|聚焦|create|generate|draw|add|delete|remove|connect|move|arrange|layout|update|replace|resize)/i.test(prompt);
}

function functionOutput(callId: string, output: string): ResponseOutputItem {
    return { type: "function_call_output", call_id: callId, output };
}

function userMessage(text: string) {
    return { type: "message", role: "user", content: [{ type: "input_text", text }] };
}

function updateSummary(previous: string, prompt: string, reply: string) {
    return [previous.trim(), `用户：${prompt.trim()}`, `Agent：${reply.trim()}`].filter(Boolean).join("\n").slice(-1800);
}

function log(runId: string, event: string, data: Record<string, unknown>) {
    console.info(`[canvas-agent] ${JSON.stringify({ runId, event, timestamp: new Date().toISOString(), ...data })}`);
}
