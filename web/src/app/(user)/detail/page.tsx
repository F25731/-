"use client";

import { useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { App, Button, Input, InputNumber, Modal, Select, Space, Tag } from "antd";
import { Download, ImagePlus, LoaderCircle, RefreshCw, Settings2, Sparkles, Wand2, X } from "lucide-react";

import { ImageSettingsPanel } from "@/components/image-settings-panel";
import { ModelPicker } from "@/components/model-picker";
import { fetchPublicModels, type AdminModel } from "@/services/api/admin";
import { requestEdit, requestGeneration } from "@/services/api/image";
import { imageToDataUrl, uploadImage } from "@/services/image-storage";
import { canvasThemes } from "@/lib/canvas-theme";
import { cn } from "@/lib/utils";
import { defaultImageTierForModel, imageReferenceLimit, normalizeImageSizeForModel, normalizeImageTierForModel, useConfigStore, useEffectiveConfig, type AiConfig } from "@/stores/use-config-store";
import { useThemeStore } from "@/stores/use-theme-store";
import type { ReferenceImage } from "@/types/image";

type DetailReference = ReferenceImage & {
    url: string;
    storageKey: string;
};

type DetailPlanScreen = {
    index: number;
    title: string;
    goal: string;
    prompt: string;
};

type DetailPlan = {
    styleSummary: string;
    screens: DetailPlanScreen[];
};

type DetailScreen = DetailPlanScreen & {
    imageUrl?: string;
    storageKey?: string;
    status: "not_started" | "generating" | "ready" | "failed";
    error?: string;
};

type DetailLlmKeys = Record<string, string>;

const DETAIL_LLM_KEYS_KEY = "detail-workbench:llm-keys";
const DEFAULT_SCREEN_COUNT = 6;

export default function DetailWorkbenchPage() {
    const { message } = App.useApp();
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    const effectiveConfig = useEffectiveConfig();
    const updateConfig = useConfigStore((state) => state.updateConfig);
    const openConfigDialog = useConfigStore((state) => state.openConfigDialog);
    const isAiConfigReady = useConfigStore((state) => state.isAiConfigReady);

    const [llmModels, setLlmModels] = useState<AdminModel[]>([]);
    const [llmKeys, setLlmKeys] = useState<DetailLlmKeys>({});
    const [selectedLlmId, setSelectedLlmId] = useState("");
    const [settingsOpen, setSettingsOpen] = useState(false);
    const [references, setReferences] = useState<DetailReference[]>([]);
    const [productInfo, setProductInfo] = useState("");
    const [styleRequest, setStyleRequest] = useState("");
    const [platform, setPlatform] = useState("淘宝");
    const [screenCount, setScreenCount] = useState(DEFAULT_SCREEN_COUNT);
    const [plan, setPlan] = useState<DetailPlan | null>(null);
    const [screens, setScreens] = useState<DetailScreen[]>([]);
    const [currentIndex, setCurrentIndex] = useState(1);
    const [feedback, setFeedback] = useState("");
    const [isRunning, setIsRunning] = useState(false);
    const [statusText, setStatusText] = useState("");

    const currentScreen = screens.find((screen) => screen.index === currentIndex) || null;
    const generatedScreens = screens.filter((screen) => screen.imageUrl);
    const selectedLlm = llmModels.find((model) => model.id === selectedLlmId) || llmModels[0] || null;
    const selectedLlmKey = selectedLlm ? llmKeys[selectedLlm.id]?.trim() || "" : "";
    const imageConfig = useMemo(() => ({ ...effectiveConfig, model: effectiveConfig.imageModel || effectiveConfig.model, count: "1" }), [effectiveConfig]);

    useEffect(() => {
        void loadLlmModels();
        loadLlmKeys();
    }, []);

    useEffect(() => {
        if (!selectedLlmId && llmModels.length) setSelectedLlmId(llmModels[0].id);
    }, [llmModels, selectedLlmId]);

    const loadLlmModels = async () => {
        try {
            const models = await fetchPublicModels();
            setLlmModels(models.filter((model) => model.enabled && model.type === "prompt"));
        } catch {
            message.error("加载 LLM 配置失败");
        }
    };

    const loadLlmKeys = () => {
        try {
            setLlmKeys(JSON.parse(localStorage.getItem(DETAIL_LLM_KEYS_KEY) || "{}") as DetailLlmKeys);
        } catch {
            setLlmKeys({});
        }
    };

    const saveLlmKeys = () => {
        const cleaned = Object.fromEntries(Object.entries(llmKeys).map(([id, value]) => [id, value.trim()]).filter(([, value]) => value));
        localStorage.setItem(DETAIL_LLM_KEYS_KEY, JSON.stringify(cleaned));
        setLlmKeys(cleaned);
        setSettingsOpen(false);
        message.success("详情图 LLM Key 已保存");
    };

    const handleReferenceFiles = async (files: FileList | null) => {
        if (!files?.length) return;
        const next = await Promise.all(
            Array.from(files)
                .filter((file) => file.type.startsWith("image/"))
                .map(async (file) => {
                    const uploaded = await uploadImage(file);
                    return {
                        id: uploaded.storageKey,
                        name: file.name || "reference.png",
                        type: uploaded.mimeType,
                        dataUrl: uploaded.url,
                        url: uploaded.url,
                        storageKey: uploaded.storageKey,
                    };
                }),
        );
        setReferences((items) => [...items, ...next]);
    };

    const startDesign = async () => {
        if (!selectedLlm) {
            setSettingsOpen(true);
            message.warning("请先在后台配置 ChatGPT 或 Claude 提示词模型");
            return;
        }
        if (!selectedLlmKey) {
            setSettingsOpen(true);
            message.warning("请先填写当前 LLM 的 API Key");
            return;
        }
        if (!productInfo.trim()) {
            message.warning("请先输入商品信息和需求");
            return;
        }
        if (!isAiConfigReady(imageConfig, imageConfig.model)) {
            openConfigDialog(true);
            return;
        }

        setIsRunning(true);
        setStatusText("正在生成整套详情图设计方案");
        try {
            const nextPlan = await createDetailPlan();
            const normalizedScreens = nextPlan.screens.slice(0, screenCount).map((screen) => ({ ...screen, status: "not_started" as const }));
            setPlan({ ...nextPlan, screens: normalizedScreens });
            setScreens(normalizedScreens);
            setCurrentIndex(1);
            setFeedback("");
            await generateScreen(1, normalizedScreens, nextPlan);
            message.success("第一屏已生成");
        } catch (error) {
            message.error(error instanceof Error ? error.message : "生成失败");
        } finally {
            setIsRunning(false);
            setStatusText("");
        }
    };

    const createDetailPlan = async () => {
        const content = await requestDetailLlm([
            {
                role: "user",
                content: [
                    {
                        type: "text",
                        text: buildPlanPrompt({ productInfo, styleRequest, platform, screenCount }),
                    },
                    ...(await referenceMessageParts(references)),
                ],
            },
        ]);
        return normalizePlan(parsePlan(content), screenCount);
    };

    const modifyCurrentScreen = async () => {
        if (!currentScreen || !plan) return;
        if (!feedback.trim()) {
            message.warning("请先填写修改建议");
            return;
        }
        if (!selectedLlm || !selectedLlmKey) {
            setSettingsOpen(true);
            message.warning("请先填写 LLM API Key");
            return;
        }

        setIsRunning(true);
        try {
            if (currentScreen.index === 1) {
                setStatusText("正在根据修改建议调整整体设计和第一屏");
                const content = await requestDetailLlm([
                    {
                        role: "user",
                        content: buildFirstScreenRevisionPrompt(plan, feedback),
                    },
                ]);
                const nextPlan = normalizePlan(parsePlan(content), screenCount);
                const nextScreens = nextPlan.screens.map((screen) => {
                    const old = screens.find((item) => item.index === screen.index);
                    return {
                        ...screen,
                        imageUrl: screen.index === 1 ? undefined : old?.imageUrl,
                        storageKey: screen.index === 1 ? undefined : old?.storageKey,
                        status: screen.index === 1 ? ("not_started" as const) : old?.status || ("not_started" as const),
                    };
                });
                setPlan(nextPlan);
                setScreens(nextScreens);
                await generateScreen(1, nextScreens, nextPlan);
            } else {
                setStatusText(`正在局部改写第 ${currentScreen.index} 屏提示词`);
                const prompt = await requestDetailLlm([{ role: "user", content: buildScreenRevisionPrompt(plan, currentScreen, feedback) }]);
                const nextScreens = screens.map((screen) => (screen.index === currentScreen.index ? { ...screen, prompt: cleanPromptText(prompt), imageUrl: undefined, storageKey: undefined, status: "not_started" as const } : screen));
                setScreens(nextScreens);
                await generateScreen(currentScreen.index, nextScreens, plan);
            }
            setFeedback("");
            message.success("已按修改建议重新生成");
        } catch (error) {
            message.error(error instanceof Error ? error.message : "修改失败");
        } finally {
            setIsRunning(false);
            setStatusText("");
        }
    };

    const generateNextScreen = async () => {
        if (!plan || !currentScreen) return;
        const nextIndex = currentScreen.index + 1;
        if (nextIndex > plan.screens.length) {
            message.success("所有屏幕已生成");
            return;
        }
        setIsRunning(true);
        setStatusText(`正在生成第 ${nextIndex} 屏`);
        try {
            setCurrentIndex(nextIndex);
            await generateScreen(nextIndex, screens, plan);
        } catch (error) {
            message.error(error instanceof Error ? error.message : "生成失败");
        } finally {
            setIsRunning(false);
            setStatusText("");
        }
    };

    const regenerateCurrent = async () => {
        if (!plan || !currentScreen) return;
        setIsRunning(true);
        setStatusText(`正在重新生成第 ${currentScreen.index} 屏`);
        try {
            await generateScreen(currentScreen.index, screens, plan);
        } catch (error) {
            message.error(error instanceof Error ? error.message : "重新生成失败");
        } finally {
            setIsRunning(false);
            setStatusText("");
        }
    };

    const generateScreen = async (index: number, sourceScreens: DetailScreen[], sourcePlan: DetailPlan) => {
        const target = sourceScreens.find((screen) => screen.index === index);
        if (!target) throw new Error("未找到当前屏提示词");
        setScreens((items) => patchScreen(items.length ? items : sourceScreens, index, { status: "generating", error: undefined }));
        const refs = await buildGenerationReferences(index, sourceScreens);
        const prompt = buildImagePrompt(sourcePlan, target, index);
        const images = refs.length ? await requestEdit(imageConfig, prompt, refs) : await requestGeneration(imageConfig, prompt);
        const uploaded = await uploadImage(images[0].dataUrl);
        setScreens((items) =>
            patchScreen(items.length ? items : sourceScreens, index, {
                imageUrl: uploaded.url,
                storageKey: uploaded.storageKey,
                status: "ready",
                error: undefined,
            }),
        );
    };

    const buildGenerationReferences = async (index: number, sourceScreens: DetailScreen[]) => {
        const limit = imageReferenceLimit(imageConfig, imageConfig.model);
        if (index === 1) return hydrateReferences(references.slice(0, limit));
        const first = sourceScreens.find((screen) => screen.index === 1 && screen.imageUrl && screen.storageKey);
        const previous = sourceScreens.find((screen) => screen.index === index - 1 && screen.imageUrl && screen.storageKey);
        const anchors: DetailReference[] = [first, previous]
            .filter((screen): screen is DetailScreen & { imageUrl: string; storageKey: string } => Boolean(screen))
            .map((screen) => ({
                id: `screen-${screen.index}`,
                name: `screen-${screen.index}.png`,
                type: "image/png",
                dataUrl: screen.imageUrl,
                url: screen.imageUrl,
                storageKey: screen.storageKey,
            }));
        return hydrateReferences(uniqueReferences([...anchors, ...references]).slice(0, limit));
    };

    const hydrateReferences = async (items: DetailReference[]) => {
        return Promise.all(items.map(async (item) => ({ ...item, dataUrl: await imageToDataUrl(item) })));
    };

    const requestDetailLlm = async (messages: unknown[]) => {
        if (!selectedLlm) throw new Error("未选择 LLM");
        const modelId = selectedLlm.modelId || selectedLlm.name;
        const response = await fetch("/api/detail-llm", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ baseUrl: selectedLlm.apiUrl, apiKey: selectedLlmKey, model: modelId, messages }),
        });
        const payload = (await response.json()) as { code: number; data?: string; msg?: string };
        if (!response.ok || payload.code !== 0 || !payload.data) throw new Error(payload.msg || "LLM 请求失败");
        return payload.data;
    };

    const exportLongImage = async () => {
        const items = generatedScreens;
        if (!items.length) {
            message.warning("还没有可导出的图片");
            return;
        }
        try {
            const blob = await composeLongImage(items.map((screen) => screen.imageUrl!));
            const url = URL.createObjectURL(blob);
            const a = document.createElement("a");
            a.href = url;
            a.download = `detail-page-${Date.now()}.png`;
            a.click();
            URL.revokeObjectURL(url);
        } catch (error) {
            message.error(error instanceof Error ? error.message : "导出失败");
        }
    };

    const setImageModel = (model: string) => {
        updateConfig("imageModel", model);
        updateConfig("model", model);
        updateConfig("imageTier", normalizeImageTierForModel(effectiveConfig, model, defaultImageTierForModel(effectiveConfig, model)) as AiConfig["imageTier"]);
        updateConfig("size", normalizeImageSizeForModel(effectiveConfig, model, effectiveConfig.size || "auto"));
    };

    return (
        <main className="h-full overflow-hidden bg-[#111111] text-stone-100">
            <div className="grid h-full min-h-0 grid-cols-[360px_minmax(420px,1fr)_360px]">
                <aside className="min-h-0 overflow-y-auto border-r border-white/10 bg-[#171717] p-4">
                    <div className="mb-4 flex items-center justify-between gap-3">
                        <div>
                            <div className="text-lg font-semibold">详情图工作台</div>
                            <div className="mt-1 text-xs text-stone-400">一次生成整套提示词，逐屏出图</div>
                        </div>
                        <Button type="text" shape="circle" icon={<Settings2 className="size-4" />} className="!text-stone-200" onClick={() => setSettingsOpen(true)} title="详情图 LLM Key 设置" />
                    </div>

                    <div className="space-y-4">
                        <Panel title="LLM 设计模型">
                            <Select
                                value={selectedLlm?.id}
                                placeholder="选择 ChatGPT / Claude"
                                className="w-full"
                                options={llmModels.map((model) => ({ label: model.name, value: model.id }))}
                                onChange={setSelectedLlmId}
                            />
                            <div className="mt-2 flex flex-wrap gap-1.5">
                                {selectedLlm ? <Tag color={selectedLlmKey ? "success" : "warning"}>{selectedLlmKey ? "Key 已填写" : "未填写 Key"}</Tag> : <Tag>后台未配置 LLM</Tag>}
                                {selectedLlm ? <Tag>{selectedLlm.modelId || selectedLlm.name}</Tag> : null}
                            </div>
                        </Panel>

                        <Panel title="参考图 / 竞品图">
                            <label className="flex min-h-28 cursor-pointer flex-col items-center justify-center rounded-lg border border-dashed border-white/15 bg-white/[0.03] p-4 text-center text-sm text-stone-400 transition hover:border-white/35 hover:text-stone-200">
                                <ImagePlus className="mb-2 size-5" />
                                上传商品图、参考图或竞品图
                                <input type="file" accept="image/*" multiple className="hidden" onChange={(event) => void handleReferenceFiles(event.target.files)} />
                            </label>
                            {references.length ? (
                                <div className="mt-3 grid grid-cols-3 gap-2">
                                    {references.map((item) => (
                                        <div key={item.id} className="group relative aspect-square overflow-hidden rounded-md border border-white/10 bg-black">
                                            <img src={item.url} alt="" className="h-full w-full object-cover" />
                                            <button type="button" className="absolute right-1 top-1 grid size-6 place-items-center rounded-full bg-black/70 opacity-0 transition group-hover:opacity-100" onClick={() => setReferences((list) => list.filter((image) => image.id !== item.id))}>
                                                <X className="size-3.5" />
                                            </button>
                                        </div>
                                    ))}
                                </div>
                            ) : null}
                        </Panel>

                        <Panel title="商品信息与总体要求">
                            <Input.TextArea value={productInfo} onChange={(event) => setProductInfo(event.target.value)} rows={7} placeholder="商品名称、品类、卖点、参数、目标用户、使用场景等" />
                            <Input.TextArea value={styleRequest} onChange={(event) => setStyleRequest(event.target.value)} rows={4} placeholder="风格要求，例如：高端简洁、奶油风、科技感、少文字、适合淘宝详情页" className="mt-3" />
                            <div className="mt-3 grid grid-cols-2 gap-3">
                                <Select value={platform} onChange={setPlatform} options={["淘宝", "拼多多", "京东", "小红书", "亚马逊", "Shopify", "其他"].map((value) => ({ label: value, value }))} />
                                <InputNumber min={1} max={12} value={screenCount} onChange={(value) => setScreenCount(Math.max(1, Math.min(12, Number(value) || DEFAULT_SCREEN_COUNT)))} addonAfter="屏" className="!w-full" />
                            </div>
                        </Panel>

                        <Panel title="生图模型">
                            <ModelPicker config={effectiveConfig} value={effectiveConfig.imageModel || effectiveConfig.model} onChange={setImageModel} onMissingConfig={() => openConfigDialog(true)} type="image" fullWidth />
                            <ImageSettingsPanel config={imageConfig} onConfigChange={updateConfig} theme={theme} showTitle={false} maxCount={1} quickCount={1} className="mt-3 space-y-4" />
                        </Panel>

                        <Button type="primary" size="large" block icon={isRunning ? <LoaderCircle className="size-4 animate-spin" /> : <Sparkles className="size-4" />} disabled={isRunning} onClick={() => void startDesign()}>
                            开始设计并生成第一屏
                        </Button>
                        {statusText ? <div className="rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2 text-xs text-stone-300">{statusText}</div> : null}
                    </div>
                </aside>

                <section className="min-h-0 overflow-y-auto bg-[#101010] p-5">
                    <div className="mx-auto flex max-w-3xl flex-col gap-4">
                        <div className="flex items-center justify-between gap-3">
                            <div>
                                <div className="text-lg font-semibold">{currentScreen ? `第 ${currentScreen.index} 屏：${currentScreen.title}` : "当前屏"}</div>
                                <div className="mt-1 text-xs text-stone-400">{currentScreen?.goal || "左侧输入商品信息后，系统会直接生成第一屏"}</div>
                            </div>
                            {currentScreen?.status ? <Tag color={currentScreen.status === "ready" ? "success" : currentScreen.status === "generating" ? "processing" : currentScreen.status === "failed" ? "error" : "default"}>{screenStatusLabel(currentScreen.status)}</Tag> : null}
                        </div>

                        <div className="grid min-h-[560px] place-items-center overflow-hidden rounded-lg border border-white/10 bg-black/40">
                            {currentScreen?.status === "generating" ? (
                                <div className="flex flex-col items-center gap-3 text-stone-400">
                                    <LoaderCircle className="size-8 animate-spin" />
                                    正在生成图片
                                </div>
                            ) : currentScreen?.imageUrl ? (
                                <img src={currentScreen.imageUrl} alt="" className="max-h-[75vh] w-auto max-w-full object-contain" />
                            ) : (
                                <div className="text-center text-sm text-stone-500">
                                    <Wand2 className="mx-auto mb-3 size-8 opacity-60" />
                                    等待生成第一屏
                                </div>
                            )}
                        </div>

                        <div className="rounded-lg border border-white/10 bg-[#171717] p-3">
                            <Input.TextArea value={feedback} onChange={(event) => setFeedback(event.target.value)} rows={3} placeholder={currentScreen?.index === 1 ? "输入对第一屏的修改建议。系统会调整整体设计方案并重新生成第一屏。" : "输入对当前屏的局部修改建议。系统只改写当前屏提示词并重新生成。"} />
                            <div className="mt-3 flex flex-wrap justify-between gap-2">
                                <Space wrap>
                                    <Button icon={<RefreshCw className="size-4" />} disabled={!currentScreen || isRunning} onClick={() => void regenerateCurrent()}>
                                        重新生成
                                    </Button>
                                    <Button type="primary" icon={<Wand2 className="size-4" />} disabled={!currentScreen || isRunning || !feedback.trim()} onClick={() => void modifyCurrentScreen()}>
                                        按建议修改
                                    </Button>
                                </Space>
                                <Button type="primary" disabled={!currentScreen?.imageUrl || isRunning || !plan || currentScreen.index >= plan.screens.length} onClick={() => void generateNextScreen()}>
                                    生成下一张
                                </Button>
                            </div>
                        </div>
                    </div>
                </section>

                <aside className="min-h-0 overflow-y-auto border-l border-white/10 bg-[#171717] p-4">
                    <div className="mb-3 flex items-center justify-between gap-3">
                        <div>
                            <div className="font-semibold">实时长图预览</div>
                            <div className="mt-1 text-xs text-stone-400">{generatedScreens.length ? `${generatedScreens.length} 屏已生成` : "生成后自动拼接"}</div>
                        </div>
                        <Button size="small" icon={<Download className="size-4" />} disabled={!generatedScreens.length} onClick={() => void exportLongImage()}>
                            导出
                        </Button>
                    </div>
                    <div className="overflow-hidden rounded-md border border-white/10 bg-black">
                        {generatedScreens.length ? (
                            generatedScreens.map((screen) => (
                                <button key={screen.index} type="button" className={cn("block w-full cursor-pointer border-0 bg-transparent p-0", screen.index === currentIndex && "ring-2 ring-inset ring-white/80")} onClick={() => setCurrentIndex(screen.index)}>
                                    <img src={screen.imageUrl} alt="" className="block w-full border-0 p-0" style={{ margin: 0 }} />
                                </button>
                            ))
                        ) : (
                            <div className="grid min-h-96 place-items-center px-6 text-center text-sm text-stone-500">暂无预览</div>
                        )}
                    </div>
                </aside>
            </div>

            <Modal title="详情图 LLM Key 设置" open={settingsOpen} onCancel={() => setSettingsOpen(false)} onOk={saveLlmKeys} okText="保存" cancelText="取消" width={680}>
                <div className="space-y-3">
                    {llmModels.length ? (
                        llmModels.map((model) => (
                            <div key={model.id} className="rounded-lg border border-stone-200 p-3 dark:border-stone-800">
                                <div className="mb-2 flex items-center justify-between gap-3">
                                    <div className="min-w-0">
                                        <div className="truncate font-medium">{model.name}</div>
                                        <div className="truncate text-xs text-stone-500">{model.apiUrl} · {model.modelId || model.name}</div>
                                    </div>
                                    <Tag color={llmKeys[model.id]?.trim() ? "success" : undefined}>{llmKeys[model.id]?.trim() ? "已填写" : "未填写"}</Tag>
                                </div>
                                <Input.Password value={llmKeys[model.id] || ""} onChange={(event) => setLlmKeys({ ...llmKeys, [model.id]: event.target.value })} placeholder="客户自己的 ChatGPT / Claude API Key" />
                            </div>
                        ))
                    ) : (
                        <div className="rounded-lg border border-dashed border-stone-200 px-4 py-8 text-center text-sm text-stone-500 dark:border-stone-800">后台模型管理里还没有启用的提示词模型</div>
                    )}
                </div>
            </Modal>
        </main>
    );
}

