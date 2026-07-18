"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowUp, ImagePlus, LoaderCircle, Plus, Type } from "lucide-react";
import { App, Button } from "antd";
import type { PointerEvent as ReactPointerEvent, ReactNode } from "react";
import { createPortal } from "react-dom";

import { ModelPicker } from "@/components/model-picker";
import { defaultConfig, defaultImageTierForModel, normalizeImageSizeForModel, normalizeImageTierForModel, useConfigStore, useEffectiveConfig, type AiConfig } from "@/stores/use-config-store";
import { canvasThemes } from "@/lib/canvas-theme";
import { useThemeStore } from "@/stores/use-theme-store";
import { CanvasImageSettingsPopover } from "./canvas-image-settings-popover";
import { CanvasPromptLibrary } from "./canvas-prompt-library";
import type { NodeGenerationInput } from "./canvas-node-generation";
import { CanvasReferenceStrip } from "./canvas-reference-strip";
import { CanvasNodeType, type CanvasGenerationMode, type CanvasNodeData } from "../types";

export type CanvasNodeGenerationMode = CanvasGenerationMode;

type CanvasNodePromptPanelProps = {
    node: CanvasNodeData;
    isRunning: boolean;
    onPromptChange: (nodeId: string, prompt: string) => void;
    onConfigChange: (nodeId: string, patch: Partial<CanvasNodeData["metadata"]>) => void;
    onGenerate: (nodeId: string, mode: CanvasNodeGenerationMode, prompt: string) => void;
    inputs?: NodeGenerationInput[];
    onUploadReference?: (nodeId: string) => void;
    onPasteReference?: (nodeId: string, files: File[]) => void;
    onImageSettingsOpenChange?: (open: boolean) => void;
};

