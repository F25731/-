import { findOpenNodePosition } from "@/app/(user)/canvas/utils/canvas-layout";

import type { CanvasOperationPayload } from "./canvas-layout";
import type { AgentCanvasSnapshot } from "./types";

const TASK_GAP = 120;
const STAGE_GAP = 80;
const ROW_GAP = 72;
const REFERENCE_SIZE = 172;
const REFERENCE_GAP = 24;
const PLAN_SIZE = { width: 340, height: 320 };
const PROMPT_SIZE = { width: 340, height: 240 };
const CONFIG_SIZE = { width: 360, height: 400 };
const RESULT_SIZE = { width: 340, height: 520 };

type DetailScreenInput = { index: number; title: string; goal: string; prompt: string };

export function buildDetailWorkflowOperations(snapshot: AgentCanvasSnapshot, args: Record<string, unknown>, stamp: string) {
    const screens = normalizeScreens(args.screens);
    if (!screens.length) throw new Error("详情图工作流至少需要一屏内容");
    const generationMode = args.generation_mode === "rough" ? "rough" : "precise";
    const executionMode = args.execution_mode === "step" ? "step" : "continuous";
    const workflowId = `detail-${safeToken(stamp)}`;
    const title =
        String(args.title || "电商详情图")
            .trim()
            .slice(0, 64) || "电商详情图";
    const styleSummary = String(args.style_summary || "统一、专业、适合电商详情页的视觉风格")
        .trim()
        .slice(0, 8000);
    const model = selectImageModel(snapshot, String(args.model || ""));
    const modelConfig = snapshot.imageModels?.find((item) => item.name === model);
    const referenceLimit = Math.max(0, Number(modelConfig?.referenceLimit) || 0);
    const existingImageIds = new Set(snapshot.nodes.filter((node) => node.type === "image").map((node) => node.id));
    const requestedNodeIds = stringArray(args.reference_node_ids).filter((id, index, values) => existingImageIds.has(id) && values.indexOf(id) === index);
    const requestedAttachmentIds = stringArray(args.reference_attachment_ids);
    const attachments = (snapshot.attachments || []).filter((item) => item.id && item.url && (!requestedAttachmentIds.length || requestedAttachmentIds.includes(String(item.id)))).slice(0, Math.max(0, referenceLimit - requestedNodeIds.length));
    const blockHeight = Math.max(PLAN_SIZE.height, screens.length * CONFIG_SIZE.height + Math.max(0, screens.length - 1) * ROW_GAP);
    const blockWidth = REFERENCE_SIZE + STAGE_GAP + PLAN_SIZE.width + STAGE_GAP + PROMPT_SIZE.width + STAGE_GAP + CONFIG_SIZE.width + STAGE_GAP + RESULT_SIZE.width;
    const preferred = nextDetailOrigin(snapshot);
    const origin = findOpenNodePosition(snapshot.nodes, preferred, { width: blockWidth, height: blockHeight }, { gap: TASK_GAP / 2 });
    const operations: CanvasOperationPayload[] = [];
    const attachmentIds = attachments.map((_, index) => `image-${workflowId}-ref-${index + 1}`);
    const referenceNodeIds = [...requestedNodeIds, ...attachmentIds].slice(0, referenceLimit);
    const refX = origin.x;
    const planX = origin.x + (referenceNodeIds.length ? REFERENCE_SIZE + STAGE_GAP : 0);
    const promptX = planX + PLAN_SIZE.width + STAGE_GAP;
    const configX = promptX + PROMPT_SIZE.width + STAGE_GAP;
    const planId = `text-${workflowId}-plan`;

    attachments.forEach((attachment, index) => {
        operations.push({
            type: "canvas.addNode",
            node: {
                id: attachmentIds[index],
                type: "image",
                title: String(attachment.title || `参考图 ${index + 1}`).slice(0, 64),
                position: { x: refX, y: origin.y + index * (REFERENCE_SIZE + REFERENCE_GAP) },
                width: REFERENCE_SIZE,
                height: REFERENCE_SIZE,
                metadata: {
                    content: String(attachment.url),
                    remoteUrl: String(attachment.url),
                    status: "success",
                    detailWorkflowId: workflowId,
                    detailRole: "reference",
                },
            },
        });
    });

    const planText = [`整体风格：${styleSummary}`, ...screens.map((screen) => `第 ${screen.index} 屏：${screen.title}\n目的：${screen.goal}`)].join("\n\n");
    operations.push({
        type: "canvas.addNode",
        node: {
            id: planId,
            type: "text",
            title: `${title}方案`,
            position: { x: planX, y: origin.y + (blockHeight - PLAN_SIZE.height) / 2 },
            width: PLAN_SIZE.width,
            height: PLAN_SIZE.height,
            metadata: {
                content: planText,
                prompt: planText,
                status: "success",
                fontSize: 14,
                detailWorkflowId: workflowId,
                detailRole: "plan",
                detailScreenCount: screens.length,
                detailStyleSummary: styleSummary,
                detailGenerationMode: generationMode,
                detailExecutionMode: executionMode,
            },
        },
    });

    const configIds: string[] = [];
    screens.forEach((screen, index) => {
        const rowY = origin.y + index * (CONFIG_SIZE.height + ROW_GAP);
        const promptId = `text-${workflowId}-screen-${screen.index}`;
        const configId = `config-${workflowId}-screen-${screen.index}`;
        configIds.push(configId);
        const initialReferenceIds = screen.index === 1 ? referenceNodeIds : [];
        const composerContent = [promptId, ...initialReferenceIds].map((id) => `@[node:${id}]`).join("\n");
        operations.push({
            type: "canvas.addNode",
            node: {
                id: promptId,
                type: "text",
                title: `第 ${screen.index} 屏：${screen.title}`.slice(0, 64),
                position: { x: promptX, y: rowY + (CONFIG_SIZE.height - PROMPT_SIZE.height) / 2 },
                width: PROMPT_SIZE.width,
                height: PROMPT_SIZE.height,
                metadata: {
                    content: screen.prompt,
                    prompt: screen.prompt,
                    status: "success",
                    fontSize: 14,
                    detailWorkflowId: workflowId,
                    detailRole: "screen-prompt",
                    detailScreenIndex: screen.index,
                    detailScreenCount: screens.length,
                    detailStyleSummary: styleSummary,
                    detailGoal: screen.goal,
                    detailGenerationMode: generationMode,
                    detailExecutionMode: executionMode,
                },
            },
        });
        operations.push({
            type: "canvas.addNode",
            node: {
                id: configId,
                type: "config",
                title: `第 ${screen.index} 屏生成`,
                position: { x: configX, y: rowY },
                width: CONFIG_SIZE.width,
                height: CONFIG_SIZE.height,
                metadata: {
                    status: "idle",
                    generationMode: "image",
                    composerContent,
                    model,
                    size: selectListedValue(String(args.size || ""), modelConfig?.supportedSizes, snapshot.imageDefaults?.size || "auto"),
                    imageTier: selectListedValue(String(args.image_tier || ""), modelConfig?.supportedTiers, modelConfig?.defaultTier || snapshot.imageDefaults?.tier || "1k"),
                    count: 1,
                    detailWorkflowId: workflowId,
                    detailRole: "screen-config",
                    detailScreenIndex: screen.index,
                    detailScreenCount: screens.length,
                    detailStyleSummary: styleSummary,
                    detailGoal: screen.goal,
                    detailGenerationMode: generationMode,
                    detailExecutionMode: executionMode,
                    detailReferenceNodeIds: referenceNodeIds,
                    detailPromptNodeId: promptId,
                },
            },
        });
        operations.push({ type: "canvas.addConnection", connection: { id: `conn-${workflowId}-plan-${screen.index}`, fromNodeId: planId, toNodeId: promptId } });
        operations.push({ type: "canvas.addConnection", connection: { id: `conn-${workflowId}-prompt-${screen.index}`, fromNodeId: promptId, toNodeId: configId } });
        initialReferenceIds.forEach((referenceId, referenceIndex) => {
            operations.push({ type: "canvas.addConnection", connection: { id: `conn-${workflowId}-ref-${screen.index}-${referenceIndex}`, fromNodeId: referenceId, toNodeId: configId } });
        });
    });
    operations.push({
        type: "canvas.runDetailWorkflow",
        action: "create",
        workflowId,
        generationMode,
        executionMode,
        composeWhenComplete: args.compose_when_complete !== false,
    });
    operations.push({ type: "canvas.selectNodes", ids: configIds });
    return { operations, workflowId, screenCount: screens.length };
}

