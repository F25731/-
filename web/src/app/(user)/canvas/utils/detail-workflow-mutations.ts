"use client";

import { nanoid } from "nanoid";

import { CanvasNodeType, type CanvasConnection, type CanvasNodeData } from "../types";
import { detailResultForConfig, detailWorkflowConfigs } from "./detail-workflow";

type DetailScreenDraft = {
    title?: string;
    goal?: string;
    prompt?: string;
};

type MutationResult = {
    nodes: CanvasNodeData[];
    connections: CanvasConnection[];
    configId?: string;
    configIds?: string[];
};

export function selectDetailEditTargets(configs: CanvasNodeData[], changedScreenIndices: number[], scope: "current" | "downstream" | "all") {
    const changed = new Set(changedScreenIndices.map((index) => Math.floor(index)).filter((index) => index > 0));
    if (!changed.size) return [];
    if (scope === "all") return configs;
    if (scope === "downstream") {
        const firstChanged = Math.min(...changed);
        return configs.filter((config) => Number(config.metadata?.detailScreenIndex || 0) >= firstChanged);
    }
    return configs.filter((config) => changed.has(Number(config.metadata?.detailScreenIndex || 0)));
}

export function markDetailCompositionStale(nodes: CanvasNodeData[], workflowId: string) {
    return nodes.map((node) => (node.metadata?.detailWorkflowId === workflowId && node.metadata.detailRole === "long-image" ? { ...node, title: "详情页合成长图（待更新）", metadata: { ...node.metadata, detailCompositionStale: true } } : node));
}

export function updateDetailWorkflowStyle(nodes: CanvasNodeData[], workflowId: string, styleSummary: string) {
    if (!styleSummary.trim()) return nodes;
    return syncDetailWorkflowPlan(
        nodes.map((node) => (node.metadata?.detailWorkflowId === workflowId ? { ...node, metadata: { ...node.metadata, detailStyleSummary: styleSummary.trim() } } : node)),
        workflowId,
    );
}

export function addDetailWorkflowScreen(nodes: CanvasNodeData[], connections: CanvasConnection[], workflowId: string, draft: DetailScreenDraft, afterScreenIndex?: number): MutationResult {
    const configs = detailWorkflowConfigs(nodes, workflowId);
    if (configs.length >= 12) throw new Error("详情图最多支持 12 屏");
    if (!draft.prompt) throw new Error("新增详情屏缺少完整提示词");
    const after = afterScreenIndex === undefined ? configs.length : Math.min(configs.length, Math.max(0, afterScreenIndex));
    const insertIndex = after + 1;
    const rowStep = detailScreenRowStep(configs);
    const templateConfig = configs[Math.min(Math.max(after - 1, 0), configs.length - 1)];
    const templatePrompt = nodes.find((node) => node.id === templateConfig?.metadata?.detailPromptNodeId);
    if (!templateConfig || !templatePrompt) throw new Error("详情图工作流缺少可复用的屏幕配置");
    const nextConfigAtPosition = configs.find((node) => Number(node.metadata?.detailScreenIndex || 0) === insertIndex);
    const targetY = nextConfigAtPosition?.position.y ?? configs.at(-1)!.position.y + rowStep;
    const token = `${Date.now()}-${nanoid(5)}`;
    const promptId = `text-${workflowId}-screen-${token}`;
    const configId = `config-${workflowId}-screen-${token}`;
    const nextCount = configs.length + 1;
    const promptNode: CanvasNodeData = {
        ...templatePrompt,
        id: promptId,
        title: `第 ${insertIndex} 屏：${draft.title || "新增内容"}`.slice(0, 64),
        position: { x: templatePrompt.position.x, y: targetY + (templateConfig.height - templatePrompt.height) / 2 },
        metadata: {
            ...templatePrompt.metadata,
            content: draft.prompt,
            prompt: draft.prompt,
            status: "success",
            detailScreenIndex: insertIndex,
            detailScreenCount: nextCount,
            detailGoal: draft.goal || "展示商品卖点",
        },
    };
    const configNode: CanvasNodeData = {
        ...templateConfig,
        id: configId,
        title: `第 ${insertIndex} 屏生成`,
        position: { x: templateConfig.position.x, y: targetY },
        metadata: {
            ...templateConfig.metadata,
            status: "idle",
            errorDetails: undefined,
            composerContent: `@[node:${promptId}]`,
            detailPromptNodeId: promptId,
            detailScreenIndex: insertIndex,
            detailScreenCount: nextCount,
            detailGoal: draft.goal || "展示商品卖点",
            detailAttempt: 0,
            detailActiveReferenceNodeIds: [],
            detailReferenceRoles: [],
        },
    };
    const shifted = nodes.map((node) => {
        const index = Number(node.metadata?.detailScreenIndex || 0);
        if (node.metadata?.detailWorkflowId !== workflowId || !index || index < insertIndex) return node;
        const nextIndex = index + 1;
        return withScreenIndex(node, nextIndex, nextCount, rowStep);
    });
    const plan = nodes.find((node) => node.metadata?.detailWorkflowId === workflowId && node.metadata.detailRole === "plan");
    const nextConnections = [...connections, ...(plan ? [{ id: `conn-${workflowId}-plan-${token}`, fromNodeId: plan.id, toNodeId: promptId }] : []), { id: `conn-${workflowId}-prompt-${token}`, fromNodeId: promptId, toNodeId: configId }];
    return { nodes: syncDetailWorkflowPlan([...shifted, promptNode, configNode], workflowId), connections: nextConnections, configId };
}

