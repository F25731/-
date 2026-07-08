"use client";

import { useMemo } from "react";
import { create } from "zustand";
import { persist } from "zustand/middleware";

import { apiGet, apiPost } from "@/services/api/request";
import type { AdminPublicSettings } from "@/services/api/admin";
import { DEFAULT_IMAGE_ASPECT_VALUES, IMAGE_MODEL_TIERS, type ImageModelTier } from "@/constant/image-model-options";
import { normalizeVideoCapabilities, type VideoModelCapabilities } from "@/constant/video-model-options";
import { normalizeImageApiKeys, normalizeImageKeyTier, type ImageKeyTier } from "@/types/api-keys";

export const DEFAULT_POOL_API_BASE_URL = "https://api.zmoapi.cn";
export const FIXED_IMAGE_MODEL = "gpt-image-2";
export const USER_MODEL_CONFIG_KEY = "user-model-config";
const MAX_IMAGE_GENERATION_COUNT = 8;
const ALLOWED_IMAGE_SIZES = new Set<string>(DEFAULT_IMAGE_ASPECT_VALUES);

export type StoredUserModel = {
    id: string;
    name: string;
    modelId?: string;
    type: "image" | "video" | "parse" | "prompt" | "detail_prompt";
    apiUrl: string;
    tierModels?: Record<string, string>;
    defaultTier?: string;
    supportedSizes?: string[];
    referenceLimit?: number;
    videoCapabilities?: VideoModelCapabilities;
    enabled: boolean;
};

export type UserModelConfigMode = "single" | "aggregate";

export type StoredAggregateModelConfig = {
    apiKey?: string;
    catalogs?: Record<string, string[]>;
    checkedAt?: number;
};

type StoredUserModelConfig = {
    mode?: UserModelConfigMode;
    aggregate?: StoredAggregateModelConfig;
    modelIds?: string[];
    apiKeys?: Record<string, string>;
    models?: StoredUserModel[];
};

export type AiConfig = {
    channelMode: "remote" | "local";
    baseUrl: string;
    apiKey: string;
    imageTier: ImageKeyTier;
    model: string;
    imageModel: string;
    videoModel: string;
    parseModel: string;
    promptModel: string;
    textModel: string;
    videoSeconds: string;
    vquality: string;
    systemPrompt: string;
    models: string[];
    quality: string;
    size: string;
    count: string;
    modelTypes: Record<string, "image" | "video" | "parse" | "prompt" | "detail_prompt">;
    modelSupportedSizes: Record<string, string[]>;
    modelTierOptions: Record<string, string[]>;
    modelDefaultTiers: Record<string, string>;
    modelReferenceLimits: Record<string, number>;
    modelVideoCapabilities: Record<string, Required<VideoModelCapabilities>>;
};

export const CONFIG_STORE_KEY = "infinite-canvas:ai_config_store";

export const defaultConfig: AiConfig = {
    channelMode: "local",
    baseUrl: DEFAULT_POOL_API_BASE_URL,
    apiKey: "",
    imageTier: "1k",
    model: "",
    imageModel: "",
    videoModel: "",
    parseModel: "",
    promptModel: "",
    textModel: "",
    videoSeconds: "6",
    vquality: "720",
    systemPrompt: "",
    models: [],
    quality: "auto",
    size: "auto",
    count: "1",
    modelTypes: {},
    modelSupportedSizes: {},
    modelTierOptions: {},
    modelDefaultTiers: {},
    modelReferenceLimits: {},
    modelVideoCapabilities: {},
};

type ConfigStore = {
    config: AiConfig;
    publicSettings: AdminPublicSettings | null;
    isPublicSettingsLoading: boolean;
    isConfigOpen: boolean;
    shouldPromptContinue: boolean;
    updateConfig: <K extends keyof AiConfig>(key: K, value: AiConfig[K]) => void;
    loadPublicSettings: () => Promise<void>;
    refreshUserModels: () => Promise<void>;
    isAiConfigReady: (config: AiConfig, model: string) => boolean;
    openConfigDialog: (shouldPromptContinue?: boolean) => void;
    setConfigDialogOpen: (isOpen: boolean) => void;
    clearPromptContinue: () => void;
};

