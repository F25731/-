"use client";

import { useState, type CSSProperties, type RefObject } from "react";
import { App, Avatar, Dropdown, Tooltip } from "antd";
import { Keyboard, LoaderCircle, LogOut, RefreshCw, Settings2 } from "lucide-react";
import type { ItemType } from "antd/es/menu/interface";
import Link from "next/link";

import { AnimatedThemeToggler } from "@/components/ui/animated-theme-toggler";
import { canvasThemes } from "@/lib/canvas-theme";
import { useConfigStore } from "@/stores/use-config-store";
import { useThemeStore } from "@/stores/use-theme-store";
import { useUserStore } from "@/stores/use-user-store";
import type { BalanceStatus } from "@/services/api/auth";
import { imageTokenBalancePercent, IMAGE_KEY_TIERS, IMAGE_KEY_TIER_LABELS, isImageTokenUnlimited, type ImageApiKeys, type ImageTokenUsage, type ImageTokenUsages } from "@/types/api-keys";

type UserStatusActionsProps = {
    showConfig?: boolean;
    variant?: "default" | "canvas";
    onOpenShortcuts?: () => void;
    accountOpen?: boolean;
    onAccountOpenChange?: (open: boolean) => void;
    accountRef?: RefObject<HTMLDivElement | null>;
    getPopupContainer?: (node: HTMLElement) => HTMLElement;
};

export function UserStatusActions({ showConfig = true, variant = "default", onOpenShortcuts, accountOpen, onAccountOpenChange, accountRef, getPopupContainer }: UserStatusActionsProps) {
    const { message } = App.useApp();
    const [isRefreshingBalance, setIsRefreshingBalance] = useState(false);
    const theme = useThemeStore((state) => state.theme);
    const setTheme = useThemeStore((state) => state.setTheme);
    const user = useUserStore((state) => state.user);
    const balanceStatus = useUserStore((state) => state.balanceStatus);
    const apiKeys = useUserStore((state) => state.apiKeys);
    const apiKeyUsages = useUserStore((state) => state.apiKeyUsages);
    const refreshApiKeyUsages = useUserStore((state) => state.refreshApiKeyUsages);
    const logout = useUserStore((state) => state.clearSession);
    const openConfigDialog = useConfigStore((state) => state.openConfigDialog);
    const canvasTheme = canvasThemes[theme];
    const userName = user?.displayName || user?.username || "";
    const avatarUrl = user?.avatarUrl?.trim();
    const avatarText = (userName.trim()[0] || "U").toUpperCase();
    const effectiveBalanceStatus = resolveBalanceStatus(balanceStatus || user?.balanceStatus || "unknown", apiKeys, apiKeyUsages);
    const naturalIconClass = "inline-flex size-8 shrink-0 items-center justify-center text-stone-600 transition hover:text-stone-950 dark:text-stone-300 dark:hover:text-white [&_svg]:size-4";
    const iconStyle: CSSProperties | undefined = variant === "canvas" ? { color: canvasTheme.node.text } : undefined;
    const avatarStyle: CSSProperties | undefined = variant === "canvas" ? { borderColor: canvasTheme.toolbar.border, color: canvasTheme.node.text, background: "transparent" } : undefined;

    const menuItems: ItemType[] = [
        { key: "user", disabled: true, label: <span className="font-medium text-current">{userName}</span> },
        ...(onOpenShortcuts ? [{ key: "shortcuts", icon: <Keyboard className="size-4" />, label: "快捷键", onClick: onOpenShortcuts }] : []),
        { type: "divider" },
        { key: "logout", icon: <LogOut className="size-4" />, label: "退出登录", onClick: logout },
    ];
    const refreshBalance = async () => {
        if (isRefreshingBalance) return;
        setIsRefreshingBalance(true);
        try {
            await refreshApiKeyUsages();
            message.success("余额已刷新");
        } catch (error) {
            message.error(error instanceof Error ? error.message : "余额刷新失败");
        } finally {
            setIsRefreshingBalance(false);
        }
    };

    return (
        <div className="inline-flex shrink-0 items-center gap-1.5">
            {showConfig ? (
                <button type="button" className={naturalIconClass} style={iconStyle} onClick={() => openConfigDialog(false)} aria-label="配置" title="配置">
                    <Settings2 className="size-4" />
                </button>
            ) : null}
            <AnimatedThemeToggler theme={theme} onThemeChange={setTheme} className={naturalIconClass} style={iconStyle} aria-label={theme === "dark" ? "切换到浅色主题" : "切换到深色主题"} title={theme === "dark" ? "切换到浅色主题" : "切换到深色主题"} />
            {variant === "canvas" && user ? (
                <Tooltip title={<BalanceTooltipContent apiKeys={apiKeys} usages={apiKeyUsages} refreshing={isRefreshingBalance} onRefresh={refreshBalance} />} placement="bottom">
                    <div className="flex h-8 shrink-0 items-center gap-1.5 px-1.5 text-xs font-medium opacity-80" style={{ color: canvasTheme.node.text }}>
                        <BalanceLight status={effectiveBalanceStatus} />
                        <span>用户余额</span>
                    </div>
                </Tooltip>
            ) : null}
            {!user && onOpenShortcuts ? (
                <button type="button" className={naturalIconClass} style={iconStyle} onClick={onOpenShortcuts} aria-label="快捷键" title="快捷键">
                    <Keyboard className="size-4" />
                </button>
            ) : null}
            {!user ? (
                <Link href="/login" className="px-1.5 text-sm font-medium text-stone-600 underline-offset-4 transition hover:text-stone-950 hover:underline dark:text-stone-300 dark:hover:text-stone-100" style={iconStyle}>
                    登录
                </Link>
            ) : null}
            {user ? (
                <div ref={accountRef}>
                    <Dropdown open={accountOpen} onOpenChange={onAccountOpenChange} trigger={["click"]} placement="bottomRight" getPopupContainer={getPopupContainer} styles={{ root: { minWidth: 150 } }} menu={{ items: menuItems }}>
                        <button type="button" className="flex size-8 shrink-0 items-center justify-center rounded-full bg-transparent p-0 text-[0] leading-[0] transition" aria-label="账户菜单">
                            <Avatar
                                size={28}
                                src={avatarUrl ? <img src={avatarUrl} alt={userName} referrerPolicy="no-referrer" /> : undefined}
                                alt={userName}
                                className="!flex !items-center !justify-center border border-stone-300 bg-transparent text-xs font-semibold text-stone-800 transition hover:border-stone-500 hover:text-stone-950 dark:border-stone-700 dark:text-stone-100 dark:hover:border-stone-400 dark:hover:text-white"
                                style={avatarStyle}
                            >
                                {avatarText}
                            </Avatar>
                        </button>
                    </Dropdown>
                </div>
            ) : null}
        </div>
    );
}

