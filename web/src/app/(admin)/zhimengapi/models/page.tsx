"use client";

import { DeleteOutlined, PlusOutlined, SaveOutlined } from "@ant-design/icons";
import { App, Button, Card, Flex, Form, Input, InputNumber, Modal, Select, Space, Table, Tag, Typography } from "antd";
import { useEffect, useState } from "react";

import { IMAGE_ASPECT_OPTIONS, IMAGE_MODEL_TIERS, IMAGE_MODEL_TIER_LABELS } from "@/constant/image-model-options";
import { createAdminModel, deleteAdminModel, fetchAdminModels, fetchAdminSettings, saveAdminSettings, updateAdminModel, type AdminModel, type AdminSettings } from "@/services/api/admin";
import { useUserStore } from "@/stores/use-user-store";

type ModelType = "image" | "video" | "parse" | "prompt" | "detail_prompt";
type ImageBedFormValues = { uploadUrl: string; apiKey: string };

const modelTypeLabels: Record<ModelType, string> = {
    image: "图片分组",
    video: "视频模型",
    parse: "解析模型",
    prompt: "提示词提取",
    detail_prompt: "详情图提示词",
};

const modelTypeColors: Record<ModelType, string> = {
    image: "blue",
    video: "purple",
    parse: "green",
    prompt: "orange",
    detail_prompt: "cyan",
};

const aspectOptions = IMAGE_ASPECT_OPTIONS.map((item) => ({ label: `${item.label} ${item.description}`, value: item.value }));
const videoSizeOptions = [
    { label: "自动", value: "auto" },
    { label: "720p 横屏 1280x720", value: "1280x720" },
    { label: "720p 竖屏 720x1280", value: "720x1280" },
    { label: "方形 1024x1024", value: "1024x1024" },
    { label: "1080p 横屏 1920x1080", value: "1920x1080" },
    { label: "1080p 竖屏 1080x1920", value: "1080x1920" },
    { label: "4K 横屏 3840x2160", value: "3840x2160" },
    { label: "4K 竖屏 2160x3840", value: "2160x3840" },
];

function isVisualGenerationType(type: ModelType) {
    return type === "image" || type === "video";
}

function defaultSupportedSizes(type: ModelType) {
    return type === "video" ? ["auto", "1280x720"] : ["auto", "1:1"];
}

function supportedSizeOptions(type: ModelType) {
    return type === "video" ? videoSizeOptions : aspectOptions;
}

