import { buildImageTaskOperations, buildWorkflowLayoutOperations, nextIndependentTaskOrigin, type CanvasOperationPayload, type ImageGenerationTask } from "./canvas-layout";
import { buildDetailWorkflowAction, buildDetailWorkflowOperations } from "./detail-layout";
import type { AgentCanvasSnapshot, AgentDetailOptions, AgentToolRequest, ResponseOutputItem } from "./types";

export const CANVAS_AGENT_TOOLS = [
    tool("canvas_read", "Read the current canvas state, selection, connections, models and image job states.", {
        type: "object",
        properties: { detail: { type: "string", enum: ["summary", "full"] } },
        additionalProperties: false,
    }),
    tool("canvas_generate_images", "Create one or more independent image-generation workflows and run them. Use one task per requested subject or deliverable.", {
        type: "object",
        properties: {
            tasks: {
                type: "array",
                minItems: 1,
                maxItems: 6,
                items: {
                    type: "object",
                    properties: {
                        title: { type: "string" },
                        prompt: { type: "string" },
                        count: { type: "integer", minimum: 1, maximum: 8 },
                        model: { type: "string" },
                        size: { type: "string" },
                        image_tier: { type: "string" },
                        reference_node_ids: { type: "array", items: { type: "string" } },
                        reference_attachment_ids: { type: "array", items: { type: "string" } },
                    },
                    required: ["prompt", "count"],
                    additionalProperties: false,
                },
            },
        },
        required: ["tasks"],
        additionalProperties: false,
    }),
    tool("canvas_generate_text", "Create a text generation workflow and run it.", {
        type: "object",
        properties: {
            title: { type: "string" },
            prompt: { type: "string" },
            count: { type: "integer", minimum: 1, maximum: 8 },
        },
        required: ["prompt"],
        additionalProperties: false,
    }),
    tool("canvas_apply_operations", "Create, update, move, resize, remove, connect, select, or focus canvas nodes. Batch related changes in one call.", {
        type: "object",
        properties: {
            description: { type: "string" },
            operations: {
                type: "array",
                minItems: 1,
                maxItems: 40,
                items: {
                    type: "object",
                    properties: {
                        action: {
                            type: "string",
                            enum: ["create_node", "update_node", "move_node", "resize_node", "remove_nodes", "connect", "disconnect", "select", "set_viewport"],
                        },
                        id: { type: "string" },
                        ids: { type: "array", items: { type: "string" } },
                        node_type: { type: "string", enum: ["text", "image", "config"] },
                        title: { type: "string" },
                        text: { type: "string" },
                        x: { type: "number" },
                        y: { type: "number" },
                        width: { type: "number" },
                        height: { type: "number" },
                        from_node_id: { type: "string" },
                        to_node_id: { type: "string" },
                        zoom: { type: "number" },
                    },
                    required: ["action"],
                    additionalProperties: false,
                },
            },
        },
        required: ["operations"],
        additionalProperties: false,
    }),
    tool("canvas_layout", "Arrange tasks as vertical lanes while keeping each workflow left-to-right. Layout changes positions only and preserves node sizes and image ratios.", {
        type: "object",
        properties: {
            node_ids: { type: "array", items: { type: "string" } },
            scope: { type: "string", enum: ["all", "selected", "nodes"] },
        },
        additionalProperties: false,
    }),
    tool("canvas_query_image_jobs", "Inspect image generation jobs currently represented on the canvas.", {
        type: "object",
        properties: { job_ids: { type: "array", items: { type: "string" } } },
        additionalProperties: false,
    }),
    tool("canvas_retry_failed_images", "Retry failed image nodes in place. Preserve their node IDs, positions and connections. If node_ids is omitted, retry every failed image node on the canvas.", {
        type: "object",
        properties: { node_ids: { type: "array", items: { type: "string" } } },
        additionalProperties: false,
    }),
] as const;