export function addDetailWorkflowScreens(nodes: CanvasNodeData[], connections: CanvasConnection[], workflowId: string, drafts: DetailScreenDraft[], afterScreenIndex?: number): MutationResult {
    if (!drafts.length) throw new Error("批量新增详情屏不能为空");
    let current = { nodes, connections } as MutationResult;
    const configIds: string[] = [];
    let after = afterScreenIndex;
    for (const draft of drafts) {
        current = addDetailWorkflowScreen(current.nodes, current.connections, workflowId, draft, after);
        if (current.configId) configIds.push(current.configId);
        after = after === undefined ? undefined : after + 1;
    }
    return { ...current, configIds };
}

export function updateDetailWorkflowScreen(nodes: CanvasNodeData[], connections: CanvasConnection[], workflowId: string, screenIndex: number, draft: DetailScreenDraft): MutationResult {
    const configs = detailWorkflowConfigs(nodes, workflowId);
    const target = configs.find((config) => config.metadata?.detailScreenIndex === screenIndex);
    if (!target) throw new Error(`没有找到第 ${screenIndex} 屏`);
    if (!draft.prompt) throw new Error("修改详情屏缺少完整提示词");
    const promptId = String(target.metadata?.detailPromptNodeId || "");
    const nextNodes = nodes.map((node) =>
        node.id === promptId
            ? {
                  ...node,
                  title: `第 ${screenIndex} 屏：${draft.title || screenTitleSuffix(node.title)}`.slice(0, 64),
                  metadata: { ...node.metadata, content: draft.prompt, prompt: draft.prompt, detailGoal: draft.goal || node.metadata?.detailGoal, status: "success" as const },
              }
            : node.id === target.id
              ? { ...node, metadata: { ...node.metadata, detailGoal: draft.goal || node.metadata?.detailGoal } }
              : node,
    );
    return { nodes: syncDetailWorkflowPlan(nextNodes, workflowId), connections, configId: target.id };
}

export function updateDetailWorkflowScreens(nodes: CanvasNodeData[], connections: CanvasConnection[], workflowId: string, updates: Array<DetailScreenDraft & { screenIndex: number }>): MutationResult {
    if (!updates.length) throw new Error("批量修改详情屏不能为空");
    let current = { nodes, connections } as MutationResult;
    const configIds: string[] = [];
    for (const update of [...updates].sort((left, right) => left.screenIndex - right.screenIndex)) {
        current = updateDetailWorkflowScreen(current.nodes, current.connections, workflowId, update.screenIndex, update);
        if (current.configId) configIds.push(current.configId);
    }
    return { ...current, configIds };
}

export function removeDetailWorkflowScreen(nodes: CanvasNodeData[], connections: CanvasConnection[], workflowId: string, screenIndex: number): MutationResult {
    const configs = detailWorkflowConfigs(nodes, workflowId);
    if (configs.length <= 1) throw new Error("详情图至少需要保留一屏");
    const target = configs.find((config) => config.metadata?.detailScreenIndex === screenIndex);
    if (!target) throw new Error(`没有找到第 ${screenIndex} 屏`);
    const output = detailResultForConfig(nodes, connections, target.id);
    const removedIds = new Set([target.id, String(target.metadata?.detailPromptNodeId || ""), ...(output ? [output.id] : [])]);
    const rowStep = detailScreenRowStep(configs);
    const nextCount = configs.length - 1;
    const nextNodes = nodes
        .filter((node) => !removedIds.has(node.id))
        .map((node) => {
            const index = Number(node.metadata?.detailScreenIndex || 0);
            if (node.metadata?.detailWorkflowId !== workflowId || !index || index <= screenIndex) return node;
            return withScreenIndex(node, index - 1, nextCount, -rowStep);
        });
    const nextConnections = connections.filter((connection) => !removedIds.has(connection.fromNodeId) && !removedIds.has(connection.toNodeId));
    return { nodes: syncDetailWorkflowPlan(nextNodes, workflowId), connections: nextConnections };
}