export function CanvasNodePromptPanel({ node, isRunning, onPromptChange, onConfigChange, onGenerate, inputs = [], onUploadReference, onPasteReference, onImageSettingsOpenChange }: CanvasNodePromptPanelProps) {
    const { message } = App.useApp();
    const globalConfig = useEffectiveConfig();
    const openConfigDialog = useConfigStore((state) => state.openConfigDialog);
    const updateConfig = useConfigStore((state) => state.updateConfig);
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    const mode = defaultMode(node.type);
    const hasTextContent = node.type === CanvasNodeType.Text && Boolean(node.metadata?.content?.trim());
    const hasImageContent = node.type === CanvasNodeType.Image && Boolean(node.metadata?.content);
    const config = buildNodeConfig(globalConfig, node, mode);
    const isNodeGenerating = node.metadata?.status === "loading";
    const isDisabled = isRunning || isNodeGenerating;
    const [prompt, setPrompt] = useState(getInitialPrompt(node));
    const [promptMenu, setPromptMenu] = useState<{ x: number; y: number } | null>(null);
    const textareaRef = useRef<HTMLTextAreaElement>(null);

    useEffect(() => {
        setPrompt(isNodeGenerating ? "" : getInitialPrompt(node));
    }, [node.id, isNodeGenerating]);

    useEffect(() => {
        if (!promptMenu) return;
        const close = () => setPromptMenu(null);
        const closeWithEscape = (event: KeyboardEvent) => {
            if (event.key === "Escape") close();
        };
        window.addEventListener("pointerdown", close);
        window.addEventListener("keydown", closeWithEscape);
        return () => {
            window.removeEventListener("pointerdown", close);
            window.removeEventListener("keydown", closeWithEscape);
        };
    }, [promptMenu]);

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
    const selectModel = (model: string) => {
        if (mode === "image") {
            updateConfig("imageModel", model);
            updateConfig("model", model);
            onConfigChange(node.id, { model, size: normalizeImageSizeForModel(config, model, config.size), imageTier: defaultImageTierForModel(config, model) });
            return;
        }
        updateConfig("textModel", model);
        onConfigChange(node.id, { model });
    };
    const pastePromptText = async () => {
        setPromptMenu(null);
        if (isDisabled) return;
        if (!navigator.clipboard?.readText) {
            textareaRef.current?.focus();
            message.warning("当前浏览器不允许菜单读取剪贴板文本，请使用 Ctrl+V 粘贴");
            return;
        }
        let text = "";
        try {
            text = await navigator.clipboard.readText();
        } catch {
            message.warning("当前浏览器不允许读取剪贴板文本，请使用 Ctrl+V 粘贴");
            return;
        }
        if (!text) {
            message.warning("剪贴板里没有文本");
            return;
        }
        const textarea = textareaRef.current;
        const start = textarea?.selectionStart ?? prompt.length;
        const end = textarea?.selectionEnd ?? prompt.length;
        const nextPrompt = `${prompt.slice(0, start)}${text}${prompt.slice(end)}`;
        updatePrompt(nextPrompt);
        requestAnimationFrame(() => {
            textarea?.focus();
            textarea?.setSelectionRange(start + text.length, start + text.length);
        });
    };
    const pasteReferenceImage = async () => {
        setPromptMenu(null);
        if (mode !== "image" || isDisabled) return;
        if (!navigator.clipboard?.read) {
            textareaRef.current?.focus();
            message.warning("当前浏览器不允许菜单读取剪贴板图片，请使用 Ctrl+V 粘贴参考图");
            return;
        }
        try {
            const items = await navigator.clipboard.read();
            const files: File[] = [];
            for (const item of items) {
                const imageType = item.types.find((type) => type.startsWith("image/"));
                if (!imageType) continue;
                const blob = await item.getType(imageType);
                files.push(new File([blob], `clipboard-reference-${files.length + 1}.${imageType.includes("png") ? "png" : "jpg"}`, { type: imageType }));
            }
            if (!files.length) {
                message.warning("剪贴板里没有图片");
                return;
            }
            onPasteReference?.(node.id, files);
        } catch {
            textareaRef.current?.focus();
            message.warning("当前浏览器不允许菜单读取剪贴板图片，请使用 Ctrl+V 粘贴参考图");
        }
    };
    const moveInput = (input: NodeGenerationInput, offset: number) => {
        const imageInputs = inputs.filter((item) => item.type === "image");
        const sameTypeIndex = imageInputs.findIndex((item) => item.nodeId === input.nodeId);
        const targetInput = imageInputs[sameTypeIndex + offset];
        if (!targetInput) return;
        const index = inputs.findIndex((item) => item.nodeId === input.nodeId);
        const targetIndex = inputs.findIndex((item) => item.nodeId === targetInput.nodeId);
        const next = [...inputs];
        [next[index], next[targetIndex]] = [next[targetIndex], next[index]];
        onConfigChange(node.id, { inputOrder: next.map((item) => item.nodeId) });
        message.success("已调整参考图顺序");
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
            {mode === "image" ? <CanvasReferenceStrip inputs={inputs} theme={theme} onMove={moveInput} /> : null}

            <textarea
                ref={textareaRef}
                value={prompt}
                onContextMenu={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    setPromptMenu({ x: event.clientX, y: event.clientY });
                }}
                onPaste={(event) => {
                    if (mode !== "image") return;
                    const imageFiles = Array.from(event.clipboardData.files).filter((file) => file.type.startsWith("image/"));
                    if (!imageFiles.length) return;
                    event.preventDefault();
                    onPasteReference?.(node.id, imageFiles);
                }}
                onChange={(event) => updatePrompt(event.target.value)}
                onKeyDown={(event) => {
                    if (isDisabled || event.key !== "Enter" || event.ctrlKey || event.metaKey || event.shiftKey) return;
                    event.preventDefault();
                    submit();
                }}
                disabled={isDisabled}
                className="thin-scrollbar h-24 w-full resize-none rounded-xl border px-3 py-2 text-sm leading-5 outline-none"
                style={{ background: theme.node.fill, borderColor: theme.node.stroke, color: theme.node.text }}
                placeholder={isNodeGenerating ? "正在生成中" : mode === "image" ? (hasImageContent ? "输入图片修改要求" : "输入图片生成要求") : hasTextContent ? "输入文本修改要求" : "输入文本生成要求"}
            />
            {promptMenu
                ? createPortal(
                      <PromptInputContextMenu
                          x={promptMenu.x}
                          y={promptMenu.y}
                          canPasteReference={mode === "image"}
                          onPasteReference={() => void pasteReferenceImage()}
                          onPasteText={() => void pastePromptText()}
                          onPointerDown={(event) => event.stopPropagation()}
                      />,
                      document.body,
                  )
                : null}

            <div className="mt-2 flex min-w-0 items-center justify-between gap-2">
                <div className="flex min-w-0 flex-wrap items-center gap-2">
                    <CanvasPromptLibrary onSelect={updatePrompt} />
                    {mode === "image" ? (
                        <>
                            <ModelPicker config={config} value={node.metadata?.model || config.imageModel} onChange={selectModel} onMissingConfig={() => openConfigDialog(true)} type="image" />
                            <CanvasImageSettingsPopover
                                config={config}
                                placement="topLeft"
                                buttonClassName="!h-10 !max-w-[170px] !justify-start !rounded-full !px-3"
                                onConfigChange={(key, value) => onConfigChange(node.id, key === "count" ? { count: Number(value) || 1 } : { [key]: value })}
                                onMissingConfig={() => openConfigDialog(true)}
                                onOpenChange={onImageSettingsOpenChange}
                            />
                            <Button type="default" className="!h-10 !min-w-10 !rounded-full !px-3" icon={<Plus className="size-4" />} onClick={() => onUploadReference?.(node.id)} title="上传参考图" aria-label="上传参考图" />
                        </>
                    ) : (
                        <ModelPicker config={config} value={node.metadata?.model || config.textModel} onChange={selectModel} onMissingConfig={() => openConfigDialog(true)} />
                    )}
                </div>
                <Button type="primary" className="!h-10 !min-w-16 shrink-0 !rounded-full !px-3" disabled={isDisabled || !prompt.trim()} onClick={submit} aria-label="生成">
                    <span className="flex items-center gap-1.5">{isRunning ? <LoaderCircle className="size-4 animate-spin" /> : <ArrowUp className="size-4" />}</span>
                </Button>
            </div>
        </div>
    );
}

