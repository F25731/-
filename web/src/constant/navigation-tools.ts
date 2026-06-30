import { FileSearch, FileText, Images, Maximize2 } from "lucide-react";

export const navigationTools = [
    {
        slug: "canvas",
        label: "画布工作台",
        icon: Maximize2,
    },
    {
        slug: "prompts",
        label: "提示词库",
        icon: FileText,
    },
    {
        slug: "extract",
        label: "提取提示词",
        icon: FileSearch,
    },
    {
        slug: "assets",
        label: "我的素材",
        icon: Images,
    },
] as const;

export type NavigationToolSlug = (typeof navigationTools)[number]["slug"];