export function removeDetailWorkflowScreens(nodes: CanvasNodeData[], connections: CanvasConnection[], workflowId: string, screenIndices: number[]): MutationResult {
    const unique = [...new Set(screenIndices.map((index) => Math.floor(index)).filter((index) => index > 0))].sort((left, right) => right - left);
    if (!unique.length) throw new Error("批量删除详情屏不能为空");
    let current = { nodes, connections } as MutationResult;
    for (const index of unique) current = removeDetailWorkflowScreen(current.nodes, current.connections, workflowId, index);
    return current;
}

export function moveDetailWorkflowScreen(nodes: CanvasNodeData[], connections: CanvasConnection[], workflowId: string, screenIndex: number, afterScreenIndex: number): MutationResult {
    const configs = detailWorkflowConfigs(nodes, workflowId);
    const after = Math.min(configs.length, Math.max(0, afterScreenIndex));
    const source = configs.find((config) => config.metadata?.detailScreenIndex === screenIndex);
    if (!source) throw new Error(`没有找到第 ${screenIndex} 屏`);
    if (after === screenIndex) return { nodes, connections };
    const ordered = [...configs];
    ordered.splice(
        ordered.findIndex((config) => config.id === source.id),
        1,
    );
    if (after === 0) ordered.unshift(source);
    else {
        const targetPosition = ordered.findIndex((config) => config.metadata?.detailScreenIndex === after);
        ordered.splice(targetPosition < 0 ? ordered.length : targetPosition + 1, 0, source);
    }
    if (ordered.every((config, index) => config.id === configs[index]?.id)) return { nodes, connections };
    const rowStep = detailScreenRowStep(configs);
    const top = Math.min(...configs.map((config) => config.position.y));
    const groups = new Map<string, { index: number; y: number; sourceY: number }>();
    ordered.forEach((config, index) => {
        const group = { index: index + 1, y: top + index * rowStep, sourceY: config.position.y };
        groups.set(config.id, group);
        const promptId = String(config.metadata?.detailPromptNodeId || "");
        if (promptId) groups.set(promptId, group);
        const output = detailResultForConfig(nodes, connections, config.id);
        if (output) groups.set(output.id, group);
    });
    const nextNodes = nodes.map((node) => {
        const group = groups.get(node.id);
        if (!group) return node;
        return {
            ...node,
            title: titleForScreenNode(node, group.index),
            position: { ...node.position, y: group.y + (node.position.y - group.sourceY) },
            metadata: { ...node.metadata, detailScreenIndex: group.index, detailScreenCount: configs.length },
        };
    });
    return { nodes: syncDetailWorkflowPlan(nextNodes, workflowId), connections };
}

function syncDetailWorkflowPlan(nodes: CanvasNodeData[], workflowId: string) {
    const configs = detailWorkflowConfigs(nodes, workflowId);
    const count = configs.length;
    const prompts = nodes
        .filter((node) => node.metadata?.detailWorkflowId === workflowId && node.metadata.detailRole === "screen-prompt")
        .sort((left, right) => Number(left.metadata?.detailScreenIndex || 0) - Number(right.metadata?.detailScreenIndex || 0));
    const styleSummary = String(configs[0]?.metadata?.detailStyleSummary || "统一、专业的电商详情页视觉风格");
    const planText = [`整体风格：${styleSummary}`, ...prompts.map((node) => `第 ${node.metadata?.detailScreenIndex || 0} 屏：${screenTitleSuffix(node.title)}\n目的：${String(node.metadata?.detailGoal || "展示商品卖点")}`)].join("\n\n");
    return nodes.map((node) => {
        if (node.metadata?.detailWorkflowId !== workflowId) return node;
        if (node.metadata.detailRole === "plan") return { ...node, metadata: { ...node.metadata, content: planText, prompt: planText, detailScreenCount: count } };
        return { ...node, metadata: { ...node.metadata, detailScreenCount: count } };
    });
}

function detailScreenRowStep(configs: CanvasNodeData[]) {
    const measured = configs.length > 1 ? configs[1].position.y - configs[0].position.y : 0;
    return measured > 0 ? measured : (configs[0]?.height || 400) + 72;
}

function withScreenIndex(node: CanvasNodeData, index: number, count: number, yDelta: number): CanvasNodeData {
    return { ...node, title: titleForScreenNode(node, index), position: { ...node.position, y: node.position.y + yDelta }, metadata: { ...node.metadata, detailScreenIndex: index, detailScreenCount: count } };
}

function titleForScreenNode(node: CanvasNodeData, index: number) {
    if (node.metadata?.detailRole === "screen-config") return `第 ${index} 屏生成`;
    if (node.metadata?.detailRole === "screen-result" || node.type === CanvasNodeType.Image) return `第 ${index} 屏结果`;
    if (node.metadata?.detailRole === "screen-prompt") return `第 ${index} 屏：${screenTitleSuffix(node.title) || "详情内容"}`.slice(0, 64);
    return node.title;
}

function screenTitleSuffix(title: string) {
    return title.replace(/^第\s*\d+\s*屏\s*[：:]?\s*/, "");
}
