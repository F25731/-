"use client";

import { uploadImage, type UploadedImage } from "@/services/image-storage";

import type { CanvasConnection, CanvasNodeData } from "../types";

export type DetailWorkflowMode = "precise" | "rough";
export type DetailWorkflowExecutionMode = "step" | "continuous";

export type DetailWorkflowScreen = {
    index: number;
    title: string;
    goal: string;
    prompt: string;
};

export type DetailWorkflowOperation = {
    type: "canvas.runDetailWorkflow";
    action: "create" | "continue" | "retry" | "compose";
    workflowId?: string;
    generationMode?: DetailWorkflowMode;
    executionMode?: DetailWorkflowExecutionMode;
    screenIndex?: number;
    composeWhenComplete?: boolean;
};

export function detailWorkflowConfigs(nodes: CanvasNodeData[], workflowId: string) {
    return nodes.filter((node) => node.metadata?.detailWorkflowId === workflowId && node.metadata.detailRole === "screen-config").sort((left, right) => Number(left.metadata?.detailScreenIndex || 0) - Number(right.metadata?.detailScreenIndex || 0));
}

export function detailWorkflowResults(nodes: CanvasNodeData[], workflowId: string) {
    return nodes
        .filter((node) => node.metadata?.detailWorkflowId === workflowId && node.metadata.detailRole === "screen-result" && Boolean(node.metadata.content))
        .sort((left, right) => Number(left.metadata?.detailScreenIndex || 0) - Number(right.metadata?.detailScreenIndex || 0));
}

export function detailResultForConfig(nodes: CanvasNodeData[], connections: CanvasConnection[], configId: string) {
    const targetIds = new Set(connections.filter((connection) => connection.fromNodeId === configId).map((connection) => connection.toNodeId));
    return nodes.find((node) => targetIds.has(node.id) && node.type === "image");
}

export function buildDetailImagePrompt(input: { styleSummary: string; screen: DetailWorkflowScreen; screenCount: number; generationMode: DetailWorkflowMode; includeCurrent?: boolean }) {
    const { styleSummary, screen, screenCount, generationMode, includeCurrent } = input;
    const isFirst = screen.index === 1;
    const isLast = screen.index >= screenCount;
    const referenceGuide = isFirst
        ? "参考图来自用户上传的商品图或竞品图。准确保持商品外观、结构、材质、颜色和品牌特征，并以第一屏建立整套详情页的视觉基调。"
        : generationMode === "precise"
          ? "参考图优先级：第一张是首屏完整图，用于锁定整套详情页风格；第二张是上一屏完整图，用于延续颜色、图案、背景走势、光影和视觉节奏。其余图片是商品或竞品参考。"
          : "参考图优先级：第一张是首屏完整图，用于统一风格；其余图片是商品或竞品参考。粗略模式下各屏可以并发，但必须保持同一商品和同一视觉语言。";
    const currentGuide = includeCurrent ? "如果包含当前屏旧图，只用于理解原内容和局部修改，不得覆盖首屏与上一屏的风格优先级。" : "";
    const continuity = isFirst ? "这是第一屏主视觉，底部应自然、干净且可延展，为后续屏幕向下拼接留出视觉承接。" : "这是详情页长图中的后续内容屏，不是首屏海报。顶部自然承接上一屏，但不要复制上一屏的主体、标题、图标或具体排版。";
    return [
        screen.prompt,
        `整体风格：\n${styleSummary}`,
        `参考图说明：\n${referenceGuide}${currentGuide ? `\n${currentGuide}` : ""}`,
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