function BalanceLight({ status }: { status: BalanceStatus }) {
    const color = status === "available" ? "#22c55e" : status === "unavailable" ? "#ef4444" : status === "checking" ? "#f59e0b" : "#9ca3af";
    return <span className="inline-block size-2.5 shrink-0 rounded-full shadow-[0_0_0_2px_rgba(255,255,255,.35)]" style={{ background: color }} />;
}

function BalanceTooltipContent({ apiKeys, usages, refreshing, onRefresh }: { apiKeys: ImageApiKeys; usages: ImageTokenUsages; refreshing: boolean; onRefresh: () => void }) {
    const hasApiKeys = IMAGE_KEY_TIERS.some((tier) => apiKeys[tier]);
    return (
        <div className="w-56 space-y-3 py-1">
            <div className="flex items-center justify-between gap-3">
                <span className="text-xs font-medium text-stone-200">额度明细</span>
                <button type="button" className="inline-flex h-6 cursor-pointer items-center gap-1 rounded-md px-1.5 text-xs text-stone-200 transition hover:bg-white/10 hover:text-white disabled:cursor-not-allowed disabled:opacity-50" disabled={!hasApiKeys || refreshing} onMouseDown={(event) => event.stopPropagation()} onClick={onRefresh}>
                    {refreshing ? <LoaderCircle className="size-3 animate-spin" /> : <RefreshCw className="size-3" />}
                    刷新额度
                </button>
            </div>
            {IMAGE_KEY_TIERS.map((tier) => (
                <div key={tier} className="space-y-1.5">
                    <div className="flex items-center justify-between gap-3 text-xs">
                        <span className="font-medium">{IMAGE_KEY_TIER_LABELS[tier]}</span>
                        <span className="truncate text-stone-200">{apiKeys[tier] ? formatBalanceMoney(usages[tier]) : "未配置"}</span>
                    </div>
                    <div className="h-1.5 overflow-hidden rounded-full bg-white/20">
                        <div className="h-full rounded-full bg-emerald-400" style={{ width: `${apiKeys[tier] ? imageTokenBalancePercent(usages[tier]) : 0}%` }} />
                    </div>
                </div>
            ))}
        </div>
    );
}

function resolveBalanceStatus(status: BalanceStatus, apiKeys: ImageApiKeys, usages: ImageTokenUsages): BalanceStatus {
    if (status === "unavailable") return "unavailable";
    const configuredTiers = IMAGE_KEY_TIERS.filter((tier) => apiKeys[tier]);
    if (!configuredTiers.length) return "unknown";
    const hasMissingUsage = configuredTiers.some((tier) => !usages[tier]);
    if (hasMissingUsage) return "checking";
    return configuredTiers.every((tier) => isImageTokenUnlimited(usages[tier]) || imageTokenBalancePercent(usages[tier]) >= 50) ? "available" : "checking";
}

function formatBalanceMoney(usage: ImageTokenUsage | undefined) {
    if (!usage) return "未检测";
    if (isImageTokenUnlimited(usage)) return "无限额度";
    return `${formatUsd(usage.total_available)} / ${formatUsd(usage.total_granted)}`;
}

function formatUsd(value: number) {
    const usd = Math.max(0, Number(value) || 0) / 500000;
    return `$${new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 }).format(usd)}`;
}