function resolveEffectiveConfig(config: AiConfig, modelChannel: AdminPublicSettings["modelChannel"] | null): AiConfig {
    const userModelConfig = readUserModelConfig();
    if (userModelConfig.models.length > 0) {
        const configuredModels = userModelConfig.models;
        const imageModels = configuredModels.filter((model) => model.type === "image").map((model) => model.name);
        const videoModels = configuredModels.filter((model) => model.type === "video").map((model) => model.name);
        const parseModels = configuredModels.filter((model) => model.type === "parse").map((model) => model.name);
        const promptModels = configuredModels.filter((model) => model.type === "prompt").map((model) => model.name);
        const models = configuredModels.map((model) => model.name);
        const modelTypes = Object.fromEntries(configuredModels.map((model) => [model.name, model.type]));
        const modelVideoCapabilities: Record<string, Required<VideoModelCapabilities>> = Object.fromEntries(configuredModels.filter((model) => model.type === "video").map((model) => [model.name, normalizeVideoCapabilities(model.videoCapabilities)]));
        const modelSupportedSizes = Object.fromEntries(configuredModels.map((model) => [model.name, model.type === "video" ? modelVideoCapabilities[model.name]?.ratios || ["16:9", "9:16", "1:1"] : model.supportedSizes?.length ? model.supportedSizes : [...DEFAULT_IMAGE_ASPECT_VALUES]]));
        const modelTierOptions = Object.fromEntries(configuredModels.map((model) => [model.name, model.type === "image" ? IMAGE_MODEL_TIERS.filter((tier) => model.tierModels?.[tier]) : []]));
        const modelDefaultTiers = Object.fromEntries(configuredModels.map((model) => [model.name, model.type === "image" ? normalizeDefaultModelTier(model.defaultTier, IMAGE_MODEL_TIERS.filter((tier) => model.tierModels?.[tier])) : ""]));
        const modelReferenceLimits = Object.fromEntries(configuredModels.map((model) => [model.name, model.type === "video" ? normalizeVideoCapabilities(model.videoCapabilities).referenceImageLimit : normalizeReferenceLimit(model.referenceLimit)]));
        const imageModel = imageModels.includes(config.imageModel) ? config.imageModel : imageModels[0] || "";
        const videoModel = videoModels.includes(config.videoModel) ? config.videoModel : videoModels[0] || "";
        const parseModel = parseModels.includes(config.parseModel) ? config.parseModel : parseModels[0] || "";
        const promptModel = promptModels.includes(config.promptModel) ? config.promptModel : promptModels[0] || "";
        const model = models.includes(config.model) ? config.model : imageModel || videoModel || parseModel || promptModel || "";
        const nextImageTier = normalizeImageTierForOptions(config.imageTier, modelTierOptions[imageModel || model], modelDefaultTiers[imageModel || model]);
        const size = normalizeModelSize(config.size, modelSupportedSizes[imageModel || model]);
        const runtime = resolveModelRuntimeConfig({ ...config, model, imageModel, videoModel, parseModel, promptModel, imageTier: nextImageTier, size });
        return {
            ...config,
            channelMode: "local",
            baseUrl: runtime.baseUrl || config.baseUrl || DEFAULT_POOL_API_BASE_URL,
            apiKey: runtime.apiKey,
            model,
            imageModel,
            videoModel,
            parseModel,
            promptModel,
            imageTier: nextImageTier,
            textModel: models.includes(config.textModel) ? config.textModel : model,
            size,
            models,
            modelTypes,
            modelSupportedSizes,
            modelTierOptions,
            modelDefaultTiers,
            modelReferenceLimits,
            modelVideoCapabilities,
        };
    }

    // local 模式:走知梦号池(向后兼容)
    if (config.channelMode === "local") {
        return {
            ...config,
            channelMode: "local",
            baseUrl: DEFAULT_POOL_API_BASE_URL,
            model: config.model || FIXED_IMAGE_MODEL,
            imageModel: config.imageModel || FIXED_IMAGE_MODEL,
            videoModel: config.videoModel || FIXED_IMAGE_MODEL,
            parseModel: config.parseModel || "",
            promptModel: config.promptModel || "",
            textModel: config.textModel || FIXED_IMAGE_MODEL,
            models: config.models.length > 0 ? config.models : [FIXED_IMAGE_MODEL],
            modelSupportedSizes: config.modelSupportedSizes || {},
            modelTierOptions: config.modelTierOptions || {},
            modelDefaultTiers: config.modelDefaultTiers || {},
            modelReferenceLimits: config.modelReferenceLimits || {},
            modelVideoCapabilities: config.modelVideoCapabilities || {},
        };
    }

    // remote 模式:使用后台配置
    if (!modelChannel) {
        // 后台未配置,回退到 local 模式
        return {
            ...config,
            channelMode: "local",
            baseUrl: DEFAULT_POOL_API_BASE_URL,
            model: FIXED_IMAGE_MODEL,
            imageModel: FIXED_IMAGE_MODEL,
            videoModel: FIXED_IMAGE_MODEL,
            parseModel: "",
            promptModel: "",
            textModel: FIXED_IMAGE_MODEL,
            models: [FIXED_IMAGE_MODEL],
            modelSupportedSizes: {},
            modelTierOptions: {},
            modelDefaultTiers: {},
            modelReferenceLimits: {},
            modelVideoCapabilities: {},
        };
    }

    return {
        ...config,
        channelMode: "remote",
        models: modelChannel.availableModels || [],
        model: config.model || modelChannel.defaultModel || modelChannel.defaultImageModel || "",
        imageModel: config.imageModel || modelChannel.defaultImageModel || "",
        videoModel: config.videoModel || modelChannel.defaultVideoModel || "",
        parseModel: config.parseModel || "",
        promptModel: config.promptModel || "",
        textModel: config.textModel || modelChannel.defaultTextModel || "",
        systemPrompt: config.systemPrompt || modelChannel.systemPrompt || "",
        modelSupportedSizes: config.modelSupportedSizes || {},
        modelTierOptions: config.modelTierOptions || {},
        modelDefaultTiers: config.modelDefaultTiers || {},
        modelReferenceLimits: config.modelReferenceLimits || {},
        modelVideoCapabilities: config.modelVideoCapabilities || {},
    };
}

