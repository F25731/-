"use client";

import { create } from "zustand";
import { persist } from "zustand/middleware";

import { TOKEN_USAGE_AUTO_REFRESH_INTERVAL_MS, TOKEN_USAGE_REQUEST_DELAY_MS } from "@/constant/env";
import { AUTH_TOKEN_KEY, adminLogin, fetchCanvasCurrentUser, fetchImageTokenUsage, login, type AuthPayload, type AuthUser, type BalanceStatus, type CanvasAuthPayload } from "@/services/api/auth";
import { useConfigStore } from "@/stores/use-config-store";
import { firstAvailableImageKey, isImageTokenUnlimited, normalizeImageApiKeys, normalizeImageKeyTier, type ImageApiKeys, type ImageKeyTier, type ImageTokenUsage, type ImageTokenUsages } from "@/types/api-keys";

type AuthMode = "pool" | "admin";

type UserStore = {
    token: string;
    apiKeys: ImageApiKeys;
    apiKeyUsages: ImageTokenUsages;
    authMode: AuthMode;
    user: AuthUser | null;
    balanceStatus: BalanceStatus;
    apiKeyUsagesRefreshedAt: number;
    isReady: boolean;
    isLoading: boolean;
    setSession: (token: string, user: AuthUser, authMode?: AuthMode, apiKeys?: ImageApiKeys, apiKeyUsages?: ImageTokenUsages) => void;
    clearSession: () => void;
    hydrateUser: () => Promise<void>;
    refreshApiKeyUsages: (options?: { requestDelayMs?: number }) => Promise<ImageTokenUsages>;
    login: (payload: AuthPayload) => Promise<AuthUser>;
    adminLogin: (payload: CanvasAuthPayload) => Promise<AuthUser>;
};

function resolveTierKey(apiKeys: ImageApiKeys) {
    const configStore = useConfigStore.getState();
    const selectedTier = normalizeImageKeyTier(configStore.config.imageTier);
    const selectedKey = apiKeys[selectedTier]?.trim();
    if (selectedKey) return { tier: selectedTier, apiKey: selectedKey };
    return firstAvailableImageKey(apiKeys);
}

function syncConfigApiKey(apiKeys: ImageApiKeys, fallbackToken: string) {
    const selected = resolveTierKey(apiKeys);
    useConfigStore.getState().updateConfig("apiKey", selected?.apiKey || fallbackToken || "");
}

function ensureSelectedTier(apiKeys: ImageApiKeys) {
    const configStore = useConfigStore.getState();
    const selectedTier = normalizeImageKeyTier(configStore.config.imageTier);
    if (apiKeys[selectedTier]?.trim()) return;
    const first = firstAvailableImageKey(apiKeys);
    if (first) configStore.updateConfig("imageTier", first.tier);
}

function createStoredPoolUser(existingUser: AuthUser | null, balanceStatus: BalanceStatus, tier: ImageKeyTier, usage?: ImageTokenUsage): AuthUser {
    const baseUser: Pick<AuthUser, "id" | "username" | "displayName" | "avatarUrl" | "role" | "createdAt" | "updatedAt"> = existingUser || {
        id: tier,
        username: "知梦用户",
        displayName: "知梦用户",
        avatarUrl: "",
        role: "user" as const,
        createdAt: "",
        updatedAt: "",
    };
    return {
        ...baseUser,
        id: tier,
        credits: 0,
        quota: 0,
        used: 0,
        ...usageToUserBalance(usage),
        balanceStatus: usage ? "available" : balanceStatus,
        balanceTier: tier,
    };
}

function usageToUserBalance(usage?: ImageTokenUsage) {
    const unlimited = isImageTokenUnlimited(usage);
    return {
        credits: usage?.total_available || 0,
        quota: usage?.total_granted || 0,
        used: usage?.total_used || 0,
        unlimited,
        remaining: unlimited ? null : usage?.total_available || 0,
    };
}

function currentUserWithUsage(user: AuthUser | null, tier: ImageKeyTier, usage?: ImageTokenUsage, balanceStatus: BalanceStatus = "unknown") {
    return createStoredPoolUser(user, usage ? "available" : balanceStatus, tier, usage);
}