function Panel({ title, children }: { title: string; children: ReactNode }) {
    return (
        <section className="rounded-lg border border-white/10 bg-white/[0.035] p-3">
            <div className="mb-2 text-sm font-medium text-stone-200">{title}</div>
            {children}
        </section>
    );
}

function buildPlanPrompt(input: { productInfo: string; styleRequest: string; platform: string; screenCount: number }) {
    return `
你是资深电商详情页设计总监和 AI 生图提示词工程师。请根据用户资料，一次性规划完整电商详情页长图，并写好每一屏的生图提示词。

要求：
1. 目标平台：${input.platform}
2. 屏数：${input.screenCount}
3. 不展示方案给用户，但系统会保存你的 JSON，用于逐屏生成。
4. 第一屏必须是整套详情页风格基调。
5. 后续每一屏都会默认参考第一屏和上一屏，所以提示词要强调上下衔接、无缝拼接、风格继承。
6. 不要虚构用户未提供的认证、销量、功效、专利、检测报告、排名、医师推荐等信息。
7. 图片内中文文字要少而准，参数类信息只能使用用户提供的真实内容。
8. 每屏都是完整竖版详情页模块，不是短海报放在空白长画布中间。

商品信息：
${input.productInfo}

风格和额外要求：
${input.styleRequest || "无"}

只输出严格 JSON，不要 Markdown，不要解释：
{
  "styleSummary": "整套详情页的视觉风格摘要",
  "screens": [
    {
      "index": 1,
      "title": "首屏主视觉",
      "goal": "本屏目的",
      "prompt": "完整生图提示词"
    }
  ]
}
`.trim();
}