function normalizeStoredImageSize(size: string | undefined) {
    const value = (size || "auto").trim();
    return ALLOWED_IMAGE_SIZES.has(value) ? value : "auto";
}

function normalizeStoredImageCount(count: string | undefined) {
    const value = Math.max(1, Math.min(MAX_IMAGE_GENERATION_COUNT, Math.floor(Math.abs(Number(count)) || 1)));
    return String(value);
}

function isAiConfigReady(config: AiConfig, model: string) {
    return Boolean(model.trim()) && (config.channelMode === "remote" || Boolean(resolveModelRuntimeConfig(config, model).apiKey || readAuthToken(config.imageTier)));
}

function readAuthToken(tier?: ImageKeyTier) {
    if (typeof window === "undefined") return "";
    try {
        const parsed = JSON.parse(window.localStorage.getItem("infinite-canvas-auth-token-v1") || "{}") as { state?: { token?: string; apiKeys?: Record<string, string> } };
        const imageTier = normalizeImageKeyTier(tier);
        const apiKeys = normalizeImageApiKeys({ ...(parsed.state?.apiKeys || {}), "1k": parsed.state?.apiKeys?.["1k"] || parsed.state?.token });
        return String(apiKeys[imageTier] || "").trim();
    } catch {
        return "";
    }
}

export function readUserModelConfig() {
    if (typeof window === "undefined") return { mode: "single" as UserModelConfigMode, models: [], apiKeys: {} as Record<string, string>, aggregate: {} as StoredAggregateModelConfig };
    try {
        const parsed = JSON.parse(window.localStorage.getItem(USER_MODEL_CONFIG_KEY) || "{}") as StoredUserModelConfig;
        const mode: UserModelConfigMode = parsed.mode === "aggregate" ? "aggregate" : "single";
        const selectedIds = new Set(parsed.modelIds || []);
        const sourceModels = normalizeStoredUserModels(parsed.models || []).filter((model) => !selectedIds.size || selectedIds.has(model.id));
        const apiKeys = parsed.apiKeys || {};
        const aggregate = normalizeAggregateConfig(parsed.aggregate);
        const models =
            mode === "aggregate"
                ? sourceModels.flatMap((model) => {
                      const next = filterAggregateModel(model, aggregate.catalogs || {});
                      return next ? [next] : [];
                  })
                : sourceModels.filter((model) => Boolean(apiKeys[model.id]?.trim()));
        return { mode, models, apiKeys, aggregate };
    } catch {
        return { mode: "single" as UserModelConfigMode, models: [], apiKeys: {} as Record<string, string>, aggregate: {} as StoredAggregateModelConfig };
    }
}

