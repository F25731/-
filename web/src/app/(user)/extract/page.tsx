"use client";

import { useMemo, useRef, useState } from "react";
import { App, Button, Input, Spin } from "antd";
import { Copy, ImagePlus, LoaderCircle, Sparkles, Upload, X } from "lucide-react";
import { useRouter } from "next/navigation";

import { requestImageQuestion, type ChatCompletionMessage } from "@/services/api/image";
import { useCopyText } from "@/hooks/use-copy-text";
import { useEffectiveConfig } from "@/stores/use-config-store";
import { useUserStore } from "@/stores/use-user-store";

const EXTRACT_MODEL = "gpt-5.5";

export default function ExtractPromptPage() {
    const { message } = App.useApp();
    const copyText = useCopyText();
    const config = useEffectiveConfig();
    const router = useRouter();
    const token = useUserStore((state) => state.token);
    const user = useUserStore((state) => state.user);
    const authMode = useUserStore((state) => state.authMode);
    const apiKeys = useUserStore((state) => state.apiKeys);
    const inputRef = useRef<HTMLInputElement>(null);
    const [image, setImage] = useState<{ name: string; dataUrl: string } | null>(null);
    const [result, setResult] = useState("");
    const [extra, setExtra] = useState("");
    const [loading, setLoading] = useState(false);

    const oneKApiKey = apiKeys["1k"]?.trim() || "";
    const requestConfig = useMemo(() => ({ ...config, apiKey: oneKApiKey, imageTier: "1k" as const, model: EXTRACT_MODEL, textModel: EXTRACT_MODEL }), [config, oneKApiKey]);
    const isKeyLoggedIn = Boolean(token && user && authMode === "pool");
    const hasImageCredits = Boolean(user?.unlimited || Number(user?.remaining ?? user?.credits ?? 0) > 0);

    const pickImage = () => inputRef.current?.click();

    const handleFile = async (file: File | undefined) => {
        if (!file) return;
        if (!file.type.startsWith("image/")) {
            message.warning("请选择图片文件");
            return;
        }
        setResult("");
        setImage({ name: file.name, dataUrl: await readFileAsDataUrl(file) });
    };

    const extract = async () => {
        if (!image || loading) return;
        if (!isKeyLoggedIn) {
            message.warning("请先使用号池 Key 登录");
            router.push("/login?redirect=/extract");
            return;
        }
        if (!oneKApiKey) {
            message.warning("\u8bf7\u586b\u5199 1k API Key \u540e\u518d\u4f7f\u7528");
            router.push("/login?redirect=/extract");
            return;
        }
        if (!hasImageCredits) {
            message.warning("生图额度不足，请充值额度后再使用");
            return;
        }
        setLoading(true);
        setResult("");
        try {
            const messages: ChatCompletionMessage[] = [
                {
                    role: "user",
                    content: [
                        {
                            type: "text",
                            text: [
                                "请根据这张图片提取一份适合 AI 生图/改图使用的中文提示词。",
                                "要求：",
                                "1. 只输出提示词正文，不要解释分析过程。",
                                "2. 描述主体、材质、颜色、构图、背景、光线、镜头、风格、质感和细节。",
                                "3. 如果图片是商品图，请保留商品核心特征，写成可复现的商业摄影提示词。",
                                "4. 不要编造图片里不存在的品牌、文字、人物身份或敏感信息。",
                                extra.trim() ? `用户补充要求：${extra.trim()}` : "",
                            ]
                                .filter(Boolean)
                                .join("\n"),
                        },
                        { type: "image_url", image_url: { url: image.dataUrl } },
                    ],
                },
            ];
            const answer = await requestImageQuestion(requestConfig, messages, setResult);
            setResult(answer);
            message.success("提示词提取完成");
        } catch (error) {
            message.error(error instanceof Error ? error.message : "提取失败");
        } finally {
            setLoading(false);
        }
    };

    const copyResult = async () => {
        if (!result.trim()) return;
        copyText(result.trim(), "提示词已复制");
    };

    return (
        <main className="min-h-full bg-background bg-[radial-gradient(#e5e7eb_1px,transparent_1px)] px-6 py-8 text-stone-950 [background-size:16px_16px] dark:bg-[radial-gradient(rgba(245,245,244,.16)_1px,transparent_1px)] dark:text-stone-100">
            <section className="mx-auto grid max-w-7xl gap-5 lg:grid-cols-[420px_minmax(0,1fr)]">
                <div className="min-w-0">
                    <h1 className="text-3xl font-semibold tracking-normal">提取提示词</h1>
                    <p className="mt-2 text-sm leading-6 text-stone-500 dark:text-stone-400">上传图片后，系统会自动读取画面并生成可直接用于生图或改图的提示词。</p>
                    <p className="mt-1 text-xs leading-5 text-stone-400 dark:text-stone-500">需要有可用生图额度，提取本身不消耗额度。</p>
                </div>
                <div className="hidden lg:block" />

                <section className="rounded-lg border border-stone-200 bg-card p-4 shadow-sm dark:border-stone-800">
                    <input ref={inputRef} type="file" accept="image/*" className="hidden" onChange={(event) => void handleFile(event.target.files?.[0])} />
                    <button
                        type="button"
                        className="flex aspect-[4/3] w-full items-center justify-center overflow-hidden rounded-lg border border-dashed border-stone-300 bg-background text-left transition hover:bg-stone-50 dark:border-stone-700 dark:hover:bg-stone-900"
                        onClick={pickImage}
                    >
                        {image ? (
                            <img src={image.dataUrl} alt={image.name} className="h-full w-full object-contain" />
                        ) : (
                            <span className="flex flex-col items-center gap-3 text-stone-500 dark:text-stone-400">
                                <ImagePlus className="size-10" />
                                <span className="text-sm">上传需要提取提示词的图片</span>
                            </span>
                        )}
                    </button>

                    {image ? (
                        <div className="mt-3 flex min-w-0 items-center justify-between gap-3">
                            <div className="min-w-0 truncate text-sm text-stone-500 dark:text-stone-400">{image.name}</div>
                            <Button size="small" icon={<X className="size-3.5" />} onClick={() => setImage(null)}>
                                移除
                            </Button>
                        </div>
                    ) : null}

                    <Input.TextArea className="mt-4 !min-h-24 !resize-none" value={extra} onChange={(event) => setExtra(event.target.value)} placeholder="可选：补充提取方向，比如更偏电商主图、详情页、服装模特图" />

                    <div className="mt-4 flex gap-2">
                        <Button className="!h-10 flex-1" icon={<Upload className="size-4" />} onClick={pickImage}>
                            选择图片
                        </Button>
                        <Button type="primary" className="!h-10 flex-1" disabled={!image || loading} icon={loading ? <LoaderCircle className="size-4 animate-spin" /> : <Sparkles className="size-4" />} onClick={() => void extract()}>
                            {!isKeyLoggedIn ? "登录后提取" : hasImageCredits ? "开始提取" : "额度不足"}
                        </Button>
                    </div>
                </section>

                <section className="flex min-h-[520px] flex-col rounded-lg border border-stone-200 bg-card p-4 shadow-sm dark:border-stone-800">
                    <div className="mb-3 flex items-center justify-between gap-3">
                        <h2 className="text-lg font-semibold">提示词结果</h2>
                        <Button icon={<Copy className="size-4" />} disabled={!result.trim()} onClick={() => void copyResult()}>
                            复制
                        </Button>
                    </div>

                    <div className="thin-scrollbar min-h-0 flex-1 overflow-auto rounded-lg border border-stone-200 bg-background p-4 text-sm leading-7 dark:border-stone-800">
                        {loading && !result ? (
                            <div className="flex h-full min-h-[360px] items-center justify-center text-stone-500">
                                <Spin />
                            </div>
                        ) : result ? (
                            <pre className="whitespace-pre-wrap break-words font-sans">{result}</pre>
                        ) : (
                            <div className="flex h-full min-h-[360px] items-center justify-center text-center text-sm text-stone-500 dark:text-stone-400">上传图片后点击开始提取</div>
                        )}
                    </div>
                </section>
            </section>
        </main>
    );
}

function readFileAsDataUrl(file: File) {
    return new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result || ""));
        reader.onerror = () => reject(reader.error || new Error("读取图片失败"));
        reader.readAsDataURL(file);
    });
}