export const useUserStore = create<UserStore>()(
    persist(
        (set, get) => ({
            token: "",
            apiKeys: {},
            apiKeyUsages: {},
            authMode: "pool",
            user: null,
            balanceStatus: "unknown",
            apiKeyUsagesRefreshedAt: 0,
            isReady: false,
            isLoading: false,
            setSession: (token, user, authMode = "pool", apiKeys = {}, apiKeyUsages = {}) => {
                const normalizedKeys = authMode === "pool" ? normalizeImageApiKeys({ ...apiKeys, "1k": apiKeys["1k"] || token }) : {};
                ensureSelectedTier(normalizedKeys);
                syncConfigApiKey(normalizedKeys, authMode === "pool" ? token : "");
                set({ token, apiKeys: normalizedKeys, apiKeyUsages: authMode === "pool" ? apiKeyUsages : {}, apiKeyUsagesRefreshedAt: Object.keys(apiKeyUsages).length ? Date.now() : 0, user, authMode, balanceStatus: user.balanceStatus || "unknown", isReady: true });
            },
            clearSession: () => {
                useConfigStore.getState().updateConfig("apiKey", "");
                set({ token: "", apiKeys: {}, apiKeyUsages: {}, apiKeyUsagesRefreshedAt: 0, authMode: "pool", user: null, balanceStatus: "unknown", isReady: true });
            },
            hydrateUser: async () => {
                const token = get().token;
                const authMode = get().authMode;
                const apiKeys = normalizeImageApiKeys(get().apiKeys);
                const apiKeyUsages = get().apiKeyUsages || {};
                if (!token) {
                    set({ user: null, apiKeyUsages: {}, apiKeyUsagesRefreshedAt: 0, balanceStatus: "unknown", isReady: true, isLoading: false });
                    return;
                }
                if (authMode === "admin") {
                    set({ isLoading: true });
                    try {
                        const user = await fetchCanvasCurrentUser(token);
                        set({ user, apiKeys: {}, apiKeyUsages: {}, apiKeyUsagesRefreshedAt: 0, balanceStatus: "unknown", isReady: true, isLoading: false });
                    } catch {
                        set({ token: "", apiKeys: {}, apiKeyUsages: {}, apiKeyUsagesRefreshedAt: 0, authMode: "pool", user: null, balanceStatus: "unknown", isReady: true, isLoading: false });
                    }
                    return;
                }
                ensureSelectedTier(apiKeys);
                syncConfigApiKey(apiKeys, token);
                const selected = resolveTierKey(apiKeys);
                const usage = selected ? apiKeyUsages[selected.tier] : undefined;
                const fallbackUser = selected ? createStoredPoolUser(get().user, get().balanceStatus || "unknown", selected.tier, usage) : get().user;
                const hasAnyUsage = Object.keys(apiKeyUsages).length > 0;
                const shouldRefresh = shouldAutoRefreshTokenUsage(get().apiKeyUsagesRefreshedAt, hasAnyUsage);
                set({ user: fallbackUser, apiKeys, apiKeyUsages, balanceStatus: usage ? "available" : shouldRefresh ? "checking" : "unknown", isReady: true, isLoading: false });
                if (shouldRefresh) {
                    try {
                        await get().refreshApiKeyUsages();
                    } catch {
                        set({ balanceStatus: "unavailable" });
                    }
                }
            },
            refreshApiKeyUsages: async (options) => {
                const apiKeys = normalizeImageApiKeys(get().apiKeys);
                const requestDelayMs = options?.requestDelayMs ?? TOKEN_USAGE_REQUEST_DELAY_MS;
                const usages: ImageTokenUsages = {};
                let failedMessage = "";
                let requestCount = 0;
                for (const [tier, apiKey] of Object.entries(apiKeys) as Array<[ImageKeyTier, string]>) {
                    try {
                        if (requestCount > 0 && requestDelayMs > 0) await sleep(requestDelayMs);
                        usages[tier] = await fetchImageTokenUsage(apiKey);
                        requestCount += 1;
                    } catch (error) {
                        failedMessage ||= error instanceof Error ? error.message : "余额刷新失败";
                    }
                }
                const selected = resolveTierKey(apiKeys);
                const usage = selected ? usages[selected.tier] : undefined;
                set({
                    apiKeys,
                    apiKeyUsages: usages,
                    apiKeyUsagesRefreshedAt: Date.now(),
                    user: selected ? currentUserWithUsage(get().user, selected.tier, usage, failedMessage ? "unavailable" : "unknown") : get().user,
                    balanceStatus: failedMessage ? "unavailable" : usage ? "available" : "unknown",
                });
                if (failedMessage) throw new Error(failedMessage);
                return usages;
            },
            login: async (payload) => {
                set({ isLoading: true });
                try {
                    const session = await login(payload);
                    const apiKeys = normalizeImageApiKeys(session.apiKeys);
                    const apiKeyUsages = session.apiKeyUsages || {};
                    ensureSelectedTier(apiKeys);
                    syncConfigApiKey(apiKeys, session.token);
                    set({ token: session.token, apiKeys, apiKeyUsages, apiKeyUsagesRefreshedAt: Object.keys(apiKeyUsages).length ? Date.now() : 0, authMode: "pool", user: session.user, balanceStatus: session.user.balanceStatus || "unknown", isReady: true, isLoading: false });
                    return session.user;
                } catch (error) {
                    set({ isLoading: false });
                    throw error;
                }
            },
            adminLogin: async (payload) => {
                set({ isLoading: true });
                try {
                    const session = await adminLogin(payload);
                    useConfigStore.getState().updateConfig("apiKey", "");
                    set({ token: session.token, apiKeys: {}, apiKeyUsages: {}, apiKeyUsagesRefreshedAt: 0, authMode: "admin", user: session.user, balanceStatus: "unknown", isReady: true, isLoading: false });
                    return session.user;
                } catch (error) {
                    set({ isLoading: false });
                    throw error;
                }
            },
        }),
        {
            name: AUTH_TOKEN_KEY,
            partialize: (state) => ({ token: state.token, apiKeys: state.apiKeys, apiKeyUsages: state.apiKeyUsages, apiKeyUsagesRefreshedAt: state.apiKeyUsagesRefreshedAt, authMode: state.authMode, user: state.user, balanceStatus: state.balanceStatus }),
            onRehydrateStorage: () => (state) => {
                if (state) {
                    state.isReady = false;
                    if (!state.apiKeys || !Object.keys(state.apiKeys).length) {
                        state.apiKeys = state.token ? { "1k": state.token } : {};
                    }
                    if (!state.apiKeyUsages) state.apiKeyUsages = {};
                    if (typeof state.apiKeyUsagesRefreshedAt !== "number") state.apiKeyUsagesRefreshedAt = Object.keys(state.apiKeyUsages).length ? Date.now() : 0;
                }
            },
        },
    ),
);

function sleep(ms: number) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

function shouldAutoRefreshTokenUsage(refreshedAt: number, hasAnyUsage: boolean) {
    if (TOKEN_USAGE_AUTO_REFRESH_INTERVAL_MS <= 0) return false;
    if (!refreshedAt) return !hasAnyUsage;
    return Date.now() - refreshedAt >= TOKEN_USAGE_AUTO_REFRESH_INTERVAL_MS;
}