function buildImagePrompt(plan: DetailPlan, screen: DetailPlanScreen, index: number) {
    const continuity =
        index === 1
            ? "这是整套详情页的第一屏，必须建立明确的主视觉风格基调。"
            : "这是完整电商详情页中的一屏，将会与第一屏和上一屏上下拼接。必须继承第一屏的整体风格，并让顶部自然承接上一屏底部的颜色、光影、背景氛围；底部保持干净自然，方便下一屏继续衔接。";
    return `
${screen.prompt}

全局风格摘要：
${plan.styleSummary}

衔接要求：
${continuity}
不要添加明显边框、强分割线、页面框线或空白填充。保持商品外观、结构、颜色、包装和品牌视觉特征一致。
`.trim();
}

function buildFirstScreenRevisionPrompt(plan: DetailPlan, feedback: string) {
    return `
你正在维护一套完整电商详情页方案。用户正在修改第一屏。第一屏是整套详情页的风格基调，因此请根据用户修改建议，调整整体风格摘要，并改写第一屏提示词；其他屏幕如受整体风格影响，也同步轻微修正提示词，但不要改变商品真实信息。

当前方案 JSON：
${JSON.stringify(plan, null, 2)}

用户修改建议：
${feedback}

只输出完整严格 JSON，结构保持：
{
  "styleSummary": "...",
  "screens": [{"index":1,"title":"...","goal":"...","prompt":"..."}]
}
`.trim();
}

