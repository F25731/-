"use client";

import { useEffect, useState } from "react";
import { App, Button, Form, Input, Modal, Segmented, Space, Tag, Typography } from "antd";
import { KeyRound } from "lucide-react";

import { UserBalanceBadge } from "@/components/layout/user-balance-badge";
import { IMAGE_MODEL_TIERS } from "@/constant/image-model-options";
import { normalizeVideoCapabilities } from "@/constant/video-model-options";
import { fetchPublicModels, type AdminModel } from "@/services/api/admin";
import { USER_MODEL_CONFIG_KEY, useConfigStore, type StoredAggregateModelConfig, type UserModelConfigMode } from "@/stores/use-config-store";
import type { ImageKeyTier } from "@/types/api-keys";

const DETAIL_LLM_KEYS_KEY = "detail-workbench:llm-keys";

const modelTypeLabels: Record<AdminModel["type"], string> = {
    image: "图片分组",
    video: "视频模型",
    parse: "解析模型",
    prompt: "提示词模型",
    detail_prompt: "详情图提示词",
};

const modelTypeColors: Record<AdminModel["type"], string> = {
    image: "blue",
    video: "purple",
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
    const [apiKeys, setApiKeys] = useState<Record<string, string>>({});
    const [mode, setMode] = useState<UserModelConfigMode>("single");
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
            const config = JSON.parse(localStorage.getItem(USER_MODEL_CONFIG_KEY) || "{}") as { mode?: UserModelConfigMode; apiKeys?: Record<string, string>; aggregate?: StoredAggregateModelConfig };
            setMode(config.mode === "aggregate" ? "aggregate" : "single");
            setAggregate({
                apiKey: config.aggregate?.apiKey || "",
                catalogs: {},
            });
            setApiKeys(config.apiKeys || {});
            form.setFieldsValue({ apiKeys: config.apiKeys || {} });
        } catch {
            setMode("single");
            setAggregate({ apiKey: "", catalogs: {} });
            setApiKeys({});
            form.resetFields();
        }
    };

    const saveConfig = async () => {
        let cleanedApiKeys = Object.fromEntries(Object.entries(apiKeys).map(([id, value]) => [id, value.trim()]).filter(([, value]) => value));
        let cleanedAggregate = normalizeAggregate(aggregate);
        if (mode === "aggregate") cleanedApiKeys = aggregateFilledApiKeys(models, cleanedAggregate.apiKey, cleanedApiKeys);
        const configuredModels = mode === "aggregate" ? (cleanedAggregate.apiKey ? models : []) : models.filter((model) => cleanedApiKeys[model.id]);

        try {
            localStorage.setItem(
                USER_MODEL_CONFIG_KEY,
                JSON.stringify({
                    version: 4,
                    mode,
                    aggregate: cleanedAggregate,
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
            updateConfig("imageTier", defaultTierForConfiguredModel(imageModel) as ImageKeyTier);
            updateConfig("videoModel", videoModel?.name || "");
            updateConfig("parseModel", parseModel?.name || "");
            updateConfig("promptModel", promptModel?.name || "");
            updateConfig("baseUrl", imageModel?.apiUrl || "");
            updateConfig("apiKey", mode === "aggregate" ? cleanedAggregate.apiKey || "" : imageModel ? cleanedApiKeys[imageModel.id] || "" : "");
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
                        <Segmented
                            block
                            value={mode}
                            options={[
                                { label: "聚合模式", value: "aggregate" },
                                { label: "单模型模式", value: "single" },
                            ]}
                            onChange={(value) => setMode(value as UserModelConfigMode)}
                        />

                        {mode === "aggregate" ? (
                            <AggregateConfigPanel models={models} aggregate={aggregate} onChange={setAggregate} />
                        ) : models.length ? (
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
                                        </div>
                                        {apiKeys[model.id]?.trim() ? <Tag color="success">已填写</Tag> : <Tag>未填写</Tag>}
                                    </div>
                                    {model.type === "image" ? <ImageGroupMeta model={model} /> : null}
                                    {model.type === "video" ? <VideoModelMeta model={model} /> : null}
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

                    <div className="mt-4 flex items-center justify-between rounded-lg border border-stone-200 bg-stone-50 px-3 py-2 dark:border-stone-800 dark:bg-stone-900">
                        <Typography.Text className="text-xs text-stone-600 dark:text-stone-400">当前余额</Typography.Text>
                        <UserBalanceBadge />
                    </div>
                    <div className="mt-4 rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-xs dark:border-blue-900 dark:bg-blue-950">
                        <Typography.Text className="text-xs text-blue-700 dark:text-blue-300">API Key 只保存在当前浏览器本地；聚合模式用一个 Key 调用后台启用的模型，单模型模式继续兼容逐个填写。</Typography.Text>
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
                        聚合模式会直接使用后台已启用的模型配置和这一个 API Key，不需要获取模型列表。
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
                            {model.type === "video" ? <VideoModelMeta model={model} /> : null}
                        </div>
                    ))}
                </div>
            ) : (
                <div className="rounded-lg border border-dashed border-stone-200 px-4 py-8 text-center text-sm text-stone-500 dark:border-stone-800">{hasKey ? "后台还没有启用的模型分组" : "填写聚合 API Key 后，后台启用的模型都会可用"}</div>
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

function VideoModelMeta({ model }: { model: AdminModel }) {
    const capabilities = normalizeVideoCapabilities(model.videoCapabilities || { ratios: model.supportedSizes, referenceImageLimit: model.referenceLimit });
    return (
        <div className="mb-3 flex flex-wrap gap-1.5">
            <Tag color="purple">{capabilities.market}</Tag>
            {capabilities.ratios.map((ratio) => (
                <Tag key={ratio}>{ratio}</Tag>
            ))}
            {capabilities.qualities.map((quality) => (
                <Tag key={quality}>{quality}</Tag>
            ))}
            <Tag>{capabilities.durations.map((value) => `${value}s`).join(" / ")}</Tag>
            <Tag color="purple">参考图 {capabilities.referenceImageLimit} 张</Tag>
            <Tag color="purple">参考视频 {capabilities.referenceVideoLimit} 个</Tag>
            {capabilities.referenceAudioLimit ? <Tag color="purple">参考音频 {capabilities.referenceAudioLimit} 个</Tag> : null}
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
    const detailKeys = Object.fromEntries(models.filter((model) => model.type === "detail_prompt").map((model) => [model.id, apiKeys[model.id] || ""]).filter(([, value]) => value));
    if (!Object.keys(detailKeys).length) return;
    try {
        const saved = JSON.parse(localStorage.getItem(DETAIL_LLM_KEYS_KEY) || "{}") as Record<string, string>;
        localStorage.setItem(DETAIL_LLM_KEYS_KEY, JSON.stringify({ ...saved, ...detailKeys }));
    } catch {
        localStorage.setItem(DETAIL_LLM_KEYS_KEY, JSON.stringify(detailKeys));
    }
}

function defaultTierForConfiguredModel(model: AdminModel | undefined) {
    if (!model || model.type !== "image") return "1k";
    const tiers = IMAGE_MODEL_TIERS.filter((tier) => model.tierModels?.[tier]);
    if (model.defaultTier && tiers.includes(model.defaultTier)) return model.defaultTier;
    if (tiers.includes("1k")) return "1k";
    return tiers[0] || "1k";
}
