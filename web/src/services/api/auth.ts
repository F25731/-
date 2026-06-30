import { apiGet, apiPost } from "@/services/api/request";
import { firstAvailableImageKey, IMAGE_KEY_TIERS, IMAGE_KEY_TIER_LABELS, isImageTokenUnlimited, normalizeImageApiKeys, type ImageApiKeys, type ImageKeyTier, type ImageTokenUsage, type ImageTokenUsages } from "@/types/api-keys";

export const AUTH_TOKEN_KEY = "infinite-canvas-auth-token-v1";

export type UserRole = "guest" | "user" | "admin";
export type BalanceStatus = "unknown" | "checking" | "available" | "unavailable";

export type AuthUser = {
    id: string;
    username: string;
    displayName: string;
    avatarUrl: string;
    role: UserRole;
    credits: number;
    quota: number;
    used: number;
    unlimited: boolean;
    remaining: number | null;
    balanceStatus?: BalanceStatus;
    balanceTier?: ImageKeyTier;
    createdAt: string;
    updatedAt: string;
};

export type AuthSession = {
    token: string;
    user: AuthUser;
    apiKeys?: ImageApiKeys;
    apiKeyUsages?: ImageTokenUsages;
};

export type AuthPayload = {
    apiKey?: string;
    apiKeys?: ImageApiKeys;
};

export type CanvasAuthPayload = {
    username: string;
    password: string;
};

function createPoolUser(tier: ImageKeyTier, usage?: ImageTokenUsage): AuthUser {
    const displayName = "知梦用户";
    const unlimited = isImageTokenUnlimited(usage);
    return {
        id: tier,
        username: displayName,
        displayName,
        avatarUrl: "",
        role: "user",
        credits: usage?.total_available || 0,
        quota: usage?.total_granted || 0,
        used: usage?.total_used || 0,
        unlimited,
        remaining: unlimited ? null : usage?.total_available || 0,
        balanceStatus: usage ? "available" : "unknown",
        balanceTier: tier,
        createdAt: "",
        updatedAt: "",
    };
}

export async function login(payload: AuthPayload) {
    const apiKeys = normalizeImageApiKeys({ ...payload.apiKeys, "1k": payload.apiKeys?.["1k"] || payload.apiKey });
    const firstKey = firstAvailableImageKey(apiKeys);
    if (!firstKey) throw new Error("请至少输入一个知梦 API Key");

    await validateImageApiKeys(apiKeys);

    return { token: firstKey.apiKey, user: createPoolUser(firstKey.tier), apiKeys, apiKeyUsages: {} };
}

export async function validateImageApiKey(apiKey: string) {
    await apiGet<unknown[]>("/api/token-models", undefined, apiKey);
}

export async function fetchImageTokenUsage(apiKey: string) {
    return apiGet<ImageTokenUsage>("/api/token-usage", undefined, apiKey);
}

async function validateImageApiKeys(apiKeys: ImageApiKeys) {
    for (const tier of IMAGE_KEY_TIERS) {
        const apiKey = apiKeys[tier]?.trim();
        if (!apiKey) continue;
        try {
            await validateImageApiKey(apiKey);
        } catch (error) {
            const message = error instanceof Error ? error.message : "API Key 无效或不属于当前站点";
            throw new Error(`${IMAGE_KEY_TIER_LABELS[tier]} API Key：${message}`);
        }
    }
}

export async function adminLogin(payload: CanvasAuthPayload) {
    return apiPost<AuthSession>("/api/admin/login", payload);
}

export async function fetchCanvasCurrentUser(token?: string) {
    return apiGet<AuthUser>("/api/auth/me", undefined, token);
}
