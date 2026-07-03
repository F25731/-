"use client";

import { useEffect, useState } from "react";
import { App, Button, Form, Input, Modal, Space, Tag, Typography } from "antd";
import { KeyRound } from "lucide-react";

import { IMAGE_MODEL_TIERS } from "@/constant/image-model-options";
import { fetchPublicModels, type AdminModel } from "@/services/api/admin";
import { USER_MODEL_CONFIG_KEY, useConfigStore } from "@/stores/use-config-store";

const modelTypeLabels: Record<AdminModel["type"], string> = {
    image: "图片分组",
    video: "视频模型",
    parse: "解析模型",
    prompt: "提示词模型",
};

const modelTypeColors: Record<AdminModel["type"], string> = {
    image: "blue",
    video: "purple",
    parse: "green",
    prompt: "orange",
};

export function AppConfigModal() {
    const { message } = App.useApp();
    const [form] = Form.useForm();
    const isConfigOpen = useConfigStore((state) => state.isConfigOpen);
    const shouldPromptContinue = useConfigStore((state) => state.shouldPromptContinue);
    const updateConfig = useConfigStore((state) => state.updateConfig);
    const setConfigDialogOpen = useConfigStore((state) => state.setConfigDialogOpen);
    const clearPromptContinue = useConfigStore((state) => state.clearPromptContinue);
    const [models, setModels] = useState<AdminModel[]>([]);
    const [apiKeys, setApiKeys] = useState<Record<string, string>>({});

    useEffect(() => {
        if (!isConfigOpen) return;
        void loadModels();
        loadCurrentConfig();
    }, [isConfigOpen]);

    const loadModels = async () => {
        try {
            const data = await fetchPublicModels();
            setModels(data.filter((model) => model.enabled && model.type !== "prompt"));
        } catch {
            message.error("加载模型列表失败");
        }
    };

    const loadCurrentConfig = () => {
        try {
            const config = JSON.parse(localStorage.getItem(USER_MODEL_CONFIG_KEY) || "{}") as { apiKeys?: Record<string, string> };
            setApiKeys(config.apiKeys || {});
            form.setFieldsValue({ apiKeys: config.apiKeys || {} });
        } catch {
            setApiKeys({});
            form.resetFields();
        }
    };

    const saveConfig = () => {
        const cleanedApiKeys = Object.fromEntries(Object.entries(apiKeys).map(([id, value]) => [id, value.trim()]).filter(([, value]) => value));
        const configuredModels = models.filter((model) => cleanedApiKeys[model.id]);

        try {
            localStorage.setItem(
                USER_MODEL_CONFIG_KEY,
                JSON.stringify({
                    version: 2,
                    apiKeys: cleanedApiKeys,
                    models,
                    updatedAt: Date.now(),
                }),
            );

            const imageModel = configuredModels.find((model) => model.type === "image");
            const videoModel = configuredModels.find((model) => model.type === "video");
            const parseModel = configuredModels.find((model) => model.type === "parse");
            const promptModel = configuredModels.find((model) => model.type === "prompt");
            updateConfig("model", imageModel?.name || "");
            updateConfig("imageModel", imageModel?.name || "");
            updateConfig("videoModel", videoModel?.name || "");
            updateConfig("parseModel", parseModel?.name || "");
            updateConfig("promptModel", promptModel?.name || "");
            updateConfig("baseUrl", imageModel?.apiUrl || "");
            updateConfig("apiKey", imageModel ? cleanedApiKeys[imageModel.id] || "" : "");

            message.success(configuredModels.length ? "配置已保存" : "配置已清空");
            finishConfig();
        } catch {
            message.error("保存失败");
        }
    };

    const finishConfig = () => {
        setConfigDialogOpen(false);
        if (shouldPromptContinue) {
            message.success("配置已保存，请继续刚才的请求");
        }
        clearPromptContinue();
    };

    return (
        <Modal
            title={
                <div>
                    <div className="text-lg font-semibold">API Key 配置</div>
                    <div className="mt-1 text-xs font-normal text-stone-500">填写哪个分组的密钥，哪个分组就会在工作台可用</div>
                </div>
            }
            open={isConfigOpen}
            width={760}
            centered
            onCancel={() => setConfigDialogOpen(false)}
            footer={
                <Space>
                    <Button onClick={() => setConfigDialogOpen(false)}>取消</Button>
                    <Button type="primary" onClick={saveConfig}>
                        保存配置
                    </Button>
                </Space>
            }
        >
            <div className="pt-1">
                <Form form={form} layout="vertical" requiredMark={false}>
                    <div className="space-y-3">
                        {models.length ? (
                            models.map((model) => (
                                <div key={model.id} className="rounded-lg border border-stone-200 bg-stone-50 p-4 dark:border-stone-800 dark:bg-stone-900">
                                    <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
                                        <div className="min-w-0">
                                            <div className="flex min-w-0 items-center gap-2">
                                                <Typography.Text strong className="truncate">
                                                    {model.name}
                                                </Typography.Text>
                                                <Tag color={modelTypeColors[model.type]}>{modelTypeLabels[model.type]}</Tag>
                                            </div>
                                            <Typography.Text type="secondary" className="mt-1 block text-xs">
                                                {model.apiUrl}
                                            </Typography.Text>
                                        </div>
                                        {apiKeys[model.id]?.trim() ? <Tag color="success">已填写</Tag> : <Tag>未填写</Tag>}
                                    </div>
                                    {model.type === "image" ? <ImageGroupMeta model={model} /> : null}
                                    <Input.Password
                                        prefix={<KeyRound className="size-4 text-stone-400" />}
                                        placeholder="sk-..."
                                        value={apiKeys[model.id] || ""}
                                        onChange={(event) => setApiKeys({ ...apiKeys, [model.id]: event.target.value })}
                                    />
                                </div>
                            ))
                        ) : (
                            <div className="rounded-lg border border-dashed border-stone-200 px-4 py-8 text-center text-sm text-stone-500 dark:border-stone-800">后台还没有启用的模型分组</div>
                        )}
                    </div>

                    <div className="mt-4 rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-xs dark:border-blue-900 dark:bg-blue-950">
                        <Typography.Text className="text-xs text-blue-700 dark:text-blue-300">API Key 只保存在当前浏览器本地；未填写密钥的分组不会出现在生图模型下拉里。</Typography.Text>
                    </div>
                </Form>
            </div>
        </Modal>
    );
}

function ImageGroupMeta({ model }: { model: AdminModel }) {
    const tierModels = model.tierModels || {};
    const tiers = IMAGE_MODEL_TIERS.filter((tier) => tierModels[tier]);
    return (
        <div className="mb-3 flex flex-wrap gap-1.5">
            {(model.supportedSizes?.length ? model.supportedSizes : ["auto"]).map((size) => (
                <Tag key={size}>{size}</Tag>
            ))}
            {tiers.map((tier) => (
                <Tag key={tier} color={model.defaultTier === tier ? "blue" : undefined}>
                    {tier}
                    {model.defaultTier === tier ? " 默认" : ""}
                </Tag>
            ))}
            <Tag color="purple">参考图 {model.referenceLimit || 4} 张</Tag>
        </div>
    );
}
