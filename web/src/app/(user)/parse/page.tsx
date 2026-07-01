"use client";

import { App, Button, Card, Empty, Input, Select, Space, Spin, Tag, Typography } from "antd";
import { Copy, Download, FileAudio, ImageIcon, Link2, PlayCircle, Search } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { useCopyText } from "@/hooks/use-copy-text";
import { requestLinkParse, type ParseMediaItem, type ParseResult } from "@/services/api/parse";
import { useConfigStore, useEffectiveConfig } from "@/stores/use-config-store";

type MediaKind = "video" | "image" | "audio";
type RawMediaItem = ParseMediaItem & { sourceKind?: MediaKind };
type DisplayMediaItem = ParseMediaItem & {
    displayLabel: string;
    previewKind: MediaKind;
};

const mediaTitles: Record<MediaKind, string> = {
    video: "视频",
    image: "图片",
    audio: "音频",
};

export default function ParsePage() {
    const { message } = App.useApp();
    const copyText = useCopyText();
    const config = useEffectiveConfig();
    const updateConfig = useConfigStore((state) => state.updateConfig);
    const [selectedModel, setSelectedModel] = useState(config.parseModel);
    const [input, setInput] = useState("");
    const [isParsing, setIsParsing] = useState(false);
    const [result, setResult] = useState<ParseResult | null>(null);

    const parseModels = useMemo(() => config.models.filter((model) => config.modelTypes[model] === "parse"), [config.modelTypes, config.models]);
    const mediaGroups = useMemo(() => normalizeMediaGroups(result), [result]);

    useEffect(() => {
        if (selectedModel && parseModels.includes(selectedModel)) return;
        const nextModel = config.parseModel && parseModels.includes(config.parseModel) ? config.parseModel : parseModels[0] || "";
        setSelectedModel(nextModel);
    }, [config.parseModel, parseModels, selectedModel]);

    const handleModelChange = (model: string) => {
        setSelectedModel(model);
        updateConfig("parseModel", model);
    };

    const handleParse = async () => {
        const content = input.trim();
        if (!selectedModel) {
            message.warning("请先选择解析模型");
            return;
        }
        if (!content) {
            message.warning("请粘贴需要解析的分享链接或完整分享文本");
            return;
        }

        setIsParsing(true);
        try {
            const nextResult = await requestLinkParse(config, selectedModel, content);
            setResult(nextResult);
            message.success("解析完成");
        } catch (error) {
            message.error(error instanceof Error ? error.message : "解析失败");
        } finally {
            setIsParsing(false);
        }
    };

    const handleDownload = async (item: DisplayMediaItem, index: number) => {
        try {
            const response = await fetch(item.url);
            if (!response.ok) throw new Error("download failed");
            const blob = await response.blob();
            const objectUrl = URL.createObjectURL(blob);
            downloadObjectUrl(objectUrl, buildDownloadName(item, item.previewKind, index));
            window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
        } catch {
            window.open(item.url, "_blank", "noopener,noreferrer");
            message.warning("当前媒体不支持浏览器直接下载，已打开原始地址");
        }
    };

    return (
        <main className="h-full overflow-auto bg-background text-stone-950 dark:text-stone-100">
            <div className="mx-auto flex w-full max-w-7xl flex-col gap-6 px-6 py-8">
                <header className="border-b border-stone-200 pb-5 dark:border-stone-800">
                    <p className="text-xs text-stone-500 dark:text-stone-400">链接解析</p>
                    <h1 className="mt-2 text-3xl font-semibold">解析工作台</h1>
                </header>

                <div className="grid gap-6 lg:grid-cols-[420px_1fr]">
                    <aside>
                        <Card className="border-stone-200 dark:border-stone-800">
                            <Space direction="vertical" size={18} className="w-full">
                                <div>
                                    <Typography.Text className="mb-2 block text-sm font-medium">解析模型</Typography.Text>
                                    <Select
                                        size="large"
                                        value={selectedModel || undefined}
                                        onChange={handleModelChange}
                                        placeholder="选择解析模型"
                                        className="w-full"
                                        options={parseModels.map((model) => ({ label: model, value: model }))}
                                    />
                                </div>

                                <div>
                                    <Typography.Text className="mb-2 block text-sm font-medium">分享链接或文本</Typography.Text>
                                    <Input.TextArea
                                        value={input}
                                        onChange={(event) => setInput(event.target.value)}
                                        placeholder="粘贴抖音、快手、小红书、B站、YouTube 等平台分享文本或链接"
                                        rows={10}
                                        size="large"
                                        className="resize-none"
                                    />
                                </div>

                                <Button type="primary" size="large" block icon={<Search className="size-4" />} loading={isParsing} onClick={handleParse} className="h-12 text-base font-medium">
                                    开始解析
                                </Button>
                            </Space>
                        </Card>
                    </aside>

                    <section className="min-h-[620px] rounded-lg border border-stone-200 bg-stone-50 p-4 dark:border-stone-800 dark:bg-stone-900">
                        {isParsing ? (
                            <div className="flex min-h-[560px] items-center justify-center">
                                <Spin tip="正在解析链接" />
                            </div>
                        ) : result ? (
                            <div className="flex flex-col gap-4">
                                <ResultSummary result={result} />
                                <div className="grid gap-4 xl:grid-cols-3">
                                    <MediaColumn kind="video" items={mediaGroups.video} onCopy={copyText} onDownload={handleDownload} />
                                    <MediaColumn kind="image" items={mediaGroups.image} onCopy={copyText} onDownload={handleDownload} />
                                    <MediaColumn kind="audio" items={mediaGroups.audio} onCopy={copyText} onDownload={handleDownload} />
                                </div>
                            </div>
                        ) : (
                            <div className="flex min-h-[560px] items-center justify-center">
                                <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="左侧输入链接后，解析结果会在这里按视频、图片、音频分列展示" />
                            </div>
                        )}
                    </section>
                </div>
            </div>
        </main>
    );
}

