export const APP_VERSION = process.env.NEXT_PUBLIC_APP_VERSION || "dev";

function readNumberEnv(value: string | undefined, fallback: number, min = 1) {
    if (!value?.trim()) return fallback;
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed >= min ? parsed : fallback;
}

export const TOKEN_USAGE_AUTO_REFRESH_INTERVAL_MS = readNumberEnv(process.env.NEXT_PUBLIC_TOKEN_USAGE_AUTO_REFRESH_INTERVAL_MS, 10 * 60 * 1000, 0);
export const TOKEN_USAGE_REQUEST_DELAY_MS = readNumberEnv(process.env.NEXT_PUBLIC_TOKEN_USAGE_REQUEST_DELAY_MS, 3000, 0);
