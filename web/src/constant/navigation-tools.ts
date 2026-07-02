import { Maximize2, MessageSquareText, Search, Video } from "lucide-react";

export const navigationTools = [
    {
        slug: "canvas",
        label: "画布工作台",
        icon: Maximize2,
    },
    {
        slug: "video",
        label: "视频工作台",
        icon: Video,
    },
    {
        slug: "parse",
        label: "解析工作台",
        icon: Search,
    },
    {
        slug: "prompt",
        label: "提示词工作台",
        icon: MessageSquareText,
    },
] as const;

export type NavigationToolSlug = (typeof navigationTools)[number]["slug"];