function buildScreenRevisionPrompt(plan: DetailPlan, screen: DetailPlanScreen, feedback: string) {
    return `
你正在维护一套完整电商详情页方案。用户只想局部修改第 ${screen.index} 屏，请只改写当前屏生图提示词，不要重写整套方案，不要改变第一屏风格基调。

全局风格摘要：
${plan.styleSummary}

当前屏：
${JSON.stringify(screen, null, 2)}

用户修改建议：
${feedback}

只输出改写后的当前屏完整生图提示词，不要解释。
`.trim();
}

async function referenceMessageParts(references: DetailReference[]) {
    return Promise.all(
        references.slice(0, 6).map(async (reference) => ({
            type: "image_url" as const,
            image_url: { url: await imageToDataUrl(reference) },
        })),
    );
}

function parsePlan(content: string): DetailPlan {
    const text = extractJSON(content);
    const parsed = JSON.parse(text) as Partial<DetailPlan>;
    if (!Array.isArray(parsed.screens) || !parsed.screens.length) throw new Error("LLM 返回的分屏方案无效");
    return {
        styleSummary: String(parsed.styleSummary || "").trim(),
        screens: parsed.screens.map((screen, index) => ({
            index: Number(screen.index) || index + 1,
            title: String(screen.title || `第 ${index + 1} 屏`).trim(),
            goal: String(screen.goal || "").trim(),
            prompt: String(screen.prompt || "").trim(),
        })),
    };
}