function ResultSummary({ result }: { result: ParseResult }) {
    const normalized = result.normalized || {};
    return (
        <div className="rounded-md border border-stone-200 bg-white p-4 dark:border-stone-800 dark:bg-stone-950">
            <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                    <Typography.Title level={5} className="!mb-1 truncate">
                        {normalized.title || "解析结果"}
                    </Typography.Title>
                    <Typography.Text type="secondary" className="text-sm">
                        {normalized.author || result.api?.name || result.input?.normalizedUrl || "已解析完成"}
                    </Typography.Text>
                </div>
                <Space size={6} wrap>
                    {result.api?.name ? <Tag color="blue">{result.api.name}</Tag> : null}
                    {typeof result.durationMs === "number" ? <Tag>{result.durationMs}ms</Tag> : null}
                </Space>
            </div>
        </div>
    );
}

function MediaColumn({ kind, items, onCopy, onDownload }: { kind: MediaKind; items: DisplayMediaItem[]; onCopy: (value: string, successText?: string) => void; onDownload: (item: DisplayMediaItem, index: number) => void }) {
    const Icon = kind === "video" ? PlayCircle : kind === "image" ? ImageIcon : FileAudio;
    return (
        <div className="flex min-h-[460px] flex-col rounded-md border border-stone-200 bg-white dark:border-stone-800 dark:bg-stone-950">
            <div className="flex h-12 items-center justify-between border-b border-stone-200 px-4 dark:border-stone-800">
                <div className="flex min-w-0 items-center gap-2">
                    <Icon className="size-4 shrink-0 text-stone-500" />
                    <Typography.Text className="font-medium">{mediaTitles[kind]}</Typography.Text>
                </div>
                <Tag>{items.length}</Tag>
            </div>

            <div className="flex flex-1 flex-col gap-3 p-3">
                {items.length ? (
                    items.map((item, index) => (
                        <div key={`${item.url}-${index}`} className="overflow-hidden rounded-md border border-stone-200 bg-stone-50 dark:border-stone-800 dark:bg-stone-900">
                            <MediaPreview item={item} />
                            <div className="flex items-center justify-between gap-2 px-3 py-2">
                                <Typography.Text className="min-w-0 flex-1 truncate text-xs" title={item.displayLabel}>
                                    {item.displayLabel}
                                </Typography.Text>
                                <Space size={4}>
                                    <Button size="small" icon={<Copy className="size-3.5" />} onClick={() => onCopy(item.url, "链接已复制")} title="复制链接" />
                                    <Button size="small" icon={<Download className="size-3.5" />} onClick={() => onDownload(item, index)} title="下载" />
                                    <Button size="small" icon={<Link2 className="size-3.5" />} href={item.url} target="_blank" rel="noreferrer" title="新窗口预览" />
                                </Space>
                            </div>
                        </div>
                    ))
                ) : (
                    <div className="flex flex-1 items-center justify-center">
                        <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={`暂无${mediaTitles[kind]}`} />
                    </div>
                )}
            </div>
        </div>
    );
}

function MediaPreview({ item }: { item: DisplayMediaItem }) {
    if (item.previewKind === "video") return <video src={item.url} controls playsInline preload="metadata" className="aspect-video w-full bg-black object-contain" />;
    if (item.previewKind === "image") return <img src={item.url} alt={item.displayLabel} loading="lazy" className="aspect-video w-full bg-stone-100 object-contain dark:bg-stone-950" />;
    return <audio src={item.url} controls preload="metadata" className="w-full px-3 py-6" />;
}

