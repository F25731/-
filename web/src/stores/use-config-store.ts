"use client";

import { useMemo } from "react";
import { create } from "zustand";
import { persist } from "zustand/middleware";

import { apiGet } from "@/services/api/request";
import type { AdminPublicSettings } from "@/services/api/admin";
import { DEFAULT_IMAGE_ASPECT_VALUES, IMAGE_MODEL_TIERS, type ImageModelTier } from "@/constant/image-model-options";
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
    type: "image" | "parse" | "prompt" | "detail_prompt";
    apiUrl: string;
    tierModels?: Record<string, string>;
    defaultTier?: string;
    supportedSizes?: string[];
    referenceLimit?: number;
    isDefault?: boolean;
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
    parseModel: string;
    promptModel: string;
    textModel: string;
    systemPrompt: string;
    models: string[];
    quality: string;
    size: string;
    count: string;
    modelTypes: Record<string, "image" | "parse" | "prompt" | "detail_prompt">;
    modelSupportedSizes: Record<string, string[]>;
    modelTierOptions: Record<string, string[]>;
    modelDefaultTiers: Record<string, string>;
    modelReferenceLimits: Record<string, number>;
};

export const CONFIG_STORE_KEY = "infinite-canvas:ai_config_store";

export const defaultConfig: AiConfig = {
    channelMode: "local",
    baseUrl: DEFAULT_POOL_API_BASE_URL,
    apiKey: "",
    imageTier: "1k",
    model: "",
    imageModel: "",
    parseModel: "",
    promptModel: "",
    textModel: "",
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
        const parseModels = configuredModels.filter((model) => model.type === "parse").map((model) => model.name);
        const promptModels = configuredModels.filter((model) => model.type === "prompt").map((model) => model.name);
        const models = configuredModels.map((model) => model.name);
        const modelTypes = Object.fromEntries(configuredModels.map((model) => [model.name, model.type]));
        const modelSupportedSizes = Object.fromEntries(
            configuredModels.map((model) => [model.name, model.supportedSizes?.length ? model.supportedSizes : [...DEFAULT_IMAGE_ASPECT_VALUES]]),
        );
        const modelTierOptions = Object.fromEntries(configuredModels.map((model) => [model.name, model.type === "image" ? IMAGE_MODEL_TIERS.filter((tier) => model.tierModels?.[tier]) : []]));
        const modelDefaultTiers = Object.fromEntries(
            configuredModels.map((model) => [
                model.name,
                model.type === "image"
                    ? normalizeDefaultModelTier(
                          model.defaultTier,
                          IMAGE_MODEL_TIERS.filter((tier) => model.tierModels?.[tier]),
                      )
                    : "",
            ]),
        );
        const modelReferenceLimits = Object.fromEntries(configuredModels.map((model) => [model.name, normalizeReferenceLimit(model.referenceLimit)]));
        const imageModel = imageModels.includes(config.imageModel) ? config.imageModel : imageModels[0] || "";
        const parseModel = parseModels.includes(config.parseModel) ? config.parseModel : parseModels[0] || "";
        const promptModel = promptModels.includes(config.promptModel) ? config.promptModel : promptModels[0] || "";
        const model = models.includes(config.model) ? config.model : imageModel || parseModel || promptModel || "";
        const nextImageTier = normalizeImageTierForOptions(config.imageTier, modelTierOptions[imageModel || model], modelDefaultTiers[imageModel || model]);
        const size = normalizeModelSize(config.size, modelSupportedSizes[imageModel || model]);
        const runtime = resolveModelRuntimeConfig({ ...config, model, imageModel, parseModel, promptModel, imageTier: nextImageTier, size });
        return {
            ...config,
            channelMode: "local",
            baseUrl: runtime.baseUrl || config.baseUrl || DEFAULT_POOL_API_BASE_URL,
            apiKey: runtime.apiKey,
            model,
            imageModel,
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
            parseModel: config.parseModel || "",
            promptModel: config.promptModel || "",
            textModel: config.textModel || FIXED_IMAGE_MODEL,
            models: config.models.length > 0 ? config.models : [FIXED_IMAGE_MODEL],
            modelSupportedSizes: config.modelSupportedSizes || {},
            modelTierOptions: config.modelTierOptions || {},
            modelDefaultTiers: config.modelDefaultTiers || {},
            modelReferenceLimits: config.modelReferenceLimits || {},
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
            parseModel: "",
            promptModel: "",
            textModel: FIXED_IMAGE_MODEL,
            models: [FIXED_IMAGE_MODEL],
            modelSupportedSizes: {},
            modelTierOptions: {},
            modelDefaultTiers: {},
            modelReferenceLimits: {},
        };
    }

    return {
        ...config,
        channelMode: "remote",
        models: modelChannel.availableModels || [],
        model: config.model || modelChannel.defaultModel || modelChannel.defaultImageModel || "",
        imageModel: config.imageModel || modelChannel.defaultImageModel || "",
        parseModel: config.parseModel || "",
        promptModel: config.promptModel || "",
        textModel: config.textModel || modelChannel.defaultTextModel || "",
        systemPrompt: config.systemPrompt || modelChannel.systemPrompt || "",
        modelSupportedSizes: config.modelSupportedSizes || {},
        modelTierOptions: config.modelTierOptions || {},
        modelDefaultTiers: config.modelDefaultTiers || {},
        modelReferenceLimits: config.modelReferenceLimits || {},
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
    if (typeof window === "undefined") return { mode: "aggregate" as UserModelConfigMode, models: [], apiKeys: {} as Record<string, string>, aggregate: {} as StoredAggregateModelConfig };
    try {
        const parsed = JSON.parse(window.localStorage.getItem(USER_MODEL_CONFIG_KEY) || "{}") as StoredUserModelConfig;
        const sourceModels = normalizeStoredUserModels(parsed.models || []);
        const sharedApiKey = resolveStoredSharedApiKey(parsed);
        const aggregate = normalizeAggregateConfig({ apiKey: sharedApiKey });
        const apiKeys = sharedApiKey ? Object.fromEntries(sourceModels.map((model) => [model.id, sharedApiKey])) : {};
        return { mode: "aggregate" as UserModelConfigMode, models: sharedApiKey ? sourceModels : [], apiKeys, aggregate };
    } catch {
        return { mode: "aggregate" as UserModelConfigMode, models: [], apiKeys: {} as Record<string, string>, aggregate: {} as StoredAggregateModelConfig };
    }
}