export default function ModelsPage() {
    const { message } = App.useApp();
    const token = useUserStore((state) => state.token);
    const [models, setModels] = useState<AdminModel[]>([]);
    const [isLoading, setIsLoading] = useState(false);
    const [editingModel, setEditingModel] = useState<AdminModel | null>(null);
    const [settings, setSettings] = useState<AdminSettings | null>(null);
    const [isSettingsLoading, setIsSettingsLoading] = useState(false);
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [form] = Form.useForm<AdminModel>();
    const [imageBedForm] = Form.useForm<ImageBedFormValues>();
    const currentType = Form.useWatch("type", form) || "image";

    useEffect(() => {
        void loadModels();
        void loadSettings();
    }, [token]);

    const loadModels = async () => {
        if (!token) return;
        setIsLoading(true);
        try {
            const data = await fetchAdminModels(token);
            setModels(data.items || []);
        } catch (error) {
            message.error(error instanceof Error ? error.message : "加载模型失败");
        } finally {
            setIsLoading(false);
        }
    };

    const loadSettings = async () => {
        if (!token) return;
        setIsSettingsLoading(true);
        try {
            const data = await fetchAdminSettings(token);
            setSettings(data);
            imageBedForm.setFieldsValue({
                uploadUrl: data.private.imageBed?.uploadUrl || "https://tc.zmoapi.cn/api/upload",
                apiKey: "",
            });
        } catch (error) {
            message.error(error instanceof Error ? error.message : "加载图床配置失败");
        } finally {
            setIsSettingsLoading(false);
        }
    };

    const saveImageBedSettings = async () => {
        if (!token || !settings) return;
        try {
            const values = await imageBedForm.validateFields();
            const nextSettings: AdminSettings = {
                ...settings,
                private: {
                    ...settings.private,
                    imageBed: {
                        ...settings.private.imageBed,
                        uploadUrl: values.uploadUrl.trim(),
                        apiKey: values.apiKey.trim(),
                    },
                },
            };
            const saved = await saveAdminSettings(token, nextSettings);
            setSettings(saved);
            imageBedForm.setFieldsValue({
                uploadUrl: saved.private.imageBed?.uploadUrl || values.uploadUrl.trim(),
                apiKey: "",
            });
            message.success("图床配置已保存");
        } catch (error) {
            message.error(error instanceof Error ? error.message : "保存图床配置失败");
        }
    };

    const openModal = (model: AdminModel | null) => {
        setEditingModel(model);
        setIsModalOpen(true);
        if (model) {
            form.setFieldsValue({ ...model, apiKey: "", tierModels: model.tierModels || {}, defaultTier: model.defaultTier || firstConfiguredTier(model.tierModels), supportedSizes: model.supportedSizes?.length ? model.supportedSizes : defaultSupportedSizes(model.type), referenceLimit: model.referenceLimit || 4, isDefault: Boolean(model.isDefault) });
        } else {
            form.resetFields();
            form.setFieldsValue({ enabled: true, type: "image", apiKey: "", tierModels: {}, defaultTier: "1k", supportedSizes: ["auto", "1:1"], referenceLimit: 4, isDefault: false });
        }
    };

    const closeModal = () => {
        setIsModalOpen(false);
        setEditingModel(null);
        form.resetFields();
    };

    const saveModel = async () => {
        if (!token) return;
        try {
            const values = await form.validateFields();
            const payload = normalizeModelPayload(values);
            if (payload.type === "image" && !Object.keys(payload.tierModels || {}).length) {
                message.error("请至少填写一个清晰度对应模型");
                return;
            }

            if (editingModel) {
                await updateAdminModel(token, editingModel.id, payload);
                message.success("模型已更新");
            } else {
                await createAdminModel(token, payload as Omit<AdminModel, "id">);
                message.success("模型已添加");
            }

            await loadModels();
            closeModal();
        } catch (error) {
            message.error(error instanceof Error ? error.message : "保存失败");
        }
    };

    const deleteModel = async (id: string) => {
        if (!token) return;
        Modal.confirm({
            title: "确认删除",
            content: "确定要删除这个配置吗？",
            onOk: async () => {
                try {
                    await deleteAdminModel(token, id);
                    message.success("模型已删除");
                    await loadModels();
                } catch (error) {
                    message.error(error instanceof Error ? error.message : "删除失败");
                }
            },
        });
    };

    return (
        <main style={{ padding: 24 }}>
            <Flex vertical gap={16}>
                <Card variant="borderless">
                    <Flex justify="space-between" align="center">
                        <div>
                            <Typography.Title level={5} style={{ margin: 0 }}>
                                模型管理
                            </Typography.Title>
                            <Typography.Text type="secondary" style={{ fontSize: 13 }}>
                                图片按分组配置请求地址、清晰度模型、支持比例和参考图数量；详情图提示词用于配置 ChatGPT、Claude 等 LLM 请求地址和模型。
                            </Typography.Text>
                        </div>
                        <Button type="primary" icon={<PlusOutlined />} onClick={() => openModal(null)}>
                            添加配置
                        </Button>
                    </Flex>
                </Card>

                <Card variant="borderless" loading={isSettingsLoading}>
                    <Flex justify="space-between" align="flex-start" gap={16}>
                        <div style={{ minWidth: 180 }}>
                            <Typography.Title level={5} style={{ margin: 0 }}>
                                图床配置
                            </Typography.Title>
                            <Typography.Text type="secondary" style={{ fontSize: 13 }}>
                                参考图上传会先走这里配置的图床。API Key 留空表示继续使用已保存密钥。
                            </Typography.Text>
                        </div>
                        <Form form={imageBedForm} layout="vertical" requiredMark={false} style={{ flex: 1 }}>
                            <Flex gap={12} align="flex-start">
                                <Form.Item name="uploadUrl" label="上传地址" rules={[{ required: true, message: "请输入上传地址" }]} style={{ flex: 1, marginBottom: 0 }}>
                                    <Input placeholder="https://tc.zmoapi.cn/api/upload" />
                                </Form.Item>
                                <Form.Item
                                    name="apiKey"
                                    label="API Key"
                                    style={{ width: 320, marginBottom: 0 }}
                                    extra={settings?.private.imageBed?.hasApiKey ? "已保存密钥；留空表示不修改。" : "首次配置请填写。"}
                                >
                                    <Input.Password placeholder={settings?.private.imageBed?.hasApiKey ? "留空表示不修改" : "ib_..."} />
                                </Form.Item>
                                <Form.Item label=" " style={{ marginBottom: 0 }}>
                                    <Button type="primary" icon={<SaveOutlined />} onClick={saveImageBedSettings}>
                                        保存图床配置
                                    </Button>
                                </Form.Item>
                            </Flex>
                        </Form>
                    </Flex>
                </Card>

                <Card variant="borderless">
                    <Table
                        rowKey="id"
                        loading={isLoading}
                        dataSource={models}
                        pagination={false}
                        columns={[
                            { title: "显示名称", dataIndex: "name", width: 180, render: (value) => <Typography.Text strong>{value}</Typography.Text> },
                            {
                                title: "类型",
                                dataIndex: "type",
                                width: 110,
                                render: (value: ModelType) => <Tag color={modelTypeColors[value]}>{modelTypeLabels[value]}</Tag>,
                            },
                            {
                                title: "模型",
                                width: 260,
                                render: (_, record) => (record.type === "image" ? <TierModelSummary model={record} /> : <Typography.Text code>{record.modelId || record.name}</Typography.Text>),
                            },
                            { title: "API 地址", dataIndex: "apiUrl", ellipsis: true },
                            {
                                title: "参考图",
                                dataIndex: "referenceLimit",
                                width: 90,
                                render: (value: number | undefined, record) => (isVisualGenerationType(record.type) ? `${value || 4} 张` : "-"),
                            },
                            {
                                title: "支持比例",
                                dataIndex: "supportedSizes",
                                width: 180,
                                render: (value: string[] | undefined, record) => (isVisualGenerationType(record.type) ? <Typography.Text type="secondary">{(value?.length ? value : defaultSupportedSizes(record.type)).join("、")}</Typography.Text> : "-"),
                            },
                            {
                                title: "状态",
                                dataIndex: "enabled",
                                width: 90,
                                render: (value: boolean) => <Tag color={value ? "success" : "default"}>{value ? "已启用" : "已停用"}</Tag>,
                            },
                            {
                                title: "默认",
                                dataIndex: "isDefault",
                                width: 90,
                                render: (value: boolean, record) => (record.type === "detail_prompt" && value ? <Tag color="blue">默认</Tag> : "-"),
                            },
                            {
                                title: "操作",
                                key: "actions",
                                width: 150,
                                align: "right",
                                render: (_, record) => (
                                    <Space size={4}>
                                        <Button size="small" onClick={() => openModal(record)}>
                                            编辑
                                        </Button>
                                        <Button danger size="small" icon={<DeleteOutlined />} onClick={() => deleteModel(record.id)} />
                                    </Space>
                                ),
                            },
                        ]}
                    />
                </Card>
            </Flex>

            <Modal
                title={editingModel ? "编辑配置" : "添加配置"}
                open={isModalOpen}
                width={720}
                onCancel={closeModal}
                footer={
                    <Space>
                        <Button onClick={closeModal}>取消</Button>
                        <Button type="primary" icon={<SaveOutlined />} onClick={saveModel}>
                            保存
                        </Button>
                    </Space>
                }
            >
                <Form form={form} layout="vertical" requiredMark={false}>
                    <Form.Item name="type" label="配置类型" rules={[{ required: true }]}>
                        <Select
                            options={[
                                { label: "图片分组", value: "image" },
                                { label: "视频模型", value: "video" },
                                { label: "解析模型", value: "parse" },
                                { label: "提示词提取", value: "prompt" },
                                { label: "详情图提示词", value: "detail_prompt" },
                            ]}
                        />
                    </Form.Item>
                    <Form.Item name="name" label={currentType === "image" ? "分组名称" : "显示名称"} rules={[{ required: true, message: "请输入名称" }]} extra={currentType === "image" ? "例如：ChatGPT、即梦、豆包。用户侧会按这个名称选择分组。" : "前端展示给用户看的名称。"}>
                        <Input placeholder={currentType === "image" ? "例如：ChatGPT" : "例如：视频解析"} />
                    </Form.Item>
                    <Form.Item name="apiUrl" label="请求地址" rules={[{ required: true, message: "请输入请求地址" }]} extra="OpenAI 兼容格式的接口地址，例如：https://api.example.com/v1">
                        <Input placeholder="https://api.example.com/v1" />
                    </Form.Item>

                    {currentType === "image" ? (
                        <>
                            <Typography.Text className="mb-2 block text-sm font-medium">清晰度对应模型</Typography.Text>
                            <div className="mb-4 grid grid-cols-2 gap-3">
                                {IMAGE_MODEL_TIERS.map((tier) => (
                                    <Form.Item key={tier} name={["tierModels", tier]} label={IMAGE_MODEL_TIER_LABELS[tier]} className="!mb-0">
                                        <Input placeholder={`例如：gpt-image-${tier}`} />
                                    </Form.Item>
                                ))}
                            </div>
                            <Form.Item shouldUpdate noStyle>
                                {() => {
                                    const tierModels = form.getFieldValue("tierModels") || {};
                                    const configuredTiers = IMAGE_MODEL_TIERS.filter((tier) => String(tierModels[tier] || "").trim());
                                    const options = (configuredTiers.length ? configuredTiers : IMAGE_MODEL_TIERS).map((tier) => ({ label: IMAGE_MODEL_TIER_LABELS[tier], value: tier }));
                                    return (
                                        <Form.Item name="defaultTier" label="默认画质" rules={[{ required: true, message: "请选择默认画质" }]} extra="用户新建画布节点或切换到该分组时，默认使用这个清晰度。">
                                            <Select options={options} placeholder="请选择默认画质" />
                                        </Form.Item>
                                    );
                                }}
                            </Form.Item>
                            <Form.Item name="supportedSizes" label="支持比例" rules={[{ required: true, message: "请选择支持比例" }]} extra="用户选择该分组后，画布里只显示这些比例。">
                                <Select mode="multiple" options={aspectOptions} />
                            </Form.Item>
                            <Form.Item name="referenceLimit" label="参考图数量" rules={[{ required: true, message: "请输入参考图数量" }]} extra="用户在画布里上传或粘贴参考图时，不能超过这个数量。">
                                <InputNumber min={1} max={20} precision={0} className="!w-full" placeholder="例如：4" />
                            </Form.Item>
                        </>
                    ) : (
                        <>
                            <Form.Item name="modelId" label="调用模型 ID" extra="实际发送给 OpenAI 兼容接口的 model 参数，留空时默认使用显示名称。">
                                <Input placeholder={currentType === "prompt" ? "例如：gpt-5.5" : "例如：video-parse"} />
                            </Form.Item>
                            {currentType === "video" ? (
                                <>
                                    <Form.Item name="supportedSizes" label="支持尺寸" rules={[{ required: true, message: "请选择支持尺寸" }]} extra="用户选择该视频模型后，画布视频参数优先按这里的尺寸限制。">
                                        <Select mode="multiple" options={supportedSizeOptions(currentType)} />
                                    </Form.Item>
                                    <Form.Item name="referenceLimit" label="参考图数量" rules={[{ required: true, message: "请输入参考图数量" }]} extra="用于限制图生视频、首尾帧或参考图生成时最多携带多少张参考图。">
                                        <InputNumber min={1} max={20} precision={0} className="!w-full" placeholder="例如：4" />
                                    </Form.Item>
                                </>
                            ) : null}
                            {currentType === "prompt" ? (
                                <Form.Item
                                    name="apiKey"
                                    label="后台专用 API Key"
                                    rules={editingModel?.hasApiKey ? [] : [{ required: true, message: "请输入后台专用 API Key" }]}
                                    extra={editingModel?.hasApiKey ? "已保存密钥；留空表示继续使用原密钥。这个模型只用于图片提取提示词。" : "必填。这个模型只用于图片提取提示词。"}
                                >
                                    <Input.Password placeholder={editingModel?.hasApiKey ? "留空表示不修改" : "sk-..."} />
                                </Form.Item>
                            ) : null}
                            {currentType === "detail_prompt" ? (
                                <Form.Item name="isDefault" label="设为默认详情图提示词模型" extra="前台详情图工作台会默认选中这个模型；同一时间只会保留一个默认。">
                                    <Select
                                        options={[
                                            { label: "设为默认", value: true },
                                            { label: "不设为默认", value: false },
                                        ]}
                                    />
                                </Form.Item>
                            ) : null}
                        </>
                    )}

                    <Form.Item name="enabled" label="是否启用">
                        <Select
                            options={[
                                { label: "启用", value: true },
                                { label: "停用", value: false },
                            ]}
                        />
                    </Form.Item>
                    <Form.Item name="remark" label="备注">
                        <Input.TextArea rows={3} placeholder="选填，用于说明用途" />
                    </Form.Item>
                </Form>
            </Modal>
        </main>
    );
}

