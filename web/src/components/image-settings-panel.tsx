"use client";

import { type ReactNode } from "react";
import { ConfigProvider } from "antd";

import { type CanvasTheme } from "@/lib/canvas-theme";
import type { AiConfig } from "@/stores/use-config-store";
import { IMAGE_KEY_TIERS, IMAGE_KEY_TIER_LABELS, type ImageKeyTier } from "@/types/api-keys";

export const MAX_IMAGE_GENERATION_COUNT = 8;

const aspectOptions = [
    { value: "auto", label: "未指定", description: "模型自动决定", width: 0, height: 0, icon: "auto" },
    { value: "1:1", label: "1:1", description: "正方形", width: 1024, height: 1024, icon: "square" },
    { value: "16:9", label: "16:9", description: "横版", width: 1792, height: 1024, icon: "landscape" },
    { value: "4:3", label: "4:3", description: "横版", width: 1344, height: 1024, icon: "landscape" },
    { value: "3:4", label: "3:4", description: "竖版", width: 1024, height: 1344, icon: "portrait" },
    { value: "9:16", label: "9:16", description: "竖版", width: 1024, height: 1792, icon: "portrait" },
];

type ImageSettingsPanelProps = {
    config: AiConfig;
    onConfigChange: (key: "quality" | "size" | "count" | "imageTier", value: string) => void;
    theme: CanvasTheme;
    showTitle?: boolean;
    className?: string;
    maxCount?: number;
    quickCount?: number;
};

export function ImageSettingsPanel({ config, onConfigChange, theme, showTitle = true, className = "w-[340px] space-y-4 rounded-2xl px-1 py-0.5", maxCount = MAX_IMAGE_GENERATION_COUNT, quickCount = MAX_IMAGE_GENERATION_COUNT }: ImageSettingsPanelProps) {
    const normalizedMaxCount = Math.max(1, Math.min(MAX_IMAGE_GENERATION_COUNT, maxCount));
    const normalizedQuickCount = Math.max(1, Math.min(normalizedMaxCount, quickCount));
    const count = Math.max(1, Math.min(normalizedMaxCount, Math.floor(Math.abs(Number(config.count)) || 1)));
    const activeSize = config.size || "auto";
    const selectedAspect = aspectOptions.find((item) => item.value === activeSize);
    const activeTier = config.imageTier || "1k";
    const selectAspect = (value: string) => {
        const option = aspectOptions.find((item) => item.value === value);
        onConfigChange("size", option?.value || "auto");
    };
    const updateCount = (value: number | null) => {
        const next = Math.max(1, Math.min(normalizedMaxCount, Math.floor(Math.abs(value || count || 1))));
        onConfigChange("count", String(next));
    };

    return (
        <ImageSettingsTheme theme={theme}>
            <div className={className} style={{ color: theme.node.text }} onMouseDown={(event) => event.stopPropagation()}>
                {showTitle ? <div className="text-lg font-semibold">图像设置</div> : null}
                <div className="space-y-2.5">
                    <SettingTitle color={theme.node.muted}>生图档位</SettingTitle>
                    <div className="grid grid-cols-3 gap-2.5">
                        {IMAGE_KEY_TIERS.map((tier) => (
                            <OptionPill key={tier} selected={activeTier === tier} theme={theme} onClick={() => onConfigChange("imageTier", tier)}>
                                {IMAGE_KEY_TIER_LABELS[tier]}
                            </OptionPill>
                        ))}
                    </div>
                </div>
                <div className="space-y-2.5">
                    <SettingTitle color={theme.node.muted}>宽高比</SettingTitle>
                    <div className="grid grid-cols-2 gap-2.5">
                        {aspectOptions.map((item) => (
                            <button
                                key={item.value}
                                type="button"
                                className="flex h-[70px] cursor-pointer items-center gap-3 rounded-xl border bg-transparent px-3 text-left transition hover:opacity-80"
                                style={{ borderColor: selectedAspect?.value === item.value ? theme.node.text : theme.node.stroke, background: "transparent", color: theme.node.text }}
                                onMouseDown={(event) => event.stopPropagation()}
                                onClick={() => selectAspect(item.value)}
                            >
                                <AspectIcon type={item.icon} width={item.width} height={item.height} color={theme.node.text} />
                                <span className="min-w-0">
                                    <span className="block truncate text-sm font-medium leading-5">{item.label}</span>
                                    <span className="block truncate text-xs leading-4 opacity-55">{item.description}</span>
                                </span>
                            </button>
                        ))}
                    </div>
                </div>
                <div className="space-y-2.5">
                    <SettingTitle color={theme.node.muted}>生成张数</SettingTitle>
                    <div className="grid grid-cols-4 gap-2.5">
                        {Array.from({ length: normalizedQuickCount }, (_, index) => index + 1).map((value) => (
                            <OptionPill key={value} selected={count === value} theme={theme} onClick={() => updateCount(value)}>
                                {value} 张
                            </OptionPill>
                        ))}
                        <CountInput value={count} max={normalizedMaxCount} theme={theme} onChange={updateCount} />
                    </div>
                </div>
            </div>
        </ImageSettingsTheme>
    );
}

