export const IMAGE_MODEL_TIERS = ["512", "1k", "2k", "4k"] as const;
export type ImageModelTier = (typeof IMAGE_MODEL_TIERS)[number];

export const IMAGE_MODEL_TIER_LABELS: Record<ImageModelTier, string> = {
    "512": "512",
    "1k": "1k",
    "2k": "2k",
    "4k": "4k",
};

export const IMAGE_ASPECT_OPTIONS = [
    { value: "auto", label: "未指定", description: "模型自动决定", width: 0, height: 0, icon: "auto" },
    { value: "1:1", label: "1:1", description: "正方形", width: 1024, height: 1024, icon: "square" },
    { value: "16:9", label: "16:9", description: "横版", width: 1792, height: 1024, icon: "landscape" },
    { value: "9:16", label: "9:16", description: "竖版", width: 1024, height: 1792, icon: "portrait" },
    { value: "4:3", label: "4:3", description: "横版", width: 1344, height: 1024, icon: "landscape" },
    { value: "3:4", label: "3:4", description: "竖版", width: 1024, height: 1344, icon: "portrait" },
    { value: "3:2", label: "3:2", description: "横版", width: 1536, height: 1024, icon: "landscape" },
    { value: "2:3", label: "2:3", description: "竖版", width: 1024, height: 1536, icon: "portrait" },
    { value: "5:4", label: "5:4", description: "横版", width: 1280, height: 1024, icon: "landscape" },
    { value: "4:5", label: "4:5", description: "竖版", width: 1024, height: 1280, icon: "portrait" },
    { value: "21:9", label: "21:9", description: "超宽屏", width: 2048, height: 878, icon: "landscape" },
] as const;

export const DEFAULT_IMAGE_ASPECT_VALUES = IMAGE_ASPECT_OPTIONS.map((item) => item.value);

export type ImageAspectValue = (typeof IMAGE_ASPECT_OPTIONS)[number]["value"];