export const CANVAS_DETAIL_AGENT_TOOLS = [
    CANVAS_AGENT_TOOLS[0],
    tool("canvas_create_detail_workflow", "Plan and create a complete ecommerce detail-page workflow, then generate it using precise or rough mode.", {
        type: "object",
        properties: {
            title: { type: "string" },
            style_summary: { type: "string" },
            screens: {
                type: "array",
                minItems: 1,
                maxItems: 12,
                items: {
                    type: "object",
                    properties: {
                        title: { type: "string" },
                        goal: { type: "string" },
                        prompt: { type: "string" },
                    },
                    required: ["title", "goal", "prompt"],
                    additionalProperties: false,
                },
            },
            generation_mode: { type: "string", enum: ["precise", "rough"] },
            execution_mode: { type: "string", enum: ["step", "continuous"] },
            model: { type: "string" },
            size: { type: "string" },
            image_tier: { type: "string" },
            reference_node_ids: { type: "array", items: { type: "string" } },
            reference_attachment_ids: { type: "array", items: { type: "string" } },
            compose_when_complete: { type: "boolean" },
        },
        required: ["title", "style_summary", "screens", "generation_mode", "execution_mode"],
        additionalProperties: false,
    }),
    tool("canvas_continue_detail_workflow", "Continue a paused or partially failed detail workflow. Step mode generates one next screen; continuous mode generates all remaining screens.", {
        type: "object",
        properties: {
            workflow_id: { type: "string" },
            execution_mode: { type: "string", enum: ["step", "continuous"] },
            compose_when_complete: { type: "boolean" },
        },
        additionalProperties: false,
    }),
    tool("canvas_add_detail_screen", "Add exactly one screen to an existing detail workflow without regenerating any existing screen. Omit after_screen_index to append it at the end.", {
        type: "object",
        properties: {
            workflow_id: { type: "string" },
            after_screen_index: { type: "integer", minimum: 0, maximum: 12 },
            title: { type: "string" },
            goal: { type: "string" },
            prompt: { type: "string" },
            compose_when_complete: { type: "boolean" },
        },
        required: ["title", "goal", "prompt"],
        additionalProperties: false,
    }),
    tool("canvas_update_detail_screen", "Modify and regenerate exactly one existing detail screen in place. Preserve every other screen and refresh the composed long image after success.", {
        type: "object",
        properties: {
            workflow_id: { type: "string" },
            screen_index: { type: "integer", minimum: 1, maximum: 12 },
            title: { type: "string" },
            goal: { type: "string" },
            prompt: { type: "string" },
            compose_when_complete: { type: "boolean" },
        },
        required: ["screen_index", "title", "goal", "prompt"],
        additionalProperties: false,
    }),
    tool("canvas_remove_detail_screen", "Remove exactly one screen from an existing detail workflow without regenerating the remaining screens, then refresh the composed long image.", {
        type: "object",
        properties: {
            workflow_id: { type: "string" },
            screen_index: { type: "integer", minimum: 1, maximum: 12 },
            compose_when_complete: { type: "boolean" },
        },
        required: ["screen_index"],
        additionalProperties: false,
    }),
    tool("canvas_move_detail_screen", "Move one existing screen to a new position in the same detail workflow without regenerating any image, then refresh the composed long image.", {
        type: "object",
        properties: {
            workflow_id: { type: "string" },
            screen_index: { type: "integer", minimum: 1, maximum: 12 },
            after_screen_index: { type: "integer", minimum: 0, maximum: 12 },
            compose_when_complete: { type: "boolean" },
        },
        required: ["screen_index", "after_screen_index"],
        additionalProperties: false,
    }),
    tool("canvas_regenerate_detail_workflow", "Regenerate every screen in an existing detail workflow. Use only when the user explicitly asks to regenerate or redo the whole workflow.", {
        type: "object",
        properties: {
            workflow_id: { type: "string" },
            style_summary: { type: "string" },
            compose_when_complete: { type: "boolean" },
        },
        additionalProperties: false,
    }),
    tool("canvas_retry_detail_screen", "Retry one failed or revised detail-page screen and preserve the workflow continuity references.", {
        type: "object",
        properties: {
            workflow_id: { type: "string" },
            screen_index: { type: "integer", minimum: 1, maximum: 12 },
            compose_when_complete: { type: "boolean" },
        },
        required: ["screen_index"],
        additionalProperties: false,
    }),
    tool("canvas_compose_detail_long_image", "Compose all completed detail-page screens into one long image entirely in the browser and add it to the canvas.", {
        type: "object",
        properties: { workflow_id: { type: "string" } },
        additionalProperties: false,
    }),
    CANVAS_AGENT_TOOLS[3],
    CANVAS_AGENT_TOOLS[4],
    CANVAS_AGENT_TOOLS[5],
    CANVAS_AGENT_TOOLS[6],
] as const;

