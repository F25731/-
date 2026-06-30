"use client";

import { useMemo } from "react";
import { create } from "zustand";
import { persist } from "zustand/middleware";

import { apiGet } from "@/services/api/request";
import type { AdminPublicSettings } from "@/services/api/admin";
import { normalizeImageApiKeys, normalizeImageKeyTier, type ImageKeyTier } from "@/types/api-keys";

export const DEFAULT_POOL_API_BASE_URL = "https://api.zmoapi.cn";
export const FIXED_IMAGE_MODEL = "gpt-image-2";
const MAX_IMAGE_GENERATION_COUNT = 8;
const ALLOWED_IMAGE_SIZES = new Set(["auto", "1:1", "16:9", "4:3", "3:4", "9:16"]);

export type AiConfig = {
    channelMode: "remote" | "local";
    baseUrl: string;
    apiKey: string;
    imageTier: ImageKeyTier;
    model: string;
    imageModel: string;
    videoModel: string;
    textModel: string;
    videoSeconds: string;
    vquality: string;
    systemPrompt: string;
    models: string[];
    quality: string;
    size: string;
    count: string;
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
    textModel: "",
    videoSeconds: "6",
    vquality: "720",
    systemPrompt: "",
    models: [],
    quality: "auto",
    size: "auto",
    count: "1",
};

type ConfigStore = {
    config: AiConfig;
    publicSettings: AdminPublicSettings | null;
    isPublicSettingsLoading: boolean;
    isConfigOpen: boolean;
    shouldPromptContinue: boolean;
    updateConfig: <K extends keyof AiConfig>(key: K, value: AiConfig[K]) => void;
    loadPublicSettings: () => Promise<void>;
    isAiConfigReady: (config: AiConfig, model: string) => boolean;
    openConfigDialog: (shouldPromptContinue?: boolean) => void;
    setConfigDialogOpen: (isOpen: boolean) => void;
    clearPromptContinue: () => void;
};

function resolveEffectiveConfig(config: AiConfig, modelChannel: AdminPublicSettings["modelChannel"] | null): AiConfig {
    // local 模式:走知梦号池(向后兼容)
    if (config.channelMode === "local") {
        return {
            ...config,
            channelMode: "local",
            baseUrl: DEFAULT_POOL_API_BASE_URL,
            model: config.model || FIXED_IMAGE_MODEL,
            imageModel: config.imageModel || FIXED_IMAGE_MODEL,
            videoModel: config.videoModel || FIXED_IMAGE_MODEL,
            textModel: config.textModel || FIXED_IMAGE_MODEL,
            models: config.models.length > 0 ? config.models : [FIXED_IMAGE_MODEL],
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
            textModel: FIXED_IMAGE_MODEL,
            models: [FIXED_IMAGE_MODEL],
        };
    }

    return {
        ...config,
        channelMode: "remote",
        models: modelChannel.availableModels || [],
        model: config.model || modelChannel.defaultModel || modelChannel.defaultImageModel || "",
        imageModel: config.imageModel || modelChannel.defaultImageModel || "",
        videoModel: config.videoModel || modelChannel.defaultVideoModel || "",
        textModel: config.textModel || modelChannel.defaultTextModel || "",
        systemPrompt: config.systemPrompt || modelChannel.systemPrompt || "",
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
    return Boolean(model.trim()) && (config.channelMode === "remote" || Boolean(readAuthToken(config.imageTier)));
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

// 新增:读取指定模型的 API Key
function readModelApiKey(model: string): string {
    if (typeof window === "undefined") return "";
    try {
        const parsed = JSON.parse(window.localStorage.getItem("infinite-canvas-auth-token-v1") || "{}") as { state?: { modelKeys?: Record<string, string> } };
        return String(parsed.state?.modelKeys?.[model] || "").trim();
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
            isAiConfigReady: (config, model) => isAiConfigReady(config, model),
            openConfigDialog: (shouldPromptContinue = false) => set({ isConfigOpen: true, shouldPromptContinue }),
            setConfigDialogOpen: (isConfigOpen) => set({ isConfigOpen }),
            clearPromptContinue: () => set({ shouldPromptContinue: false }),
        }),
        {
            name: CONFIG_STORE_KEY,
            version: 3,
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
            return readAuthToken(config.imageTier);
        }
        // remote 模式下使用当前选中模型的密钥
        return readModelApiKey(effectiveConfig.model || effectiveConfig.imageModel || "");
    }, [effectiveConfig.channelMode, effectiveConfig.model, effectiveConfig.imageModel, config.imageTier]);

    return useMemo(() => ({ ...effectiveConfig, apiKey: authToken }), [authToken, effectiveConfig]);
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
