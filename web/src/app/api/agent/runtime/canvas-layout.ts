import { findOpenNodePosition } from "@/app/(user)/canvas/utils/canvas-layout";

import type { AgentCanvasSnapshot, AgentNodeSnapshot } from "./types";
import { attachmentCanvasTitle, selectAttachmentsInUploadOrder } from "./reference-order";

const TASK_GAP = 120;
const STAGE_GAP = 80;
const RESULT_GAP = 96;
const GRID_GAP = 36;
const REFERENCE_SIZE = 172;
const REFERENCE_GAP = 24;
const PROMPT_SIZE = { width: 340, height: 240 };
const CONFIG_SIZE = { width: 360, height: 400 };
const IMAGE_SIZE = { width: 340, height: 240 };

export type ImageGenerationTask = {
    title?: string;
    prompt: string;
    count: number;
    model?: string;
    size?: string;
    imageTier?: string;
    referenceNodeIds: string[];
    referenceAttachmentIds: string[];
};

export type CanvasOperationPayload = Record<string, unknown> & { type: string };

export function buildImageTaskOperations(snapshot: AgentCanvasSnapshot, tasks: ImageGenerationTask[], stamp: string) {
    const normalizedTasks = tasks.slice(0, 6);
    const block = measureTaskBlock(snapshot, normalizedTasks);
    const preferred = nextIndependentTaskOrigin(snapshot);
    const origin = findOpenNodePosition(snapshot.nodes, preferred, block, { gap: TASK_GAP / 2 });
    const operations: CanvasOperationPayload[] = [];
    const createdNodeIds: string[] = [];
    let rowY = origin.y;

    normalizedTasks.forEach((task, taskIndex) => {
        const plan = buildTaskPlan(snapshot, task, `${stamp}-${taskIndex}`, origin.x, rowY);
        operations.push(...plan.operations);
        createdNodeIds.push(...plan.createdNodeIds);
        rowY += plan.height + TASK_GAP;
    });

    if (createdNodeIds.length) operations.push({ type: "canvas.selectNodes", ids: createdNodeIds.filter((id) => id.includes("config-agent-")) });
    return { operations, createdNodeIds };
}

export function buildWorkflowLayoutOperations(snapshot: AgentCanvasSnapshot, requestedIds: string[] = []) {
    const allowed = new Set(requestedIds.length ? requestedIds : snapshot.nodes.map((node) => node.id));
    const nodes = snapshot.nodes.filter((node) => allowed.has(node.id));
    if (!nodes.length) return [];

    const nodeById = new Map(nodes.map((node) => [node.id, node]));
    const relevantConnections = snapshot.connections.filter((connection) => nodeById.has(connection.fromNodeId) && nodeById.has(connection.toNodeId));
    const components = connectedComponents(nodes, relevantConnections);
    const baseX = Math.min(...nodes.map((node) => node.position.x));
    const baseY = Math.min(...nodes.map((node) => node.position.y));
    let taskY = baseY;
    const items: Array<{ id: string; position: { x: number; y: number } }> = [];

    for (const component of components) {
        const levels = workflowLevels(component, relevantConnections);
        const levelEntries = Array.from(levels.entries()).sort(([a], [b]) => a - b);
        const levelWidths = levelEntries.map(([, levelNodes]) => Math.max(...levelNodes.map((node) => node.width)));
        const levelX: number[] = [];
        levelWidths.forEach((width, index) => {
            levelX[index] = index ? levelX[index - 1] + levelWidths[index - 1] + RESULT_GAP : baseX;
        });
        const taskHeight = Math.max(...levelEntries.map(([, levelNodes]) => levelNodes.reduce((height, node) => height + node.height, 0) + Math.max(0, levelNodes.length - 1) * GRID_GAP));
        for (const [level, levelNodes] of levelEntries) {
            const columnHeight = levelNodes.reduce((height, node) => height + node.height, 0) + Math.max(0, levelNodes.length - 1) * GRID_GAP;
            let y = taskY + (taskHeight - columnHeight) / 2;
            for (const node of levelNodes) {
                items.push({ id: node.id, position: { x: levelX[level] || baseX, y } });
                y += node.height + GRID_GAP;
            }
        }
        taskY += taskHeight + TASK_GAP;
    }
    return items.length ? [{ type: "canvas.moveNodes", items }] : [];
}

export function nextIndependentTaskOrigin(snapshot: AgentCanvasSnapshot) {
    if (!snapshot.nodes.length) return { x: 0, y: 0 };
    return {
        x: Math.min(...snapshot.nodes.map((node) => node.position.x)),
        y: Math.max(...snapshot.nodes.map((node) => node.position.y + node.height)) + TASK_GAP,
    };
}