export type CompiledTool = { kind: "direct"; output: Record<string, unknown> } | { kind: "browser"; request: AgentToolRequest };

export function compileToolCall(item: ResponseOutputItem, snapshot: AgentCanvasSnapshot, ids: { runId: string; turnId: string }, step: number, detailOptions?: AgentDetailOptions, userPrompt = ""): CompiledTool {
    const name = String(item.name || "");
    const toolCallId = String(item.call_id || item.id || `tool-${step}`);
    const args = applyDetailOptions(name, parseArguments(item.arguments), detailOptions);
    logAgent(ids.runId, "tool.arguments", { toolCallId, name, arguments: args });

    if (name === "canvas_read") {
        return {
            kind: "direct",
            output: {
                ok: true,
                canvas: args.detail === "full" ? snapshot : summarizeCanvas(snapshot),
            },
        };
    }
    if (name === "canvas_query_image_jobs") {
        const requested = stringArray(args.job_ids);
        const jobs = snapshot.nodes.filter((node) => node.imageJobId && (!requested.length || requested.includes(node.imageJobId))).map((node) => ({ jobId: node.imageJobId, nodeId: node.id, status: node.status || "unknown" }));
        return { kind: "direct", output: { ok: true, jobs, message: jobs.length ? `Found ${jobs.length} image jobs` : "No active image jobs" } };
    }

    enforceDetailToolIntent(name, snapshot, userPrompt);

    let operation: CanvasOperationPayload;
    let description = "执行画布操作";
    if (name === "canvas_generate_images") {
        const tasks = normalizeImageTasks(args.tasks, snapshot);
        if (!tasks.length) throw new ToolValidationError(name, "At least one valid image task is required");
        const built = buildImageTaskOperations(snapshot, tasks, `${Date.now()}-${step}`);
        operation = { type: "canvas.applyOps", operations: built.operations };
        description = tasks.length === 1 ? `创建并生成：${tasks[0].title || tasks[0].prompt.slice(0, 32)}` : `创建 ${tasks.length} 条独立生图任务并开始生成`;
    } else if (name === "canvas_create_detail_workflow") {
        const built = buildDetailWorkflowOperations(snapshot, args, `${Date.now()}-${step}`);
        operation = { type: "canvas.applyOps", operations: built.operations };
        description = `创建 ${built.screenCount} 屏详情图工作流并开始生成`;
    } else if (
        [
            "canvas_continue_detail_workflow",
            "canvas_add_detail_screen",
            "canvas_update_detail_screen",
            "canvas_remove_detail_screen",
            "canvas_move_detail_screen",
            "canvas_regenerate_detail_workflow",
            "canvas_retry_detail_screen",
            "canvas_compose_detail_long_image",
        ].includes(name)
    ) {
        operation = buildDetailWorkflowAction(name, args);
        description = detailToolDescription(name, args);
    } else if (name === "canvas_retry_failed_images") {
        const requestedIds = stringArray(args.node_ids);
        const failedNodes = snapshot.nodes.filter((node) => node.type === "image" && ["error", "failed"].includes(String(node.status || "")) && (!requestedIds.length || requestedIds.includes(node.id)));
        if (!failedNodes.length) {
            throw new ToolValidationError(name, requestedIds.length ? "None of the requested nodes is a failed image node" : "No failed image nodes are available to retry");
        }
        operation = { type: "canvas.retryFailedNodes", nodeIds: failedNodes.map((node) => node.id) };
        description = failedNodes.length === 1 ? "在原失败节点上重试生图" : `在 ${failedNodes.length} 个原失败节点上重试生图`;
    } else if (name === "canvas_generate_text") {
        operation = buildTextGenerationOperation(snapshot, args, `${Date.now()}-${step}`);
        description = `创建文本生成任务：${String(args.title || args.prompt || "").slice(0, 48)}`;
    } else if (name === "canvas_layout") {
        const scope = String(args.scope || "all");
        const requestedIds = scope === "selected" ? snapshot.selectedNodeIds : scope === "nodes" ? stringArray(args.node_ids) : [];
        const operations = buildWorkflowLayoutOperations(snapshot, requestedIds);
        if (!operations.length) throw new ToolValidationError(name, "No nodes available for layout");
        operation = { type: "canvas.applyOps", operations };
        description = "按任务泳道整理画布，保持节点尺寸和图片比例";
    } else if (name === "canvas_apply_operations") {
        const operations = compileGenericOperations(args.operations, snapshot, step);
        if (!operations.length) throw new ToolValidationError(name, "No valid canvas operations were supplied");
        operation = { type: "canvas.applyOps", operations };
        description = String(args.description || "批量修改当前画布").slice(0, 160);
    } else {
        throw new ToolValidationError(name || "unknown", "Unsupported canvas tool");
    }

    return {
        kind: "browser",
        request: {
            id: `agent-tool-${toolCallId}`,
            runId: ids.runId,
            turnId: ids.turnId,
            toolCallId,
            name: browserToolName(name),
            description,
            expectedRevision: snapshot.canvasRevision,
            operation,
            status: "pending",
        },
    };
}

