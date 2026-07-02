"use client";

import { useEffect, useState } from "react";
import { ArrowUp, LoaderCircle } from "lucide-react";
import { Button } from "antd";

import { ModelPicker } from "@/components/model-picker";
import { defaultConfig, normalizeImageSizeForModel, normalizeImageTierForModel, useConfigStore, useEffectiveConfig, type AiConfig } from "@/stores/use-config-store";
import { canvasThemes } from "@/lib/canvas-theme";
import { useThemeStore } from "@/stores/use-theme-store";
import { CanvasImageSettingsPopover } from "./canvas-image-settings-popover";
import { CanvasPromptLibrary } from "./canvas-prompt-library";
import { CanvasNodeType, type CanvasGenerationMode, type CanvasNodeData } from "../types";

export type CanvasNodeGenerationMode = CanvasGenerationMode;

type CanvasNodePromptPanelProps = {
    node: CanvasNodeData;
    isRunning: boolean;
    onPromptChange: (nodeId: string, prompt: string) => void;
    onConfigChange: (nodeId: string, patch: Partial<CanvasNodeData["metadata"]>) => void;
    onGenerate: (nodeId: string, mode: CanvasNodeGenerationMode, prompt: string) => void;
    onImageSettingsOpenChange?: (open: boolean) => void;
};

export function CanvasNodePromptPanel({ node, isRunning, onPromptChange, onConfigChange, onGenerate, onImageSettingsOpenChange }: CanvasNodePromptPanelProps) {
    const globalConfig = useEffectiveConfig();
    const openConfigDialog = useConfigStore((state) => state.openConfigDialog);
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    const mode = defaultMode(node.type);
    const hasTextContent = node.type === CanvasNodeType.Text && Boolean(node.metadata?.content?.trim());
    const hasImageContent = node.type === CanvasNodeType.Image && Boolean(node.metadata?.content);
    const config = buildNodeConfig(globalConfig, node, mode);
    const isNodeGenerating = node.metadata?.status === "loading";
    const isDisabled = isRunning || isNodeGenerating;
    const [prompt, setPrompt] = useState(getInitialPrompt(node));

    useEffect(() => {
        setPrompt(isNodeGenerating ? "" : getInitialPrompt(node));
    }, [node.id, isNodeGenerating]);

    const updatePrompt = (value: string) => {
        if (isDisabled) return;
        setPrompt(value);
        onPromptChange(node.id, value);
    };

    const submit = () => {
        const text = prompt.trim();
        if (!text || isDisabled) return;
        onGenerate(node.id, mode, text);
        setPrompt("");
        onPromptChange(node.id, "");
    };

    if (isNodeGenerating) {
        return (
            <div
                className="flex items-center gap-2 rounded-2xl border px-3 py-2 text-sm shadow-2xl backdrop-blur"
                style={{ background: theme.toolbar.panel, borderColor: theme.toolbar.border, color: theme.node.text }}
                onMouseDown={(event) => event.stopPropagation()}
                onPointerDown={(event) => event.stopPropagation()}
                onWheel={(event) => event.stopPropagation()}
            >
                <LoaderCircle className="size-4 animate-spin" />
                <span>正在生成中</span>
            </div>
        );
    }

    return (
        <div
            className="rounded-2xl border p-3 shadow-2xl backdrop-blur"
            style={{ background: theme.toolbar.panel, borderColor: theme.toolbar.border, color: theme.node.text }}
            onMouseDown={(event) => event.stopPropagation()}
            onPointerDown={(event) => event.stopPropagation()}
            onWheel={(event) => event.stopPropagation()}
        >
            <textarea
                value={prompt}
                onChange={(event) => updatePrompt(event.target.value)}
                onKeyDown={(event) => {
                    if (isDisabled || event.key !== "Enter" || event.ctrlKey || event.metaKey || event.shiftKey) return;
                    event.preventDefault();
                    submit();
                }}
                disabled={isDisabled}
                className="thin-scrollbar h-24 w-full resize-none rounded-xl border px-3 py-2 text-sm leading-5 outline-none"
                style={{ background: theme.node.fill, borderColor: theme.node.stroke, color: theme.node.text }}
                placeholder={isNodeGenerating ? "正在生成中" : mode === "video" ? "输入视频生成要求" : mode === "image" ? (hasImageContent ? "输入图片修改要求" : "输入图片生成要求") : hasTextContent ? "输入文本修改要求" : "输入文本生成要求"}
            />

            <div className="mt-2 flex min-w-0 items-center justify-between gap-2">
                <div className="flex min-w-0 flex-wrap items-center gap-2">
                    <CanvasPromptLibrary onSelect={updatePrompt} />
                    {mode === "image" ? (
                        <>
                            <ModelPicker
                                config={config}
                                value={node.metadata?.model || config.imageModel}
                                onChange={(model) => onConfigChange(node.id, { model, size: normalizeImageSizeForModel(config, model, config.size), imageTier: normalizeImageTierForModel(config, model, config.imageTier) })}
                                onMissingConfig={() => openConfigDialog(true)}
                                type="image"
                            />
                            <CanvasImageSettingsPopover
                                config={config}
                                placement="topLeft"
                                buttonClassName="!h-10 !max-w-[170px] !justify-start !rounded-full !px-3"
                                onConfigChange={(key, value) => onConfigChange(node.id, key === "count" ? { count: Number(value) || 1 } : { [key]: value })}
                                onMissingConfig={() => openConfigDialog(true)}
                                onOpenChange={onImageSettingsOpenChange}
                            />
                        </>
                    ) : mode === "video" ? (
                        <ModelPicker
                            config={config}
                            value={node.metadata?.model || config.videoModel}
                            onChange={(model) => onConfigChange(node.id, { model })}
                            onMissingConfig={() => openConfigDialog(true)}
                            type="video"
                        />
                    ) : (
                        <ModelPicker
                            config={config}
                            value={node.metadata?.model || config.textModel}
                            onChange={(model) => onConfigChange(node.id, { model })}
                            onMissingConfig={() => openConfigDialog(true)}
                        />
                    )}
                </div>
                <Button
                    type="primary"
                    className="!h-10 !min-w-16 shrink-0 !rounded-full !px-3"
                    disabled={isDisabled || !prompt.trim()}
                    onClick={submit}
                    aria-label="生成"
                >
                    <span className="flex items-center gap-1.5">
                        {isRunning ? <LoaderCircle className="size-4 animate-spin" /> : <ArrowUp className="size-4" />}
                    </span>
                </Button>
            </div>
        </div>
    );
}