export function resolveModelRuntimeConfig(config: AiConfig, modelName = config.model || config.imageModel || config.videoModel || config.parseModel || config.promptModel) {
    const userModelConfig = readUserModelConfig();
    const model = userModelConfig.models.find((item) => item.name === modelName);
    if (!model) return { baseUrl: config.baseUrl, apiKey: config.apiKey };
    if (userModelConfig.mode === "aggregate") return { baseUrl: model.apiUrl, apiKey: userModelConfig.aggregate.apiKey || "", modelId: resolveRuntimeModelId(model, config.imageTier) };
    return { baseUrl: model.apiUrl, apiKey: String(userModelConfig.apiKeys[model.id] || "").trim(), modelId: resolveRuntimeModelId(model, config.imageTier) };
}

function readModelApiKey(model: string): string {
    if (typeof window === "undefined") return "";
    try {
        return resolveModelRuntimeConfig(defaultConfig, model).apiKey;
    } catch {
        return "";
    }
}

export const useConfigStore = create<ConfigStore>()(
    persist(
        (set, get) => ({
            config: defaultConfig,
            publicSettings: null,
            isPublicSettingsLoading: false,
            isConfigOpen: false,
            shouldPromptContinue: false,
            updateConfig: (key, value) =>
                set((state) => ({
                    config: {
                        ...state.config,
                        [key]: value,
                    },
                })),
            loadPublicSettings: async () => {
                if (get().isPublicSettingsLoading) return;
                set({ isPublicSettingsLoading: true });
                try {
                    set({ publicSettings: await apiGet<AdminPublicSettings>("/api/settings") });
                } finally {
                    set({ isPublicSettingsLoading: false });
                }
            },
            refreshUserModels: async () => {
                if (typeof window === "undefined") return;
                const models = normalizeStoredUserModels(await apiGet<StoredUserModel[]>("/api/models"));
                const parsed = readStoredUserModelConfig();
                const aggregate = normalizeAggregateConfig(parsed.aggregate);
                if (parsed.mode === "aggregate" && aggregate.apiKey) {
                    const baseUrls = Array.from(new Set(models.map((model) => normalizeModelApiUrl(model.apiUrl)).filter(Boolean)));
                    if (baseUrls.length) {
                        try {
                            aggregate.catalogs = normalizeAggregateConfig({ catalogs: await apiPost<Record<string, string[]>>("/api/aggregate-models", { baseUrls, apiKey: aggregate.apiKey }) }).catalogs;
                            aggregate.checkedAt = Date.now();
                        } catch {
                            // 保留上次检测结果，避免临时网络错误清空可用模型。
                        }
                    }
                }
                window.localStorage.setItem(
                    USER_MODEL_CONFIG_KEY,
                    JSON.stringify({
                        ...parsed,
                        version: 4,
                        mode: parsed.mode === "aggregate" ? "aggregate" : "single",
                        aggregate,
                        apiKeys: parsed.apiKeys || {},
                        models,
                        updatedAt: Date.now(),
                    }),
                );
                set((state) => ({
                    config: resolveEffectiveConfig({ ...state.config }, state.publicSettings?.modelChannel || null),
                }));
            },
            isAiConfigReady: (config, model) => isAiConfigReady(config, model),
            openConfigDialog: (shouldPromptContinue = false) => set({ isConfigOpen: true, shouldPromptContinue }),
            setConfigDialogOpen: (isConfigOpen) => set({ isConfigOpen }),
            clearPromptContinue: () => set({ shouldPromptContinue: false }),
        }),
        {
            name: CONFIG_STORE_KEY,
            version: 5,
            partialize: (state) => ({ config: state.config }),
            migrate: (persisted) => {
                const state = persisted as Partial<ConfigStore>;
                return {
                    ...state,
                    config: {
                        ...defaultConfig,
                        ...state.config,
                        imageTier: normalizeImageKeyTier(state.config?.imageTier),
                        quality: "auto",
                        size: normalizeStoredImageSize(state.config?.size),
                        count: normalizeStoredImageCount(state.config?.count),
                    },
                };
            },
            merge: (persisted, current) => {
                const config = { ...defaultConfig, ...((persisted as Partial<ConfigStore>).config || {}) };
                return {
                    ...current,
                    config: {
                        ...config,
                        apiKey: "",
                        imageTier: normalizeImageKeyTier(config.imageTier),
                        channelMode: config.channelMode || "local",
                        baseUrl: config.baseUrl || DEFAULT_POOL_API_BASE_URL,
                        quality: "auto",
                        size: normalizeStoredImageSize(config.size),
                        count: normalizeStoredImageCount(config.count),
                        videoSeconds: config.videoSeconds || "6",
                        vquality: config.vquality || "720",
                        parseModel: config.parseModel || "",
                        promptModel: config.promptModel || "",
                        modelTypes: config.modelTypes || {},
                        modelSupportedSizes: config.modelSupportedSizes || {},
                        modelTierOptions: config.modelTierOptions || {},
                        modelDefaultTiers: config.modelDefaultTiers || {},
                        modelReferenceLimits: config.modelReferenceLimits || {},
                        modelVideoCapabilities: config.modelVideoCapabilities || {},
                    },
                };
            },
        },
    ),
);