export function ImageSettingsTheme({ theme, children }: { theme: CanvasTheme; children: ReactNode }) {
    return (
        <ConfigProvider
            theme={{
                token: { colorBgContainer: theme.toolbar.panel, colorBgElevated: theme.toolbar.panel, colorBorder: theme.node.stroke, colorPrimary: theme.node.activeStroke, colorText: theme.node.text, colorTextLightSolid: theme.node.panel },
                components: { Button: { defaultBg: theme.toolbar.panel, defaultBorderColor: theme.node.stroke, defaultColor: theme.node.text } },
            }}
        >
            {children}
        </ConfigProvider>
    );
}

export function imageQualityLabel(value: string) {
    return ({ auto: "默认", high: "默认", medium: "默认", low: "默认" } as Record<string, string>)[value] || "默认";
}

export function imageSizeLabel(size: string) {
    return aspectOptions.find((item) => item.value === size)?.label || size || "未指定";
}

export function imageTierLabel(tier: string | undefined) {
    return IMAGE_KEY_TIER_LABELS[(tier || "1k") as ImageKeyTier] || "1k";
}

function OptionPill({ selected, theme, onClick, children }: { selected: boolean; theme: CanvasTheme; onClick: () => void; children: ReactNode }) {
    return (
        <button
            type="button"
            className="h-9 cursor-pointer rounded-full border px-2 text-sm transition hover:opacity-80"
            style={{ background: "transparent", borderColor: selected ? theme.node.text : theme.node.stroke, color: theme.node.text }}
            onMouseDown={(event) => event.stopPropagation()}
            onClick={onClick}
        >
            {children}
        </button>
    );
}

function CountInput({ value, max, theme, onChange }: { value: number; max: number; theme: CanvasTheme; onChange: (value: number | null) => void }) {
    return (
        <label className="col-span-2 flex h-9 overflow-hidden rounded-full border text-sm" style={{ borderColor: theme.node.stroke, color: theme.node.text }}>
            <input
                type="number"
                min={1}
                max={max}
                className="min-w-0 flex-1 bg-transparent px-3 text-center outline-none [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                style={{ color: theme.node.text, WebkitTextFillColor: theme.node.text }}
                value={value || ""}
                onChange={(event) => onChange(Number(event.target.value) || null)}
                onMouseDown={(event) => event.stopPropagation()}
            />
        </label>
    );
}

function AspectIcon({ type, width, height, color }: { type: string; width: number; height: number; color: string }) {
    if (type === "auto") {
        return (
            <span className="grid h-7 w-9 shrink-0 place-items-center">
                <span className="h-1.5 w-5 rounded-full" style={{ background: color, opacity: 0.35 }} />
            </span>
        );
    }
    const ratio = width / Math.max(1, height);
    const boxWidth = ratio >= 1 ? 24 : Math.max(10, 24 * ratio);
    const boxHeight = ratio >= 1 ? Math.max(10, 24 / ratio) : 24;
    return (
        <span className="grid h-7 w-9 shrink-0 place-items-center">
            <span className="border-2" style={{ width: boxWidth, height: boxHeight, borderColor: color }} />
        </span>
    );
}

function SettingTitle({ children, color }: { children: string; color: string }) {
    return (
        <div className="text-xs font-medium" style={{ color }}>
            {children}
        </div>
    );
}