function buildTaskPlan(snapshot: AgentCanvasSnapshot, task: ImageGenerationTask, stamp: string, x: number, y: number) {
    const model = selectImageModel(snapshot, task.model);
    const modelConfig = snapshot.imageModels?.find((item) => item.name === model);
    const referenceLimit = Math.max(0, Number(modelConfig?.referenceLimit) || 0);
    const existingImageIds = new Set(snapshot.nodes.filter((node) => node.type === "image").map((node) => node.id));
    const existingReferences = task.referenceNodeIds.filter((id, index, values) => existingImageIds.has(id) && values.indexOf(id) === index).slice(0, referenceLimit);
    const attachments = selectAttachmentsInUploadOrder(snapshot.attachments, task.referenceAttachmentIds, referenceLimit - existingReferences.length);
    const hasAttachmentColumn = attachments.length > 0;
    const promptX = x + (hasAttachmentColumn ? REFERENCE_SIZE + STAGE_GAP : 0);
    const configX = promptX + PROMPT_SIZE.width + STAGE_GAP;
    const promptY = y + (CONFIG_SIZE.height - PROMPT_SIZE.height) / 2;
    const promptNodeId = `text-agent-${stamp}`;
    const configNodeId = `config-agent-${stamp}`;
    const attachmentIds = attachments.map((item) => `image-agent-ref-${stamp}-${safeToken(item.id)}`);
    const allReferenceIds = [...existingReferences, ...attachmentIds].slice(0, referenceLimit);
    const composerContent = [promptNodeId, ...allReferenceIds].map((id) => `@[node:${id}]`).join("\n");
    const operations: CanvasOperationPayload[] = [];
    const createdNodeIds: string[] = [];

    attachments.forEach((attachment, index) => {
        const id = attachmentIds[index];
        operations.push({
            type: "canvas.addNode",
            node: {
                id,
                type: "image",
                title: attachmentCanvasTitle(attachment, index),
                position: { x, y: y + index * (REFERENCE_SIZE + REFERENCE_GAP) },
                width: REFERENCE_SIZE,
                height: REFERENCE_SIZE,
                metadata: { content: String(attachment.url), remoteUrl: String(attachment.url), status: "success", prompt: "Agent 参考图", referenceOrder: Number(attachment.order) || index + 1, referenceLabel: attachment.label || `图${index + 1}` },
            },
        });
        createdNodeIds.push(id);
    });

    operations.push({
        type: "canvas.addNode",
        node: {
            id: promptNodeId,
            type: "text",
            title: String(task.title || "图片提示词").slice(0, 64),
            position: { x: promptX, y: promptY },
            width: PROMPT_SIZE.width,
            height: PROMPT_SIZE.height,
            metadata: { content: task.prompt, prompt: task.prompt, status: "success", fontSize: 14 },
        },
    });
    operations.push({
        type: "canvas.addNode",
        node: {
            id: configNodeId,
            type: "config",
            title: String(task.title || "图片生成").slice(0, 64),
            position: { x: configX, y },
            width: CONFIG_SIZE.width,
            height: CONFIG_SIZE.height,
            metadata: {
                status: "idle",
                generationMode: "image",
                composerContent,
                model,
                size: selectListedValue(task.size, modelConfig?.supportedSizes, snapshot.imageDefaults?.size || "auto"),
                imageTier: selectListedValue(task.imageTier, modelConfig?.supportedTiers, modelConfig?.defaultTier || snapshot.imageDefaults?.tier || "1k"),
                count: clamp(task.count, 1, 8),
            },
        },
    });
    operations.push({ type: "canvas.addConnection", connection: { id: `conn-agent-prompt-${stamp}`, fromNodeId: promptNodeId, toNodeId: configNodeId } });
    allReferenceIds.forEach((fromNodeId, index) => {
        operations.push({ type: "canvas.addConnection", connection: { id: `conn-agent-ref-${stamp}-${index}`, fromNodeId, toNodeId: configNodeId } });
    });
    operations.push({ type: "canvas.runGeneration", nodeId: configNodeId, mode: "image", prompt: composerContent });
    createdNodeIds.push(promptNodeId, configNodeId);

    const referenceHeight = attachments.length ? attachments.length * REFERENCE_SIZE + Math.max(0, attachments.length - 1) * REFERENCE_GAP : 0;
    const resultRows = Math.ceil(clamp(task.count, 1, 8) / 2);
    const resultHeight = resultRows * IMAGE_SIZE.height + Math.max(0, resultRows - 1) * GRID_GAP;
    return { operations, createdNodeIds, height: Math.max(CONFIG_SIZE.height, referenceHeight, resultHeight) };
}

