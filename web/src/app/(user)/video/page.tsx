"use client";

import { CloudUploadOutlined, DeleteOutlined, DownloadOutlined, LinkOutlined, PlayCircleOutlined } from "@ant-design/icons";
import { App, Button, Card, Empty, Input, Radio, Segmented, Slider, Space, Tag, Typography, Upload } from "antd";
import { Clock3, Film, Image as ImageIcon, Music2, Video } from "lucide-react";
import { useEffect, useMemo, useState, type ReactNode } from "react";

import { VIDEO_QUALITY_OPTIONS } from "@/constant/video-model-options";
import { requestVideoGeneration, type VideoReferenceMaterial } from "@/services/api/video";
import { deleteStoredMedia, resolveMediaUrl, uploadMediaFile } from "@/services/file-storage";
import { uploadReferenceBlobToImageBed, uploadReferenceImage } from "@/services/image-bed";
import { useConfigStore, useEffectiveConfig, videoCapabilitiesForModel } from "@/stores/use-config-store";
import type { ReferenceImage } from "@/types/image";

type VideoHistoryItem = {
    id: string;
    prompt: string;
    url: string;
    storageKey: string;
    createdAt: number;
};

const VIDEO_HISTORY_KEY = "zmo-video-workbench-history-v1";

export default function VideoPage() {
    const { message } = App.useApp();
    const config = useEffectiveConfig();
    const updateConfig = useConfigStore((state) => state.updateConfig);
    const [selectedModel, setSelectedModel] = useState(config.videoModel);
    const capabilities = useMemo(() => videoCapabilitiesForModel(config, selectedModel), [config, selectedModel]);
    const [ratio, setRatio] = useState(capabilities.defaultRatio);
    const [quality, setQuality] = useState(capabilities.defaultQuality);
    const [duration, setDuration] = useState(capabilities.defaultDuration);
    const [prompt, setPrompt] = useState("");
    const [imageUrl, setImageUrl] = useState("");
    const [videoUrlInput, setVideoUrlInput] = useState("");
    const [audioUrlInput, setAudioUrlInput] = useState("");
    const [imageReferences, setImageReferences] = useState<ReferenceImage[]>([]);
    const [mediaReferences, setMediaReferences] = useState<VideoReferenceMaterial[]>([]);
    const [isGenerating, setIsGenerating] = useState(false);
    const [resultUrl, setResultUrl] = useState("");
    const [history, setHistory] = useState<VideoHistoryItem[]>([]);

    const videoModels = useMemo(() => config.models.filter((model) => config.modelTypes[model] === "video"), [config.modelTypes, config.models]);
    const hasReferenceInputs = capabilities.referenceImageLimit > 0 || capabilities.referenceVideoLimit > 0 || capabilities.referenceAudioLimit > 0;

    useEffect(() => {
        if (selectedModel && videoModels.includes(selectedModel)) return;
        setSelectedModel(config.videoModel && videoModels.includes(config.videoModel) ? config.videoModel : videoModels[0] || "");
    }, [config.videoModel, selectedModel, videoModels]);

    useEffect(() => {
        setRatio((current) => (capabilities.ratios.includes(current) ? current : capabilities.defaultRatio));
        setQuality((current) => (capabilities.qualities.includes(current) ? current : capabilities.defaultQuality));
        setDuration((current) => (capabilities.durations.includes(current) ? current : capabilities.defaultDuration));
        setImageReferences((current) => current.slice(0, capabilities.referenceImageLimit));
        setMediaReferences((current) => [
            ...current.filter((item) => item.type === "video").slice(0, capabilities.referenceVideoLimit),
            ...current.filter((item) => item.type === "audio").slice(0, capabilities.referenceAudioLimit),
        ]);
    }, [capabilities]);

    useEffect(() => {
        let cancelled = false;
        void (async () => {
            const items = await Promise.all(
                readVideoHistory().map(async (item) => ({
                    ...item,
                    url: await resolveMediaUrl(item.storageKey, item.url),
                })),
            );
            if (cancelled) return;
            setHistory(items);
            if (items[0]?.url) setResultUrl(items[0].url);
        })();
        return () => {
            cancelled = true;
        };
    }, []);

    const handleModelChange = (model: string) => {
        setSelectedModel(model);
        updateConfig("videoModel", model);
    };

    const addImageUrl = () => {
        const url = imageUrl.trim();
        if (!isRemoteUrl(url)) {
            message.warning("请输入 HTTPS 图片 URL");
            return;
        }
        if (imageReferences.length >= capabilities.referenceImageLimit) {
            message.warning(`当前模型最多 ${capabilities.referenceImageLimit} 张参考图`);
            return;
        }
        setImageReferences((current) => [...current, { id: newID(), name: `image${current.length + 1}`, type: "image/url", dataUrl: "", url, remoteUrl: url }]);
        setImageUrl("");
    };

    const addMediaUrl = (type: "video" | "audio", url: string, setUrl: (value: string) => void) => {
        const limit = type === "video" ? capabilities.referenceVideoLimit : capabilities.referenceAudioLimit;
        if (!limit) {
            message.warning(`当前模型不支持参考${type === "video" ? "视频" : "音频"}`);
            return;
        }
        const value = url.trim();
        if (!isRemoteUrl(value)) {
            message.warning(`请输入 HTTPS ${type === "video" ? "视频" : "音频"} URL`);
            return;
        }
        if (mediaReferences.filter((item) => item.type === type).length >= limit) {
            message.warning(`当前模型最多 ${limit} 个参考${type === "video" ? "视频" : "音频"}`);
            return;
        }
        setMediaReferences((current) => [...current, { type, url: value, name: `${type}${current.length + 1}` }]);
        setUrl("");
    };

    const uploadImage = async (file: File) => {
        if (imageReferences.length >= capabilities.referenceImageLimit) {
            message.warning(`当前模型最多 ${capabilities.referenceImageLimit} 张参考图`);
            return;
        }
        const uploaded = await uploadReferenceImage(file);
        setImageReferences((current) => [...current, { id: uploaded.storageKey, name: file.name || `image${current.length + 1}`, type: file.type || "image", dataUrl: uploaded.url, url: uploaded.url, remoteUrl: uploaded.remoteUrl, storageKey: uploaded.storageKey }]);
        message.success("参考图已上传");
    };

    const uploadMedia = async (type: "video" | "audio", file: File) => {
        const limit = type === "video" ? capabilities.referenceVideoLimit : capabilities.referenceAudioLimit;
        if (!limit || mediaReferences.filter((item) => item.type === type).length >= limit) {
            message.warning(`当前模型最多 ${limit} 个参考${type === "video" ? "视频" : "音频"}`);
            return;
        }
        const remoteUrl = await uploadReferenceBlobToImageBed(file, file.name || `${type}.mp4`);
        setMediaReferences((current) => [...current, { type, url: remoteUrl, name: file.name || `${type}${current.length + 1}` }]);
        message.success(`参考${type === "video" ? "视频" : "音频"}已上传`);
    };

    const handleGenerate = async () => {
        if (!selectedModel) {
            message.warning("请选择视频模型");
            return;
        }
        if (!prompt.trim()) {
            message.warning("请输入视频描述");
            return;
        }
        if (capabilities.requireImageReference && imageReferences.length === 0) {
            message.warning("当前视频模型必须添加参考图");
            return;
        }
        setIsGenerating(true);
        try {
            const runtimeConfig = { ...config, model: selectedModel, videoModel: selectedModel, size: ratio, vquality: quality, videoSeconds: String(duration) };
            const blob = await requestVideoGeneration(runtimeConfig, prompt.trim(), imageReferences, mediaReferences);
            const stored = await uploadMediaFile(blob, "video-workbench");
            const item: VideoHistoryItem = { id: newID(), prompt: prompt.trim(), url: stored.url, storageKey: stored.storageKey, createdAt: Date.now() };
            setResultUrl(stored.url);
            setHistory((current) => {
                const next = [item, ...current].slice(0, 30);
                writeVideoHistory(next);
                return next;
            });
            message.success("视频生成完成");
        } catch (error) {
            message.error(error instanceof Error ? error.message : "生成失败");
        } finally {
            setIsGenerating(false);
        }
    };

    const handleDownload = (url = resultUrl, name = "video.mp4") => {
        if (!url) return;
        const link = document.createElement("a");
        link.href = url;
        link.download = name.endsWith(".mp4") ? name : `${name}.mp4`;
        document.body.appendChild(link);
        link.click();
        link.remove();
    };

    const removeHistory = (id: string) => {
        setHistory((current) => {
            const item = current.find((entry) => entry.id === id);
            if (item) void deleteStoredMedia([item.storageKey]);
            const next = current.filter((entry) => entry.id !== id);
            writeVideoHistory(next);
            if (item?.url === resultUrl) setResultUrl(next[0]?.url || "");
            return next;
        });
    };

    return (
        <main className="h-full overflow-auto bg-background text-stone-950 dark:text-stone-100">
            <div className="mx-auto flex w-full max-w-[1600px] flex-col gap-5 px-6 py-6">
                <header className="flex flex-wrap items-center justify-between gap-3 border-b border-stone-200 pb-4 dark:border-stone-800">
                    <Typography.Title level={3} className="!mb-1">
                        视频工作台
                    </Typography.Title>
                    <Space wrap>
                        <Tag color="purple">{capabilities.market}</Tag>
                        <Tag>{capabilities.ratios.length} 个比例</Tag>
                        <Tag>{capabilities.qualities.join(" / ")}</Tag>
                        <Tag>{capabilities.durations.map((value) => `${value}s`).join(" / ")}</Tag>
                    </Space>
                </header>

                <div className="grid gap-5 lg:grid-cols-[420px_minmax(0,1fr)] xl:grid-cols-[440px_minmax(0,1fr)_300px]">
                    <Card className="border-stone-200 dark:border-stone-800" styles={{ body: { padding: 18 } }}>
                        <Space direction="vertical" size={18} className="w-full">
                            <SectionTitle icon={<Film className="size-4" />} title="视频模型" />
                            <SelectModel value={selectedModel} models={videoModels} onChange={handleModelChange} />

                            <ControlBlock title="画面比例">
                                <Radio.Group value={ratio} onChange={(event) => setRatio(event.target.value)} optionType="button" buttonStyle="solid" className="w-full">
                                    {capabilities.ratios.map((item) => (
                                        <Radio.Button key={item} value={item}>
                                            {item}
                                        </Radio.Button>
                                    ))}
                                </Radio.Group>
                            </ControlBlock>

                            <ControlBlock title="画质">
                                <Segmented value={quality} onChange={(value) => setQuality(String(value))} options={VIDEO_QUALITY_OPTIONS.filter((item) => capabilities.qualities.includes(item.value))} block />
                            </ControlBlock>

                            <ControlBlock title={`时长 ${duration}s`} icon={<Clock3 className="size-4" />}>
                                <Slider min={Math.min(...capabilities.durations)} max={Math.max(...capabilities.durations)} step={null} marks={Object.fromEntries(capabilities.durations.map((item) => [item, `${item}s`]))} value={duration} onChange={setDuration} />
                            </ControlBlock>

                            {hasReferenceInputs ? (
                                <ControlBlock title="参考素材">
                                    {capabilities.referenceImageLimit > 0 ? (
                                        <ReferenceRow icon={<ImageIcon className="size-4" />} title="参考图" limit={capabilities.referenceImageLimit} count={imageReferences.length} value={imageUrl} placeholder="HTTPS 图片 URL" accept="image/*" onValueChange={setImageUrl} onAdd={addImageUrl} onUpload={(file) => uploadImage(file).catch((error) => message.error(error instanceof Error ? error.message : "上传失败"))} />
                                    ) : null}
                                    {capabilities.referenceVideoLimit > 0 ? (
                                        <ReferenceRow icon={<Video className="size-4" />} title="参考视频" limit={capabilities.referenceVideoLimit} count={mediaReferences.filter((item) => item.type === "video").length} value={videoUrlInput} placeholder="HTTPS 视频 URL" accept="video/*" extra={`总时长建议不超过 ${capabilities.referenceVideoMaxSeconds}s`} onValueChange={setVideoUrlInput} onAdd={() => addMediaUrl("video", videoUrlInput, setVideoUrlInput)} onUpload={(file) => uploadMedia("video", file).catch((error) => message.error(error instanceof Error ? error.message : "上传失败"))} />
                                    ) : null}
                                    {capabilities.referenceAudioLimit > 0 ? (
                                        <ReferenceRow icon={<Music2 className="size-4" />} title="参考音频" limit={capabilities.referenceAudioLimit} count={mediaReferences.filter((item) => item.type === "audio").length} value={audioUrlInput} placeholder="HTTPS 音频 URL" accept="audio/*" onValueChange={setAudioUrlInput} onAdd={() => addMediaUrl("audio", audioUrlInput, setAudioUrlInput)} onUpload={(file) => uploadMedia("audio", file).catch((error) => message.error(error instanceof Error ? error.message : "上传失败"))} />
                                    ) : null}
                                    <MaterialTags images={imageReferences} media={mediaReferences} onRemoveImage={(id) => setImageReferences((current) => current.filter((item) => item.id !== id))} onRemoveMedia={(url) => setMediaReferences((current) => current.filter((item) => item.url !== url))} />
                                </ControlBlock>
                            ) : null}

                            <ControlBlock title="视频描述">
                                <Input.TextArea value={prompt} onChange={(event) => setPrompt(event.target.value)} placeholder="描述镜头、主体、动作、场景和风格" rows={7} className="resize-none" />
                            </ControlBlock>

                            <Button type="primary" size="large" block icon={<PlayCircleOutlined />} loading={isGenerating} onClick={handleGenerate} className="h-12 text-base font-medium">
                                生成视频
                            </Button>
                        </Space>
                    </Card>

                    <section className="relative flex min-h-[640px] items-center justify-center rounded-lg border border-stone-200 bg-stone-50 p-4 dark:border-stone-800 dark:bg-stone-900">
                        {resultUrl ? (
                            <>
                                <video src={resultUrl} controls className="max-h-[720px] max-w-full rounded-lg bg-black shadow-lg" />
                                <Button type="primary" icon={<DownloadOutlined />} className="absolute bottom-4 right-4" onClick={() => handleDownload()}>
                                    下载视频
                                </Button>
                            </>
                        ) : (
                            <Empty image={<Video className="mx-auto size-16 text-stone-300 dark:text-stone-700" />} description="生成结果会显示在这里" />
                        )}
                    </section>

                    <VideoHistoryPanel history={history} onPreview={(item) => setResultUrl(item.url)} onDownload={(item) => handleDownload(item.url, `video-${item.createdAt}.mp4`)} onDelete={removeHistory} />
                </div>
            </div>
        </main>
    );
}