function normalizePlan(plan: DetailPlan, count: number): DetailPlan {
    const screens = plan.screens.slice(0, count).map((screen, index) => ({
        ...screen,
        index: index + 1,
        title: screen.title || `第 ${index + 1} 屏`,
        prompt: screen.prompt || `${screen.title}，电商详情页竖版设计`,
    }));
    while (screens.length < count) {
        const index = screens.length + 1;
        screens.push({
            index,
            title: `第 ${index} 屏`,
            goal: "补充展示商品卖点",
            prompt: `电商详情页第 ${index} 屏，延续整套风格，展示商品卖点和细节，竖版构图，上下自然衔接。`,
        });
    }
    return { styleSummary: plan.styleSummary || "统一、专业、适合电商详情页的视觉风格", screens };
}

function extractJSON(content: string) {
    const fenced = content.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1];
    const text = (fenced || content).trim();
    const start = text.indexOf("{");
    const end = text.lastIndexOf("}");
    if (start >= 0 && end > start) return text.slice(start, end + 1);
    return text;
}

function cleanPromptText(text: string) {
    return text.replace(/^```[\s\S]*?\n?|\n?```$/g, "").trim();
}

function patchScreen(screens: DetailScreen[], index: number, patch: Partial<DetailScreen>) {
    return screens.map((screen) => (screen.index === index ? { ...screen, ...patch } : screen));
}