function measureTaskBlock(snapshot: AgentCanvasSnapshot, tasks: ImageGenerationTask[]) {
    let height = 0;
    let width = PROMPT_SIZE.width + STAGE_GAP + CONFIG_SIZE.width + RESULT_GAP + IMAGE_SIZE.width * 2 + GRID_GAP;
    tasks.forEach((task, index) => {
        const attachmentCount = task.referenceAttachmentIds.length || (snapshot.attachments || []).length;
        const referenceHeight = attachmentCount ? attachmentCount * REFERENCE_SIZE + Math.max(0, attachmentCount - 1) * REFERENCE_GAP : 0;
        const resultRows = Math.ceil(clamp(task.count, 1, 8) / 2);
        const taskHeight = Math.max(CONFIG_SIZE.height, referenceHeight, resultRows * IMAGE_SIZE.height + Math.max(0, resultRows - 1) * GRID_GAP);
        height += taskHeight + (index ? TASK_GAP : 0);
        if (attachmentCount) width += REFERENCE_SIZE + STAGE_GAP;
    });
    return { width, height };
}

function connectedComponents(nodes: AgentNodeSnapshot[], connections: AgentCanvasSnapshot["connections"]) {
    const byId = new Map(nodes.map((node) => [node.id, node]));
    const neighbors = new Map(nodes.map((node) => [node.id, new Set<string>()]));
    connections.forEach((connection) => {
        neighbors.get(connection.fromNodeId)?.add(connection.toNodeId);
        neighbors.get(connection.toNodeId)?.add(connection.fromNodeId);
    });
    const seen = new Set<string>();
    const result: AgentNodeSnapshot[][] = [];
    const ordered = [...nodes].sort((a, b) => a.position.y - b.position.y || a.position.x - b.position.x);
    for (const node of ordered) {
        if (seen.has(node.id)) continue;
        const queue = [node.id];
        const component: AgentNodeSnapshot[] = [];
        seen.add(node.id);
        while (queue.length) {
            const id = queue.shift()!;
            const current = byId.get(id);
            if (current) component.push(current);
            neighbors.get(id)?.forEach((next) => {
                if (seen.has(next)) return;
                seen.add(next);
                queue.push(next);
            });
        }
        result.push(component);
    }
    return result;
}

function workflowLevels(nodes: AgentNodeSnapshot[], connections: AgentCanvasSnapshot["connections"]) {
    const ids = new Set(nodes.map((node) => node.id));
    const incoming = new Map(nodes.map((node) => [node.id, 0]));
    const outgoing = new Map(nodes.map((node) => [node.id, [] as string[]]));
    connections.forEach((connection) => {
        if (!ids.has(connection.fromNodeId) || !ids.has(connection.toNodeId)) return;
        incoming.set(connection.toNodeId, (incoming.get(connection.toNodeId) || 0) + 1);
        outgoing.get(connection.fromNodeId)?.push(connection.toNodeId);
    });
    const levelById = new Map<string, number>();
    const queue = nodes.filter((node) => !incoming.get(node.id)).map((node) => node.id);
    if (!queue.length) queue.push(nodes[0].id);
    while (queue.length) {
        const id = queue.shift()!;
        const level = levelById.get(id) || 0;
        outgoing.get(id)?.forEach((target) => {
            levelById.set(target, Math.max(levelById.get(target) || 0, level + 1));
            incoming.set(target, Math.max(0, (incoming.get(target) || 0) - 1));
            if (!incoming.get(target)) queue.push(target);
        });
    }
    nodes.forEach((node) => {
        if (!levelById.has(node.id)) levelById.set(node.id, 0);
    });
    const levels = new Map<number, AgentNodeSnapshot[]>();
    nodes.forEach((node) => {
        const level = levelById.get(node.id) || 0;
        levels.set(level, [...(levels.get(level) || []), node]);
    });
    return levels;
}

function selectImageModel(snapshot: AgentCanvasSnapshot, requested?: string) {
    const listed = (snapshot.imageModels || []).map((item) => String(item.name || "")).filter(Boolean);
    if (requested && listed.includes(requested)) return requested;
    const defaultModel = snapshot.imageModels?.find((item) => item.isDefault)?.name || snapshot.imageDefaults?.model;
    return listed.includes(String(defaultModel || "")) ? String(defaultModel) : listed[0] || String(defaultModel || "");
}

function selectListedValue(value: string | undefined, values: string[] | undefined, fallback: string) {
    const list = (values || []).filter(Boolean);
    if (value && (!list.length || list.includes(value))) return value;
    return list.includes(fallback) || !list.length ? fallback : list[0];
}

function safeToken(value: unknown) {
    return String(value || "reference")
        .replace(/[^a-zA-Z0-9_-]/g, "-")
        .slice(0, 48);
}

function clamp(value: number, min: number, max: number) {
    const number = Number.isFinite(value) ? Math.floor(value) : min;
    return Math.max(min, Math.min(max, number));
}
