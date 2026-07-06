export type VideoModelCapabilities = {
    market?: string;
    ratios?: string[];
    qualities?: string[];
    durations?: number[];
    defaultRatio?: string;
    defaultQuality?: string;
    defaultDuration?: number;
    referenceImageLimit?: number;
    referenceVideoLimit?: number;
    referenceVideoMaxSeconds?: number;
    referenceAudioLimit?: number;
    supportsImageReferences?: boolean;
    supportsVideoReferences?: boolean;
    supportsAudioReferences?: boolean;
};

export const VIDEO_RATIO_OPTIONS = [
    { label: "16:9", value: "16:9" },
    { label: "9:16", value: "9:16" },
    { label: "1:1", value: "1:1" },
    { label: "21:9", value: "21:9" },
    { label: "3:4", value: "3:4" },
    { label: "4:3", value: "4:3" },
];

export const VIDEO_QUALITY_OPTIONS = [
    { label: "480p", value: "480p" },
    { label: "720p", value: "720p" },
    { label: "1080p", value: "1080p" },
    { label: "4K", value: "4k" },
];

export const VIDEO_DURATION_OPTIONS = [4, 5, 6, 8, 10, 12, 15];

export const DEFAULT_VIDEO_CAPABILITIES: Required<VideoModelCapabilities> = {
    market: "通用",
    ratios: ["16:9", "9:16", "1:1"],
    qualities: ["720p"],
    durations: [5],
    defaultRatio: "16:9",
    defaultQuality: "720p",
    defaultDuration: 5,
    referenceImageLimit: 4,
    referenceVideoLimit: 0,
    referenceVideoMaxSeconds: 15,
    referenceAudioLimit: 0,
    supportsImageReferences: true,
    supportsVideoReferences: false,
    supportsAudioReferences: false,
};

export function normalizeVideoCapabilities(input?: VideoModelCapabilities | null): Required<VideoModelCapabilities> {
    const ratios = uniqueAllowed(input?.ratios, VIDEO_RATIO_OPTIONS.map((item) => item.value), DEFAULT_VIDEO_CAPABILITIES.ratios);
    const qualities = uniqueAllowed(input?.qualities, VIDEO_QUALITY_OPTIONS.map((item) => item.value), DEFAULT_VIDEO_CAPABILITIES.qualities);
    const durations = uniqueDurations(input?.durations);
    return {
        market: String(input?.market || DEFAULT_VIDEO_CAPABILITIES.market).trim() || DEFAULT_VIDEO_CAPABILITIES.market,
        ratios,
        qualities,
        durations,
        defaultRatio: ratios.includes(String(input?.defaultRatio || "")) ? String(input?.defaultRatio) : ratios[0],
        defaultQuality: qualities.includes(String(input?.defaultQuality || "")) ? String(input?.defaultQuality) : qualities[0],
        defaultDuration: durations.includes(Number(input?.defaultDuration)) ? Number(input?.defaultDuration) : durations[0],
        referenceImageLimit: clampInt(input?.referenceImageLimit, 0, 20, DEFAULT_VIDEO_CAPABILITIES.referenceImageLimit),
        referenceVideoLimit: clampInt(input?.referenceVideoLimit, 0, 20, DEFAULT_VIDEO_CAPABILITIES.referenceVideoLimit),
        referenceVideoMaxSeconds: clampInt(input?.referenceVideoMaxSeconds, 1, 300, DEFAULT_VIDEO_CAPABILITIES.referenceVideoMaxSeconds),
        referenceAudioLimit: clampInt(input?.referenceAudioLimit, 0, 5, DEFAULT_VIDEO_CAPABILITIES.referenceAudioLimit),
        supportsImageReferences: input?.supportsImageReferences ?? true,
        supportsVideoReferences: input?.supportsVideoReferences ?? false,
        supportsAudioReferences: input?.supportsAudioReferences ?? false,
    };
}

function uniqueAllowed(values: string[] | undefined, allowed: string[], fallback: string[]) {
    const seen = new Set<string>();
    const next = (values || []).map((value) => String(value || "").trim()).filter((value) => allowed.includes(value) && !seen.has(value) && seen.add(value));
    return next.length ? next : [...fallback];
}

function uniqueDurations(values: number[] | undefined) {
    const seen = new Set<number>();
    const next = (values || [])
        .map((value) => clampInt(value, 1, 300, 0))
        .filter((value) => value > 0 && !seen.has(value) && seen.add(value))
        .sort((a, b) => a - b);
    return next.length ? next : [...DEFAULT_VIDEO_CAPABILITIES.durations];
}

function clampInt(value: unknown, min: number, max: number, fallback: number) {
    const next = Math.floor(Math.abs(Number(value)) || fallback);
    return Math.max(min, Math.min(max, next));
}
