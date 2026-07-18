"use client";

import { uploadImage, type UploadedImage } from "@/services/image-storage";

import type { CanvasConnection, CanvasNodeData } from "../types";

export type DetailWorkflowMode = "precise" | "rough";
export type DetailWorkflowExecutionMode = "step" | "continuous";
export type DetailReferenceRole = "product" | "first-screen" | "previous-screen";

export type DetailReferencePlanItem = {
    nodeId: string;
    role: DetailReferenceRole;
};

export type DetailWorkflowScreen = {
    index: number;
    title: string;
    goal: string;
    prompt: string;
};

export type DetailWorkflowOperation = {
    type: "canvas.runDetailWorkflow";
    action: "create" | "continue" | "retry" | "compose" | "add-screen" | "add-screens" | "update-screen" | "update-screens" | "remove-screen" | "remove-screens" | "move-screen" | "regenerate-all";
    workflowId?: string;
    generationMode?: DetailWorkflowMode;
    executionMode?: DetailWorkflowExecutionMode;
    screenIndex?: number;
    afterScreenIndex?: number;
    screenTitle?: string;
    screenGoal?: string;
    screenPrompt?: string;
    styleSummary?: string;
    screenDrafts?: Array<{ title?: string; goal?: string; prompt?: string }>;
    screenUpdates?: Array<{ screenIndex: number; title?: string; goal?: string; prompt?: string }>;
    screenIndices?: number[];
    composeWhenComplete?: boolean;
};

export function detailWorkflowConfigs(nodes: CanvasNodeData[], workflowId: string) {
    return nodes.filter((node) => node.metadata?.detailWorkflowId === workflowId && node.metadata.detailRole === "screen-config").sort((left, right) => Number(left.metadata?.detailScreenIndex || 0) - Number(right.metadata?.detailScreenIndex || 0));
}

export function detailWorkflowResults(nodes: CanvasNodeData[], workflowId: string) {
    return nodes
        .filter((node) => node.metadata?.detailWorkflowId === workflowId && node.metadata.detailRole === "screen-result" && Boolean(node.metadata.content) && node.metadata.status !== "error" && node.metadata.status !== "loading")
        .sort((left, right) => Number(left.metadata?.detailScreenIndex || 0) - Number(right.metadata?.detailScreenIndex || 0));
}

export function detailResultForConfig(nodes: CanvasNodeData[], connections: CanvasConnection[], configId: string) {
    const targetIds = new Set(connections.filter((connection) => connection.fromNodeId === configId).map((connection) => connection.toNodeId));
    return nodes.find((node) => targetIds.has(node.id) && node.type === "image");
}

export function buildDetailReferencePlan(input: { screenIndex: number; generationMode: DetailWorkflowMode; originalReferenceIds: string[]; firstResultId?: string; previousResultId?: string; limit: number }) {
    const { screenIndex, generationMode, originalReferenceIds, firstResultId, previousResultId, limit } = input;
    const candidates: DetailReferencePlanItem[] =
        screenIndex <= 1
            ? originalReferenceIds.map((nodeId) => ({ nodeId, role: "product" }))
            : generationMode === "rough" || screenIndex === 2
              ? firstResultId
                  ? [{ nodeId: firstResultId, role: "first-screen" }]
                  : []
              : [...(firstResultId ? [{ nodeId: firstResultId, role: "first-screen" as const }] : []), ...(previousResultId ? [{ nodeId: previousResultId, role: "previous-screen" as const }] : [])];
    const seen = new Set<string>();
    return candidates.filter((item) => item.nodeId && !seen.has(item.nodeId) && seen.add(item.nodeId)).slice(0, Math.max(0, limit));
}