function PromptInputContextMenu({
    x,
    y,
    canPasteReference,
    onPasteReference,
    onPasteText,
    onPointerDown,
}: {
    x: number;
    y: number;
    canPasteReference: boolean;
    onPasteReference: () => void;
    onPasteText: () => void;
    onPointerDown: (event: ReactPointerEvent<HTMLDivElement>) => void;
}) {
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    return (
        <div className="fixed z-[1300] min-w-44 overflow-hidden rounded-xl border py-1 shadow-2xl" style={{ left: x, top: y, background: theme.toolbar.panel, borderColor: theme.toolbar.border, color: theme.node.text }} onPointerDown={onPointerDown}>
            <PromptMenuButton icon={<Type className="size-4" />} label="粘贴提示词" onClick={onPasteText} />
            {canPasteReference ? <PromptMenuButton icon={<ImagePlus className="size-4" />} label="粘贴参考图" onClick={onPasteReference} /> : null}
        </div>
    );
}

function PromptMenuButton({ icon, label, onClick }: { icon: ReactNode; label: string; onClick: () => void }) {
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    return (
        <button type="button" className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs transition-colors hover:opacity-80" style={{ color: theme.node.text }} onClick={onClick}>
            {icon}
            <span>{label}</span>
        </button>
    );
}

function defaultMode(type: CanvasNodeData["type"]): CanvasNodeGenerationMode {
    return type === CanvasNodeType.Text ? "text" : "image";
}

function getInitialPrompt(node: CanvasNodeData) {
    if (node.type === CanvasNodeType.Image && node.metadata?.content && node.metadata?.status === "success") return "";
    return node.metadata?.prompt || "";
}

function buildNodeConfig(globalConfig: AiConfig, node: CanvasNodeData, mode: CanvasNodeGenerationMode): AiConfig {
    const defaultModel = mode === "image" ? globalConfig.imageModel : globalConfig.textModel;
    const model = node.metadata?.model || defaultModel || globalConfig.model;
    return {
        ...globalConfig,
        model,
        quality: node.metadata?.quality || globalConfig.quality || defaultConfig.quality,
        imageTier: normalizeImageTierForModel(globalConfig, model, node?.metadata?.imageTier || globalConfig.imageTier || defaultImageTierForModel(globalConfig, model)),
        size: mode === "image" ? normalizeImageSizeForModel(globalConfig, model, node.metadata?.size || globalConfig.size || defaultConfig.size) : node.metadata?.size || globalConfig.size || defaultConfig.size,
        count: String(node.metadata?.count || globalConfig.count || defaultConfig.count),
    };
}
