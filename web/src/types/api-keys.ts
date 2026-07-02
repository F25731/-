import { IMAGE_MODEL_TIERS, IMAGE_MODEL_TIER_LABELS } from "@/constant/image-model-options";

export const IMAGE_KEY_TIERS = IMAGE_MODEL_TIERS;

export type ImageKeyTier = (typeof IMAGE_KEY_TIERS)[number];

export type ImageApiKeys = Partial<Record<ImageKeyTier, string>>;

// 新增:按模型存储密钥
export type ModelApiKeys = Record<string, string>;

// 扩展的认证配置
export type ApiKeysConfig = {
    imageKeys: ImageApiKeys; // 保留原知梦 Key (向后兼容)
    modelKeys: ModelApiKeys; // 新增:按模型存密钥
};

export type ImageTokenUsage = {
    expires_at: number;
    model_limits?: Record<string, unknown>;
    model_limits_enabled?: boolean;
    name: string;
    object: "token_usage";
    total_available: number;
    total_granted: number;
    total_used: number;
    unlimited_quota: boolean | string;
};

export type ImageTokenUsages = Partial<Record<ImageKeyTier, ImageTokenUsage>>;

export const IMAGE_KEY_TIER_LABELS: Record<ImageKeyTier, string> = {
    ...IMAGE_MODEL_TIER_LABELS,
};

export function normalizeImageApiKeys(keys: Partial<Record<ImageKeyTier, string>> | undefined): ImageApiKeys {
    const next: ImageApiKeys = {};
    for (const tier of IMAGE_KEY_TIERS) {
        const value = String(keys?.[tier] || "").trim();
        if (value) next[tier] = value;
    }
    return next;
}

export function firstAvailableImageKey(keys: ImageApiKeys) {
    for (const tier of IMAGE_KEY_TIERS) {
        const apiKey = keys[tier]?.trim();
        if (apiKey) return { tier, apiKey };
    }
    return null;
}

export function normalizeImageKeyTier(value: string | undefined): ImageKeyTier {
    return IMAGE_KEY_TIERS.includes(value as ImageKeyTier) ? (value as ImageKeyTier) : "1k";
}

export function formatImageTokenBalance(usage: ImageTokenUsage | undefined) {
    if (!usage) return "未检测";
    if (isImageTokenUnlimited(usage)) return "无限额度";
    return `${formatQuotaUsd(usage.total_available)} / ${formatQuotaUsd(usage.total_granted)}`;
}

export function imageTokenBalancePercent(usage: ImageTokenUsage | undefined) {
    if (!usage) return 0;
    if (isImageTokenUnlimited(usage)) return 100;
    const total = Number(usage.total_granted) || 0;
    if (total <= 0) return 0;
    return Math.max(0, Math.min(100, (Number(usage.total_available) / total) * 100));
}

export function isImageTokenUnlimited(usage: ImageTokenUsage | undefined) {
    return usage?.unlimited_quota === true || String(usage?.unlimited_quota).toLowerCase() === "true";
}

function formatQuotaUsd(value: number) {
    const usd = Math.max(0, Number(value) || 0) / 500000;
    return `${new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 }).format(usd)} USD`;
}
