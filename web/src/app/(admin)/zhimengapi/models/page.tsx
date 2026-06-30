"use client";

import { DeleteOutlined, PlusOutlined, SaveOutlined } from "@ant-design/icons";
import { App, Button, Card, Flex, Form, Input, Modal, Select, Space, Table, Tag, Typography } from "antd";
import { useEffect, useState } from "react";

import { useUserStore } from "@/stores/use-user-store";

type ModelType = "image" | "video";

type Model = {
    id: string;
    name: string;
    type: ModelType;
    apiUrl: string;
    enabled: boolean;
    remark: string;
};

const modelTypeLabels: Record<ModelType, string> = {
    image: "图片模型",
    video: "视频模型",
};

export default function ModelsPage() {
    const { message } = App.useApp();
    const token = useUserStore((state) => state.token);
    const [models, setModels] = useState<Model[]>([]);
    const [isLoading, setIsLoading] = useState(false);
    const [editingModel, setEditingModel] = useState<Model | null>(null);
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [form] = Form.useForm<Model>();

    useEffect(() => {
        void loadModels();
    }, []);

    const loadModels = async () => {
        setIsLoading(true);
        try {
            // TODO: 从后端加载模型列表
            // const data = await fetchModels(token);
            // setModels(data);

            // 临时测试数据
            setModels([
                { id: "1", name: "Gemini Pro Vision", type: "image", apiUrl: "https://api.example.com/v1", enabled: true, remark: "Google 图片模型" },
                { id: "2", name: "DALL-E 3", type: "image", apiUrl: "https://api.openai.com/v1", enabled: true, remark: "OpenAI 图片模型" },
                { id: "3", name: "Gemini Video", type: "video", apiUrl: "https://api.example.com/v1", enabled: true, remark: "Google 视频模型" },
            ]);
        } catch (error) {
            message.error(error instanceof Error ? error.message : "加载模型失败");
        } finally {
            setIsLoading(false);
        }
    };

    const openModal = (model: Model | null) => {
        setEditingModel(model);
        setIsModalOpen(true);
        if (model) {
            form.setFieldsValue(model);
        } else {
            form.resetFields();
            form.setFieldsValue({ enabled: true, type: "image" });
        }
    };

    const closeModal = () => {
        setIsModalOpen(false);
        setEditingModel(null);
        form.resetFields();
    };

    const saveModel = async () => {
        try {
            const values = await form.validateFields();

            // TODO: 保存到后端
            // if (editingModel) {
            //     await updateModel(token, editingModel.id, values);
            // } else {
            //     await createModel(token, values);
            // }

            // 临时更新本地
            if (editingModel) {
                setModels((prev) => prev.map((m) => (m.id === editingModel.id ? { ...m, ...values } : m)));
                message.success("模型已更新");
            } else {
                setModels((prev) => [...prev, { ...values, id: Date.now().toString() }]);
                message.success("模型已添加");
            }

            closeModal();
        } catch (error) {
            message.error(error instanceof Error ? error.message : "保存失败");
        }
    };

    const deleteModel = async (id: string) => {
        Modal.confirm({
            title: "确认删除",
            content: "确定要删除这个模型吗?",
            onOk: async () => {
                try {
                    // TODO: 调用后端删除接口
                    // await deleteModelById(token, id);

                    setModels((prev) => prev.filter((m) => m.id !== id));
                    message.success("模型已删除");
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
                                配置图片和视频模型,客户使用时输入对应的 API Key
                            </Typography.Text>
                        </div>
                        <Button type="primary" icon={<PlusOutlined />} onClick={() => openModal(null)}>
                            添加模型
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
                            { title: "模型名称", dataIndex: "name", width: 200, render: (value) => <Typography.Text strong>{value}</Typography.Text> },
                            {
                                title: "类型",
                                dataIndex: "type",
                                width: 120,
                                render: (value: ModelType) => <Tag color={value === "image" ? "blue" : "purple"}>{modelTypeLabels[value]}</Tag>,
                            },
                            { title: "API 地址", dataIndex: "apiUrl", ellipsis: true },
                            {
                                title: "状态",
                                dataIndex: "enabled",
                                width: 100,
                                render: (value: boolean) => <Tag color={value ? "success" : "default"}>{value ? "已启用" : "已停用"}</Tag>,
                            },
                            { title: "备注", dataIndex: "remark", width: 200, ellipsis: true },
                            {
                                title: "操作",
                                key: "actions",
                                width: 160,
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
                title={editingModel ? "编辑模型" : "添加模型"}
                open={isModalOpen}
                width={640}
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
                    <Form.Item name="name" label="模型名称" rules={[{ required: true, message: "请输入模型名称" }]}>
                        <Input placeholder="例如: Gemini Pro Vision" />
                    </Form.Item>
                    <Form.Item name="type" label="模型类型" rules={[{ required: true }]}>
                        <Select
                            options={[
                                { label: "图片模型", value: "image" },
                                { label: "视频模型", value: "video" },
                            ]}
                        />
                    </Form.Item>
                    <Form.Item name="apiUrl" label="API 地址" rules={[{ required: true, message: "请输入 API 地址" }]} extra="OpenAI 兼容格式的接口地址,例如: https://api.example.com/v1">
                        <Input placeholder="https://api.example.com/v1" />
                    </Form.Item>
                    <Form.Item name="enabled" label="是否启用" valuePropName="checked">
                        <Select
                            options={[
                                { label: "启用", value: true },
                                { label: "停用", value: false },
                            ]}
                        />
                    </Form.Item>
                    <Form.Item name="remark" label="备注">
                        <Input.TextArea rows={3} placeholder="选填,用于说明模型用途" />
                    </Form.Item>
                </Form>
            </Modal>
        </main>
    );
}
