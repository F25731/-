"use client";

import { CloudUploadOutlined, PlayCircleOutlined } from "@ant-design/icons";
import { App, Button, Card, Input, Radio, Select, Space, Typography, Upload } from "antd";
import { useState } from "react";
import { Video } from "lucide-react";

import { useEffectiveConfig } from "@/stores/use-config-store";

type AspectRatio = "16:9" | "9:16" | "1:1";
type Duration = 4 | 6 | 8 | 10 | 12 | 15;

export default function VideoPage() {
    const { message } = App.useApp();
    const config = useEffectiveConfig();
    const [selectedModel, setSelectedModel] = useState<string>("");
    const [aspectRatio, setAspectRatio] = useState<AspectRatio>("16:9");
    const [duration, setDuration] = useState<Duration>(4);
    const [prompt, setPrompt] = useState("");
    const [isGenerating, setIsGenerating] = useState(false);
    const [videoUrl, setVideoUrl] = useState("");

    const videoModels = config.models.filter((m) => m.includes("video") || m.includes("Video")); // TODO: 从后台配置的type过滤

    const handleGenerate = async () => {
        if (!selectedModel) {
            message.warning("请选择视频模型");
            return;
        }
        if (!prompt.trim()) {
            message.warning("请输入视频描述");
            return;
        }

        setIsGenerating(true);
        try {
            // TODO: 调用视频生成 API
            message.success("视频生成任务已提交");
        } catch (error) {
            message.error(error instanceof Error ? error.message : "生成失败");
        } finally {
            setIsGenerating(false);
        }
    };

    return (
        <main className="h-full overflow-auto bg-background text-stone-950 dark:text-stone-100">
            <div className="mx-auto flex w-full max-w-7xl flex-col gap-8 px-6 py-10">
                {/* 页面标题 */}
                <header className="border-b border-stone-200 pb-6 dark:border-stone-800">
                    <p className="text-xs text-stone-500 dark:text-stone-400">视频生成</p>
                    <h1 className="mt-3 text-3xl font-semibold">视频工作台</h1>
                </header>

                {/* 主体内容 */}
                <div className="grid gap-6 lg:grid-cols-[480px_1fr]">
                    {/* 左侧配置面板 */}
                    <aside className="space-y-6">
                        <Card className="border-stone-200 dark:border-stone-800">
                            <Space direction="vertical" size={20} style={{ width: "100%" }}>
                                {/* 视频模型 */}
                                <div>
                                    <div className="mb-2 flex items-center justify-between">
                                        <Typography.Text className="text-sm font-medium">视频模型</Typography.Text>
                                        <Typography.Text type="secondary" className="text-xs">
                                            1000 积分/次
                                        </Typography.Text>
                                    </div>
                                    <Select
                                        size="large"
                                        value={selectedModel}
                                        onChange={setSelectedModel}
                                        placeholder="选择模型"
                                        className="w-full"
                                        options={videoModels.map((m) => ({ label: m, value: m }))}
                                    />
                                    {selectedModel && (
                                        <Typography.Text type="secondary" className="mt-2 block text-xs">
                                            {selectedModel} - 支持文生视频和图生视频
                                        </Typography.Text>
                                    )}
                                </div>

                                {/* 画面比例 */}
                                <div>
                                    <Typography.Text className="mb-2 block text-sm font-medium">画面比例</Typography.Text>
                                    <Radio.Group value={aspectRatio} onChange={(e) => setAspectRatio(e.target.value)} className="w-full" size="large">
                                        <Radio.Button value="16:9" className="w-1/3 text-center">
                                            横版
                                        </Radio.Button>
                                        <Radio.Button value="9:16" className="w-1/3 text-center">
                                            竖屏
                                        </Radio.Button>
                                        <Radio.Button value="1:1" className="w-1/3 text-center">
                                            方形
                                        </Radio.Button>
                                    </Radio.Group>
                                    <Typography.Text type="secondary" className="mt-2 block text-xs">
                                        {aspectRatio}
                                    </Typography.Text>
                                </div>

                                {/* 时长 */}
                                <div>
                                    <Typography.Text className="mb-2 block text-sm font-medium">时长</Typography.Text>
                                    <div className="grid grid-cols-3 gap-2">
                                        {[4, 6, 8, 10, 12, 15].map((d) => (
                                            <Button key={d} size="large" type={duration === d ? "primary" : "default"} onClick={() => setDuration(d as Duration)} className="w-full">
                                                {d}s
                                            </Button>
                                        ))}
                                    </div>
                                    <Typography.Text type="secondary" className="mt-2 block text-xs">
                                        当前: {duration}s
                                    </Typography.Text>
                                </div>

                                {/* 参考素材 */}
                                <div>
                                    <Typography.Text className="mb-2 block text-sm font-medium">
                                        参考素材 <Typography.Text type="secondary">(可选)</Typography.Text>
                                    </Typography.Text>

                                    {/* 上传参考图 */}
                                    <Upload.Dragger className="mb-2" style={{ padding: "16px" }}>
                                        <div className="flex flex-col items-center">
                                            <CloudUploadOutlined className="mb-2 text-2xl text-blue-500" />
                                            <Typography.Text className="text-xs">上传参考图</Typography.Text>
                                            <Typography.Text type="secondary" className="text-xs">
                                                最多 4 张,每张 ≤ 20MB
                                            </Typography.Text>
                                        </div>
                                    </Upload.Dragger>

                                    {/* 参考图 URL */}
                                    <div className="mb-3 flex gap-2">
                                        <Input placeholder="或输入图片 URL" size="large" />
                                        <Button size="large">添加</Button>
                                    </div>

                                    {/* 上传参考视频 */}
                                    <Upload.Dragger className="mb-2" style={{ padding: "16px" }}>
                                        <div className="flex flex-col items-center">
                                            <CloudUploadOutlined className="mb-2 text-2xl text-blue-500" />
                                            <Typography.Text className="text-xs">上传参考视频</Typography.Text>
                                            <Typography.Text type="secondary" className="text-xs">
                                                最多 1 个,≤ 50MB
                                            </Typography.Text>
                                        </div>
                                    </Upload.Dragger>

                                    {/* 参考视频 URL */}
                                    <div className="flex gap-2">
                                        <Input placeholder="或输入视频 URL" size="large" />
                                        <Button size="large">添加</Button>
                                    </div>
                                </div>

                                {/* Prompt */}
                                <div>
                                    <Typography.Text className="mb-2 block text-sm font-medium">视频描述</Typography.Text>
                                    <Input.TextArea
                                        value={prompt}
                                        onChange={(e) => setPrompt(e.target.value)}
                                        placeholder="描述镜头、主体、动作和画面风格&#10;例如: 一只橘猫在阳光下慵懒地打哈欠，镜头缓慢推进，4K 高清画质"
                                        rows={6}
                                        size="large"
                                        className="resize-none"
                                    />
                                </div>

                                {/* 生成按钮 */}
                                <Button type="primary" size="large" block icon={<PlayCircleOutlined />} loading={isGenerating} onClick={handleGenerate} className="h-12 text-base font-medium">
                                    生成视频
                                </Button>
                            </Space>
                        </Card>
                    </aside>

                    {/* 右侧预览区 */}
                    <section className="flex min-h-[500px] items-center justify-center rounded-lg border border-stone-200 bg-stone-50 dark:border-stone-800 dark:bg-stone-900">
                        {videoUrl ? (
                            <video src={videoUrl} controls className="max-h-[600px] max-w-full rounded-lg shadow-lg" />
                        ) : (
                            <div className="flex flex-col items-center gap-4 text-center">
                                <Video className="size-16 text-stone-300 dark:text-stone-700" />
                                <div>
                                    <Typography.Text className="block text-base font-medium">还没有视频</Typography.Text>
                                    <Typography.Text type="secondary" className="mt-1 block text-sm">
                                        选择模型并填写描述后开始生成
                                    </Typography.Text>
                                </div>
                            </div>
                        )}
                    </section>
                </div>
            </div>
        </main>
    );
}