function enforceDetailToolIntent(name: string, snapshot: AgentCanvasSnapshot, userPrompt: string) {
    const hasDetailWorkflow = snapshot.nodes.some((node) => Boolean(node.detailWorkflowId));
    if (name === "canvas_create_detail_workflow" && hasDetailWorkflow && !/(另做|另一套|新建一套|新建新的|创建一套新的|再做一套新的)/i.test(userPrompt)) {
        throw new ToolValidationError(name, "An existing detail workflow must be edited incrementally. Use add/update/remove/regenerate tools unless the user explicitly asks for a separate new workflow.");
    }
    if (name === "canvas_regenerate_detail_workflow" && !/(全部|所有|整套|全套|每一屏|所有屏).{0,16}(重新生成|重做|重绘|再生成|全部更新)|(重新生成|重做|重绘|再生成).{0,16}(全部|所有|整套|全套|每一屏|所有屏)/i.test(userPrompt)) {
        throw new ToolValidationError(name, "Full-workflow regeneration requires an explicit user request to regenerate every screen. Use a single-screen incremental tool instead.");
    }
}

function detailToolDescription(name: string, args: Record<string, unknown>) {
    const index = Number(args.screen_index) || 1;
    if (name === "canvas_compose_detail_long_image") return "在浏览器合成详情页长图";
    if (name === "canvas_add_detail_screen") return `仅新增一屏详情图：${String(args.title || "新屏幕").slice(0, 48)}`;
    if (name === "canvas_update_detail_screen") return `仅修改并重新生成详情图第 ${index} 屏`;
    if (name === "canvas_remove_detail_screen") return `仅删除详情图第 ${index} 屏`;
    if (name === "canvas_move_detail_screen") return `仅调整详情图第 ${index} 屏顺序`;
    if (name === "canvas_regenerate_detail_workflow") return "按用户明确要求重新生成全部详情图屏幕";
    if (name === "canvas_retry_detail_screen") return `重试详情图第 ${index} 屏`;
    return "继续未完成的详情图工作流";
}

function applyDetailOptions(name: string, args: Record<string, unknown>, detailOptions?: AgentDetailOptions) {
    if (!detailOptions || !name.includes("detail")) return args;
    return {
        ...args,
        generation_mode: detailOptions.generationMode,
        execution_mode: detailOptions.executionMode,
        compose_when_complete: detailOptions.composeWhenComplete,
    };
}

export function compactToolOutput(result: { ok: boolean; message: string; generationRunIds?: string[]; imageJobIds?: string[]; artifacts?: unknown[] }, before: AgentCanvasSnapshot, after: AgentCanvasSnapshot) {
    const beforeIds = new Set(before.nodes.map((node) => node.id));
    const createdNodeIds = after.nodes.filter((node) => !beforeIds.has(node.id)).map((node) => node.id);
    return {
        ok: result.ok,
        message: result.message,
        createdNodeIds,
        selectedNodeIds: after.selectedNodeIds,
        generationRunIds: result.generationRunIds || [],
        imageJobIds: result.imageJobIds || [],
        artifacts: result.artifacts || [],
        canvasRevision: after.canvasRevision,
    };
}

export class ToolValidationError extends Error {
    constructor(
        readonly toolName: string,
        message: string,
    ) {
        super(message);
        this.name = "ToolValidationError";
    }
}

