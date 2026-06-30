"use client";

import type { ReactNode } from "react";
import { useEffect, useRef } from "react";
import { usePathname } from "next/navigation";

import { TOKEN_USAGE_AUTO_REFRESH_INTERVAL_MS, TOKEN_USAGE_REQUEST_DELAY_MS } from "@/constant/env";
import { useConfigStore } from "@/stores/use-config-store";
import { useUserStore } from "@/stores/use-user-store";

export function ClientRootInit({ children }: { children: ReactNode }) {
    const pathname = usePathname();
    const isLoginPage = pathname === "/login" || pathname === "/zhimengapi/login";
    const hasInitialized = useRef(false);
    const isAutoRefreshing = useRef(false);

    useEffect(() => {
        if (hasInitialized.current) return;
        hasInitialized.current = true;

        // 加载公共设置
        void useConfigStore.getState().loadPublicSettings();

        // 非登录页面时恢复用户状态
        if (!isLoginPage) {
            void useUserStore.getState().hydrateUser();
        }
    }, [isLoginPage]);

    useEffect(() => {
        if (isLoginPage || TOKEN_USAGE_AUTO_REFRESH_INTERVAL_MS <= 0) return;

        const refresh = async () => {
            const { token, authMode, apiKeys, refreshApiKeyUsages } = useUserStore.getState();
            if (!token || authMode !== "pool" || !Object.values(apiKeys).some((apiKey) => apiKey?.trim()) || isAutoRefreshing.current) return;
            isAutoRefreshing.current = true;
            try {
                await refreshApiKeyUsages({ requestDelayMs: TOKEN_USAGE_REQUEST_DELAY_MS });
            } catch (error) {
                console.warn("自动刷新余额失败", error);
            } finally {
                isAutoRefreshing.current = false;
            }
        };

        const timer = window.setInterval(() => {
            void refresh();
        }, TOKEN_USAGE_AUTO_REFRESH_INTERVAL_MS);

        return () => window.clearInterval(timer);
    }, [isLoginPage]);

    return <>{children}</>;
}
