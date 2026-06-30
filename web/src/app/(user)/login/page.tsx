"use client";

import { KeyRound } from "lucide-react";
import { App, Button, Form, Input } from "antd";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense } from "react";

import { useUserStore } from "@/stores/use-user-store";

type LoginFormValues = {
    apiKey1k?: string;
    apiKey2k?: string;
    apiKey4k?: string;
};

export default function LoginPage() {
    return (
        <Suspense fallback={null}>
            <LoginContent />
        </Suspense>
    );
}

function LoginContent() {
    const { message } = App.useApp();
    const router = useRouter();
    const searchParams = useSearchParams();
    const login = useUserStore((state) => state.login);
    const isLoading = useUserStore((state) => state.isLoading);
    const redirect = searchParams.get("redirect") || "/";

    const submit = async (values: LoginFormValues) => {
        const apiKeys = {
            "1k": values.apiKey1k?.trim() || "",
            "2k": values.apiKey2k?.trim() || "",
            "4k": values.apiKey4k?.trim() || "",
        };
        if (!apiKeys["1k"] && !apiKeys["2k"] && !apiKeys["4k"]) {
            message.warning("请至少输入一个知梦 API Key");
            return;
        }
        try {
            await login({ apiKeys });
            message.success("API Key 验证成功，登录完成");
            router.replace(redirect.startsWith("/") ? redirect : "/");
            router.refresh();
        } catch (error) {
            message.error(error instanceof Error ? error.message : "登录失败");
        }
    };

    return (
        <main className="flex h-full min-h-0 items-center justify-center overflow-y-auto bg-background bg-[radial-gradient(#e5e7eb_1px,transparent_1px)] px-6 py-10 [background-size:16px_16px] dark:bg-[radial-gradient(rgba(245,245,244,.16)_1px,transparent_1px)]">
            <section className="w-full max-w-[440px]">
                <div className="mb-7 text-center">
                    <span
                        className="mx-auto mb-4 block size-12 bg-stone-950 dark:bg-stone-100"
                        style={{
                            mask: "url(/logo.svg) center / contain no-repeat",
                            WebkitMask: "url(/logo.svg) center / contain no-repeat",
                        }}
                        aria-label="知梦画布"
                    />
                    <h1 className="text-3xl font-semibold tracking-normal text-stone-950 dark:text-stone-100">知梦 Key 登录</h1>
                    <p className="mt-3 text-base leading-7 text-stone-500 dark:text-stone-400">填写知梦 API Key，登录时会验证连接有效性。1k、2k、4k 至少填一个。</p>
                </div>

                <Form<LoginFormValues> layout="vertical" size="large" requiredMark={false} onFinish={submit}>
                    <Form.Item name="apiKey1k" label={<span className="font-medium text-stone-800 dark:text-stone-200">1k API Key</span>}>
                        <Input.Password prefix={<KeyRound className="size-4 text-stone-400" />} autoComplete="off" placeholder="sk-..." />
                    </Form.Item>
                    <Form.Item name="apiKey2k" label={<span className="font-medium text-stone-800 dark:text-stone-200">2k API Key</span>}>
                        <Input.Password prefix={<KeyRound className="size-4 text-stone-400" />} autoComplete="off" placeholder="sk-..." />
                    </Form.Item>
                    <Form.Item name="apiKey4k" label={<span className="font-medium text-stone-800 dark:text-stone-200">4k API Key</span>}>
                        <Input.Password prefix={<KeyRound className="size-4 text-stone-400" />} autoComplete="off" placeholder="sk-..." />
                    </Form.Item>
                    <Button block type="primary" htmlType="submit" loading={isLoading}>
                        登录
                    </Button>
                </Form>
            </section>
        </main>
    );
}
