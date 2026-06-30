"use client";

import { FileTextOutlined, HomeOutlined, LogoutOutlined, MenuFoldOutlined, MenuUnfoldOutlined, PictureOutlined, SettingOutlined, TransactionOutlined, UserOutlined } from "@ant-design/icons";
import { Button, Flex, Layout, Menu, Tooltip, Typography, theme } from "antd";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import type { ReactNode } from "react";
import { useEffect, useState } from "react";

import { UserStatusActions } from "@/components/layout/user-status-actions";
import { adminLayoutStyle } from "@/lib/app-theme";
import { useUserStore } from "@/stores/use-user-store";

const adminMenus = [
    { key: "/zhimengapi/users", icon: <UserOutlined />, label: "用户管理" },
    { key: "/zhimengapi/credit-logs", icon: <TransactionOutlined />, label: "算力点日志" },
    { key: "/zhimengapi/prompts", icon: <FileTextOutlined />, label: "提示词管理" },
    { key: "/zhimengapi/assets", icon: <PictureOutlined />, label: "素材库" },
    { key: "/zhimengapi/settings", icon: <SettingOutlined />, label: "系统设置" },
];

export default function AdminLayout({ children }: { children: ReactNode }) {
    const { token: antToken } = theme.useToken();
    const router = useRouter();
    const pathname = usePathname();
    const token = useUserStore((state) => state.token);
    const authMode = useUserStore((state) => state.authMode);
    const user = useUserStore((state) => state.user);
    const isReady = useUserStore((state) => state.isReady);
    const logout = useUserStore((state) => state.clearSession);
    const [collapsed, setCollapsed] = useState(false);
    const activeKey = pathname.startsWith("/zhimengapi/settings")
        ? "/zhimengapi/settings"
        : pathname.startsWith("/zhimengapi/assets")
          ? "/zhimengapi/assets"
          : pathname.startsWith("/zhimengapi/prompts")
            ? "/zhimengapi/prompts"
            : pathname.startsWith("/zhimengapi/credit-logs")
              ? "/zhimengapi/credit-logs"
              : pathname.startsWith("/zhimengapi/users")
                ? "/zhimengapi/users"
                : "";
    const pageTitle = pathname.startsWith("/zhimengapi/settings") ? "系统设置" : pathname.startsWith("/zhimengapi/assets") ? "素材库管理" : pathname.startsWith("/zhimengapi/prompts") ? "提示词管理" : pathname.startsWith("/zhimengapi/credit-logs") ? "算力点日志" : "用户管理";
    const isAdminLogin = pathname === "/zhimengapi/login";

    useEffect(() => {
        if (isAdminLogin) return;
        if (!isReady) return;
        if (!token || authMode !== "admin") {
            router.replace("/zhimengapi/login?redirect=/zhimengapi");
            return;
        }
        if (user?.role !== "admin") {
            router.replace("/");
        }
    }, [authMode, isAdminLogin, isReady, router, token, user?.role]);

    if (isAdminLogin) {
        return <>{children}</>;
    }

    if (!isReady || !token || authMode !== "admin" || user?.role !== "admin") {
        return (
            <div style={{ display: "flex", minHeight: "100vh", alignItems: "center", justifyContent: "center", background: antToken.colorBgLayout }}>
                <span />
            </div>
        );
    }

    return (
        <Layout hasSider style={{ height: "100vh", overflow: "hidden", background: antToken.colorBgLayout }}>
            <Layout.Sider
                collapsible
                collapsed={collapsed}
                onCollapse={setCollapsed}
                collapsedWidth={adminLayoutStyle.collapsedWidth}
                width={adminLayoutStyle.siderWidth}
                trigger={null}
                style={{ height: "100vh", overflow: "hidden", background: antToken.colorBgContainer, borderRight: `1px solid ${antToken.colorBorder}` }}
            >
                <Flex align="center" justify={collapsed ? "center" : "space-between"} gap={12} style={{ height: adminLayoutStyle.brandHeight, padding: collapsed ? "0" : "0 20px", borderBottom: `1px solid ${antToken.colorBorderSecondary}` }}>
                    {collapsed ? (
                        <span aria-hidden style={{ display: "inline-block", width: 30, height: 30, background: antToken.colorText, WebkitMask: "url(/logo.svg) center / contain no-repeat", mask: "url(/logo.svg) center / contain no-repeat" }} />
                    ) : (
                        <>
                            <Flex align="center" gap={12}>
                                <span aria-hidden style={{ display: "inline-block", width: 30, height: 30, background: antToken.colorText, WebkitMask: "url(/logo.svg) center / contain no-repeat", mask: "url(/logo.svg) center / contain no-repeat" }} />
                                <Typography.Text strong style={{ fontSize: 18, letterSpacing: 0 }}>
                                    无限画布
                                </Typography.Text>
                            </Flex>
                            <Button type="text" icon={collapsed ? <MenuUnfoldOutlined /> : <MenuFoldOutlined />} onClick={() => setCollapsed(!collapsed)} style={{ marginRight: -8 }} />
                        </>
                    )}
                </Flex>
                <Menu
                    mode="inline"
                    selectedKeys={[activeKey]}
                    style={adminLayoutStyle.menu}
                    items={adminMenus.map((item) => ({
                        ...item,
                        label: (
                            <Link href={item.key} style={{ color: "inherit" }}>
                                {item.label}
                            </Link>
                        ),
                        style: adminLayoutStyle.menuItem,
                    }))}
                />
                <Flex vertical gap={8} style={{ position: "absolute", bottom: 0, insetInline: 0, padding: 12, borderTop: `1px solid ${antToken.colorBorder}`, background: antToken.colorBgContainer }}>
                    {collapsed ? (
                        <>
                            <Tooltip title="前往画布" placement="right">
                                <Button block icon={<HomeOutlined />} href="/canvas" target="_blank" rel="noreferrer" />
                            </Tooltip>
                            <Tooltip title="退出登录" placement="right">
                                <Button block icon={<LogoutOutlined />} onClick={logout} />
                            </Tooltip>
                        </>
                    ) : (
                        <>
                            <Button block icon={<HomeOutlined />} href="/canvas" target="_blank" rel="noreferrer">
                                前往画布
                            </Button>
                            <Button block icon={<LogoutOutlined />} onClick={logout}>
                                退出登录
                            </Button>
                        </>
                    )}
                </Flex>
            </Layout.Sider>
            <Layout style={{ background: antToken.colorBgLayout }}>
                <Layout.Header
                    style={{ display: "flex", alignItems: "center", justifyContent: "space-between", height: adminLayoutStyle.headerHeight, padding: "0 24px", background: antToken.colorBgContainer, borderBottom: `1px solid ${antToken.colorBorder}` }}
                >
                    <Typography.Title level={5} style={{ margin: 0 }}>
                        {pageTitle}
                    </Typography.Title>
                    <Flex align="center" gap={4}>
                        <UserStatusActions showConfig={false} />
                    </Flex>
                </Layout.Header>
                <Layout.Content style={{ minHeight: 0, overflow: "auto" }}>{children}</Layout.Content>
            </Layout>
        </Layout>
    );
}
