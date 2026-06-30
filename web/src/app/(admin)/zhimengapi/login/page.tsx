"use client";

import { LockOutlined, UserOutlined } from "@ant-design/icons";
import { App, Button, Form, Input } from "antd";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense } from "react";

import { useUserStore } from "@/stores/use-user-store";

type LoginFormValues = {
    username: string;
    password: string;
};

export default function AdminLoginPage() {
    return (
        <Suspense fallback={null}>
            <AdminLoginContent />
        </Suspense>
    );
}

function AdminLoginContent() {
    const { message } = App.useApp();
    const router = useRouter();
    const searchParams = useSearchParams();
    const login = useUserStore((state) => state.adminLogin);
    const isLoading = useUserStore((state) => state.isLoading);
    const redirect = searchParams.get("redirect") || "/zhimengapi";

    const submit = async (values: LoginFormValues) => {
        try {
            await login(values);
            message.success("登录成功");
            router.replace(redirect.startsWith("/zhimengapi") ? redirect : "/zhimengapi");
            router.refresh();
        } catch (error) {
            message.error(error instanceof Error ? error.message : "登录失败");
        }
    };

    return (
        <main className="flex h-dvh items-center justify-center bg-background px-6">
            <section className="w-full max-w-[400px]">
                <div className="mb-7 text-center">
                    <span
                        className="mx-auto mb-4 block size-12 bg-stone-950 dark:bg-stone-100"
                        style={{
                            mask: "url(/logo.svg) center / contain no-repeat",
                            WebkitMask: "url(/logo.svg) center / contain no-repeat",
                        }}
                        aria-label="知梦画布"
                    />
                    <h1 className="text-3xl font-semibold tracking-normal text-stone-950 dark:text-stone-100">管理后台</h1>
                    <p className="mt-3 text-base leading-7 text-stone-500 dark:text-stone-400">仅管理员可访问。</p>
                </div>

                <Form<LoginFormValues> layout="vertical" size="large" requiredMark={false} onFinish={submit}>
                    <Form.Item name="username" label={<span className="font-medium text-stone-800 dark:text-stone-200">账号</span>} rules={[{ required: true, message: "请输入账号" }]}>
                        <Input prefix={<UserOutlined />} autoComplete="username" />
                    </Form.Item>
                    <Form.Item name="password" label={<span className="font-medium text-stone-800 dark:text-stone-200">密码</span>} rules={[{ required: true, message: "请输入密码" }]}>
                        <Input.Password prefix={<LockOutlined />} autoComplete="current-password" />
                    </Form.Item>
                    <Button block type="primary" htmlType="submit" loading={isLoading}>
                        登录
                    </Button>
                </Form>
            </section>
        </main>
    );
}