function defaultMode(type: CanvasNodeData["type"]): CanvasNodeGenerationMode {
    return type === CanvasNodeType.Text ? "text" : type === CanvasNodeType.Video ? "video" : "image";
}

function getInitialPrompt(node: CanvasNodeData) {
    if (node.type === CanvasNodeType.Image && node.metadata?.content && node.metadata?.status === "success") return "";
    return node.metadata?.prompt || "";
}

function buildNodeConfig(globalConfig: AiConfig, node: CanvasNodeData, mode: CanvasNodeGenerationMode): AiConfig {
    const defaultModel = mode === "image" ? globalConfig.imageModel : mode === "video" ? globalConfig.videoModel : globalConfig.textModel;
    return {
        ...globalConfig,
        model: node.metadata?.model || defaultModel || globalConfig.model,
        quality: node.metadata?.quality || globalConfig.quality || defaultConfig.quality,
        imageTier: node?.metadata?.imageTier || globalConfig.imageTier || defaultConfig.imageTier,
        size: node.metadata?.size || globalConfig.size || defaultConfig.size,
        videoSeconds: node.metadata?.seconds || globalConfig.videoSeconds || defaultConfig.videoSeconds,
        vquality: node.metadata?.vquality || globalConfig.vquality || defaultConfig.vquality,
        count: String(node.metadata?.count || globalConfig.count || defaultConfig.count),
    };
}