export function useEffectiveConfig() {
    const config = useConfigStore((state) => state.config);
    const modelChannel = useConfigStore((state) => state.publicSettings?.modelChannel || null);
    const effectiveConfig = useMemo(() => resolveEffectiveConfig(config, modelChannel), [config, modelChannel]);

    // 根据模式选择密钥
    const authToken = useMemo(() => {
        if (effectiveConfig.channelMode === "local") {
            return resolveModelRuntimeConfig(effectiveConfig).apiKey || readAuthToken(config.imageTier);
        }
        // remote 模式下使用当前选中模型的密钥
        return readModelApiKey(effectiveConfig.model || effectiveConfig.imageModel || effectiveConfig.parseModel || effectiveConfig.promptModel || "");
    }, [effectiveConfig.channelMode, effectiveConfig.model, effectiveConfig.imageModel, effectiveConfig.parseModel, effectiveConfig.promptModel, config.imageTier]);

    return useMemo(() => ({ ...effectiveConfig, apiKey: authToken }), [authToken, effectiveConfig]);
}

function resolveRuntimeModelId(model: StoredUserModel, imageTier: string) {
    if (model.type !== "image") return (model.modelId || model.name).trim();
    const tier = IMAGE_MODEL_TIERS.includes(imageTier as ImageModelTier) ? imageTier : "1k";
    return (model.tierModels?.[tier] || model.tierModels?.["1k"] || model.tierModels?.["512"] || model.tierModels?.["2k"] || model.tierModels?.["4k"] || model.modelId || model.name).trim();
}

function normalizeModelSize(size: string, supportedSizes: string[] | undefined) {
    const allowed = supportedSizes?.length ? supportedSizes : DEFAULT_IMAGE_ASPECT_VALUES;
    return allowed.includes(size) ? size : allowed[0] || "auto";
}

export function supportedImageSizes(config: AiConfig, modelName = config.model || config.imageModel) {
    return config.modelSupportedSizes[modelName] || [...DEFAULT_IMAGE_ASPECT_VALUES];
}

export function supportedImageTiers(config: AiConfig, modelName = config.model || config.imageModel) {
    const tiers = config.modelTierOptions[modelName] || [];
    return tiers.length ? tiers : [...IMAGE_MODEL_TIERS];
}

export function normalizeImageSizeForModel(config: AiConfig, modelName: string, size: string) {
    return normalizeModelSize(size, supportedImageSizes(config, modelName));
}

export function normalizeImageTierForModel(config: AiConfig, modelName: string, tier: string) {
    const tiers = supportedImageTiers(config, modelName);
    return tiers.includes(tier) ? tier : defaultImageTierForModel(config, modelName);
}

