"use client";

import { CloudUploadOutlined, PlayCircleOutlined } from "@ant-design/icons";
import { Button, Card, Flex, Input, Radio, Select, Space, Typography, Upload, message } from "antd";
import { useState } from "react";

import { useEffectiveConfig } from "@/stores/use-config-store";

type AspectRatio = "16:9" | "9:16" | "1:1";
type Duration = 4 | 6 | 8 | 10 | 12 | 15;

export default function VideoPage() {
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
        <div style={{ display: "flex", height: "calc(100vh - 64px)", background: "#0a0a0a" }}>
            {/* 左侧配置面板 */}
            <div style={{ width: 320, background: "#141414", borderRight: "1px solid #303030", padding: "24px 16px", overflowY: "auto" }}>
                <Flex vertical gap={24}>
                    {/* 视频模型选择 */}
                    <div>
                        <Flex justify="space-between" align="center" style={{ marginBottom: 8 }}>
                            <Typography.Text style={{ color: "#fff", fontSize: 14 }}>视频模型</Typography.Text>
                            <Typography.Text style={{ color: "#1890ff", fontSize: 13 }}>1000.00 积分/次</Typography.Text>
                        </Flex>
                        <Select
                            value={selectedModel}
                            onChange={setSelectedModel}
                            placeholder="选择模型"
                            style={{ width: "100%" }}
                            options={videoModels.map((m) => ({ label: m, value: m }))}
                        />
                        {selectedModel && (
                            <Typography.Text type="secondary" style={{ fontSize: 12, display: "block", marginTop: 8 }}>
                                {selectedModel} - 支持文生视频和图生视频
                            </Typography.Text>
                        )}
                    </div>

                    {/* 画面比例 */}
                    <div>
                        <Typography.Text style={{ color: "#fff", fontSize: 14, display: "block", marginBottom: 8 }}>画面比例</Typography.Text>
                        <Radio.Group value={aspectRatio} onChange={(e) => setAspectRatio(e.target.value)} style={{ width: "100%" }}>
                            <Radio.Button value="16:9" style={{ width: "33.33%", textAlign: "center" }}>
                                横版
                            </Radio.Button>
                            <Radio.Button value="9:16" style={{ width: "33.33%", textAlign: "center" }}>
                                竖屏
                            </Radio.Button>
                            <Radio.Button value="1:1" style={{ width: "33.33%", textAlign: "center" }}>
                                方形
                            </Radio.Button>
                        </Radio.Group>
                        <Typography.Text type="secondary" style={{ fontSize: 12, display: "block", marginTop: 8, color: "#8c8c8c" }}>
                            {aspectRatio}
                        </Typography.Text>
                    </div>

                    {/* 时长 */}
                    <div>
                        <Typography.Text style={{ color: "#fff", fontSize: 14, display: "block", marginBottom: 8 }}>时长</Typography.Text>
                        <Flex gap={8} wrap="wrap">
                            {[4, 6, 8, 10, 12, 15].map((d) => (
                                <Button
                                    key={d}
                                    type={duration === d ? "primary" : "default"}
                                    onClick={() => setDuration(d as Duration)}
                                    style={{
                                        width: "calc(33.33% - 6px)",
                                        background: duration === d ? "#1890ff" : "#262626",
                                        borderColor: duration === d ? "#1890ff" : "#434343",
                                        color: duration === d ? "#fff" : "#d9d9d9",
                                    }}
                                >
                                    {d}s
                                </Button>
                            ))}
                        </Flex>
                        <Typography.Text type="secondary" style={{ fontSize: 12, display: "block", marginTop: 8, color: "#8c8c8c" }}>
                            {duration}s
                        </Typography.Text>
                    </div>

                    {/* 参考素材 */}
                    <div>
                        <Typography.Text style={{ color: "#fff", fontSize: 14, display: "block", marginBottom: 8 }}>参考素材</Typography.Text>
                        <Typography.Link style={{ fontSize: 13, marginBottom: 12, display: "block" }}>可选</Typography.Link>

                        {/* 上传参考图 */}
                        <Upload.Dragger height={100} style={{ marginBottom: 12, background: "#1f1f1f", borderColor: "#434343" }}>
                            <Flex vertical align="center" justify="center" style={{ padding: "12px 0" }}>
                                <CloudUploadOutlined style={{ fontSize: 24, color: "#1890ff", marginBottom: 8 }} />
                                <Typography.Text style={{ fontSize: 12, color: "#d9d9d9" }}>上传参考图</Typography.Text>
                                <Typography.Text type="secondary" style={{ fontSize: 11 }}>
                                    0/4 · 最多 ≤ 20MB
                                </Typography.Text>
                            </Flex>
                        </Upload.Dragger>

                        {/* 添加 URL */}
                        <Input placeholder="输入 URL" style={{ marginBottom: 12, background: "#1f1f1f", borderColor: "#434343", color: "#d9d9d9" }} suffix={<Button size="small">添加</Button>} />

                        {/* 上传参考视频 */}
                        <Upload.Dragger height={100} style={{ marginBottom: 12, background: "#1f1f1f", borderColor: "#434343" }}>
                            <Flex vertical align="center" justify="center" style={{ padding: "12px 0" }}>
                                <CloudUploadOutlined style={{ fontSize: 24, color: "#1890ff", marginBottom: 8 }} />
                                <Typography.Text style={{ fontSize: 12, color: "#d9d9d9" }}>上传参考视频</Typography.Text>
                                <Typography.Text type="secondary" style={{ fontSize: 11 }}>
                                    0/1 · 最多 ≤ 50MB
                                </Typography.Text>
                            </Flex>
                        </Upload.Dragger>

                        {/* 添加视频 URL */}
                        <Flex gap={8}>
                            <Input placeholder="视频 URL,最多 1 个" style={{ flex: 1, background: "#1f1f1f", borderColor: "#434343", color: "#d9d9d9" }} />
                            <Button>添加</Button>
                            <Button>清空</Button>
                        </Flex>

                        <Typography.Text type="secondary" style={{ fontSize: 11, display: "block", marginTop: 8, color: "#8c8c8c" }}>
                            单次最多参考 4 张图、3 个视频、1 个音频
                        </Typography.Text>
                    </div>

                    {/* PROMPT */}
                    <div>
                        <Typography.Text style={{ color: "#fff", fontSize: 14, display: "block", marginBottom: 8 }}>PROMPT</Typography.Text>
                        <Input.TextArea
                            value={prompt}
                            onChange={(e) => setPrompt(e.target.value)}
                            placeholder="描述镜头、主体、动作和画面风格"
                            rows={6}
                            style={{ background: "#1f1f1f", borderColor: "#434343", color: "#d9d9d9", resize: "none" }}
                        />
                    </div>

                    {/* 生成按钮 */}
                    <Button type="primary" size="large" block icon={<PlayCircleOutlined />} loading={isGenerating} onClick={handleGenerate} style={{ height: 48, fontSize: 16 }}>
                        生成视频
                    </Button>
                </Flex>
            </div>

            {/* 右侧预览区 */}
            <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", background: "#0a0a0a" }}>
                {videoUrl ? (
                    <video src={videoUrl} controls style={{ maxWidth: "90%", maxHeight: "90%", borderRadius: 8 }} />
                ) : (
                    <Flex vertical align="center" gap={16}>
                        <PlayCircleOutlined style={{ fontSize: 80, color: "#434343" }} />
                        <Typography.Text style={{ color: "#8c8c8c", fontSize: 16 }}>还没有视频</Typography.Text>
                        <Typography.Text type="secondary" style={{ fontSize: 14 }}>
                            选择模型或填写 prompt 后开始生成
                        </Typography.Text>
                    </Flex>
                )}
            </div>
        </div>
    );
}
