"use client";

import { useEffect, useState } from "react";
import { App, Button, Form, Input, Modal, Segmented, Space, Tag, Typography } from "antd";
import { KeyRound } from "lucide-react";

import { IMAGE_MODEL_TIERS } from "@/constant/image-model-options";
import { normalizeVideoCapabilities } from "@/constant/video-model-options";
import { detectAggregateModels, fetchPublicModels, type AdminModel } from "@/services/api/admin";
import { DEFAULT_POOL_API_BASE_URL, USER_MODEL_CONFIG_KEY, useConfigStore, type StoredAggregateModelConfig, type UserModelConfigMode } from "@/stores/use-config-store";
import type { ImageKeyTier } from "@/types/api-keys";

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
    const setConfigDialogOpen = useConfigStore((state) => state.setConfigDialogOpen);
    const clearPromptContinue = useConfigStore((state) => state.clearPromptContinue);
    const [models, setModels] = useState<AdminModel[]>([]);
    const [apiKeys, setApiKeys] = useState<Record<string, string>>({});
    const [mode, setMode] = useState<UserModelConfigMode>("single");
    const [aggregate, setAggregate] = useState<StoredAggregateModelConfig>({ baseUrl: `${DEFAULT_POOL_API_BASE_URL}/v1`, apiKey: "", availableModelIds: [] });
    const [isCheckingAggregate, setIsCheckingAggregate] = useState(false);

    useEffect(() => {
        if (!isConfigOpen) return;
        void loadModels();
        loadCurrentConfig();
    }, [isConfigOpen]);

    const loadModels = async () => {
        try {
            const data = await fetchPublicModels();
            setModels(data.filter((model) => model.enabled && model.type !== "prompt" && model.type !== "detail_prompt"));
        } catch {
            message.error("加载模型列表失败");
        }
    };

    const loadCurrentConfig = () => {
        try {
            const config = JSON.parse(localStorage.getItem(USER_MODEL_CONFIG_KEY) || "{}") as { mode?: UserModelConfigMode; apiKeys?: Record<string, string>; aggregate?: StoredAggregateModelConfig };
            setMode(config.mode === "aggregate" ? "aggregate" : "single");
            setAggregate({
                baseUrl: config.aggregate?.baseUrl || `${DEFAULT_POOL_API_BASE_URL}/v1`,
                apiKey: config.aggregate?.apiKey || "",
                availableModelIds: config.aggregate?.availableModelIds || [],
                checkedAt: config.aggregate?.checkedAt,
            });
            setApiKeys(config.apiKeys || {});
            form.setFieldsValue({ apiKeys: config.apiKeys || {} });
        } catch {
            setMode("single");
            setAggregate({ baseUrl: `${DEFAULT_POOL_API_BASE_URL}/v1`, apiKey: "", availableModelIds: [] });
            setApiKeys({});
            form.resetFields();
        }
    };

    const saveConfig = async () => {
        const cleanedApiKeys = Object.fromEntries(Object.entries(apiKeys).map(([id, value]) => [id, value.trim()]).filter(([, value]) => value));
        let cleanedAggregate = normalizeAggregate(aggregate);
        if (mode === "aggregate" && cleanedAggregate.baseUrl && cleanedAggregate.apiKey && !cleanedAggregate.availableModelIds?.length) {
            const detected = await checkAggregateModels(cleanedAggregate);
            if (!detected) return;
            cleanedAggregate = detected;
        }
        const configuredModels = mode === "aggregate" ? aggregateConfiguredModels(models, cleanedAggregate.availableModelIds || []) : models.filter((model) => cleanedApiKeys[model.id]);
        const matchedAggregateModelIds = mode === "aggregate" ? cleanedAggregate.availableModelIds || [] : [];

        try {
            localStorage.setItem(
                USER_MODEL_CONFIG_KEY,
                JSON.stringify({
                    version: 3,
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
            updateConfig("imageTier", defaultTierForConfiguredModel(imageModel, matchedAggregateModelIds) as ImageKeyTier);
            updateConfig("videoModel", videoModel?.name || "");
            updateConfig("parseModel", parseModel?.name || "");
            updateConfig("promptModel", promptModel?.name || "");
            updateConfig("baseUrl", mode === "aggregate" ? cleanedAggregate.baseUrl || "" : imageModel?.apiUrl || "");
            updateConfig("apiKey", mode === "aggregate" ? cleanedAggregate.apiKey || "" : imageModel ? cleanedApiKeys[imageModel.id] || "" : "");

            message.success(configuredModels.length ? "配置已保存" : "配置已清空");
            finishConfig();
        } catch {
            message.error("保存失败");
        }
    };

    const checkAggregateModels = async (target = normalizeAggregate(aggregate)) => {
        if (!target.baseUrl || !target.apiKey) {
            message.warning("请先填写聚合请求地址和 API Key");
            return null;
        }
        setIsCheckingAggregate(true);
        try {
            const availableModelIds = await detectAggregateModels(target.baseUrl, target.apiKey);
            const next = { ...target, availableModelIds, checkedAt: Date.now() };
            setAggregate(next);
            const matched = aggregateConfiguredModels(models, availableModelIds);
            message.success(`检测到 ${availableModelIds.length} 个可调用模型，已匹配 ${matched.length} 个后台模型`);
            return next;
        } catch (error) {
            message.error(error instanceof Error ? error.message : "检测模型列表失败");
            return null;
        } finally {
            setIsCheckingAggregate(false);
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
                            <AggregateConfigPanel models={models} aggregate={aggregate} isChecking={isCheckingAggregate} onChange={setAggregate} onCheck={() => void checkAggregateModels()} />
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
                                            <Typography.Text type="secondary" className="mt-1 block text-xs">
                                                {model.apiUrl}
                                            </Typography.Text>
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

                    <div className="mt-4 rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-xs dark:border-blue-900 dark:bg-blue-950">
                        <Typography.Text className="text-xs text-blue-700 dark:text-blue-300">API Key 只保存在当前浏览器本地；聚合模式用一个 Key 匹配多个后台模型，单模型模式继续兼容逐个填写。</Typography.Text>
                    </div>
                </Form>
            </div>
        </Modal>
    );
}

function AggregateConfigPanel({ models, aggregate, isChecking, onChange, onCheck }: { models: AdminModel[]; aggregate: StoredAggregateModelConfig; isChecking: boolean; onChange: (value: StoredAggregateModelConfig) => void; onCheck: () => void }) {
    const ids = aggregate.availableModelIds || [];
    const matched = aggregateConfiguredModels(models, ids);
    const matchedIds = new Set(matched.map((model) => model.id));
    return (
        <div className="space-y-3">
            <div className="rounded-lg border border-stone-200 bg-stone-50 p-4 dark:border-stone-800 dark:bg-stone-900">
                <div className="grid gap-3">
                    <Input value={aggregate.baseUrl || ""} onChange={(event) => onChange({ ...aggregate, baseUrl: event.target.value, availableModelIds: [] })} placeholder="请求地址，例如 https://api.zmoapi.cn/v1" />
                    <Input.Password prefix={<KeyRound className="size-4 text-stone-400" />} value={aggregate.apiKey || ""} onChange={(event) => onChange({ ...aggregate, apiKey: event.target.value, availableModelIds: [] })} placeholder="sk-..." />
                    <div className="flex flex-wrap items-center justify-between gap-2">
                        <Typography.Text type="secondary" className="text-xs">
                            {ids.length ? `已检测到 ${ids.length} 个模型` : "检测后会按后台模型 ID 自动匹配可用模型"}
                        </Typography.Text>
                        <Button loading={isChecking} onClick={onCheck}>
                            检测模型
                        </Button>
                    </div>
                </div>
            </div>
            {models.length ? (
                <div className="space-y-2">
                    {models.map((model) => {
                        const summary = aggregateMatchSummary(model, ids);
                        const active = matchedIds.has(model.id);
                        return (
                            <div key={model.id} className="rounded-lg border border-stone-200 bg-white p-3 dark:border-stone-800 dark:bg-stone-950/40">
                                <div className="flex flex-wrap items-start justify-between gap-3">
                                    <div className="min-w-0">
                                        <div className="flex min-w-0 items-center gap-2">
                                            <Typography.Text strong className="truncate">
                                                {model.name}
                                            </Typography.Text>
                                            <Tag color={modelTypeColors[model.type]}>{modelTypeLabels[model.type]}</Tag>
                                        </div>
                                        <Typography.Text type="secondary" className="mt-1 block text-xs">
                                            {model.type === "image" ? "匹配清晰度模型 ID" : model.modelId || model.name}
                                        </Typography.Text>
                                    </div>
                                    <Tag color={active ? "success" : undefined}>{active ? "已匹配" : "未匹配"}</Tag>
                                </div>
                                <div className="mt-2 flex flex-wrap gap-1.5">
                                    {summary.length ? summary.map((item) => <Tag key={item}>{item}</Tag>) : <Tag>该 Key 的模型列表里没有匹配项</Tag>}
                                </div>
                            </div>
                        );
                    })}
                </div>
            ) : (
                <div className="rounded-lg border border-dashed border-stone-200 px-4 py-8 text-center text-sm text-stone-500 dark:border-stone-800">后台还没有启用的模型分组</div>
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
        baseUrl: (value.baseUrl || "").trim().replace(/\/+$/, ""),
        apiKey: (value.apiKey || "").trim(),
        availableModelIds: Array.from(new Set((value.availableModelIds || []).map((item) => String(item || "").trim()).filter(Boolean))),
        checkedAt: value.checkedAt,
    };
}

function aggregateConfiguredModels(models: AdminModel[], availableModelIds: string[]) {
    return models.filter((model) => aggregateMatchSummary(model, availableModelIds).length > 0);
}

function aggregateMatchSummary(model: AdminModel, availableModelIds: string[]) {
    const available = new Set(availableModelIds.map((item) => item.trim()).filter(Boolean));
    if (!available.size) return [];
    if (model.type === "image") {
        return IMAGE_MODEL_TIERS.filter((tier) => available.has(String(model.tierModels?.[tier] || "").trim()));
    }
    const modelId = (model.modelId || model.name).trim();
    return modelId && available.has(modelId) ? [modelId] : [];
}

function defaultTierForConfiguredModel(model: AdminModel | undefined, availableModelIds: string[]) {
    if (!model || model.type !== "image") return "1k";
    const tiers = availableModelIds.length ? aggregateMatchSummary(model, availableModelIds) : IMAGE_MODEL_TIERS.filter((tier) => model.tierModels?.[tier]);
    if (model.defaultTier && tiers.includes(model.defaultTier)) return model.defaultTier;
    if (tiers.includes("1k")) return "1k";
    return tiers[0] || "1k";
}
