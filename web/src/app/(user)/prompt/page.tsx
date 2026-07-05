"use client";

import { CloudUploadOutlined } from "@ant-design/icons";
import { App, Button, Card, Empty, Input, Space, Spin, Typography, Upload } from "antd";
import { Copy, MessageSquareText, WandSparkles } from "lucide-react";
import { useState } from "react";

import { useCopyText } from "@/hooks/use-copy-text";
import { requestPromptExtraction } from "@/services/api/image";
import { uploadReferenceImage } from "@/services/image-bed";
import type { ReferenceImage } from "@/types/image";

export default function PromptPage() {
    const { message } = App.useApp();
    const copyText = useCopyText();
    const [image, setImage] = useState<ReferenceImage | null>(null);
    const [isUploading, setIsUploading] = useState(false);
    const [isExtracting, setIsExtracting] = useState(false);
    const [result, setResult] = useState("");

    const uploadPromptImage = (file: File) => {
        if (!file.type.startsWith("image/")) {
            message.warning("请选择图片文件");
            return false;
        }
        setIsUploading(true);
        setResult("");
        void uploadReferenceImage(file)
            .then((uploaded) => {
                setImage({ id: uploaded.storageKey, name: file.name || "prompt-image.png", type: uploaded.mimeType, dataUrl: uploaded.url, url: uploaded.url, remoteUrl: uploaded.remoteUrl, storageKey: uploaded.storageKey });
            })
            .catch((error) => {
                setImage(null);
                message.error(error instanceof Error ? error.message : "图片上传失败");
            })
            .finally(() => setIsUploading(false));
        return false;
    };

    const handleExtract = async () => {
        if (!image || isUploading) {
            message.warning(isUploading ? "图片仍在上传，请稍后" : "请先上传图片");
            return;
        }
        setIsExtracting(true);
        try {
            const text = await requestPromptExtraction(image);
            setResult(text);
            message.success("提示词已提取");
        } catch (error) {
            message.error(error instanceof Error ? error.message : "提取失败");
        } finally {
            setIsExtracting(false);
        }
    };

    return (
        <main className="h-full overflow-auto bg-background text-stone-950 dark:text-stone-100">
            <div className="mx-auto flex w-full max-w-7xl flex-col gap-6 px-6 py-8">
                <header className="border-b border-stone-200 pb-5 dark:border-stone-800">
                    <p className="text-xs text-stone-500 dark:text-stone-400">图片反推提示词</p>
                    <h1 className="mt-2 text-3xl font-semibold">提示词工作台</h1>
                </header>

                <div className="grid gap-6 lg:grid-cols-[420px_1fr]">
                    <aside>
                        <Card className="border-stone-200 dark:border-stone-800">
                            <Space direction="vertical" size={18} className="w-full">
                                <Upload.Dragger accept="image/*" maxCount={1} showUploadList={false} beforeUpload={uploadPromptImage} className="!p-0">
                                    <div className="flex min-h-56 flex-col items-center justify-center px-5 py-8">
                                        {isUploading ? (
                                            <div className="flex flex-col items-center gap-3">
                                                <Spin />
                                                <Typography.Text type="secondary" className="text-xs">
                                                    正在上传图床
                                                </Typography.Text>
                                            </div>
                                        ) : image?.dataUrl ? (
                                            <img src={image.dataUrl} alt="待提取图片" className="max-h-72 max-w-full rounded-lg object-contain" />
                                        ) : (
                                            <>
                                                <CloudUploadOutlined className="mb-3 text-3xl text-blue-500" />
                                                <Typography.Text className="text-sm font-medium">上传图片</Typography.Text>
                                                <Typography.Text type="secondary" className="mt-1 text-xs">
                                                    支持点击或拖拽上传
                                                </Typography.Text>
                                            </>
                                        )}
                                    </div>
                                </Upload.Dragger>

                                <Button type="primary" size="large" block icon={<WandSparkles className="size-4" />} loading={isUploading || isExtracting} disabled={isUploading || !image} onClick={handleExtract} className="h-12 text-base font-medium">
                                    提取提示词
                                </Button>
                            </Space>
                        </Card>
                    </aside>

                    <section className="min-h-[620px] rounded-lg border border-stone-200 bg-stone-50 p-4 dark:border-stone-800 dark:bg-stone-900">
                        {isExtracting ? (
                            <div className="flex min-h-[560px] items-center justify-center">
                                <Spin tip="正在提取提示词" />
                            </div>
                        ) : result ? (
                            <Card className="border-stone-200 dark:border-stone-800">
                                <div className="mb-3 flex items-center justify-between gap-3">
                                    <div className="flex items-center gap-2">
                                        <MessageSquareText className="size-4 text-stone-500" />
                                        <Typography.Text className="font-medium">提取结果</Typography.Text>
                                    </div>
                                    <Button icon={<Copy className="size-4" />} onClick={() => copyText(result, "提示词已复制")}>
                                        复制提示词
                                    </Button>
                                </div>
                                <Input.TextArea value={result} onChange={(event) => setResult(event.target.value)} rows={18} className="resize-none !text-sm !leading-7" />
                            </Card>
                        ) : (
                            <div className="flex min-h-[560px] items-center justify-center">
                                <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="上传图片后，提取出的生图提示词会显示在这里" />
                            </div>
                        )}
                    </section>
                </div>
            </div>
        </main>
    );
}
