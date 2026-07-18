import { GalleryVerticalEnd, Maximize2, MessageSquareText, Search } from "lucide-react";

export const navigationTools = [
    {
        slug: "canvas",
        label: "画布工作台",
        icon: Maximize2,
    },
    {
        slug: "detail",
        label: "详情图工作台",
        icon: GalleryVerticalEnd,
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
