"use client";

import { App, Button, Card, Empty, Input, Select, Space, Spin, Tag, Typography } from "antd";
import { Copy, Download, FileAudio, ImageIcon, Link2, PlayCircle, Search } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { useCopyText } from "@/hooks/use-copy-text";
import { requestLinkParse, type ParseMediaItem, type ParseResult } from "@/services/api/parse";
import { useConfigStore, useEffectiveConfig } from "@/stores/use-config-store";

type MediaKind = "video" | "image" | "audio";

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

    useEffect(() => {
        if (selectedModel && parseModels.includes(selectedModel)) return;
        const nextModel = config.parseModel && parseModels.includes(config.parseModel) ? config.parseModel : parseModels[0] || "";
        setSelectedModel(nextModel);
    }, [config.parseModel, parseModels, selectedModel]);

    const imageItems = useMemo(() => withCover(result), [result]);
    const videoItems = result?.normalized?.videos || [];
    const audioItems = result?.normalized?.audios || [];

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

    const handleDownload = async (item: ParseMediaItem, kind: MediaKind, index: number) => {
        try {
            const response = await fetch(item.url);
            if (!response.ok) throw new Error("download failed");
            const blob = await response.blob();
            const objectUrl = URL.createObjectURL(blob);
            downloadObjectUrl(objectUrl, buildDownloadName(item, kind, index));
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
                                    <MediaColumn kind="video" items={videoItems} onCopy={copyText} onDownload={handleDownload} />
                                    <MediaColumn kind="image" items={imageItems} onCopy={copyText} onDownload={handleDownload} />
                                    <MediaColumn kind="audio" items={audioItems} onCopy={copyText} onDownload={handleDownload} />
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

function MediaColumn({ kind, items, onCopy, onDownload }: { kind: MediaKind; items: ParseMediaItem[]; onCopy: (value: string, successText?: string) => void; onDownload: (item: ParseMediaItem, kind: MediaKind, index: number) => void }) {
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
                            <MediaPreview item={item} kind={kind} />
                            <div className="flex items-center justify-between gap-2 px-3 py-2">
                                <Typography.Text className="min-w-0 flex-1 truncate text-xs" title={item.label || item.filename || `${mediaTitles[kind]} ${index + 1}`}>
                                    {item.label || item.filename || `${mediaTitles[kind]} ${index + 1}`}
                                </Typography.Text>
                                <Space size={4}>
                                    <Button size="small" icon={<Copy className="size-3.5" />} onClick={() => onCopy(item.url, "链接已复制")} title="复制链接" />
                                    <Button size="small" icon={<Download className="size-3.5" />} onClick={() => onDownload(item, kind, index)} title="下载" />
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

function MediaPreview({ item, kind }: { item: ParseMediaItem; kind: MediaKind }) {
    if (kind === "video") return <video src={item.url} controls playsInline preload="metadata" className="aspect-video w-full bg-black object-contain" />;
    if (kind === "image") return <img src={item.url} alt={item.label || "解析图片"} loading="lazy" className="aspect-video w-full bg-stone-100 object-contain dark:bg-stone-950" />;
    return <audio src={item.url} controls preload="metadata" className="w-full px-3 py-6" />;
}

function withCover(result: ParseResult | null) {
    const images = result?.normalized?.images || [];
    const cover = result?.normalized?.cover;
    if (!cover || images.some((item) => item.url === cover)) return images;
    return [{ label: "封面", url: cover, type: "image", filename: "cover" }, ...images];
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