function buildTextGenerationOperation(snapshot: AgentCanvasSnapshot, args: Record<string, unknown>, stamp: string): CanvasOperationPayload {
    const prompt = String(args.prompt || "").trim();
    if (!prompt) throw new ToolValidationError("canvas_generate_text", "Prompt is required");
    const origin = nextIndependentTaskOrigin(snapshot);
    const promptId = `text-agent-${stamp}`;
    const configId = `config-agent-${stamp}`;
    return {
        type: "canvas.applyOps",
        operations: [
            {
                type: "canvas.addNode",
                node: { id: promptId, type: "text", title: String(args.title || "文本提示词").slice(0, 64), position: origin, width: 340, height: 240, metadata: { content: prompt, prompt, status: "success", fontSize: 14 } },
            },
            {
                type: "canvas.addNode",
                node: {
                    id: configId,
                    type: "config",
                    title: String(args.title || "文本生成").slice(0, 64),
                    position: { x: origin.x + 420, y: origin.y - 80 },
                    width: 360,
                    height: 400,
                    metadata: { status: "idle", generationMode: "text", composerContent: `@[node:${promptId}]`, count: clampNumber(args.count, 1, 8, 1) },
                },
            },
            { type: "canvas.addConnection", connection: { id: `conn-agent-${stamp}`, fromNodeId: promptId, toNodeId: configId } },
            { type: "canvas.runGeneration", nodeId: configId, mode: "text", prompt: `@[node:${promptId}]` },
        ],
    };
}

function compileGenericOperations(value: unknown, snapshot: AgentCanvasSnapshot, step: number) {
    if (!Array.isArray(value)) return [];
    const nodeById = new Map(snapshot.nodes.map((node) => [node.id, node]));
    const operations: CanvasOperationPayload[] = [];
    let createIndex = 0;
    for (const raw of value.slice(0, 40)) {
        if (!raw || typeof raw !== "object") continue;
        const item = raw as Record<string, unknown>;
        const action = String(item.action || "");
        if (action === "create_node") {
            const type = ["text", "image", "config"].includes(String(item.node_type)) ? String(item.node_type) : "text";
            const defaults = type === "config" ? { width: 360, height: 400 } : { width: 340, height: 240 };
            const preferred = nextIndependentTaskOrigin({ ...snapshot, nodes: [...snapshot.nodes, ...operations.flatMap(extractCreatedNodes)] });
            const id = `agent-${type}-${Date.now()}-${step}-${createIndex++}`;
            operations.push({
                type: "canvas.addNode",
                node: {
                    id,
                    type,
                    title: String(item.title || (type === "text" ? "文本" : type === "config" ? "生成配置" : "图片")).slice(0, 64),
                    position: { x: finiteNumber(item.x, preferred.x), y: finiteNumber(item.y, preferred.y) },
                    width: clampNumber(item.width, 120, 1600, defaults.width),
                    height: clampNumber(item.height, 80, 1200, defaults.height),
                    metadata: type === "text" ? { content: String(item.text || ""), status: "success", fontSize: 14 } : { status: "idle" },
                },
            });
        } else if (action === "update_node" && nodeById.has(String(item.id))) {
            const patch: Record<string, unknown> = {};
            if (typeof item.title === "string") patch.title = item.title.slice(0, 64);
            if (typeof item.text === "string") patch.metadata = { content: item.text, prompt: item.text };
            operations.push({ type: "canvas.updateNode", id: String(item.id), patch });
        } else if (action === "move_node" && nodeById.has(String(item.id))) {
            const node = nodeById.get(String(item.id))!;
            operations.push({ type: "canvas.moveNodes", items: [{ id: node.id, position: { x: finiteNumber(item.x, node.position.x), y: finiteNumber(item.y, node.position.y) } }] });
        } else if (action === "resize_node" && nodeById.has(String(item.id))) {
            const node = nodeById.get(String(item.id))!;
            operations.push({ type: "canvas.resizeNode", id: node.id, width: clampNumber(item.width, 120, 1600, node.width), height: clampNumber(item.height, 80, 1200, node.height) });
        } else if (action === "remove_nodes") {
            const ids = stringArray(item.ids).filter((id) => nodeById.has(id));
            if (ids.length) operations.push({ type: "canvas.removeNodes", ids });
        } else if (action === "connect" && nodeById.has(String(item.from_node_id)) && nodeById.has(String(item.to_node_id))) {
            operations.push({ type: "canvas.addConnection", connection: { id: `conn-agent-${Date.now()}-${step}-${operations.length}`, fromNodeId: String(item.from_node_id), toNodeId: String(item.to_node_id) } });
        } else if (action === "disconnect") {
            const ids = stringArray(item.ids).filter((id) => snapshot.connections.some((connection) => connection.id === id));
            if (ids.length) operations.push({ type: "canvas.removeConnections", ids });
        } else if (action === "select") {
            operations.push({ type: "canvas.selectNodes", ids: stringArray(item.ids).filter((id) => nodeById.has(id)) });
        } else if (action === "set_viewport") {
            operations.push({ type: "canvas.setViewport", viewport: { x: finiteNumber(item.x, snapshot.viewport?.x || 0), y: finiteNumber(item.y, snapshot.viewport?.y || 0), k: clampNumber(item.zoom, 0.08, 4, snapshot.viewport?.k || 1) } });
        }
    }
    return operations;
}

