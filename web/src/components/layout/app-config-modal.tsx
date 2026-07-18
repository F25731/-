"use client";

import { useEffect, useState } from "react";
import { App, Button, Form, Input, Modal, Space, Tag, Typography } from "antd";
import { KeyRound } from "lucide-react";

import { UserBalanceBadge } from "@/components/layout/user-balance-badge";
import { IMAGE_MODEL_TIERS } from "@/constant/image-model-options";
import { fetchPublicModels, type AdminModel } from "@/services/api/admin";
import { USER_MODEL_CONFIG_KEY, useConfigStore, type StoredAggregateModelConfig } from "@/stores/use-config-store";
import type { ImageKeyTier } from "@/types/api-keys";

const DETAIL_LLM_KEYS_KEY = "detail-workbench:llm-keys";

const modelTypeLabels: Record<AdminModel["type"], string> = {
    image: "图片分组",
    parse: "解析模型",
    prompt: "提示词模型",
    detail_prompt: "详情图提示词",
};

const modelTypeColors: Record<AdminModel["type"], string> = {
    image: "blue",
    parse: "green",
    prompt: "orange",
    detail_prompt: "cyan",
};

export function AppConfigModal() {
    const { message } = App.useApp();
    const [form] = Form.useForm();
    const isConfigOpen = useConfigStore((state) => state.isConfigOpen);
    const shouldPromptContinue = useConfigStore((state) => state.shouldPromptContinue);
    const updateConfig = useConfigStore((state) => state.updateConfig);
    const refreshUserModels = useConfigStore((state) => state.refreshUserModels);
    const setConfigDialogOpen = useConfigStore((state) => state.setConfigDialogOpen);
    const clearPromptContinue = useConfigStore((state) => state.clearPromptContinue);
    const [models, setModels] = useState<AdminModel[]>([]);
    const [aggregate, setAggregate] = useState<StoredAggregateModelConfig>({ apiKey: "", catalogs: {} });

    useEffect(() => {
        void refreshUserModels().catch(() => undefined);
        const refresh = () => void refreshUserModels().catch(() => undefined);
        window.addEventListener("focus", refresh);
        document.addEventListener("visibilitychange", refresh);
        return () => {
            window.removeEventListener("focus", refresh);
            document.removeEventListener("visibilitychange", refresh);
        };
    }, [refreshUserModels]);

    useEffect(() => {
        if (!isConfigOpen) return;
        void openConfig();
    }, [isConfigOpen]);

    const openConfig = async () => {
        await refreshUserModels().catch(() => undefined);
        await loadModels();
        loadCurrentConfig();
    };

    const loadModels = async () => {
        try {
            const data = await fetchPublicModels();
            setModels(data.filter((model) => model.enabled));
        } catch {
            message.error("加载模型列表失败");
        }
    };

    const loadCurrentConfig = () => {
        try {
            const config = JSON.parse(localStorage.getItem(USER_MODEL_CONFIG_KEY) || "{}") as { apiKeys?: Record<string, string>; aggregate?: StoredAggregateModelConfig };
            const migratedKey = config.aggregate?.apiKey || Object.values(config.apiKeys || {}).find((value) => String(value || "").trim()) || "";
            setAggregate({
                apiKey: migratedKey,
                catalogs: {},
            });
        } catch {
            setAggregate({ apiKey: "", catalogs: {} });
            form.resetFields();
        }
    };

    const saveConfig = async () => {
        const cleanedAggregate = normalizeAggregate(aggregate);
        const cleanedApiKeys = aggregateFilledApiKeys(models, cleanedAggregate.apiKey, {});
        const configuredModels = cleanedAggregate.apiKey ? models : [];

        try {
            localStorage.setItem(
                USER_MODEL_CONFIG_KEY,
                JSON.stringify({
                    version: 4,
                    mode: "aggregate",
                    aggregate: cleanedAggregate,
                    apiKeys: cleanedApiKeys,
                    models,
                    updatedAt: Date.now(),
                }),
            );

            const imageModel = configuredModels.find((model) => model.type === "image");
            const parseModel = configuredModels.find((model) => model.type === "parse");
            const promptModel = configuredModels.find((model) => model.type === "prompt");
            updateConfig("model", imageModel?.name || "");
            updateConfig("imageModel", imageModel?.name || "");
            updateConfig("imageTier", defaultTierForConfiguredModel(imageModel) as ImageKeyTier);
            updateConfig("parseModel", parseModel?.name || "");
            updateConfig("promptModel", promptModel?.name || "");
            updateConfig("baseUrl", imageModel?.apiUrl || "");
            updateConfig("apiKey", cleanedAggregate.apiKey || "");
            syncDetailLlmKeys(configuredModels, cleanedApiKeys);
            window.dispatchEvent(new Event("user-model-config-updated"));

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
                    <div className="mt-1 text-xs font-normal text-stone-500">一把 Key 调用后台已启用的所有模型</div>
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
                        <AggregateConfigPanel models={models} aggregate={aggregate} onChange={setAggregate} />
                    </div>

                    <div className="mt-4 flex items-center justify-between rounded-lg border border-stone-200 bg-stone-50 px-3 py-2 dark:border-stone-800 dark:bg-stone-900">
                        <Typography.Text className="text-xs text-stone-600 dark:text-stone-400">当前余额</Typography.Text>
                        <UserBalanceBadge />
                    </div>
                    <div className="mt-4 rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-xs dark:border-blue-900 dark:bg-blue-950">
                        <Typography.Text className="text-xs text-blue-700 dark:text-blue-300">API Key 只保存在当前浏览器本地；生图、解析、提示词和 Agent 都使用这把 Key。</Typography.Text>
                    </div>
                </Form>
            </div>
        </Modal>
    );
}

function AggregateConfigPanel({ models, aggregate, onChange }: { models: AdminModel[]; aggregate: StoredAggregateModelConfig; onChange: (value: StoredAggregateModelConfig) => void }) {
    const hasKey = Boolean(aggregate.apiKey?.trim());
    return (
        <div className="space-y-3">
            <div className="rounded-lg border border-stone-200 bg-stone-50 p-4 dark:border-stone-800 dark:bg-stone-900">
                <div className="grid gap-3">
                    <Input.Password prefix={<KeyRound className="size-4 text-stone-400" />} value={aggregate.apiKey || ""} onChange={(event) => onChange({ ...aggregate, apiKey: event.target.value, catalogs: {} })} placeholder="sk-..." />
                    <Typography.Text type="secondary" className="text-xs">
                        这把 API Key 会用于下方全部模型，包括生图模型和画布 Agent 模型。
                    </Typography.Text>
                </div>
            </div>
            {hasKey && models.length ? (
                <div className="space-y-2">
                    {models.map((model) => (
                        <div key={model.id} className="rounded-lg border border-stone-200 bg-white p-3 dark:border-stone-800 dark:bg-stone-950/40">
                            <div className="flex flex-wrap items-start justify-between gap-3">
                                <div className="min-w-0">
                                    <div className="flex min-w-0 items-center gap-2">
                                        <Typography.Text strong className="truncate">
                                            {model.name}
                                        </Typography.Text>
                                        <Tag color={modelTypeColors[model.type]}>{modelTypeLabels[model.type]}</Tag>
                                    </div>
                                </div>
                                <Tag color="success">已启用</Tag>
                            </div>
                            {model.type === "image" ? <ImageGroupMeta model={model} /> : null}
                        </div>
                    ))}
                </div>
            ) : (
                <div className="rounded-lg border border-dashed border-stone-200 px-4 py-8 text-center text-sm text-stone-500 dark:border-stone-800">{hasKey ? "后台还没有启用的模型分组" : "填写 API Key 后，后台启用的模型都会可用"}</div>
            )}
        </div>
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

function normalizeAggregate(value: StoredAggregateModelConfig) {
    return {
        apiKey: (value.apiKey || "").trim(),
        catalogs: {},
        checkedAt: undefined,
    };
}

function aggregateFilledApiKeys(models: AdminModel[], apiKey: string | undefined, current: Record<string, string>) {
    const key = String(apiKey || "").trim();
    if (!key) return current;
    return {
        ...current,
        ...Object.fromEntries(models.map((model) => [model.id, key])),
    };
}

function syncDetailLlmKeys(models: AdminModel[], apiKeys: Record<string, string>) {
    const detailKeys = Object.fromEntries(
        models
            .filter((model) => model.type === "detail_prompt")
            .map((model) => [model.id, apiKeys[model.id] || ""])
            .filter(([, value]) => value),
    );
    if (!Object.keys(detailKeys).length) return;
    try {
        const saved = JSON.parse(localStorage.getItem(DETAIL_LLM_KEYS_KEY) || "{}") as Record<string, string>;
        localStorage.setItem(DETAIL_LLM_KEYS_KEY, JSON.stringify({ ...saved, ...detailKeys }));
    } catch {
        localStorage.setItem(DETAIL_LLM_KEYS_KEY, JSON.stringify(detailKeys));
    }
}

function defaultTierForConfiguredModel(model: AdminModel | undefined): ImageKeyTier {
    if (!model || model.type !== "image") return "1k";
    const tiers = IMAGE_MODEL_TIERS.filter((tier) => model.tierModels?.[tier]);
    const defaultTier = model.defaultTier as ImageKeyTier | undefined;
    if (defaultTier && tiers.includes(defaultTier)) return defaultTier;
    if (tiers.includes("1k")) return "1k";
    return tiers[0] || "1k";
}