function TierModelSummary({ model }: { model: AdminModel }) {
    const tierModels = model.tierModels || {};
    const configured = IMAGE_MODEL_TIERS.filter((tier) => tierModels[tier]);
    if (!configured.length) return <Typography.Text type="secondary">未配置清晰度模型</Typography.Text>;
    return (
        <Space size={4} wrap>
            {configured.map((tier) => (
                <Tag key={tier} color={model.defaultTier === tier ? "blue" : undefined}>
                    {tier}: {tierModels[tier]}
                    {model.defaultTier === tier ? " 默认" : ""}
                </Tag>
            ))}
        </Space>
    );
}

function normalizeModelPayload(values: AdminModel) {
    if (values.type !== "image") {
        return {
            ...values,
            apiKey: values.type === "prompt" ? String(values.apiKey || "").trim() : "",
            tierModels: {},
            defaultTier: "",
            supportedSizes: values.type === "video" ? values.supportedSizes?.length ? values.supportedSizes : defaultSupportedSizes(values.type) : [],
            referenceLimit: values.type === "video" ? Math.max(1, Math.min(20, Math.floor(Math.abs(Number(values.referenceLimit)) || 4))) : 4,
            isDefault: values.type === "detail_prompt" ? Boolean(values.isDefault) : false,
        };
    }
    const tierModels: Record<string, string> = Object.fromEntries(Object.entries(values.tierModels || {}).map(([key, value]) => [key, String(value || "").trim()]).filter(([, value]) => value));
    const defaultTier = tierModels[String(values.defaultTier || "")] ? String(values.defaultTier) : firstConfiguredTier(tierModels);
    return {
        ...values,
        modelId: "",
        apiKey: "",
        tierModels,
        defaultTier,
        supportedSizes: values.supportedSizes?.length ? values.supportedSizes : ["auto"],
        referenceLimit: Math.max(1, Math.min(20, Math.floor(Math.abs(Number(values.referenceLimit)) || 4))),
        isDefault: false,
    };
}

function firstConfiguredTier(tierModels: Record<string, string> | undefined) {
    if (tierModels?.["1k"]) return "1k";
    return IMAGE_MODEL_TIERS.find((tier) => tierModels?.[tier]) || "1k";
}
