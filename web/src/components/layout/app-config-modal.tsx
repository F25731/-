"use client";

import { useEffect, useState } from "react";
import { App, Button, Checkbox, Form, Input, Modal, Select, Space, Typography } from "antd";

import { USER_MODEL_CONFIG_KEY, useConfigStore } from "@/stores/use-config-store";
import { useUserStore } from "@/stores/use-user-store";
import { fetchPublicModels, type AdminModel } from "@/services/api/admin";
import { KeyRound } from "lucide-react";

export function AppConfigModal() {
    const { message } = App.useApp();
    const [form] = Form.useForm();
    const isConfigOpen = useConfigStore((state) => state.isConfigOpen);
    const shouldPromptContinue = useConfigStore((state) => state.shouldPromptContinue);
    const updateConfig = useConfigStore((state) => state.updateConfig);
    const setConfigDialogOpen = useConfigStore((state) => state.setConfigDialogOpen);
    const clearPromptContinue = useConfigStore((state) => state.clearPromptContinue);
    const user = useUserStore((state) => state.user);
    const [models, setModels] = useState<AdminModel[]>([]);
    const [selectedModelIds, setSelectedModelIds] = useState<string[]>([]);
    const [apiKeys, setApiKeys] = useState<Record<string, string>>({});
    const [configureAll, setConfigureAll] = useState(false);

    useEffect(() => {
        if (!isConfigOpen) return;
        loadModels();
        loadCurrentConfig();
    }, [isConfigOpen]);

    const loadModels = async () => {
        try {
            const data = await fetchPublicModels();
            setModels(data.filter((m) => m.enabled));
        } catch (error) {
            message.error("加载模型列表失败");
        }
    };

    const loadCurrentConfig = () => {
        try {
            const config = JSON.parse(localStorage.getItem(USER_MODEL_CONFIG_KEY) || "{}");
            const currentModelIds = config.modelIds || [];
            const currentApiKeys = config.apiKeys || {};

            setSelectedModelIds(currentModelIds);
            setApiKeys(currentApiKeys);
            form.setFieldValue("modelIds", currentModelIds);
            setConfigureAll(false);
        } catch {
            setSelectedModelIds([]);
            setApiKeys({});
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

    const saveConfig = () => {
        if (selectedModelIds.length === 0) {
            message.warning("请至少选择一个模型");
            return;
        }

        // 检查每个选中的模型是否都输入了 API Key
        const missingKeys = selectedModelIds.filter((id) => !apiKeys[id]?.trim());
        if (missingKeys.length > 0) {
            message.warning("请为所有选中的模型输入 API Key");
            return;
        }

        try {
            localStorage.setItem(
                USER_MODEL_CONFIG_KEY,
                JSON.stringify({
                    modelIds: selectedModelIds,
                    apiKeys: apiKeys,
                    models: models.filter((m) => selectedModelIds.includes(m.id)),
                }),
            );
            const selectedModels = models.filter((m) => selectedModelIds.includes(m.id));
            const imageModel = selectedModels.find((m) => m.type === "image");
            const videoModel = selectedModels.find((m) => m.type === "video");
            if (imageModel) {
                updateConfig("model", imageModel.name);
                updateConfig("imageModel", imageModel.name);
                updateConfig("baseUrl", imageModel.apiUrl);
                updateConfig("apiKey", apiKeys[imageModel.id] || "");
            }
            if (videoModel) updateConfig("videoModel", videoModel.name);

            message.success("配置已保存");
            finishConfig();
        } catch (error) {
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
                    <div className="text-lg font-semibold">配置</div>
                    <div className="mt-1 text-xs font-normal text-stone-500">管理模型和密钥</div>
                </div>
            }
            open={isConfigOpen}
            width={640}
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
                    {/* 当前账号 */}
                    <div className="mb-4 rounded-lg border border-stone-200 px-3 py-2 text-sm dark:border-stone-800">
                        <div className="font-medium">当前账号</div>
                        <div className="mt-1 text-xs text-stone-500">{user ? `${user.displayName || user.username}` : "未登录"}</div>
                    </div>

                    {/* 选择模型 */}
                    <Form.Item label={<span className="font-medium text-stone-800 dark:text-stone-200">选择模型</span>}>
                        <Space direction="vertical" className="w-full" size={12}>
                            <Checkbox checked={configureAll} onChange={(e) => handleConfigureAllChange(e.target.checked)}>
                                <span className="font-medium">配置所有模型</span>
                            </Checkbox>

                            <Form.Item name="modelIds" noStyle>
                                <Select
                                    mode="multiple"
                                    placeholder="请选择要使用的模型"
                                    value={selectedModelIds}
                                    onChange={handleModelChange}
                                    options={models.map((m) => ({
                                        label: `${m.name} (${m.type === "image" ? "图片" : "视频"})`,
                                        value: m.id,
                                    }))}
                                />
                            </Form.Item>
                        </Space>
                    </Form.Item>

                    {/* 配置密钥 */}
                    {selectedModelIds.length > 0 && (
                        <div className="mb-4 space-y-4 rounded-lg border border-stone-200 bg-stone-50 p-4 dark:border-stone-800 dark:bg-stone-900">
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

                    {/* 提示信息 */}
                    <div className="rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-xs dark:border-blue-900 dark:bg-blue-950">
                        <Typography.Text className="text-xs text-blue-700 dark:text-blue-300">
                            💡 提示: 可以添加新模型或修改现有模型的密钥。配置会立即生效。
                        </Typography.Text>
                    </div>
                </Form>
            </div>
        </Modal>
    );
}
