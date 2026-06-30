"use client";

import { useEffect, useState } from "react";
import { App, Button, Form, Input, Modal, Typography } from "antd";
import Link from "next/link";

import { useConfigStore } from "@/stores/use-config-store";
import { useUserStore } from "@/stores/use-user-store";
import { fetchPublicModels, type AdminModel } from "@/services/api/admin";

export function AppConfigModal() {
    const { message } = App.useApp();
    const isConfigOpen = useConfigStore((state) => state.isConfigOpen);
    const shouldPromptContinue = useConfigStore((state) => state.shouldPromptContinue);
    const setConfigDialogOpen = useConfigStore((state) => state.setConfigDialogOpen);
    const clearPromptContinue = useConfigStore((state) => state.clearPromptContinue);
    const user = useUserStore((state) => state.user);
    const [models, setModels] = useState<AdminModel[]>([]);
    const [modelKeys, setModelKeys] = useState<Record<string, string>>({});

    useEffect(() => {
        if (!isConfigOpen) return;
        loadModels();
        loadModelKeys();
    }, [isConfigOpen]);

    const loadModels = async () => {
        try {
            const data = await fetchPublicModels();
            setModels(data.filter((m) => m.enabled));
        } catch (error) {
            message.error("加载模型列表失败");
        }
    };

    const loadModelKeys = () => {
        try {
            const config = JSON.parse(localStorage.getItem("user-model-config") || "{}");
            setModelKeys(config.apiKeys || {});
        } catch {
            setModelKeys({});
        }
    };

    const updateModelKey = (modelId: string, key: string) => {
        setModelKeys((prev) => ({ ...prev, [modelId]: key.trim() }));
    };

    const saveModelKeys = () => {
        try {
            const config = JSON.parse(localStorage.getItem("user-model-config") || "{}");
            config.apiKeys = modelKeys;
            localStorage.setItem("user-model-config", JSON.stringify(config));
            message.success("模型密钥已保存");
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
                    <div className="mt-1 text-xs font-normal text-stone-500">管理模型密钥</div>
                </div>
            }
            open={isConfigOpen}
            width={640}
            centered
            onCancel={() => setConfigDialogOpen(false)}
            footer={
                <Button type="primary" onClick={finishConfig}>
                    完成
                </Button>
            }
        >
            <div className="pt-1">
                <Form layout="vertical" requiredMark={false}>
                    {/* 当前账号 */}
                    <div className="mb-4 rounded-lg border border-stone-200 px-3 py-2 text-sm dark:border-stone-800">
                        <div className="font-medium">当前账号</div>
                        <div className="mt-1 text-xs text-stone-500">{user ? `${user.displayName || user.username}` : "未登录"}</div>
                        {!user ? (
                            <Link href="/login" className="mt-2 inline-flex text-xs font-medium text-stone-950 underline-offset-4 hover:underline dark:text-stone-100" onClick={() => setConfigDialogOpen(false)}>
                                去登录
                            </Link>
                        ) : null}
                    </div>

                    {/* 模型密钥配置 */}
                    <div className="mb-4 rounded-lg border border-stone-200 px-3 py-3 dark:border-stone-800">
                        <div className="mb-3 text-sm font-medium">模型密钥配置</div>
                        {models.length === 0 ? (
                            <div className="py-4 text-center text-sm text-stone-500">暂无可用模型</div>
                        ) : (
                            <div className="space-y-4">
                                <div className="text-xs text-stone-500">为每个模型配置 API Key。登录后选择的模型会显示在这里。</div>
                                {models.map((model) => (
                                    <div key={model.id}>
                                        <Form.Item
                                            label={
                                                <span className="text-xs">
                                                    {model.name} <span className="text-stone-400">({model.type === "image" ? "图片" : "视频"})</span>
                                                </span>
                                            }
                                            className="mb-0"
                                        >
                                            <Input.Password autoComplete="off" value={modelKeys[model.id] || ""} onChange={(e) => updateModelKey(model.id, e.target.value)} placeholder="sk-..." />
                                        </Form.Item>
                                    </div>
                                ))}
                                <Button type="primary" onClick={saveModelKeys}>
                                    保存密钥
                                </Button>
                            </div>
                        )}
                    </div>

                    {/* 提示信息 */}
                    <div className="rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-xs dark:border-blue-900 dark:bg-blue-950">
                        <Typography.Text className="text-xs text-blue-700 dark:text-blue-300">💡 提示: 如需添加或切换模型，请前往登录页面重新配置</Typography.Text>
                    </div>
                </Form>
            </div>
        </Modal>
    );
}
