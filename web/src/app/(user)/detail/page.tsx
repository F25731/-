"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { App, Button, Input, InputNumber, Modal, Select, Space, Tag } from "antd";
import { ChevronDown, ChevronLeft, ChevronRight, Download, LoaderCircle, Plus, RefreshCw, Settings2, Sparkles, Trash2, Wand2, X } from "lucide-react";

import { ImageSettingsPanel } from "@/components/image-settings-panel";
import { ModelPicker } from "@/components/model-picker";
import { fetchPublicModels, type AdminModel } from "@/services/api/admin";
import { requestEdit, requestGeneration } from "@/services/api/image";
import { imageToDataUrl, resolveImageUrl, uploadImage } from "@/services/image-storage";
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

type DetailProject = {
    id: string;
    title: string;
    createdAt: string;
    updatedAt: string;
    references: DetailReference[];
    productInfo: string;
    styleRequest: string;
    platform: string;
    screenCount: number;
    plan: DetailPlan | null;
    screens: DetailScreen[];
    currentIndex: number;
};

const DETAIL_LLM_KEYS_KEY = "detail-workbench:llm-keys";
const DETAIL_PROJECTS_KEY = "detail-workbench:projects";
const DEFAULT_SCREEN_COUNT = 6;

export default function DetailWorkbenchPage() {
    const { message, modal } = App.useApp();
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    const effectiveConfig = useEffectiveConfig();
    const updateConfig = useConfigStore((state) => state.updateConfig);
    const openConfigDialog = useConfigStore((state) => state.openConfigDialog);
    const isAiConfigReady = useConfigStore((state) => state.isAiConfigReady);

    const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const [projects, setProjects] = useState<DetailProject[]>([]);
    const [activeProjectId, setActiveProjectId] = useState<string | null>(null);
    const [projectReady, setProjectReady] = useState(false);
    const [llmModels, setLlmModels] = useState<AdminModel[]>([]);
    const [llmKeys, setLlmKeys] = useState<DetailLlmKeys>({});
    const [selectedLlmId, setSelectedLlmId] = useState("");
    const [settingsOpen, setSettingsOpen] = useState(false);
    const [imageSettingsOpen, setImageSettingsOpen] = useState(false);
    const [centerImageSettingsOpen, setCenterImageSettingsOpen] = useState(false);
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
    const generatingScreen = screens.find((screen) => screen.status === "generating") || null;
    const activeProject = projects.find((project) => project.id === activeProjectId) || null;
    const selectedLlm = llmModels.find((model) => model.id === selectedLlmId) || llmModels[0] || null;
    const selectedLlmKey = selectedLlm ? llmKeys[selectedLlm.id]?.trim() || "" : "";
    const imageConfig = useMemo(() => ({ ...effectiveConfig, model: effectiveConfig.imageModel || effectiveConfig.model, count: "1" }), [effectiveConfig]);

    useEffect(() => {
        void loadLlmModels();
        loadLlmKeys();
        void loadProjects();
    }, []);

    useEffect(() => {
        if (!selectedLlmId && llmModels.length) setSelectedLlmId(llmModels[0].id);
    }, [llmModels, selectedLlmId]);

    useEffect(() => {
        if (!projectReady || !activeProjectId) return;
        const now = new Date().toISOString();
        setProjects((items) => {
            const next = items.map((project) =>
                project.id === activeProjectId
                    ? {
                          ...project,
                          updatedAt: now,
                          references,
                          productInfo,
                          styleRequest,
                          platform,
                          screenCount,
                          plan,
                          screens,
                          currentIndex,
                      }
                    : project,
            );
            scheduleProjectSave(next);
            return next;
        });
    }, [projectReady, activeProjectId, references, productInfo, styleRequest, platform, screenCount, plan, screens, currentIndex]);

    const scheduleProjectSave = (items: DetailProject[]) => {
        if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
        saveTimerRef.current = setTimeout(() => {
            localStorage.setItem(DETAIL_PROJECTS_KEY, JSON.stringify(items));
        }, 250);
    };

    const loadLlmModels = async () => {
        try {
            const models = await fetchPublicModels();
            setLlmModels(models.filter((model) => model.enabled && model.type === "detail_prompt"));
        } catch {
            message.error("加载 LLM 配置失败");
        }
    };

    const loadProjects = async () => {
        try {
            const stored = JSON.parse(localStorage.getItem(DETAIL_PROJECTS_KEY) || "[]") as DetailProject[];
            const hydrated = await Promise.all(stored.map(hydrateProjectImages));
            setProjects(hydrated);
        } catch {
            setProjects([]);
        }
    };

    const openCreateProjectDialog = () => {
        let title = `详情图项目 ${projects.length + 1}`;
        modal.confirm({
            title: "新建详情图项目",
            icon: null,
            okText: "创建",
            cancelText: "取消",
            content: <Input autoFocus defaultValue={title} placeholder="请输入项目名称" onChange={(event) => (title = event.target.value)} />,
            onOk: () => createProject(title),
        });
    };

    const createProject = (rawTitle?: string) => {
        const now = new Date().toISOString();
        const title = rawTitle?.trim() || `详情图项目 ${projects.length + 1}`;
        const project: DetailProject = {
            id: `detail-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
            title: "未命名详情图",
            createdAt: now,
            updatedAt: now,
            references: [],
            productInfo: "",
            styleRequest: "",
            platform: "淘宝",
            screenCount: DEFAULT_SCREEN_COUNT,
            plan: null,
            screens: [],
            currentIndex: 1,
        };
        project.title = title;
        const next = [project, ...projects];
        setProjects(next);
        localStorage.setItem(DETAIL_PROJECTS_KEY, JSON.stringify(next));
        openProject(project);
    };

    const renameActiveProject = (title: string) => {
        if (!activeProjectId) return;
        const now = new Date().toISOString();
        setProjects((items) => {
            const next = items.map((project) => (project.id === activeProjectId ? { ...project, title, updatedAt: now } : project));
            scheduleProjectSave(next);
            return next;
        });
    };

    const openProject = (project: DetailProject) => {
        setProjectReady(false);
        setActiveProjectId(project.id);
        setReferences(project.references || []);
        setProductInfo(project.productInfo || "");
        setStyleRequest(project.styleRequest || "");
        setPlatform(project.platform || "淘宝");
        setScreenCount(project.screenCount || DEFAULT_SCREEN_COUNT);
        setPlan(project.plan || null);
        setScreens(project.screens || []);
        setCurrentIndex(project.currentIndex || 1);
        setFeedback("");
        window.setTimeout(() => setProjectReady(true), 0);
    };

    const deleteProject = (id: string) => {
        const next = projects.filter((project) => project.id !== id);
        setProjects(next);
        localStorage.setItem(DETAIL_PROJECTS_KEY, JSON.stringify(next));
        if (activeProjectId === id) setActiveProjectId(null);
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
            message.warning("请先在后台配置详情图提示词模型");
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
        setStatusText(`正在修改第 ${currentScreen.index} 屏`);
        setScreens((items) => patchScreen(items, currentScreen.index, { status: "generating", error: undefined }));
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
                        imageUrl: old?.imageUrl,
                        storageKey: old?.storageKey,
                        status: screen.index === 1 ? ("generating" as const) : old?.status || ("not_started" as const),
                    };
                });
                setPlan(nextPlan);
                setScreens(nextScreens);
                await generateScreen(1, nextScreens, nextPlan, { includeCurrent: true });
            } else {
                setStatusText(`正在局部改写第 ${currentScreen.index} 屏提示词`);
                const prompt = await requestDetailLlm([{ role: "user", content: buildScreenRevisionPrompt(plan, currentScreen, feedback) }]);
                const nextScreens = screens.map((screen) => (screen.index === currentScreen.index ? { ...screen, prompt: cleanPromptText(prompt), status: "generating" as const } : screen));
                setScreens(nextScreens);
                await generateScreen(currentScreen.index, nextScreens, plan, { includeCurrent: true });
            }
            setFeedback("");
            message.success("已按修改建议重新生成");
        } catch (error) {
            setScreens((items) => patchScreen(items, currentScreen.index, { status: currentScreen.imageUrl ? "ready" : "failed", error: error instanceof Error ? error.message : "修改失败" }));
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

    const generateScreen = async (index: number, sourceScreens: DetailScreen[], sourcePlan: DetailPlan, options?: { includeCurrent?: boolean }) => {
        const target = sourceScreens.find((screen) => screen.index === index);
        if (!target) throw new Error("未找到当前屏提示词");
        setScreens((items) => patchScreen(items.length ? items : sourceScreens, index, { status: "generating", error: undefined }));
        try {
            const refs = await buildGenerationReferences(index, sourceScreens, options);
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
        } catch (error) {
            setScreens((items) => patchScreen(items.length ? items : sourceScreens, index, { status: target.imageUrl ? "ready" : "failed", error: error instanceof Error ? error.message : "生成失败" }));
            throw error;
        }
    };

    const buildGenerationReferences = async (index: number, sourceScreens: DetailScreen[], options?: { includeCurrent?: boolean }) => {
        const limit = imageReferenceLimit(imageConfig, imageConfig.model);
        const current = options?.includeCurrent ? sourceScreens.find((screen) => screen.index === index && screen.imageUrl && screen.storageKey) : null;
        const currentReference = current
            ? [
                  {
                      id: `screen-${current.index}-current`,
                      name: `screen-${current.index}-current.png`,
                      type: "image/png",
                      dataUrl: current.imageUrl!,
                      url: current.imageUrl!,
                      storageKey: current.storageKey!,
                  },
              ]
            : [];
        if (index === 1) return hydrateReferences(uniqueReferences([...currentReference, ...references]).slice(0, limit));
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
        return hydrateReferences(uniqueReferences([...currentReference, ...anchors, ...references]).slice(0, limit));
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

    if (!activeProjectId) {
        return (
            <main className="h-full overflow-y-auto bg-[#111111] p-6 text-stone-100">
                <div className="mx-auto max-w-6xl">
                    <div className="mb-6 flex items-center justify-between gap-4">
                        <div>
                            <h1 className="m-0 text-2xl font-semibold">详情图工作台</h1>
                            <p className="mt-2 text-sm text-stone-400">每个项目都会保存在当前浏览器本地。</p>
                        </div>
                        <Button type="primary" size="large" icon={<Plus className="size-4" />} onClick={openCreateProjectDialog}>
                            新建详情图项目
                        </Button>
                    </div>
                    {projects.length ? (
                        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                            {projects.map((project) => (
                                <button key={project.id} type="button" className="group rounded-lg border border-white/10 bg-[#171717] p-4 text-left transition hover:border-white/30" onClick={() => openProject(project)}>
                                    <div className="flex items-start justify-between gap-3">
                                        <div className="min-w-0">
                                            <div className="truncate text-lg font-semibold">{project.title || "未命名详情图"}</div>
                                            <div className="mt-1 text-xs text-stone-500">{new Date(project.updatedAt).toLocaleString()}</div>
                                        </div>
                                        <span
                                            role="button"
                                            tabIndex={0}
                                            className="grid size-8 shrink-0 place-items-center rounded-full text-stone-500 opacity-0 transition hover:bg-white/10 hover:text-red-300 group-hover:opacity-100"
                                            onClick={(event) => {
                                                event.stopPropagation();
                                                deleteProject(project.id);
                                            }}
                                        >
                                            <Trash2 className="size-4" />
                                        </span>
                                    </div>
                                    <div className="mt-4 flex gap-2">
                                        {(project.references || []).slice(0, 4).map((reference) => (
                                            <img key={reference.id} src={reference.url} alt="" className="size-14 rounded-md border border-white/10 object-cover" />
                                        ))}
                                        {project.references.length > 4 ? <div className="grid size-14 place-items-center rounded-md border border-white/10 text-xs text-stone-500">+{project.references.length - 4}</div> : null}
                                    </div>
                                    <div className="mt-4 flex flex-wrap gap-1.5">
                                        <Tag>{project.platform}</Tag>
                                        <Tag>{project.screenCount} 屏</Tag>
                                        <Tag color={project.screens.some((screen) => screen.imageUrl) ? "success" : undefined}>{project.screens.filter((screen) => screen.imageUrl).length} 已生成</Tag>
                                    </div>
                                </button>
                            ))}
                        </div>
                    ) : (
                        <div className="grid min-h-[420px] place-items-center rounded-lg border border-dashed border-white/10 bg-[#171717] text-center text-stone-500">
                            <div>
                                <Sparkles className="mx-auto mb-3 size-8 opacity-60" />
                                还没有详情图项目
                            </div>
                        </div>
                    )}
                </div>
            </main>
        );
    }

    return (
        <main className="h-full overflow-hidden bg-[#111111] text-stone-100">
            <div className="grid h-full min-h-0 grid-cols-[360px_minmax(420px,1fr)_360px]">
                <aside className="min-h-0 overflow-y-auto border-r border-white/10 bg-[#171717] p-4">
                    <div className="mb-4 flex items-center justify-between gap-3">
                        <div>
                            <div className="text-lg font-semibold">详情图工作台</div>
                            <div className="mt-1 text-xs text-stone-400">一次生成整套提示词，逐屏出图</div>
                        </div>
                        <Space size={4}>
                            <Button type="text" size="small" className="!text-stone-300" onClick={() => setActiveProjectId(null)}>
                                项目
                            </Button>
                            <Button type="text" shape="circle" icon={<Settings2 className="size-4" />} className="!text-stone-200" onClick={() => setSettingsOpen(true)} title="详情图 LLM Key 设置" />
                        </Space>
                    </div>
                    <Input
                        value={activeProject?.title || ""}
                        placeholder="项目名称"
                        className="mb-4"
                        onChange={(event) => renameActiveProject(event.target.value)}
                        onBlur={(event) => {
                            if (!event.target.value.trim()) renameActiveProject("未命名详情图");
                        }}
                    />

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

                        <Panel title="参考图 / 竞品图顺序">
                            <div className="thin-scrollbar flex gap-2 overflow-x-auto pb-1">
                                {references.map((item, index) => (
                                    <div key={item.id} className="group relative h-20 w-20 shrink-0 overflow-hidden rounded-md border border-white/10 bg-black">
                                        <img src={item.url} alt="" className="h-full w-full object-cover" />
                                        <span className="absolute left-1 top-1 rounded bg-black/70 px-1.5 py-0.5 text-[10px] text-white">{index + 1}</span>
                                        <div className="absolute inset-x-1 bottom-1 flex justify-between opacity-0 transition group-hover:opacity-100">
                                            <button type="button" className="grid size-6 place-items-center rounded-full bg-black/70" disabled={index === 0} onClick={() => setReferences((list) => moveItem(list, index, index - 1))}>
                                                <ChevronLeft className="size-3.5" />
                                            </button>
                                            <button type="button" className="grid size-6 place-items-center rounded-full bg-black/70" disabled={index === references.length - 1} onClick={() => setReferences((list) => moveItem(list, index, index + 1))}>
                                                <ChevronRight className="size-3.5" />
                                            </button>
                                        </div>
                                        <button type="button" className="absolute right-1 top-1 grid size-6 place-items-center rounded-full bg-black/70 opacity-0 transition group-hover:opacity-100" onClick={() => setReferences((list) => list.filter((image) => image.id !== item.id))}>
                                            <X className="size-3.5" />
                                        </button>
                                    </div>
                                ))}
                                <label className="grid h-20 w-20 shrink-0 cursor-pointer place-items-center rounded-md border border-dashed border-white/20 bg-white/[0.03] text-stone-400 transition hover:border-white/40 hover:text-stone-100" title="添加参考图">
                                    <Plus className="size-5" />
                                    <input type="file" accept="image/*" multiple className="hidden" onChange={(event) => void handleReferenceFiles(event.target.files)} />
                                </label>
                            </div>
                            <div className="mt-2 text-xs text-stone-500">顺序会传给 AI：越靠前优先级越高。</div>
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
                            <button type="button" className="mt-3 flex w-full items-center justify-between rounded-lg border border-white/10 px-3 py-2 text-left text-sm text-stone-300 transition hover:border-white/25" onClick={() => setImageSettingsOpen((value) => !value)}>
                                <span>画质、比例与张数</span>
                                <ChevronDown className={cn("size-4 transition", imageSettingsOpen && "rotate-180")} />
                            </button>
                            {imageSettingsOpen ? <ImageSettingsPanel config={imageConfig} onConfigChange={updateConfig} theme={theme} showTitle={false} maxCount={1} quickCount={1} showCount={false} className="mt-3 space-y-4" /> : null}
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

                        <div className="flex h-[640px] min-h-[420px] items-center justify-center overflow-hidden rounded-lg border border-white/10 bg-black/40 p-4">
                            {currentScreen?.status === "generating" ? (
                                <div className="flex flex-col items-center gap-3 text-stone-400">
                                    <LoaderCircle className="size-8 animate-spin" />
                                    正在生成图片
                                </div>
                            ) : currentScreen?.imageUrl ? (
                                <img src={currentScreen.imageUrl} alt="" className="block max-h-full max-w-full rounded-md object-contain" draggable={false} />
                            ) : (
                                <div className="text-center text-sm text-stone-500">
                                    <Wand2 className="mx-auto mb-3 size-8 opacity-60" />
                                    等待生成第一屏
                                </div>
                            )}
                        </div>

                        <div className="rounded-lg border border-white/10 bg-[#171717] p-3">
                            <div className="mb-3 rounded-lg border border-white/10 bg-white/[0.03] p-3">
                                <div className="flex flex-wrap items-center gap-2">
                                    <div className="min-w-24 text-sm font-medium text-stone-200">生图模型</div>
                                    <div className="min-w-[220px] flex-1">
                                        <ModelPicker config={effectiveConfig} value={effectiveConfig.imageModel || effectiveConfig.model} onChange={setImageModel} onMissingConfig={() => openConfigDialog(true)} type="image" fullWidth />
                                    </div>
                                    <button type="button" className="flex h-8 items-center gap-1.5 rounded-full border border-white/10 px-3 text-xs text-stone-300 transition hover:border-white/25" onClick={() => setCenterImageSettingsOpen((value) => !value)}>
                                        <span>画质与比例</span>
                                        <ChevronDown className={cn("size-3.5 transition", centerImageSettingsOpen && "rotate-180")} />
                                    </button>
                                </div>
                                {centerImageSettingsOpen ? <ImageSettingsPanel config={imageConfig} onConfigChange={updateConfig} theme={theme} showTitle={false} maxCount={1} quickCount={1} showCount={false} className="mt-3 space-y-4" /> : null}
                            </div>
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
                        {generatingScreen ? (
                            <button
                                type="button"
                                className={cn(
                                    "flex w-full items-center justify-center gap-2 rounded-lg border px-3 py-2 text-sm transition",
                                    generatingScreen.index === currentIndex ? "border-blue-400/40 bg-blue-500/10 text-blue-100" : "border-white/10 bg-white/[0.03] text-stone-300 hover:border-blue-400/50 hover:text-blue-100",
                                )}
                                onClick={() => setCurrentIndex(generatingScreen.index)}
                            >
                                <LoaderCircle className="size-4 animate-spin" />
                                <span>正在生成第 {generatingScreen.index} 屏</span>
                                {generatingScreen.index === currentIndex ? <span className="text-xs text-blue-200/70">当前查看中</span> : <span className="text-xs text-blue-200/70">点击切回当前生成屏</span>}
                            </button>
                        ) : null}
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
                        <div className="rounded-lg border border-dashed border-stone-200 px-4 py-8 text-center text-sm text-stone-500 dark:border-stone-800">后台模型管理里还没有启用的详情图提示词模型</div>
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

async function hydrateProjectImages(project: DetailProject): Promise<DetailProject> {
    const references = await Promise.all(
        (project.references || []).map(async (reference) => ({
            ...reference,
            url: await resolveImageUrl(reference.storageKey, reference.url || reference.dataUrl || ""),
            dataUrl: await resolveImageUrl(reference.storageKey, reference.dataUrl || reference.url || ""),
        })),
    );
    const screens = await Promise.all(
        (project.screens || []).map(async (screen) =>
            screen.storageKey
                ? {
                      ...screen,
                      imageUrl: await resolveImageUrl(screen.storageKey, screen.imageUrl || ""),
                  }
                : screen,
        ),
    );
    return { ...project, references, screens };
}

function moveItem<T>(items: T[], from: number, to: number) {
    if (to < 0 || to >= items.length) return items;
    const next = [...items];
    const [item] = next.splice(from, 1);
    next.splice(to, 0, item);
    return next;
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
