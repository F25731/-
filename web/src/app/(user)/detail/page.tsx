"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode, WheelEvent } from "react";
import { App, Button, Input, InputNumber, Modal, Select, Space, Tag } from "antd";
import { ChevronDown, ChevronLeft, ChevronRight, Download, Eye, LoaderCircle, Plus, RefreshCw, Settings2, Sparkles, Trash2, Upload, Wand2, X } from "lucide-react";

import { ImageSettingsPanel } from "@/components/image-settings-panel";
import { ModelPicker } from "@/components/model-picker";
import { fetchPublicModels, type AdminModel } from "@/services/api/admin";
import { requestEdit, requestGeneration, requestPromptExtraction } from "@/services/api/image";
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
type DetailGenerationMode = "precise" | "rough";

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
const SEAM_REFERENCE_RATIO = 0.18;

export default function DetailWorkbenchPage() {
    const { message, modal } = App.useApp();
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    const effectiveConfig = useEffectiveConfig();
    const updateConfig = useConfigStore((state) => state.updateConfig);
    const openConfigDialog = useConfigStore((state) => state.openConfigDialog);
    const isAiConfigReady = useConfigStore((state) => state.isAiConfigReady);

    const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const activeProjectIdRef = useRef<string | null>(null);
    const currentReplaceInputRef = useRef<HTMLInputElement | null>(null);
    const addScreenUploadInputRef = useRef<HTMLInputElement | null>(null);
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
    const [planEditorOpen, setPlanEditorOpen] = useState(false);
    const [draftStyleSummary, setDraftStyleSummary] = useState("");
    const [draftScreens, setDraftScreens] = useState<DetailPlanScreen[]>([]);
    const [generationModeOpen, setGenerationModeOpen] = useState(false);
    const [addScreenOpen, setAddScreenOpen] = useState(false);
    const [addScreenPrompt, setAddScreenPrompt] = useState("");
    const [previewOpen, setPreviewOpen] = useState(false);
    const [previewImageUrl, setPreviewImageUrl] = useState("");
    const [previewScale, setPreviewScale] = useState(1);

    const currentScreen = screens.find((screen) => screen.index === currentIndex) || null;
    const generatedScreens = screens.filter((screen) => screen.imageUrl);
    const failedScreens = screens.filter((screen) => screen.status === "failed");
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
        activeProjectIdRef.current = activeProjectId;
    }, [activeProjectId]);

    useEffect(() => {
        const handlePopState = (event: PopStateEvent) => {
            if (activeProjectIdRef.current && !event.state?.detailWorkbenchProjectId) {
                setActiveProjectId(null);
                setProjectReady(false);
            }
        };
        window.addEventListener("popstate", handlePopState);
        return () => window.removeEventListener("popstate", handlePopState);
    }, []);

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
            const detailModels = models.filter((model) => model.enabled && model.type === "detail_prompt").sort((left, right) => Number(Boolean(right.isDefault)) - Number(Boolean(left.isDefault)));
            setLlmModels(detailModels);
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

    const pushProjectHistory = (projectId: string) => {
        const state = window.history.state || {};
        if (state.detailWorkbenchProjectId === projectId) return;
        window.history.pushState({ ...state, detailWorkbenchProjectId: projectId }, "", window.location.href);
    };

    const closeProjectList = () => {
        setActiveProjectId(null);
        setProjectReady(false);
        const state = window.history.state || {};
        if (state.detailWorkbenchProjectId) {
            const nextState = { ...state };
            delete nextState.detailWorkbenchProjectId;
            window.history.replaceState(nextState, "", window.location.href);
        }
    };

    const openProject = (project: DetailProject, options: { pushHistory?: boolean } = {}) => {
        if (options.pushHistory !== false) pushProjectHistory(project.id);
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
        if (activeProjectId === id) closeProjectList();
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
            setDraftStyleSummary(nextPlan.styleSummary);
            setDraftScreens(nextPlan.screens);
            setFeedback("");
            setPlanEditorOpen(true);
            message.success("分屏提示词已生成");
        } catch (error) {
            message.error(error instanceof Error ? error.message : "生成失败");
        } finally {
            setIsRunning(false);
            setStatusText("");
        }
    };

    const applyPromptPlan = () => {
        const nextPlan = normalizePlan(
            {
                styleSummary: draftStyleSummary,
                screens: draftScreens,
            },
            draftScreens.length || screenCount,
        );
        const normalizedScreens = nextPlan.screens.map((screen) => ({ ...screen, status: "not_started" as const }));
        setPlan(nextPlan);
        setScreens(normalizedScreens);
        setScreenCount(normalizedScreens.length);
        setCurrentIndex(1);
        setFeedback("");
        setPlanEditorOpen(false);
        setGenerationModeOpen(true);
    };

    const startGenerationWithMode = async (mode: DetailGenerationMode) => {
        if (!plan) return;
        if (!isAiConfigReady(imageConfig, imageConfig.model)) {
            openConfigDialog(true);
            return;
        }
        setGenerationModeOpen(false);
        setIsRunning(true);
        setFeedback("");
        try {
            if (mode === "rough") {
                await generateRoughPlan(plan);
            } else {
                await generatePrecisePlan(plan);
            }
            message.success("详情图生成完成");
        } catch (error) {
            message.error(error instanceof Error ? error.message : "生成失败");
        } finally {
            setIsRunning(false);
            setStatusText("");
        }
    };

    const generatePrecisePlan = async (sourcePlan: DetailPlan) => {
        let sourceScreens = sourcePlan.screens.map((screen) => ({ ...screen, status: "not_started" as const }));
        setScreens(sourceScreens);
        setCurrentIndex(1);
        for (const screen of sourceScreens) {
            setStatusText(`精细模式：正在生成第 ${screen.index} 屏`);
            const generated = await generateScreen(screen.index, sourceScreens, sourcePlan, { throwOnError: false });
            if (generated) sourceScreens = patchScreen(sourceScreens, screen.index, generated);
        }
    };

    const generateRoughPlan = async (sourcePlan: DetailPlan) => {
        const sourceScreens = sourcePlan.screens.map((screen) => ({ ...screen, status: "not_started" as const }));
        setScreens(sourceScreens);
        setCurrentIndex(1);
        setStatusText("粗糙模式：正在生成第一屏");
        const first = await generateScreen(1, sourceScreens, sourcePlan, { throwOnError: false });
        if (!first?.imageUrl || !first.storageKey) return;
        const anchoredScreens = sourceScreens.map((screen) => (screen.index === 1 ? { ...screen, imageUrl: first.imageUrl, storageKey: first.storageKey, status: "ready" as const } : screen));
        setStatusText("粗糙模式：正在并发生成其余屏");
        await Promise.all(sourcePlan.screens.slice(1).map((screen) => generateScreen(screen.index, anchoredScreens, sourcePlan, { mode: "rough", throwOnError: false })));
    };

    const createDetailPlan = async () => {
        const referenceSummaries = await extractReferenceSummaries();
        setStatusText("正在生成整套详情图设计方案");
        const content = await requestDetailLlm([
            {
                role: "user",
                content: buildPlanPrompt({ productInfo, styleRequest, platform, screenCount, referenceSummaries }),
            },
        ]);
        try {
            return normalizePlan(parsePlan(content), screenCount);
        } catch {
            const repaired = await requestDetailLlm([{ role: "user", content: buildPlanRepairPrompt(content, screenCount) }]);
            return normalizePlan(parsePlan(repaired), screenCount);
        }
    };

    const extractReferenceSummaries = async () => {
        if (!references.length) return "";
        setStatusText("正在读取参考图风格");
        const results = await Promise.allSettled(
            references.slice(0, 6).map(async (reference, index) => {
                const text = await requestPromptExtraction(reference);
                return `${index + 1}. ${text.trim()}`;
            }),
        );
        const summaries = results.flatMap((result) => (result.status === "fulfilled" && result.value ? [result.value] : []));
        const failed = results.length - summaries.length;
        if (failed > 0) message.warning(`有 ${failed} 张参考图读取失败，已继续生成`);
        return summaries.join("\n");
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

    const generateScreen = async (index: number, sourceScreens: DetailScreen[], sourcePlan: DetailPlan, options?: { includeCurrent?: boolean; mode?: DetailGenerationMode; throwOnError?: boolean }) => {
        const target = sourceScreens.find((screen) => screen.index === index);
        if (!target) throw new Error("未找到当前屏提示词");
        setScreens((items) => patchScreen(items.length ? items : sourceScreens, index, { status: "generating", error: undefined }));
        try {
            const refs = await buildGenerationReferences(index, sourceScreens, options);
            const prompt = buildImagePrompt(sourcePlan, target, index, options?.mode || "precise", Boolean(options?.includeCurrent));
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
            return {
                ...target,
                imageUrl: uploaded.url,
                storageKey: uploaded.storageKey,
                status: "ready" as const,
                error: undefined,
            };
        } catch (error) {
            setScreens((items) => patchScreen(items.length ? items : sourceScreens, index, { status: target.imageUrl ? "ready" : "failed", error: error instanceof Error ? error.message : "生成失败" }));
            if (options?.throwOnError === false) return undefined;
            throw error;
        }
    };

    const buildGenerationReferences = async (index: number, sourceScreens: DetailScreen[], options?: { includeCurrent?: boolean; mode?: DetailGenerationMode }) => {
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
        const first = sourceScreens.find((screen): screen is DetailScreen & { imageUrl: string; storageKey: string } => screen.index === 1 && Boolean(screen.imageUrl && screen.storageKey));
        const previous = sourceScreens.find((screen): screen is DetailScreen & { imageUrl: string; storageKey: string } => screen.index === index - 1 && Boolean(screen.imageUrl && screen.storageKey));
        const anchors: DetailReference[] = [];
        if (first) {
            anchors.push({
                id: `screen-${first.index}-anchor-1`,
                name: `screen-${first.index}.png`,
                type: "image/png",
                dataUrl: first.imageUrl,
                url: first.imageUrl,
                storageKey: first.storageKey,
            });
        }
        if (options?.mode !== "rough" && previous) {
            anchors.push(await buildBottomSeamReference(previous));
        }
        const remainingSlots = Math.max(0, limit - anchors.length);
        const extras = uniqueReferences([...currentReference, ...references]).filter((reference) => !anchors.some((anchor) => anchor.storageKey === reference.storageKey && anchor.id !== reference.id));
        return hydrateReferences([...anchors, ...extras.slice(0, remainingSlots)]);
    };

    const hydrateReferences = async (items: DetailReference[]) => {
        return Promise.all(items.map(async (item) => ({ ...item, dataUrl: await imageToDataUrl(item) })));
    };

    const requestDetailLlm = async (messages: unknown[]) => {
        if (!selectedLlm) throw new Error("未选择 LLM");
        const response = await fetch("/api/detail-llm", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ modelId: selectedLlm.id, apiKey: selectedLlmKey, messages }),
        });
        const responseText = await response.text();
        const payload = parseDetailLlmResponse(responseText);
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

    const openLongPreview = async () => {
        if (!generatedScreens.length) {
            message.warning("还没有可预览的图片");
            return;
        }
        try {
            const blob = await composeLongImage(generatedScreens.map((screen) => screen.imageUrl!));
            if (previewImageUrl) URL.revokeObjectURL(previewImageUrl);
            setPreviewImageUrl(URL.createObjectURL(blob));
            setPreviewScale(1);
            setPreviewOpen(true);
        } catch (error) {
            message.error(error instanceof Error ? error.message : "预览失败");
        }
    };

    const closeLongPreview = () => {
        if (previewImageUrl) URL.revokeObjectURL(previewImageUrl);
        setPreviewImageUrl("");
        setPreviewOpen(false);
        setPreviewScale(1);
    };

    const handlePreviewWheel = (event: WheelEvent<HTMLDivElement>) => {
        event.preventDefault();
        setPreviewScale((value) => Math.max(0.25, Math.min(3, Number((value + (event.deltaY > 0 ? -0.1 : 0.1)).toFixed(2)))));
    };

    const replaceCurrentImage = async (files: FileList | null) => {
        if (!currentScreen || !files?.[0]) return;
        const file = files[0];
        if (!file.type.startsWith("image/")) {
            message.warning("请选择图片文件");
            return;
        }
        const uploaded = await uploadImage(file);
        setScreens((items) =>
            patchScreen(items, currentScreen.index, {
                imageUrl: uploaded.url,
                storageKey: uploaded.storageKey,
                status: "ready",
                error: undefined,
            }),
        );
        message.success(`第 ${currentScreen.index} 屏已替换`);
    };

    const retryScreen = async (index: number) => {
        if (!plan || isRunning) return;
        setCurrentIndex(index);
        setIsRunning(true);
        setStatusText(`正在重新生成第 ${index} 屏`);
        try {
            await generateScreen(index, screens, plan, { throwOnError: false });
        } finally {
            setIsRunning(false);
            setStatusText("");
        }
    };

    const openAddScreen = () => {
        setAddScreenPrompt("");
        setAddScreenOpen(true);
    };

    const addScreenFromUpload = async (files: FileList | null) => {
        if (!files?.[0]) return;
        const file = files[0];
        if (!file.type.startsWith("image/")) {
            message.warning("请选择图片文件");
            return;
        }
        const uploaded = await uploadImage(file);
        const index = screens.length + 1;
        const nextScreen: DetailScreen = {
            index,
            title: `第 ${index} 屏`,
            goal: "用户手动添加",
            prompt: addScreenPrompt.trim() || `电商详情页第 ${index} 屏，延续整套风格。`,
            imageUrl: uploaded.url,
            storageKey: uploaded.storageKey,
            status: "ready",
        };
        const nextScreens = [...screens, nextScreen];
        const nextPlan = normalizePlan({ styleSummary: plan?.styleSummary || "统一详情页视觉风格", screens: [...(plan?.screens || screens), nextScreen] }, nextScreens.length);
        setPlan(nextPlan);
        setScreens(nextScreens);
        setScreenCount(nextScreens.length);
        setCurrentIndex(index);
        setAddScreenOpen(false);
        message.success("已添加一屏");
    };

    const addScreenByAi = async () => {
        if (!plan || isRunning) return;
        const index = screens.length + 1;
        const nextScreen: DetailScreen = {
            index,
            title: `第 ${index} 屏`,
            goal: "补充详情页内容",
            prompt: addScreenPrompt.trim() || `电商详情页第 ${index} 屏，延续第一屏风格，补充展示商品卖点或细节，上下自然衔接。`,
            status: "not_started",
        };
        const nextScreens = [...screens, nextScreen];
        const nextPlan = normalizePlan({ styleSummary: plan.styleSummary, screens: [...plan.screens, nextScreen] }, nextScreens.length);
        setPlan(nextPlan);
        setScreens(nextScreens);
        setScreenCount(nextScreens.length);
        setCurrentIndex(index);
        setAddScreenOpen(false);
        setIsRunning(true);
        setStatusText(`正在生成第 ${index} 屏`);
        try {
            await generateScreen(index, nextScreens, nextPlan, { mode: "rough", throwOnError: false });
        } finally {
            setIsRunning(false);
            setStatusText("");
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
            <main className="h-full overflow-y-auto bg-stone-50 p-6 text-stone-950 dark:bg-[#111111] dark:text-stone-100">
                <div className="mx-auto max-w-6xl">
                    <div className="mb-6 flex items-center justify-between gap-4">
                        <div>
                            <h1 className="m-0 text-2xl font-semibold">详情图工作台</h1>
                            <p className="mt-2 text-sm text-stone-600 dark:text-stone-400">每个项目都会保存在当前浏览器本地。</p>
                        </div>
                        <Button type="primary" size="large" icon={<Plus className="size-4" />} onClick={openCreateProjectDialog}>
                            新建详情图项目
                        </Button>
                    </div>
                    {projects.length ? (
                        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                            {projects.map((project) => (
                                <button key={project.id} type="button" className="group rounded-lg border border-stone-200 bg-white p-4 text-left transition hover:border-stone-400 dark:border-white/10 dark:bg-[#171717] dark:hover:border-white/30" onClick={() => openProject(project)}>
                                    <div className="flex items-start justify-between gap-3">
                                        <div className="min-w-0">
                                            <div className="truncate text-lg font-semibold">{project.title || "未命名详情图"}</div>
                                            <div className="mt-1 text-xs text-stone-500 dark:text-stone-500">{new Date(project.updatedAt).toLocaleString()}</div>
                                        </div>
                                        <span
                                            role="button"
                                            tabIndex={0}
                                            className="grid size-8 shrink-0 place-items-center rounded-full text-stone-500 opacity-0 transition hover:bg-stone-100 hover:text-red-500 group-hover:opacity-100 dark:hover:bg-white/10 dark:hover:text-red-300"
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
                                            <img key={reference.id} src={reference.url} alt="" className="size-14 rounded-md border border-stone-200 object-cover dark:border-white/10" />
                                        ))}
                                        {project.references.length > 4 ? <div className="grid size-14 place-items-center rounded-md border border-stone-200 text-xs text-stone-500 dark:border-white/10">+{project.references.length - 4}</div> : null}
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
                        <div className="grid min-h-[420px] place-items-center rounded-lg border border-dashed border-stone-300 bg-white text-center text-stone-500 dark:border-white/10 dark:bg-[#171717]">
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
        <main className="h-full overflow-hidden bg-stone-50 text-stone-950 dark:bg-[#111111] dark:text-stone-100">
            <div className="grid h-full min-h-0 grid-cols-[360px_minmax(420px,1fr)_360px]">
                <aside className="min-h-0 overflow-y-auto border-r border-stone-200 bg-white p-4 dark:border-white/10 dark:bg-[#171717]">
                    <div className="mb-4 flex items-center justify-between gap-3">
                        <div>
                            <div className="text-lg font-semibold">详情图工作台</div>
                            <div className="mt-1 text-xs text-stone-600 dark:text-stone-400">一次生成整套提示词，逐屏出图</div>
                        </div>
                        <Space size={4}>
                            <Button type="text" size="small" className="!text-stone-700 dark:!text-stone-300" onClick={closeProjectList}>
                                项目
                            </Button>
                            <Button type="text" shape="circle" icon={<Settings2 className="size-4" />} className="!text-stone-700 dark:!text-stone-200" onClick={() => setSettingsOpen(true)} title="详情图 LLM Key 设置" />
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
                                    <div key={item.id} className="group relative h-20 w-20 shrink-0 overflow-hidden rounded-md border border-stone-200 bg-black dark:border-white/10">
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
                                <label className="grid h-20 w-20 shrink-0 cursor-pointer place-items-center rounded-md border border-dashed border-stone-300 bg-stone-50 text-stone-500 transition hover:border-stone-500 hover:text-stone-900 dark:border-white/20 dark:bg-white/[0.03] dark:text-stone-400 dark:hover:border-white/40 dark:hover:text-stone-100" title="添加参考图">
                                    <Plus className="size-5" />
                                    <input type="file" accept="image/*" multiple className="hidden" onChange={(event) => void handleReferenceFiles(event.target.files)} />
                                </label>
                            </div>
                            <div className="mt-2 text-xs text-stone-500 dark:text-stone-500">顺序会传给 AI：越靠前优先级越高。</div>
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
                            <button type="button" className="mt-3 flex w-full items-center justify-between rounded-lg border border-stone-200 px-3 py-2 text-left text-sm text-stone-700 transition hover:border-stone-400 dark:border-white/10 dark:text-stone-300 dark:hover:border-white/25" onClick={() => setImageSettingsOpen((value) => !value)}>
                                <span>画质、比例与张数</span>
                                <ChevronDown className={cn("size-4 transition", imageSettingsOpen && "rotate-180")} />
                            </button>
                            {imageSettingsOpen ? <ImageSettingsPanel config={imageConfig} onConfigChange={updateConfig} theme={theme} showTitle={false} maxCount={1} quickCount={1} showCount={false} className="mt-3 space-y-4" /> : null}
                        </Panel>

                        <Button type="primary" size="large" block icon={isRunning ? <LoaderCircle className="size-4 animate-spin" /> : <Sparkles className="size-4" />} disabled={isRunning} onClick={() => void startDesign()}>
                            生成分屏提示词
                        </Button>
                        {statusText ? <div className="rounded-lg border border-stone-200 bg-stone-50 px-3 py-2 text-xs text-stone-700 dark:border-white/10 dark:bg-white/[0.03] dark:text-stone-300">{statusText}</div> : null}
                    </div>
                </aside>

                <section className="min-h-0 overflow-y-auto bg-stone-100 p-5 dark:bg-[#101010]">
                    <div className="mx-auto flex max-w-3xl flex-col gap-4">
                        <div className="flex items-center justify-between gap-3">
                            <div>
                                <div className="text-lg font-semibold">{currentScreen ? `第 ${currentScreen.index} 屏：${currentScreen.title}` : "当前屏"}</div>
                                <div className="mt-1 text-xs text-stone-600 dark:text-stone-400">{currentScreen?.goal || "左侧输入商品信息后，系统会直接生成第一屏"}</div>
                            </div>
                            {currentScreen?.status ? <Tag color={currentScreen.status === "ready" ? "success" : currentScreen.status === "generating" ? "processing" : currentScreen.status === "failed" ? "error" : "default"}>{screenStatusLabel(currentScreen.status)}</Tag> : null}
                        </div>

                        <div className="flex h-[640px] min-h-[420px] items-center justify-center overflow-hidden rounded-lg border border-stone-200 bg-white p-4 dark:border-white/10 dark:bg-black/40">
                            {currentScreen?.status === "generating" ? (
                                <div className="flex flex-col items-center gap-3 text-stone-500 dark:text-stone-400">
                                    <LoaderCircle className="size-8 animate-spin" />
                                    正在生成图片
                                </div>
                            ) : currentScreen?.imageUrl ? (
                                <img src={currentScreen.imageUrl} alt="" className="block max-h-full max-w-full rounded-md object-contain" draggable={false} />
                            ) : (
                                <div className="text-center text-sm text-stone-500 dark:text-stone-500">
                                    <Wand2 className="mx-auto mb-3 size-8 opacity-60" />
                                    等待生成第一屏
                                </div>
                            )}
                        </div>

                        <div className="rounded-lg border border-stone-200 bg-white p-3 dark:border-white/10 dark:bg-[#171717]">
                            <div className="mb-3 rounded-lg border border-stone-200 bg-stone-50 p-3 dark:border-white/10 dark:bg-white/[0.03]">
                                <div className="flex flex-wrap items-center gap-2">
                                    <div className="min-w-24 text-sm font-medium text-stone-800 dark:text-stone-200">生图模型</div>
                                    <div className="min-w-[220px] flex-1">
                                        <ModelPicker config={effectiveConfig} value={effectiveConfig.imageModel || effectiveConfig.model} onChange={setImageModel} onMissingConfig={() => openConfigDialog(true)} type="image" fullWidth />
                                    </div>
                                    <button type="button" className="flex h-8 items-center gap-1.5 rounded-full border border-stone-200 px-3 text-xs text-stone-700 transition hover:border-stone-400 dark:border-white/10 dark:text-stone-300 dark:hover:border-white/25" onClick={() => setCenterImageSettingsOpen((value) => !value)}>
                                        <span>画质与比例</span>
                                        <ChevronDown className={cn("size-3.5 transition", centerImageSettingsOpen && "rotate-180")} />
                                    </button>
                                </div>
                                {centerImageSettingsOpen ? <ImageSettingsPanel config={imageConfig} onConfigChange={updateConfig} theme={theme} showTitle={false} maxCount={1} quickCount={1} showCount={false} className="mt-3 space-y-4" /> : null}
                            </div>
                            <Input.TextArea disabled={isRunning} value={feedback} onChange={(event) => setFeedback(event.target.value)} rows={3} placeholder={currentScreen?.index === 1 ? "输入对第一屏的修改建议。系统会调整整体设计方案并重新生成第一屏。" : "输入对当前屏的局部修改建议。系统只改写当前屏提示词并重新生成。"} />
                            <div className="mt-3 flex flex-wrap justify-between gap-2">
                                <Space wrap>
                                    <Button icon={<RefreshCw className="size-4" />} disabled={!currentScreen || isRunning} onClick={() => void regenerateCurrent()}>
                                        重新生成
                                    </Button>
                                    <Button icon={<Upload className="size-4" />} disabled={!currentScreen || isRunning} onClick={() => currentReplaceInputRef.current?.click()}>
                                        替换本地图片
                                    </Button>
                                    <Button type="primary" icon={<Wand2 className="size-4" />} disabled={!currentScreen || isRunning || !feedback.trim()} onClick={() => void modifyCurrentScreen()}>
                                        按建议修改
                                    </Button>
                                </Space>
                                <Button type="primary" disabled={!currentScreen?.imageUrl || isRunning || !plan || currentScreen.index >= plan.screens.length} onClick={() => void generateNextScreen()}>
                                    生成下一张
                                </Button>
                            </div>
                            <input
                                ref={currentReplaceInputRef}
                                type="file"
                                accept="image/*"
                                className="hidden"
                                onChange={(event) => {
                                    void replaceCurrentImage(event.target.files);
                                    event.target.value = "";
                                }}
                            />
                            {failedScreens.length ? (
                                <div className="mt-3 flex flex-wrap gap-2 rounded-lg border border-red-200 bg-red-50 p-2 dark:border-red-400/20 dark:bg-red-500/10">
                                    {failedScreens.map((screen) => (
                                        <Button key={screen.index} size="small" danger icon={<RefreshCw className="size-3.5" />} disabled={isRunning} onClick={() => void retryScreen(screen.index)}>
                                            第 {screen.index} 屏失败，重新生成
                                        </Button>
                                    ))}
                                </div>
                            ) : null}
                        </div>
                        {generatingScreen ? (
                            <button
                                type="button"
                                className={cn(
                                    "flex w-full items-center justify-center gap-2 rounded-lg border px-3 py-2 text-sm transition",
                                    generatingScreen.index === currentIndex ? "border-blue-400/60 bg-blue-500/10 text-blue-700 dark:border-blue-400/40 dark:text-blue-100" : "border-stone-200 bg-white text-stone-700 hover:border-blue-400/50 hover:text-blue-700 dark:border-white/10 dark:bg-white/[0.03] dark:text-stone-300 dark:hover:text-blue-100",
                                )}
                                onClick={() => setCurrentIndex(generatingScreen.index)}
                            >
                                <LoaderCircle className="size-4 animate-spin" />
                                <span>正在生成第 {generatingScreen.index} 屏</span>
                                {generatingScreen.index === currentIndex ? <span className="text-xs text-blue-500 dark:text-blue-200/70">当前查看中</span> : <span className="text-xs text-blue-500 dark:text-blue-200/70">点击切回当前生成屏</span>}
                            </button>
                        ) : null}
                    </div>
                </section>

                <aside className="min-h-0 overflow-y-auto border-l border-stone-200 bg-white p-4 dark:border-white/10 dark:bg-[#171717]">
                    <div className="mb-3 flex items-center justify-between gap-3">
                        <div>
                            <div className="font-semibold">实时长图预览</div>
                            <div className="mt-1 text-xs text-stone-600 dark:text-stone-400">{generatedScreens.length ? `${generatedScreens.length} 屏已生成` : "生成后自动拼接"}</div>
                        </div>
                        <Space size={6}>
                            <Button size="small" icon={<Eye className="size-4" />} disabled={!generatedScreens.length} onClick={() => void openLongPreview()}>
                                预览
                            </Button>
                            <Button size="small" icon={<Download className="size-4" />} disabled={!generatedScreens.length} onClick={() => void exportLongImage()}>
                                导出
                            </Button>
                        </Space>
                    </div>
                    <div className="overflow-hidden rounded-md border border-stone-200 bg-stone-100 dark:border-white/10 dark:bg-black">
                        {generatedScreens.length ? (
                            generatedScreens.map((screen) => (
                                <button key={screen.index} type="button" className={cn("block w-full cursor-pointer border-0 bg-transparent p-0", screen.index === currentIndex && "ring-2 ring-inset ring-stone-900/80 dark:ring-white/80")} onClick={() => setCurrentIndex(screen.index)}>
                                    <img src={screen.imageUrl} alt="" className="block w-full border-0 p-0" style={{ margin: 0 }} />
                                </button>
                            ))
                        ) : (
                            <div className="grid min-h-96 place-items-center px-6 text-center text-sm text-stone-500 dark:text-stone-500">暂无预览</div>
                        )}
                    </div>
                    <Button className="mt-3" block icon={<Plus className="size-4" />} disabled={isRunning} onClick={openAddScreen}>
                        添加一屏
                    </Button>
                </aside>
            </div>

            <Modal title="分屏提示词确认" open={planEditorOpen} onCancel={() => setPlanEditorOpen(false)} onOk={applyPromptPlan} okText="应用提示词" cancelText="返回修改" width={980}>
                <div className="max-h-[70vh] space-y-4 overflow-y-auto pr-2">
                    <div>
                        <div className="mb-1 text-sm font-medium text-stone-700 dark:text-stone-200">整体风格</div>
                        <Input.TextArea value={draftStyleSummary} rows={3} onChange={(event) => setDraftStyleSummary(event.target.value)} />
                    </div>
                    {draftScreens.map((screen, index) => (
                        <div key={screen.index} className="rounded-lg border border-stone-200 p-3 dark:border-white/10">
                            <div className="mb-2 flex items-center justify-between gap-2">
                                <Tag color="blue">第 {index + 1} 屏</Tag>
                                <Input
                                    value={screen.title}
                                    className="max-w-xs"
                                    placeholder="屏幕标题"
                                    onChange={(event) =>
                                        setDraftScreens((items) =>
                                            items.map((item, itemIndex) =>
                                                itemIndex === index
                                                    ? {
                                                          ...item,
                                                          title: event.target.value,
                                                      }
                                                    : item,
                                            ),
                                        )
                                    }
                                />
                            </div>
                            <Input className="mb-2" value={screen.goal} placeholder="本屏目的" onChange={(event) => setDraftScreens((items) => items.map((item, itemIndex) => (itemIndex === index ? { ...item, goal: event.target.value } : item)))} />
                            <Input.TextArea value={screen.prompt} rows={6} placeholder="生图提示词" onChange={(event) => setDraftScreens((items) => items.map((item, itemIndex) => (itemIndex === index ? { ...item, prompt: event.target.value } : item)))} />
                        </div>
                    ))}
                </div>
            </Modal>

            <Modal title="选择生成模式" open={generationModeOpen} onCancel={() => setGenerationModeOpen(false)} footer={null} width={640}>
                <div className="grid gap-3 sm:grid-cols-2">
                    <button type="button" className="rounded-lg border border-stone-200 p-4 text-left transition hover:border-blue-400 hover:bg-blue-50 dark:border-white/10 dark:hover:bg-blue-500/10" onClick={() => void startGenerationWithMode("precise")}>
                        <div className="mb-2 flex items-center gap-2 text-base font-semibold">
                            <Sparkles className="size-4" />
                            精细模式
                        </div>
                        <div className="text-sm leading-6 text-stone-600 dark:text-stone-400">按顺序生成。第二屏以后默认带第一屏和上一屏作为参考，连贯性更好。</div>
                    </button>
                    <button type="button" className="rounded-lg border border-stone-200 p-4 text-left transition hover:border-blue-400 hover:bg-blue-50 dark:border-white/10 dark:hover:bg-blue-500/10" onClick={() => void startGenerationWithMode("rough")}>
                        <div className="mb-2 flex items-center gap-2 text-base font-semibold">
                            <Wand2 className="size-4" />
                            粗糙模式
                        </div>
                        <div className="text-sm leading-6 text-stone-600 dark:text-stone-400">先生成第一屏，再并发生成其他屏。后续屏以第一屏为风格参考，速度更快。</div>
                    </button>
                </div>
            </Modal>

            <Modal title="添加一屏" open={addScreenOpen} onCancel={() => setAddScreenOpen(false)} footer={null} width={620}>
                <div className="space-y-3">
                    <Input.TextArea value={addScreenPrompt} rows={4} onChange={(event) => setAddScreenPrompt(event.target.value)} placeholder="可选：输入这一屏要展示的内容或生图提示词" />
                    <div className="flex flex-wrap gap-2">
                        <Button icon={<Upload className="size-4" />} onClick={() => addScreenUploadInputRef.current?.click()}>
                            上传本地图片
                        </Button>
                        <Button type="primary" icon={<Wand2 className="size-4" />} disabled={!plan || isRunning} onClick={() => void addScreenByAi()}>
                            AI 生成
                        </Button>
                    </div>
                    <input
                        ref={addScreenUploadInputRef}
                        type="file"
                        accept="image/*"
                        className="hidden"
                        onChange={(event) => {
                            void addScreenFromUpload(event.target.files);
                            event.target.value = "";
                        }}
                    />
                </div>
            </Modal>

            <Modal title="长图预览" open={previewOpen} onCancel={closeLongPreview} footer={null} width={980}>
                <div className="mb-2 text-xs text-stone-500 dark:text-stone-400">滚动鼠标缩放，拖动滚动条查看长图。</div>
                <div className="max-h-[72vh] overflow-auto rounded-lg bg-stone-100 p-3 dark:bg-black" onWheel={handlePreviewWheel}>
                    {previewImageUrl ? <img src={previewImageUrl} alt="" className="mx-auto block origin-top" style={{ width: `${previewScale * 100}%`, maxWidth: "none" }} /> : null}
                </div>
            </Modal>

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
        <section className="rounded-lg border border-stone-200 bg-stone-50 p-3 dark:border-white/10 dark:bg-white/[0.035]">
            <div className="mb-2 text-sm font-medium text-stone-800 dark:text-stone-200">{title}</div>
            {children}
        </section>
    );
}

function buildPlanPrompt(input: { productInfo: string; styleRequest: string; platform: string; screenCount: number; referenceSummaries?: string }) {
    const referenceBlock = input.referenceSummaries?.trim()
        ? `
参考图/竞品图按用户排序提取到的信息：
${input.referenceSummaries}

请把这些参考信息作为风格、构图、卖点呈现和视觉顺序的依据。越靠前的参考图优先级越高，但不要抄袭具体品牌标识，不要虚构用户没有提供的参数。`
        : "";
    return `
你是资深电商详情页设计总监和 AI 生图提示词工程师。请根据用户资料，一次性规划完整电商详情页长图，并写好每一屏的生图提示词。

要求：
1. 目标平台：${input.platform}
2. 屏数：${input.screenCount}
3. 不展示方案给用户，但系统会保存你的 JSON，用于逐屏生成。
4. 第一屏必须是整套详情页风格基调。
5. 后续每一屏都会默认参考第一屏完整图和上一屏底部衔接条，所以提示词要强调风格继承、边缘衔接，但不要让下一屏复制上一屏底部的具体物体或局部画面。
6. 不要虚构用户未提供的认证、销量、功效、专利、检测报告、排名、医师推荐等信息。
7. 图片内中文文字要少而准，参数类信息只能使用用户提供的真实内容。
8. 每屏都是完整竖版详情页模块，不是短海报放在空白长画布中间。

商品信息：
${input.productInfo}
${referenceBlock}

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

function buildPlanRepairPrompt(content: string, screenCount: number) {
    return `
下面内容本应是电商详情图分屏方案 JSON，但格式不合格。请只根据原内容修复为严格 JSON，不要补充解释，不要 Markdown。

必须符合：
{
  "styleSummary": "整套详情页视觉风格摘要",
  "screens": [
    {"index":1,"title":"屏幕标题","goal":"本屏目的","prompt":"完整生图提示词"}
  ]
}

要求 screens 数量为 ${screenCount}，如果原内容不足，请按同一商品和同一视觉风格补齐。

原内容：
${content}
`.trim();
}

function buildImagePrompt(plan: DetailPlan, screen: DetailPlanScreen, index: number, mode: DetailGenerationMode, includeCurrent: boolean) {
    const referenceGuide =
        index === 1
            ? "这是整套详情页的第一屏。参考图主要来自用户上传的商品图/竞品图，请准确保持产品外观、材质、结构和白灰科技感，并建立整套长图的视觉基调。"
            : mode === "rough"
              ? "参考图片顺序：图一 = 系统参考图片编号中的图片1，也就是第一屏生成图，是全局风格基调。当前屏请以图一保持产品质感、色调、光影、字体氛围和高级感，但不要复制第一屏版式或首屏大标题结构。"
              : "参考图片顺序：图一 = 系统参考图片编号中的图片1，也就是第一屏生成图，是全局风格基调；图二 = 系统参考图片编号中的图片2，也就是上一屏底部衔接条，不是上一屏完整图。图二只用于学习上一屏最底部边缘的平均颜色、亮度、柔和光影、雾化感和背景方向，不要复制图二里的任何具体物体或局部画面。";
    const currentGuide = !includeCurrent
        ? ""
        : index === 1
          ? "如果还提供了当前屏修改前的旧图，它只用于理解第一屏原本内容，请根据用户要求局部调整，不要照搬旧图。"
          : mode === "rough"
            ? "如果还提供了图二，它对应系统参考图片编号中的图片2，是当前屏修改前的旧图，只用于理解本屏原本内容，不要让图二改变图一的风格优先级。"
            : "如果还提供了图三，它对应系统参考图片编号中的图片3，是当前屏修改前的旧图，只用于理解本屏原本内容，不要让图三改变图一和图二的优先级。";
    const continuity =
        index === 1
            ? "第一屏底部也要为下一屏预留可衔接区域，避免主体、标题、图标或复杂纹理贴近底边。"
            : "当前屏是完整详情页长图中的后续内容屏，不是第一屏，不是主视觉海报。请根据图一统一风格，根据图二处理顶部边缘衔接，但不要把上一屏下半段接到本屏顶部。";
    return `
${screen.prompt}

全局风格摘要：
${plan.styleSummary}

参考图说明：
${referenceGuide}
${currentGuide}

衔接要求：
${continuity}
1. 当前屏顶部 20%-25% 是无主体衔接安全区，只能是低复杂度、可延展、柔和的浅色背景。
2. 顶部安全区禁止出现主体产品、包装、宠物、食盆、食物、零件、重要标题、参数文字、图标组、LOGO、边框、裁切物体或复杂结构。
3. 不要复制、重画、拼接图二中的任何可识别内容；图二只作为边缘色彩和光影样本。
4. 过渡区域不需要全纯色，可以使用低复杂度的浅灰白背景、柔和气流、轻雾、淡光影、简单曲线或非常简洁的纹理，但不要出现难以对接的复杂图案、硬边框、强分割线、页面框线。
5. 当前屏底部 15%-18% 也要为下一屏预留自然衔接区域，保持低复杂度、可延展、无重要内容。
6. 主体产品、宠物、爆炸结构、卖点图标和主要文字都放在中间区域，避免贴近上下边缘。
7. 第二屏以后的内容屏不要重复第一屏的首屏大标题、主视觉封面结构或整屏包装海报构图。
8. 保持商品外观、结构、颜色、包装和品牌视觉特征一致。
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

function parseDetailLlmResponse(text: string): { code: number; data?: string; msg?: string } {
    try {
        return JSON.parse(text) as { code: number; data?: string; msg?: string };
    } catch {
        const compact = text.replace(/\s+/g, " ").trim();
        const looksLikeHtml = compact.startsWith("<") || compact.toLowerCase().includes("<html");
        return {
            code: 1,
            msg: looksLikeHtml ? "详情图提示词接口返回了网页内容，请检查部署是否最新、反向代理是否正确转发 /api/detail-llm，或后台请求地址是否填成了网页地址。" : compact.slice(0, 160) || "详情图提示词接口返回格式异常",
        };
    }
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

async function buildBottomSeamReference(screen: DetailScreen & { imageUrl: string; storageKey: string }): Promise<DetailReference> {
    const sourceDataUrl = await imageToDataUrl({ url: screen.imageUrl, storageKey: screen.storageKey });
    const seamDataUrl = await createBottomSeamDataUrl(sourceDataUrl);
    return {
        id: `screen-${screen.index}-bottom-seam`,
        name: `screen-${screen.index}-bottom-seam.png`,
        type: "image/png",
        dataUrl: seamDataUrl,
        url: seamDataUrl,
        storageKey: `seam:${screen.storageKey}`,
    };
}

async function createBottomSeamDataUrl(url: string) {
    const image = await loadImage(url);
    const width = image.naturalWidth || image.width;
    const height = image.naturalHeight || image.height;
    const seamHeight = Math.max(80, Math.round(height * SEAM_REFERENCE_RATIO));
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("浏览器不支持衔接参考图处理");

    context.fillStyle = "#f6f7ef";
    context.fillRect(0, 0, width, height);

    const blurPadding = Math.round(seamHeight * 0.16);
    context.save();
    context.filter = `blur(${Math.max(8, Math.round(seamHeight * 0.04))}px)`;
    context.drawImage(image, 0, height - seamHeight, width, seamHeight, -blurPadding, -blurPadding, width + blurPadding * 2, seamHeight + blurPadding * 2);
    context.restore();

    const fade = context.createLinearGradient(0, 0, 0, Math.round(seamHeight * 1.9));
    fade.addColorStop(0, "rgba(246, 247, 239, 0.08)");
    fade.addColorStop(0.5, "rgba(246, 247, 239, 0.32)");
    fade.addColorStop(1, "rgba(246, 247, 239, 0.92)");
    context.fillStyle = fade;
    context.fillRect(0, 0, width, Math.round(seamHeight * 1.9));

    return canvas.toDataURL("image/png");
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