export function buildDetailWorkflowAction(name: string, args: Record<string, unknown>): CanvasOperationPayload {
    return {
        type: "canvas.runDetailWorkflow",
        action: name === "canvas_compose_detail_long_image" ? "compose" : name === "canvas_retry_detail_screen" ? "retry" : "continue",
        workflowId: String(args.workflow_id || "").trim() || undefined,
        screenIndex: Number(args.screen_index) || undefined,
        generationMode: args.generation_mode === "rough" ? "rough" : undefined,
        executionMode: args.execution_mode === "continuous" ? "continuous" : args.execution_mode === "step" ? "step" : undefined,
        composeWhenComplete: args.compose_when_complete !== false,
    };
}

function normalizeScreens(value: unknown): DetailScreenInput[] {
    if (!Array.isArray(value)) return [];
    return value.slice(0, 12).flatMap((raw, index) => {
        if (!raw || typeof raw !== "object") return [];
        const item = raw as Record<string, unknown>;
        const prompt = String(item.prompt || "").trim();
        if (!prompt) return [];
        return [
            {
                index: index + 1,
                title: String(item.title || `第 ${index + 1} 屏`)
                    .trim()
                    .slice(0, 64),
                goal: String(item.goal || "展示商品卖点")
                    .trim()
                    .slice(0, 1000),
                prompt: prompt.slice(0, 12000),
            },
        ];
    });
}

function nextDetailOrigin(snapshot: AgentCanvasSnapshot) {
    if (!snapshot.nodes.length) return { x: 0, y: 0 };
    return { x: Math.min(...snapshot.nodes.map((node) => node.position.x)), y: Math.max(...snapshot.nodes.map((node) => node.position.y + node.height)) + TASK_GAP };
}

function selectImageModel(snapshot: AgentCanvasSnapshot, requested: string) {
    const listed = (snapshot.imageModels || []).map((item) => String(item.name || "")).filter(Boolean);
    if (requested && listed.includes(requested)) return requested;
    const fallback = snapshot.imageModels?.find((item) => item.isDefault)?.name || snapshot.imageDefaults?.model;
    return listed.includes(String(fallback || "")) ? String(fallback) : listed[0] || String(fallback || "");
}

function selectListedValue(value: string, values: string[] | undefined, fallback: string) {
    const list = (values || []).filter(Boolean);
    if (value && (!list.length || list.includes(value))) return value;
    return list.includes(fallback) || !list.length ? fallback : list[0];
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

function safeToken(value: unknown) {
    return String(value || "workflow")
        .replace(/[^a-zA-Z0-9_-]/g, "-")
        .slice(0, 72);
}
