import { Maximize2, Video } from "lucide-react";

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
] as const;

export type NavigationToolSlug = (typeof navigationTools)[number]["slug"];