function normalizeImageTasks(value: unknown, snapshot: AgentCanvasSnapshot): ImageGenerationTask[] {
    if (!Array.isArray(value)) return [];
    return value.flatMap((raw) => {
        if (!raw || typeof raw !== "object") return [];
        const task = raw as Record<string, unknown>;
        const prompt = String(task.prompt || "").trim();
        if (!prompt) return [];
        return [
            {
                title: String(task.title || "").slice(0, 64) || undefined,
                prompt: prompt.slice(0, 8000),
                count: clampNumber(task.count, 1, 8, snapshot.imageDefaults?.count || 1),
                model: String(task.model || "").trim() || undefined,
                size: String(task.size || "").trim() || undefined,
                imageTier: String(task.image_tier || "").trim() || undefined,
                referenceNodeIds: stringArray(task.reference_node_ids),
                referenceAttachmentIds: stringArray(task.reference_attachment_ids),
            },
        ];
    });
}

function summarizeCanvas(snapshot: AgentCanvasSnapshot) {
    return {
        projectId: snapshot.projectId,
        canvasRevision: snapshot.canvasRevision,
        nodeCount: snapshot.nodes.length,
        connectionCount: snapshot.connections.length,
        selectedNodeIds: snapshot.selectedNodeIds,
        nodes: snapshot.nodes.map((node) => ({ id: node.id, type: node.type, title: node.title, status: node.status, imageJobId: node.imageJobId })),
        imageModels: snapshot.imageModels,
        imageDefaults: snapshot.imageDefaults,
    };
}

function extractCreatedNodes(operation: CanvasOperationPayload) {
    return operation.type === "canvas.addNode" && operation.node && typeof operation.node === "object" ? [operation.node as AgentCanvasSnapshot["nodes"][number]] : [];
}

function browserToolName(name: string) {
    if (name.startsWith("canvas_") && name.includes("detail")) return "canvas.detailWorkflow";
    if (name === "canvas_retry_failed_images") return "canvas.retryFailedImages";
    if (name === "canvas_generate_images") return "canvas.generateImage";
    if (name === "canvas_generate_text") return "canvas.generateText";
    if (name === "canvas_layout") return "canvas.moveNodes";
    return "canvas.applyOps";
}

function tool(name: string, description: string, parameters: Record<string, unknown>) {
    return { type: "function", name, description, parameters, strict: false };
}

function parseArguments(value: unknown): Record<string, unknown> {
    if (value && typeof value === "object") return value as Record<string, unknown>;
    try {
        const parsed = JSON.parse(String(value || "{}"));
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return parsed as Record<string, unknown>;
    } catch {
        throw new ToolValidationError("unknown", "Tool arguments are not valid JSON");
    }
    return {};
}

function stringArray(value: unknown) {
    return Array.isArray(value)
        ? value
              .map(String)
              .map((item) => item.trim())
              .filter(Boolean)
              .slice(0, 100)
        : [];
}

function finiteNumber(value: unknown, fallback: number) {
    const number = Number(value);
    return Number.isFinite(number) ? number : fallback;
}

function clampNumber(value: unknown, min: number, max: number, fallback: number) {
    return Math.max(min, Math.min(max, Math.floor(finiteNumber(value, fallback))));
}

function logAgent(runId: string, event: string, data: Record<string, unknown>) {
    console.info(`[canvas-agent] ${JSON.stringify({ runId, event, ...data })}`);
}