export function defaultImageTierForModel(config: AiConfig, modelName: string) {
    return normalizeDefaultModelTier(config.modelDefaultTiers[modelName], supportedImageTiers(config, modelName));
}

export function imageReferenceLimit(config: AiConfig, modelName = config.model || config.imageModel) {
    return normalizeReferenceLimit(config.modelReferenceLimits[modelName]);
}

function normalizeAggregateConfig(value?: StoredAggregateModelConfig): StoredAggregateModelConfig {
    const catalogs = Object.fromEntries(
        Object.entries(value?.catalogs || {})
            .map(([baseUrl, modelIds]) => [
                normalizeModelApiUrl(baseUrl),
                Array.from(new Set((modelIds || []).map((item) => String(item || "").trim()).filter(Boolean))),
            ])
            .filter(([baseUrl, modelIds]) => Boolean(baseUrl) && modelIds.length > 0),
    );
    return {
        apiKey: String(value?.apiKey || "").trim(),
        catalogs,
        checkedAt: value?.checkedAt,
    };
}

function filterAggregateModel(model: StoredUserModel, catalogs: Record<string, string[]>) {
    const available = new Set((catalogs[normalizeModelApiUrl(model.apiUrl)] || []).map((item) => item.trim()).filter(Boolean));
    if (!available.size) return null;
    if (model.type === "image") {
        const tierModels = Object.fromEntries(Object.entries(model.tierModels || {}).filter(([, modelId]) => available.has(String(modelId || "").trim())));
        if (!Object.keys(tierModels).length) return null;
        return { ...model, tierModels, defaultTier: normalizeDefaultModelTier(model.defaultTier, IMAGE_MODEL_TIERS.filter((tier) => tierModels[tier])) };
    }
    const modelId = (model.modelId || model.name).trim();
    return modelId && available.has(modelId) ? model : null;
}

export function normalizeModelApiUrl(value: string) {
    return value.trim().replace(/\/+$/, "");
}

function normalizeStoredUserModels(models: StoredUserModel[]) {
    return models.filter((model) => model.type !== "prompt" && model.enabled && model.name && model.apiUrl);
}

function readStoredUserModelConfig() {
    if (typeof window === "undefined") return {} as StoredUserModelConfig;
    try {
        return JSON.parse(window.localStorage.getItem(USER_MODEL_CONFIG_KEY) || "{}") as StoredUserModelConfig;
    } catch {
        return {};
    }
}

export function videoCapabilitiesForModel(config: AiConfig, modelName = config.videoModel || config.model) {
    return normalizeVideoCapabilities(config.modelVideoCapabilities?.[modelName]);
}

function normalizeReferenceLimit(value: number | undefined) {
    const next = Math.floor(Math.abs(Number(value)) || 4);
    return Math.max(1, Math.min(20, next));
}

function normalizeDefaultModelTier(defaultTier: string | undefined, tiers: readonly string[]) {
    const value = String(defaultTier || "").trim();
    if (tiers.includes(value)) return value;
    if (tiers.includes("1k")) return "1k";
    return tiers[0] || "1k";
}

function normalizeImageTierForOptions(tier: string, tiers: string[] | undefined, defaultTier: string | undefined): ImageKeyTier {
    const options = tiers?.length ? tiers : [...IMAGE_MODEL_TIERS];
    return (options.includes(tier) ? tier : normalizeDefaultModelTier(defaultTier, options)) as ImageKeyTier;
}

export function buildApiUrl(baseUrl: string, path: string) {
    const normalizedBaseUrl = resolvePoolApiBaseUrl(baseUrl);
    const apiBaseUrl = normalizedBaseUrl.endsWith("/v1") ? normalizedBaseUrl : `${normalizedBaseUrl}/v1`;
    return `${apiBaseUrl}${path}`;
}

export function buildPoolApiUrl(path: string) {
    const normalizedBaseUrl = resolvePoolApiBaseUrl(DEFAULT_POOL_API_BASE_URL).replace(/\/+$/, "");
    return `${normalizedBaseUrl}${path.startsWith("/") ? path : `/${path}`}`;
}

function resolvePoolApiBaseUrl(baseUrl: string) {
    return (baseUrl || DEFAULT_POOL_API_BASE_URL).trim().replace(/\/+$/, "") || DEFAULT_POOL_API_BASE_URL;
}
