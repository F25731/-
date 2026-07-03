"use client";

import { DeleteOutlined, PlusOutlined, SaveOutlined } from "@ant-design/icons";
import { App, Button, Card, Flex, Form, Input, InputNumber, Modal, Select, Space, Table, Tag, Typography } from "antd";
import { useEffect, useState } from "react";

import { IMAGE_ASPECT_OPTIONS, IMAGE_MODEL_TIERS, IMAGE_MODEL_TIER_LABELS } from "@/constant/image-model-options";
import { createAdminModel, deleteAdminModel, fetchAdminModels, updateAdminModel, type AdminModel } from "@/services/api/admin";
import { useUserStore } from "@/stores/use-user-store";

type ModelType = "image" | "video" | "parse" | "prompt";

const modelTypeLabels: Record<ModelType, string> = {
    image: "图片分组",
    video: "视频模型",
    parse: "解析模型",
    prompt: "提示词模型",
};

const modelTypeColors: Record<ModelType, string> = {
    image: "blue",
    video: "purple",
    parse: "green",
    prompt: "orange",
};

const aspectOptions = IMAGE_ASPECT_OPTIONS.map((item) => ({ label: `${item.label} ${item.description}`, value: item.value }));

export default function ModelsPage() {
    const { message } = App.useApp();
    const token = useUserStore((state) => state.token);
    const [models, setModels] = useState<AdminModel[]>([]);
    const [isLoading, setIsLoading] = useState(false);
    const [editingModel, setEditingModel] = useState<AdminModel | null>(null);
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [form] = Form.useForm<AdminModel>();
    const currentType = Form.useWatch("type", form) || "image";

    useEffect(() => {
        void loadModels();
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

    const openModal = (model: AdminModel | null) => {
        setEditingModel(model);
        setIsModalOpen(true);
        if (model) {
            form.setFieldsValue({ ...model, apiKey: "", tierModels: model.tierModels || {}, defaultTier: model.defaultTier || firstConfiguredTier(model.tierModels), supportedSizes: model.supportedSizes?.length ? model.supportedSizes : ["auto", "1:1"], referenceLimit: model.referenceLimit || 4 });
        } else {
            form.resetFields();
            form.setFieldsValue({ enabled: true, type: "image", apiKey: "", tierModels: {}, defaultTier: "1k", supportedSizes: ["auto", "1:1"], referenceLimit: 4 });
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
                                图片按分组配置请求地址、清晰度模型、支持比例和参考图数量；视频/解析/提示词仍按单模型配置。
                            </Typography.Text>
                        </div>
                        <Button type="primary" icon={<PlusOutlined />} onClick={() => openModal(null)}>
                            添加配置
                        </Button>
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
                                render: (value: number | undefined, record) => (record.type === "image" ? `${value || 4} 张` : "-"),
                            },
                            {
                                title: "支持比例",
                                dataIndex: "supportedSizes",
                                width: 180,
                                render: (value: string[] | undefined, record) => (record.type === "image" ? <Typography.Text type="secondary">{(value?.length ? value : ["auto"]).join("、")}</Typography.Text> : "-"),
                            },
                            {
                                title: "状态",
                                dataIndex: "enabled",
                                width: 90,
                                render: (value: boolean) => <Tag color={value ? "success" : "default"}>{value ? "已启用" : "已停用"}</Tag>,
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
                                { label: "提示词模型", value: "prompt" },
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
                            {currentType === "prompt" ? (
                                <Form.Item
                                    name="apiKey"
                                    label="后台专用 API Key"
                                    rules={editingModel?.hasApiKey ? [] : [{ required: true, message: "请输入后台专用 API Key" }]}
                                    extra={editingModel?.hasApiKey ? "已保存密钥；留空表示继续使用原密钥。" : "用户无需填写，提示词工作台会免费使用这个密钥。"}
                                >
                                    <Input.Password placeholder={editingModel?.hasApiKey ? "留空表示不修改" : "sk-..."} />
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
        return { ...values, apiKey: values.type === "prompt" ? String(values.apiKey || "").trim() : "", tierModels: {}, defaultTier: "", supportedSizes: [], referenceLimit: 4 };
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
    };
}

function firstConfiguredTier(tierModels: Record<string, string> | undefined) {
    if (tierModels?.["1k"]) return "1k";
    return IMAGE_MODEL_TIERS.find((tier) => tierModels?.[tier]) || "1k";
}
