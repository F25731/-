"use client";

import { KeyRound } from "lucide-react";
import { App, Button, Form, Input, Select } from "antd";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";

import { useUserStore } from "@/stores/use-user-store";
import { useConfigStore } from "@/stores/use-config-store";

type LoginFormValues = {
    modelId: string;
    apiKey: string;
};

type Model = {
    id: string;
    name: string;
    type: "image" | "video";
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
    const [form] = Form.useForm<LoginFormValues>();
    const login = useUserStore((state) => state.login);
    const isLoading = useUserStore((state) => state.isLoading);
    const loadPublicSettings = useConfigStore((state) => state.loadPublicSettings);
    const publicSettings = useConfigStore((state) => state.publicSettings);
    const redirect = searchParams.get("redirect") || "/";
    const [models, setModels] = useState<Model[]>([]);
    const [selectedModel, setSelectedModel] = useState<Model | null>(null);

    useEffect(() => {
        void loadPublicSettings();
    }, [loadPublicSettings]);

    useEffect(() => {
        // TODO: 从后台加载模型列表
        // const data = await fetchModels();
        // setModels(data);

        // 临时测试数据
        setModels([
            { id: "1", name: "Gemini Pro Vision", type: "image" },
            { id: "2", name: "DALL-E 3", type: "image" },
            { id: "3", name: "Gemini Video", type: "video" },
        ]);
    }, []);

    const submit = async (values: LoginFormValues) => {
        if (!values.modelId) {
            message.warning("请选择模型");
            return;
        }
        if (!values.apiKey?.trim()) {
            message.warning("请输入 API Key");
            return;
        }

        try {
            // TODO: 保存选择的模型和 API Key
            // await login({ modelId: values.modelId, apiKey: values.apiKey });

            // 临时存储到 localStorage
            localStorage.setItem(
                "user-model-config",
                JSON.stringify({
                    modelId: values.modelId,
                    modelName: selectedModel?.name,
                    apiKey: values.apiKey,
                }),
            );

            message.success("登录成功");
            router.replace(redirect.startsWith("/") ? redirect : "/canvas");
            router.refresh();
        } catch (error) {
            message.error(error instanceof Error ? error.message : "登录失败");
        }
    };

    return (
        <main className="flex h-full min-h-0 items-center justify-center overflow-y-auto bg-background bg-[radial-gradient(#e5e7eb_1px,transparent_1px)] px-6 py-10 [background-size:16px_16px] dark:bg-[radial-gradient(rgba(245,245,244,.16)_1px,transparent_1px)]">
            <section className="w-full max-w-[480px]">
                <div className="mb-7 text-center">
                    <span
                        className="mx-auto mb-4 block size-12 bg-stone-950 dark:bg-stone-100"
                        style={{
                            mask: "url(/logo.svg) center / contain no-repeat",
                            WebkitMask: "url(/logo.svg) center / contain no-repeat",
                        }}
                        aria-label="无限画布"
                    />
                    <h1 className="text-3xl font-semibold tracking-normal text-stone-950 dark:text-stone-100">登录</h1>
                    <p className="mt-3 text-base leading-7 text-stone-500 dark:text-stone-400">选择模型并输入对应的 API Key</p>
                </div>

                <Form<LoginFormValues> form={form} layout="vertical" size="large" requiredMark={false} onFinish={submit}>
                    <Form.Item name="modelId" label={<span className="font-medium text-stone-800 dark:text-stone-200">选择模型</span>} rules={[{ required: true, message: "请选择模型" }]}>
                        <Select
                            placeholder="请选择要使用的模型"
                            onChange={(value) => {
                                const model = models.find((m) => m.id === value);
                                setSelectedModel(model || null);
                            }}
                            options={models.map((m) => ({
                                label: (
                                    <div>
                                        <div style={{ fontWeight: 500 }}>{m.name}</div>
                                        <div style={{ fontSize: 12, color: "#8c8c8c" }}>{m.type === "image" ? "图片模型" : "视频模型"}</div>
                                    </div>
                                ),
                                value: m.id,
                            }))}
                            optionLabelProp="label"
                        />
                    </Form.Item>

                    {selectedModel && (
                        <div className="mb-4 rounded-lg border border-stone-200 bg-stone-50 p-3 dark:border-stone-800 dark:bg-stone-900">
                            <div className="text-sm font-medium text-stone-800 dark:text-stone-200">{selectedModel.name}</div>
                            <div className="mt-1 text-xs text-stone-500 dark:text-stone-400">{selectedModel.type === "image" ? "支持图片生成和编辑" : "支持视频生成"}</div>
                        </div>
                    )}

                    <Form.Item name="apiKey" label={<span className="font-medium text-stone-800 dark:text-stone-200">API Key</span>} rules={[{ required: true, message: "请输入 API Key" }]}>
                        <Input.Password prefix={<KeyRound className="size-4 text-stone-400" />} autoComplete="off" placeholder="sk-..." />
                    </Form.Item>

                    <Button block type="primary" htmlType="submit" loading={isLoading} style={{ height: 48, fontSize: 16 }}>
                        登录
                    </Button>

                    <div className="mt-4 text-center text-sm text-stone-500 dark:text-stone-400">登录后配置会保存,下次可以直接使用或切换模型</div>
                </Form>
            </section>
        </main>
    );
}