function uniqueReferences(references: DetailReference[]) {
    const seen = new Set<string>();
    return references.filter((reference) => {
        const key = reference.storageKey || reference.id;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
    });
}

function screenStatusLabel(status: DetailScreen["status"]) {
    if (status === "generating") return "生成中";
    if (status === "ready") return "已生成";
    if (status === "failed") return "失败";
    return "未生成";
}

async function composeLongImage(urls: string[]) {
    const images = await Promise.all(urls.map(loadImage));
    const width = Math.max(...images.map((image) => image.naturalWidth || image.width));
    const heights = images.map((image) => Math.round(((image.naturalHeight || image.height) * width) / (image.naturalWidth || image.width || width)));
    const height = heights.reduce((sum, value) => sum + value, 0);
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("浏览器不支持长图导出");
    let y = 0;
    images.forEach((image, index) => {
        context.drawImage(image, 0, y, width, heights[index]);
        y += heights[index];
    });
    return new Promise<Blob>((resolve, reject) => canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("长图导出失败"))), "image/png"));
}

function loadImage(url: string) {
    return new Promise<HTMLImageElement>((resolve, reject) => {
        const image = new Image();
        image.onload = () => resolve(image);
        image.onerror = () => reject(new Error("读取预览图片失败"));
        image.src = url;
    });
}