export function buildDetailImagePrompt(input: { styleSummary: string; screen: DetailWorkflowScreen; screenCount: number; generationMode: DetailWorkflowMode; references: DetailReferencePlanItem[] }) {
    const { styleSummary, screen, screenCount, generationMode, references } = input;
    const isFirst = screen.index === 1;
    const isLast = screen.index >= screenCount;
    const referenceGuide = buildReferenceGuide(references, generationMode);
    const continuity = isFirst ? "这是第一屏主视觉，底部应自然、干净且可延展，为后续屏幕向下拼接留出视觉承接。" : "这是详情页长图中的后续内容屏，不是首屏海报。顶部自然承接上一屏，但不要复制上一屏的主体、标题、图标或具体排版。";
    return [
        `参考图顺序（唯一有效，以本段为准）：\n${referenceGuide}`,
        `本屏内容与排版要求：\n${screen.prompt}`,
        `整体风格：\n${styleSummary}`,
        `连续性要求：\n${continuity}`,
        "生成一张完整的竖版电商详情页屏幕，不要生成拼贴图、九宫格、分镜草图或半截页面。",
        "商品主体、卖点标题、参数文字和图标放在画面主体区域，避免紧贴上下边缘。",
        "图片内文字要少而准确，不得虚构用户未提供的认证、销量、功效、专利、检测报告、排名或推荐信息。",
        "保持商品真实外观、结构、颜色、包装与品牌视觉特征一致。",
        isLast ? "这是最后一屏，请自然收尾，不需要为下一屏预留明显区域。" : "底部保持自然可延展，方便下一屏继续拼接，但不要留下突兀的大块空白。",
    ]
        .filter(Boolean)
        .join("\n\n");
}

function buildReferenceGuide(references: DetailReferencePlanItem[], generationMode: DetailWorkflowMode) {
    if (!references.length) return "本屏没有传入参考图，请严格依据本屏要求和整体风格生成。";
    const lines = references.map((reference, index) => {
        const label = `图${index + 1}`;
        if (reference.role === "product") return `${label}：用户提供的原始商品或竞品参考，用于保持商品外观、结构、材质、颜色、包装和品牌特征。`;
        if (reference.role === "previous-screen") return `${label}：上一屏完整结果，用于衔接顶部布局、背景走势、光影和视觉节奏。`;
        return `${label}：已完成的详情页首屏，用于锁定整套详情页的商品形象和视觉基调。`;
    });
    if (generationMode === "rough" && references.some((reference) => reference.role === "first-screen")) {
        lines.push("当前为粗略模式，后续屏幕只以首屏统一风格，不假定存在上一屏参考图。");
    }
    lines.push("不要把参考图编号理解为额外商品；本屏要求中若出现与本段冲突的图号描述，一律忽略冲突描述。");
    return lines.join("\n");
}

export async function composeVerticalImageBlob(urls: string[]) {
    if (!urls.length) throw new Error("没有可合成的详情图屏幕");
    const images = await Promise.all(urls.map(loadImage));
    const naturalWidth = Math.max(...images.map((image) => image.naturalWidth || image.width));
    const naturalHeight = images.reduce((sum, image) => sum + ((image.naturalHeight || image.height) * naturalWidth) / Math.max(1, image.naturalWidth || image.width), 0);
    const maxDimension = 32760;
    const maxPixels = 80_000_000;
    const scale = Math.min(1, maxDimension / naturalWidth, maxDimension / naturalHeight, Math.sqrt(maxPixels / Math.max(1, naturalWidth * naturalHeight)));
    const width = Math.max(1, Math.floor(naturalWidth * scale));
    const heights = images.map((image) => Math.max(1, Math.round(((image.naturalHeight || image.height) * width) / Math.max(1, image.naturalWidth || image.width))));
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = heights.reduce((sum, height) => sum + height, 0);
    const context = canvas.getContext("2d");
    if (!context) throw new Error("浏览器无法创建长图画布");

    let y = 0;
    images.forEach((image, index) => {
        context.drawImage(image, 0, y, width, heights[index]);
        y += heights[index];
    });
    return new Promise<Blob>((resolve, reject) => canvas.toBlob((value) => (value ? resolve(value) : reject(new Error("长图编码失败"))), "image/png"));
}

export async function composeDetailLongImage(nodes: CanvasNodeData[]): Promise<UploadedImage> {
    const ordered = [...nodes].filter((node) => Boolean(node.metadata?.content)).sort((left, right) => Number(left.metadata?.detailScreenIndex || 0) - Number(right.metadata?.detailScreenIndex || 0));
    const blob = await composeVerticalImageBlob(ordered.map((node) => String(node.metadata?.content || "")));
    return uploadImage(blob);
}

function loadImage(url: string) {
    return new Promise<HTMLImageElement>((resolve, reject) => {
        if (!url) {
            reject(new Error("详情图屏幕地址为空"));
            return;
        }
        const image = new Image();
        image.onload = () => resolve(image);
        image.onerror = () => reject(new Error("读取详情图屏幕失败"));
        image.src = url;
    });
}