export function resolveModelRuntimeConfig(config: AiConfig, modelName = config.model || config.imageModel || config.parseModel || config.promptModel) {
    const userModelConfig = readUserModelConfig();
    const model = userModelConfig.models.find((item) => item.name === modelName);
    if (!model) return { baseUrl: config.baseUrl, apiKey: config.apiKey };
    return { baseUrl: model.apiUrl, apiKey: userModelConfig.aggregate.apiKey || "", modelId: resolveRuntimeModelId(model, config.imageTier) };
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
                const sharedApiKey = resolveStoredSharedApiKey(parsed);
                const aggregate = normalizeAggregateConfig({ apiKey: sharedApiKey });
                window.localStorage.setItem(
                    USER_MODEL_CONFIG_KEY,
                    JSON.stringify({
                        ...parsed,
                        version: 4,
                        mode: "aggregate",
                        modelIds: undefined,
                        aggregate,
                        apiKeys: sharedApiKey ? Object.fromEntries(models.map((model) => [model.id, sharedApiKey])) : {},
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
                        parseModel: config.parseModel || "",
                        promptModel: config.promptModel || "",
                        modelTypes: config.modelTypes || {},
                        modelSupportedSizes: config.modelSupportedSizes || {},
                        modelTierOptions: config.modelTierOptions || {},
                        modelDefaultTiers: config.modelDefaultTiers || {},
                        modelReferenceLimits: config.modelReferenceLimits || {},
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

function normalizeModelSize(size: string, supportedSizes: readonly string[] | undefined) {
    const allowed = supportedSizes?.length ? supportedSizes : DEFAULT_IMAGE_ASPECT_VALUES;
    return allowed.includes(size) ? size : allowed[0] || "auto";
}

export function supportedImageSizes(config: AiConfig, modelName = config.model || config.imageModel): readonly string[] {
    return config.modelSupportedSizes[modelName] || [...DEFAULT_IMAGE_ASPECT_VALUES];
}

export function supportedImageTiers(config: AiConfig, modelName = config.model || config.imageModel): readonly string[] {
    const tiers = config.modelTierOptions[modelName] || [];
    return tiers.length ? tiers : [...IMAGE_MODEL_TIERS];
}

export function normalizeImageSizeForModel(config: AiConfig, modelName: string, size: string): string {
    return normalizeModelSize(size, supportedImageSizes(config, modelName));
}

export function normalizeImageTierForModel(config: AiConfig, modelName: string, tier: string): ImageKeyTier {
    const tiers = supportedImageTiers(config, modelName);
    return (tiers.includes(tier) ? tier : defaultImageTierForModel(config, modelName)) as ImageKeyTier;
}

export function defaultImageTierForModel(config: AiConfig, modelName: string): ImageKeyTier {
    return normalizeDefaultModelTier(config.modelDefaultTiers[modelName], supportedImageTiers(config, modelName)) as ImageKeyTier;
}

export function imageReferenceLimit(config: AiConfig, modelName = config.model || config.imageModel) {
    return normalizeReferenceLimit(config.modelReferenceLimits[modelName]);
}

function normalizeAggregateConfig(value?: StoredAggregateModelConfig): StoredAggregateModelConfig {
    return {
        apiKey: String(value?.apiKey || "").trim(),
        catalogs: {},
        checkedAt: undefined,
    };
}

export function normalizeModelApiUrl(value: string) {
    return value.trim().replace(/\/+$/, "");
}

function normalizeStoredUserModels(models: StoredUserModel[]) {
    return models.filter((model) => model.enabled && model.name && model.apiUrl);
}

function readStoredUserModelConfig() {
    if (typeof window === "undefined") return {} as StoredUserModelConfig;
    try {
        return JSON.parse(window.localStorage.getItem(USER_MODEL_CONFIG_KEY) || "{}") as StoredUserModelConfig;
    } catch {
        return {};
    }
}

function resolveStoredSharedApiKey(config: StoredUserModelConfig) {
    const aggregateKey = String(config.aggregate?.apiKey || "").trim();
    if (aggregateKey) return aggregateKey;
    return Object.values(config.apiKeys || {})
        .map((value) => String(value || "").trim())
        .find(Boolean) || "";
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
