"use client";

import { useEffect, useMemo, useState } from "react";
import { LoaderCircle, RefreshCw, WalletCards } from "lucide-react";

import { fetchUserBalance, type UserBalance } from "@/services/api/balance";
import { USER_MODEL_CONFIG_KEY, type StoredAggregateModelConfig, type UserModelConfigMode } from "@/stores/use-config-store";
import { cn } from "@/lib/utils";

const BALANCE_CACHE_KEY = "user-balance-cache-v1";
const BALANCE_LIMIT_MS = 15_000;

type StoredUserModelConfig = {
    mode?: UserModelConfigMode;
    aggregate?: StoredAggregateModelConfig;
    apiKeys?: Record<string, string>;
};

type BalanceCache = {
    checkedAt: number;
    keysSignature: string;
    data?: UserBalance;
};

export function UserBalanceBadge({ compact = false }: { compact?: boolean }) {
    const [configVersion, setConfigVersion] = useState(0);
    const [balance, setBalance] = useState<UserBalance | null>(null);
    const [checkedAt, setCheckedAt] = useState(0);
    const [isRefreshing, setIsRefreshing] = useState(false);
    const keys = useMemo(readConfiguredKeys, [configVersion]);
    const keysSignature = keys.join("|");
    const balanceName = balance?.keyLimited ? balance.keyName || balance.username : balance?.username;
    const displayBalance = balance?.keyLimited ? balance.keyBalanceUsd || balance.balanceUsd : balance?.balanceUsd;
    const balanceAmount = Number(displayBalance || 0);
    const balanceClassName = balanceAmount >= 3 ? "text-emerald-600 dark:text-emerald-400" : "text-red-600 dark:text-red-400";

    useEffect(() => {
        const cached = readBalanceCache();
        if (cached?.data && cached.keysSignature === keysSignature) {
            setBalance(cached.data);
            setCheckedAt(cached.checkedAt);
        }
        void refreshBalance({ silent: true });
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [keysSignature]);

    useEffect(() => {
        const refreshKeys = () => setConfigVersion((value) => value + 1);
        window.addEventListener("storage", refreshKeys);
        window.addEventListener("user-model-config-updated", refreshKeys);
        return () => {
            window.removeEventListener("storage", refreshKeys);
            window.removeEventListener("user-model-config-updated", refreshKeys);
        };
    }, []);

    const refreshBalance = async (options?: { silent?: boolean }) => {
        if (!keys.length || isRefreshing) return;
        const cached = readBalanceCache();
        const cachedMatched = cached?.keysSignature === keysSignature;
        const lastCheckedAt = cachedMatched ? cached?.checkedAt || checkedAt : 0;
        if (lastCheckedAt && Date.now() - lastCheckedAt < BALANCE_LIMIT_MS) {
            if (cached?.data && cachedMatched) {
                setBalance(cached.data);
                setCheckedAt(cached.checkedAt);
            }
            return;
        }
        setIsRefreshing(true);
        try {
            const data = await fetchUserBalance(keys);
            const cache = { checkedAt: Date.now(), keysSignature, data };
            writeBalanceCache(cache);
            setBalance(data);
            setCheckedAt(cache.checkedAt);
        } catch {
            if (!options?.silent) setBalance(null);
        } finally {
            setIsRefreshing(false);
        }
    };

    if (!keys.length) return null;

    return (
        <button
            type="button"
            className={cn("inline-flex h-8 shrink-0 items-center gap-1.5 text-xs text-stone-600 transition hover:text-stone-950 dark:text-stone-300 dark:hover:text-white", compact ? "px-1" : "rounded-md px-2")}
            onClick={() => void refreshBalance()}
            title="刷新余额"
        >
            {isRefreshing ? <LoaderCircle className="size-3.5 animate-spin" /> : <WalletCards className="size-3.5" />}
            {balance ? (
                <span className="max-w-44 truncate">
                    {balanceName} · <span className={balanceClassName}>${formatUsd(displayBalance || "0")}</span>
                </span>
            ) : (
                <span>余额</span>
            )}
            {!compact ? <RefreshCw className="size-3 opacity-60" /> : null}
        </button>
    );
}

function readConfiguredKeys() {
    if (typeof window === "undefined") return [];
    try {
        const config = JSON.parse(window.localStorage.getItem(USER_MODEL_CONFIG_KEY) || "{}") as StoredUserModelConfig;
        if (config.mode === "aggregate") {
            const key = String(config.aggregate?.apiKey || "").trim();
            return key ? [key] : [];
        }
        return Array.from(new Set(Object.values(config.apiKeys || {}).map((item) => String(item || "").trim()).filter(Boolean)));
    } catch {
        return [];
    }
}

function readBalanceCache(): BalanceCache | null {
    if (typeof window === "undefined") return null;
    try {
        return JSON.parse(window.localStorage.getItem(BALANCE_CACHE_KEY) || "null") as BalanceCache | null;
    } catch {
        return null;
    }
}

function writeBalanceCache(cache: BalanceCache) {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(BALANCE_CACHE_KEY, JSON.stringify(cache));
}

function formatUsd(value: string) {
    return new Intl.NumberFormat("en-US", { maximumFractionDigits: 6 }).format(Number(value) || 0);
}
