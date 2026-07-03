"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowUp, ClipboardPaste, LoaderCircle, Plus } from "lucide-react";
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
        if (mode === "video") {
            updateConfig("videoModel", model);
            onConfigChange(node.id, { model });
            return;
        }
        updateConfig("textModel", model);
        onConfigChange(node.id, { model });
    };
    const pastePromptText = async () => {
        setPromptMenu(null);
        if (isDisabled) return;
        if (!navigator.clipboard?.readText) {
            message.warning("当前浏览器不支持直接读取剪贴板文本，请使用 Ctrl+V 粘贴");
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
    const uploadReferenceFromMenu = () => {
        setPromptMenu(null);
        onUploadReference?.(node.id);
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
                placeholder={isNodeGenerating ? "正在生成中" : mode === "video" ? "输入视频生成要求" : mode === "image" ? (hasImageContent ? "输入图片修改要求" : "输入图片生成要求") : hasTextContent ? "输入文本修改要求" : "输入文本生成要求"}
            />
            {promptMenu
                ? createPortal(
                      <PromptInputContextMenu
                          x={promptMenu.x}
                          y={promptMenu.y}
                          canAddReference={mode === "image"}
                          onAddReference={uploadReferenceFromMenu}
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
                            <ModelPicker
                                config={config}
                                value={node.metadata?.model || config.imageModel}
                                onChange={selectModel}
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
                            <Button
                                type="default"
                                className="!h-10 !min-w-10 !rounded-full !px-3"
                                icon={<Plus className="size-4" />}
                                onClick={() => onUploadReference?.(node.id)}
                                title="上传参考图"
                                aria-label="上传参考图"
                            />
                        </>
                    ) : mode === "video" ? (
                        <ModelPicker
                            config={config}
                            value={node.metadata?.model || config.videoModel}
                            onChange={selectModel}
                            onMissingConfig={() => openConfigDialog(true)}
                            type="video"
                        />
                    ) : (
                        <ModelPicker
                            config={config}
                            value={node.metadata?.model || config.textModel}
                            onChange={selectModel}
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

function PromptInputContextMenu({ x, y, canAddReference, onAddReference, onPasteText, onPointerDown }: { x: number; y: number; canAddReference: boolean; onAddReference: () => void; onPasteText: () => void; onPointerDown: (event: ReactPointerEvent<HTMLDivElement>) => void }) {
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    return (
        <div className="fixed z-[1300] min-w-44 overflow-hidden rounded-xl border py-1 shadow-2xl" style={{ left: x, top: y, background: theme.toolbar.panel, borderColor: theme.toolbar.border, color: theme.node.text }} onPointerDown={onPointerDown}>
            {canAddReference ? <PromptMenuButton icon={<Plus className="size-4" />} label="添加参考图" onClick={onAddReference} /> : null}
            <PromptMenuButton icon={<ClipboardPaste className="size-4" />} label="粘贴提示词文本" onClick={onPasteText} />
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
    return type === CanvasNodeType.Text ? "text" : type === CanvasNodeType.Video ? "video" : "image";
}

function getInitialPrompt(node: CanvasNodeData) {
    if (node.type === CanvasNodeType.Image && node.metadata?.content && node.metadata?.status === "success") return "";
    return node.metadata?.prompt || "";
}

function buildNodeConfig(globalConfig: AiConfig, node: CanvasNodeData, mode: CanvasNodeGenerationMode): AiConfig {
    const defaultModel = mode === "image" ? globalConfig.imageModel : mode === "video" ? globalConfig.videoModel : globalConfig.textModel;
    const model = node.metadata?.model || defaultModel || globalConfig.model;
    return {
        ...globalConfig,
        model,
        quality: node.metadata?.quality || globalConfig.quality || defaultConfig.quality,
        imageTier: mode === "image" ? normalizeImageTierForModel(globalConfig, model, node?.metadata?.imageTier || defaultImageTierForModel(globalConfig, model)) : node?.metadata?.imageTier || globalConfig.imageTier || defaultConfig.imageTier,
        size: mode === "image" ? normalizeImageSizeForModel(globalConfig, model, node.metadata?.size || globalConfig.size || defaultConfig.size) : node.metadata?.size || globalConfig.size || defaultConfig.size,
        videoSeconds: node.metadata?.seconds || globalConfig.videoSeconds || defaultConfig.videoSeconds,
        vquality: node.metadata?.vquality || globalConfig.vquality || defaultConfig.vquality,
        count: String(node.metadata?.count || globalConfig.count || defaultConfig.count),
    };
}