function SelectModel({ value, models, onChange }: { value: string; models: string[]; onChange: (value: string) => void }) {
    return <Segmented value={value} onChange={(next) => onChange(String(next))} options={models.map((model) => ({ label: model, value: model }))} block />;
}

function SectionTitle({ icon, title }: { icon: ReactNode; title: string }) {
    return (
        <div className="flex items-center gap-2 text-sm font-semibold">
            {icon}
            {title}
        </div>
    );
}

function ControlBlock({ title, icon, children }: { title: string; icon?: ReactNode; children: ReactNode }) {
    return (
        <div className="space-y-2.5">
            <div className="flex items-center gap-2 text-sm font-medium text-stone-700 dark:text-stone-200">
                {icon}
                {title}
            </div>
            {children}
        </div>
    );
}

function ReferenceRow({ icon, title, limit, count, value, placeholder, accept, disabled, extra, onValueChange, onAdd, onUpload }: { icon: ReactNode; title: string; limit: number; count: number; value: string; placeholder: string; accept: string; disabled?: boolean; extra?: string; onValueChange: (value: string) => void; onAdd: () => void; onUpload: (file: File) => Promise<void> }) {
    return (
        <div className="rounded-lg border border-stone-200 p-3 dark:border-stone-800">
            <div className="mb-2 flex items-center justify-between gap-2">
                <div className="flex items-center gap-2 text-sm font-medium">
                    {icon}
                    {title}
                </div>
                <Typography.Text type="secondary" className="text-xs">
                    {count}/{limit}
                </Typography.Text>
            </div>
            <div className="flex gap-2">
                <Input value={value} disabled={disabled} placeholder={placeholder} prefix={<LinkOutlined />} onChange={(event) => onValueChange(event.target.value)} />
                <Button disabled={disabled} onClick={onAdd}>
                    添加
                </Button>
                <Upload
                    showUploadList={false}
                    accept={accept}
                    disabled={disabled}
                    beforeUpload={(file) => {
                        void onUpload(file);
                        return Upload.LIST_IGNORE;
                    }}
                >
                    <Button disabled={disabled} icon={<CloudUploadOutlined />}>
                        上传
                    </Button>
                </Upload>
            </div>
            {extra ? (
                <Typography.Text type="secondary" className="mt-1 block text-xs">
                    {extra}
                </Typography.Text>
            ) : null}
        </div>
    );
}

