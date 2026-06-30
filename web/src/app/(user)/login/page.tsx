"use client";

import { KeyRound } from "lucide-react";
import { App, Button, Checkbox, Form, Input, Select, Space, Typography } from "antd";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";

import { useUserStore } from "@/stores/use-user-store";
import { USER_MODEL_CONFIG_KEY, useConfigStore } from "@/stores/use-config-store";
import { fetchPublicModels, type AdminModel } from "@/services/api/admin";

type LoginFormValues = {
    modelIds: string[];
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
    const redirect = searchParams.get("redirect") || "/";
    const [models, setModels] = useState<AdminModel[]>([]);
    const [selectedModelIds, setSelectedModelIds] = useState<string[]>([]);
    const [apiKeys, setApiKeys] = useState<Record<string, string>>({});
    const [configureAll, setConfigureAll] = useState(false);
    const updateConfig = useConfigStore((state) => state.updateConfig);

    useEffect(() => {
        loadModels();
    }, []);

    const loadModels = async () => {
        try {
            const data = await fetchPublicModels();
            setModels(data.filter((m) => m.enabled));
        } catch (error) {
            message.error("加载模型列表失败");
        }
    };

    const handleConfigureAllChange = (checked: boolean) => {
        setConfigureAll(checked);
        if (checked) {
            const allIds = models.map((m) => m.id);
            setSelectedModelIds(allIds);
            form.setFieldValue("modelIds", allIds);
        } else {
            setSelectedModelIds([]);
            form.setFieldValue("modelIds", []);
        }
    };

    const handleModelChange = (ids: string[]) => {
        setSelectedModelIds(ids);
        setConfigureAll(ids.length === models.length);
    };

    const submit = async (values: LoginFormValues) => {
        if (!values.modelIds || values.modelIds.length === 0) {
            message.warning("请至少选择一个模型");
            return;
        }

        // 检查每个选中的模型是否都输入了 API Key
        const missingKeys = values.modelIds.filter((id) => !apiKeys[id]?.trim());
        if (missingKeys.length > 0) {
            message.warning("请为所有选中的模型输入 API Key");
            return;
        }

        try {
            localStorage.setItem(
                USER_MODEL_CONFIG_KEY,
                JSON.stringify({
                    modelIds: values.modelIds,
                    apiKeys: apiKeys,
                    models: models.filter((m) => values.modelIds.includes(m.id)),
                }),
            );
            const selectedModels = models.filter((m) => values.modelIds.includes(m.id));
            const imageModel = selectedModels.find((m) => m.type === "image");
            const videoModel = selectedModels.find((m) => m.type === "video");
            if (imageModel) {
                updateConfig("model", imageModel.name);
                updateConfig("imageModel", imageModel.name);
                updateConfig("baseUrl", imageModel.apiUrl);
                updateConfig("apiKey", apiKeys[imageModel.id] || "");
            }
            if (videoModel) updateConfig("videoModel", videoModel.name);

            message.success("登录成功");
            router.replace(redirect.startsWith("/") ? redirect : "/canvas");
            router.refresh();
        } catch (error) {
            message.error(error instanceof Error ? error.message : "登录失败");
        }
    };

    return (
        <main className="flex h-full min-h-0 items-center justify-center overflow-y-auto bg-background bg-[radial-gradient(#e5e7eb_1px,transparent_1px)] px-6 py-10 [background-size:16px_16px] dark:bg-[radial-gradient(rgba(245,245,244,.16)_1px,transparent_1px)]">
            <section className="w-full max-w-[540px]">
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
                    <p className="mt-3 text-base leading-7 text-stone-500 dark:text-stone-400">选择要使用的模型并配置对应的 API Key</p>
                </div>

                <Form<LoginFormValues> form={form} layout="vertical" size="large" requiredMark={false} onFinish={submit}>
                    <Form.Item label={<span className="font-medium text-stone-800 dark:text-stone-200">选择模型</span>}>
                        <Space direction="vertical" className="w-full" size={12}>
                            <Checkbox checked={configureAll} onChange={(e) => handleConfigureAllChange(e.target.checked)}>
                                <span className="font-medium">配置所有模型</span>
                            </Checkbox>

                            <Form.Item name="modelIds" noStyle rules={[{ required: true, message: "请至少选择一个模型" }]}>
                                <Select
                                    mode="multiple"
                                    placeholder="请选择要使用的模型"
                                    onChange={handleModelChange}
                                    options={models.map((m) => ({
                                        label: `${m.name} (${m.type === "image" ? "图片" : "视频"})`,
                                        value: m.id,
                                    }))}
                                />
                            </Form.Item>
                        </Space>
                    </Form.Item>

                    {selectedModelIds.length > 0 && (
                        <div className="mb-6 space-y-4 rounded-lg border border-stone-200 bg-stone-50 p-4 dark:border-stone-800 dark:bg-stone-900">
                            <Typography.Text className="block text-sm font-medium">为选中的模型配置 API Key</Typography.Text>
                            {models
                                .filter((m) => selectedModelIds.includes(m.id))
                                .map((model) => (
                                    <div key={model.id}>
                                        <Typography.Text className="mb-2 block text-xs text-stone-600 dark:text-stone-400">
                                            {model.name} ({model.type === "image" ? "图片模型" : "视频模型"})
                                        </Typography.Text>
                                        <Input.Password
                                            prefix={<KeyRound className="size-4 text-stone-400" />}
                                            placeholder="sk-..."
                                            value={apiKeys[model.id] || ""}
                                            onChange={(e) => setApiKeys({ ...apiKeys, [model.id]: e.target.value })}
                                        />
                                    </div>
                                ))}
                        </div>
                    )}

                    <Button block type="primary" htmlType="submit" loading={isLoading} style={{ height: 48, fontSize: 16 }}>
                        登录
                    </Button>

                    <div className="mt-4 text-center text-sm text-stone-500 dark:text-stone-400">登录后配置会保存,下次可以直接使用或切换模型</div>
                </Form>
            </section>
        </main>
    );
}