function normalizeMediaGroups(result: ParseResult | null) {
    const groups: Record<MediaKind, DisplayMediaItem[]> = { video: [], image: [], audio: [] };
    const normalized = result?.normalized;
    if (!normalized) return groups;

    const items: RawMediaItem[] = [
        ...(normalized.videos || []).map((item) => ({ ...item, sourceKind: "video" as const })),
        ...(normalized.images || []).map((item) => ({ ...item, sourceKind: "image" as const })),
        ...(normalized.audios || []).map((item) => ({ ...item, sourceKind: "audio" as const })),
        ...(normalized.links || []),
    ];
    if (normalized.avatar) items.push({ label: "author avatar", url: normalized.avatar, type: "image", filename: "author_avatar", sourceKind: "image" });
    if (normalized.cover) items.push({ label: "cover", url: normalized.cover, type: "image", filename: "cover", sourceKind: "image" });

    const seen = new Set<string>();
    for (const item of items) {
        if (!item.url || seen.has(item.url)) continue;
        const classified = classifyMediaItem(item);
        if (!classified) continue;
        groups[classified.column].push(classified.item);
        seen.add(item.url);
    }
    return groups;
}

function classifyMediaItem(item: RawMediaItem): { column: MediaKind; item: DisplayMediaItem } | null {
    const label = `${item.label || ""} ${item.filename || ""} ${item.type || ""}`.toLowerCase();
    const urlKind = inferUrlKind(item.url);
    const isAudioCover = hasAny(label, ["music avatar", "music cover", "audio avatar", "audio cover", "sound avatar"]);
    const isAuthorAvatar = hasAny(label, ["author avatar", "user avatar", "avatar"]) && !isAudioCover;
    const isVideoCover = hasAny(label, ["video cover", "cover", "poster"]) && !isAudioCover && !isAuthorAvatar;
    const isAudio = item.sourceKind === "audio" || item.type === "audio" || urlKind === "audio" || hasAny(label, ["music url", "audio url", "music", "audio", "sound", "bgm"]);
    const isImage = item.sourceKind === "image" || item.type === "image" || urlKind === "image" || isAudioCover || isAuthorAvatar || isVideoCover;
    const isVideo = item.type === "video" || urlKind === "video" || hasAny(label, ["video", "live_photo"]);
    const isGenericUrl = ["url", "link"].includes(label.trim()) && !urlKind;

    if (isAudioCover) return toDisplayItem("audio", item, "image", "音频封面");
    if (isAudio) return toDisplayItem("audio", item, "audio", numberedLabel(item, "音频"));
    if (isAuthorAvatar) return toDisplayItem("image", item, "image", "作者头像");
    if (isVideoCover) return toDisplayItem("image", item, "image", "视频封面");
    if (isImage) return toDisplayItem("image", item, "image", numberedLabel(item, "图片"));
    if (isVideo && !isGenericUrl) return toDisplayItem("video", item, "video", numberedLabel(item, "视频"));
    return null;
}

function toDisplayItem(column: MediaKind, item: RawMediaItem, previewKind: MediaKind, displayLabel: string) {
    return { column, item: { ...item, previewKind, displayLabel } };
}

function numberedLabel(item: ParseMediaItem, fallback: string) {
    const text = `${item.label || item.filename || ""}`.toLowerCase();
    const match = text.match(/\b(\d+)\b/);
    return match ? `${fallback} ${match[1]}` : fallback;
}

function hasAny(value: string, needles: string[]) {
    return needles.some((needle) => value.includes(needle));
}

function inferUrlKind(url: string): MediaKind | "" {
    const ext = readUrlExt(url).toLowerCase();
    if ([".jpg", ".jpeg", ".png", ".webp", ".gif", ".avif", ".bmp", ".svg"].includes(ext)) return "image";
    if ([".mp3", ".m4a", ".aac", ".wav", ".ogg", ".flac"].includes(ext)) return "audio";
    if ([".mp4", ".webm", ".mov", ".m4v", ".avi", ".mkv"].includes(ext)) return "video";
    return "";
}

function downloadObjectUrl(url: string, filename: string) {
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
}

function buildDownloadName(item: ParseMediaItem, kind: MediaKind, index: number) {
    const baseName = stripExt(sanitizeFilename(item.filename || item.label || `${kind}_${index + 1}`));
    if (kind === "video") return `${baseName}.mp4`;
    return `${baseName}${readUrlExt(item.url) || (kind === "audio" ? ".mp3" : ".jpg")}`;
}

function stripExt(value: string) {
    return value.replace(/\.[a-z0-9]{2,5}$/i, "");
}

function readUrlExt(url: string) {
    try {
        const pathname = new URL(url).pathname;
        const match = pathname.match(/\.[a-z0-9]{2,5}$/i);
        return match?.[0] || "";
    } catch {
        return "";
    }
}

function sanitizeFilename(value: string) {
    return value.trim().replace(/[\\/:*?"<>|]+/g, "_").replace(/\.+$/g, "") || "media";
}