function MaterialTags({ images, media, onRemoveImage, onRemoveMedia }: { images: ReferenceImage[]; media: VideoReferenceMaterial[]; onRemoveImage: (id: string) => void; onRemoveMedia: (url: string) => void }) {
    if (!images.length && !media.length) return null;
    const videos = media.filter((item) => item.type === "video");
    const audios = media.filter((item) => item.type === "audio");
    return (
        <div className="flex flex-wrap gap-1.5">
            {images.map((item, index) => (
                <Tag key={item.id} closable onClose={() => onRemoveImage(item.id)}>
                    图{index + 1}
                </Tag>
            ))}
            {videos.map((item, index) => (
                <Tag key={item.url} closable onClose={() => onRemoveMedia(item.url)}>
                    视频{index + 1}
                </Tag>
            ))}
            {audios.map((item, index) => (
                <Tag key={item.url} closable onClose={() => onRemoveMedia(item.url)}>
                    音频{index + 1}
                </Tag>
            ))}
        </div>
    );
}

function VideoHistoryPanel({ history, onPreview, onDownload, onDelete }: { history: VideoHistoryItem[]; onPreview: (item: VideoHistoryItem) => void; onDownload: (item: VideoHistoryItem) => void; onDelete: (id: string) => void }) {
    return (
        <Card className="border-stone-200 dark:border-stone-800 lg:col-span-2 xl:col-span-1" styles={{ body: { padding: 16 } }}>
            <div className="mb-3 flex items-center justify-between">
                <Typography.Text className="font-medium">视频生成记录</Typography.Text>
                <Tag>{history.length}</Tag>
            </div>
            {history.length ? (
                <div className="space-y-3">
                    {history.map((item) => (
                        <div key={item.id} className="rounded-lg border border-stone-200 p-2 dark:border-stone-800">
                            <Typography.Paragraph ellipsis={{ rows: 2 }} className="!mb-2 text-xs">
                                {item.prompt || "未填写提示词"}
                            </Typography.Paragraph>
                            <div className="flex gap-2">
                                <Button size="small" icon={<PlayCircleOutlined />} onClick={() => onPreview(item)}>
                                    预览
                                </Button>
                                <Button size="small" icon={<DownloadOutlined />} onClick={() => onDownload(item)}>
                                    下载
                                </Button>
                                <Button size="small" danger icon={<DeleteOutlined />} onClick={() => onDelete(item.id)} />
                            </div>
                        </div>
                    ))}
                </div>
            ) : (
                <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无生成记录" />
            )}
        </Card>
    );
}

function isRemoteUrl(value: string) {
    return /^https:\/\//i.test(value.trim());
}

function newID() {
    return typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function readVideoHistory(): VideoHistoryItem[] {
    if (typeof window === "undefined") return [];
    try {
        return (JSON.parse(window.localStorage.getItem(VIDEO_HISTORY_KEY) || "[]") as VideoHistoryItem[]).filter((item) => item.id && item.storageKey);
    } catch {
        return [];
    }
}

function writeVideoHistory(items: VideoHistoryItem[]) {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(VIDEO_HISTORY_KEY, JSON.stringify(items.map((item) => ({ ...item, url: "" }))));
}
