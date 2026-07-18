import { createClient } from "redis";

import type { AgentToolResult } from "./types";

type PendingTool = {
    resolve: (result: AgentToolResult) => void;
    reject: (error: Error) => void;
    timer: ReturnType<typeof setTimeout>;
};

type RegistryState = {
    client?: ReturnType<typeof createClient>;
    subscriber?: ReturnType<typeof createClient>;
    connecting?: Promise<void>;
    pending: Map<string, PendingTool>;
};

const registryKey = Symbol.for("infinite-canvas.agent-run-registry.redis");
const globalRegistry = globalThis as typeof globalThis & { [registryKey]?: RegistryState };
const state: RegistryState = globalRegistry[registryKey] || { pending: new Map<string, PendingTool>() };
globalRegistry[registryKey] = state;
const RUN_TTL_SECONDS = 15 * 60;
const TOOL_RESULT_TIMEOUT_MS = 12 * 60 * 1000;
const RESULT_CHANNEL_PATTERN = "canvas-agent:tool-result:*";

export async function createAgentRun(runId: string) {
    const client = await redisClient();
    await client.set(runKey(runId), "running", { EX: RUN_TTL_SECONDS });
}

export async function waitForToolResult(runId: string, toolCallId: string, signal: AbortSignal) {
    const client = await redisClient();
    const key = resultKey(runId, toolCallId);
    const existing = await client.get(key);
    if (existing) return parseResult(existing);
    if (!(await client.exists(runKey(runId)))) throw new Error("Agent run is not active");

    return new Promise<AgentToolResult>((resolve, reject) => {
        const abort = () => {
            clearPending(key);
            reject(new DOMException("Agent run stopped", "AbortError"));
        };
        const timer = setTimeout(() => {
            clearPending(key);
            reject(new Error("Canvas tool execution timed out"));
        }, TOOL_RESULT_TIMEOUT_MS);
        state.pending.set(key, {
            timer,
            resolve: (result) => {
                signal.removeEventListener("abort", abort);
                resolve(result);
            },
            reject: (error) => {
                signal.removeEventListener("abort", abort);
                reject(error);
            },
        });
        signal.addEventListener("abort", abort, { once: true });
        void client.get(key).then(
            (payload) => {
                const pending = state.pending.get(key);
                if (!payload || !pending) return;
                clearPending(key);
                pending.resolve(parseResult(payload));
            },
            (error) => {
                clearPending(key);
                reject(error instanceof Error ? error : new Error("Redis tool result lookup failed"));
            },
        );
    });
}

export async function submitToolResult(runId: string, toolCallId: string, result: AgentToolResult) {
    const client = await redisClient();
    if (!(await client.exists(runKey(runId)))) return false;
    const key = resultKey(runId, toolCallId);
    const payload = JSON.stringify(result);
    await client.multi().set(key, payload, { EX: RUN_TTL_SECONDS }).publish(resultChannel(runId, toolCallId), payload).exec();
    return true;
}

export async function stopAgentRun(runId: string) {
    const client = await redisClient();
    await client.del(runKey(runId));
    rejectRunPending(runId, new DOMException("Agent run stopped", "AbortError"));
}

export async function completeAgentRun(runId: string) {
    const client = await redisClient();
    await client.del(runKey(runId));
    rejectRunPending(runId, new Error("Agent run completed before tool result"));
}

async function redisClient() {
    if (state.client?.isReady && state.subscriber?.isReady) return state.client;
    if (!state.connecting) {
        state.connecting = (async () => {
            const url = redisUrl();
            const client = createClient({ url });
            const subscriber = client.duplicate();
            client.on("error", (error) => console.error("[canvas-agent] redis client error", error));
            subscriber.on("error", (error) => console.error("[canvas-agent] redis subscriber error", error));
            await Promise.all([client.connect(), subscriber.connect()]);
            await subscriber.pSubscribe(RESULT_CHANNEL_PATTERN, (message, channel) => {
                const key = channel;
                const pending = state.pending.get(key);
                if (!pending) return;
                clearPending(key);
                try {
                    pending.resolve(parseResult(message));
                } catch (error) {
                    pending.reject(error instanceof Error ? error : new Error("Invalid tool result"));
                }
            });
            state.client = client;
            state.subscriber = subscriber;
        })().finally(() => {
            state.connecting = undefined;
        });
    }
    await state.connecting;
    if (!state.client) throw new Error("Redis connection is unavailable");
    return state.client;
}

function redisUrl() {
    if (process.env.REDIS_URL) return process.env.REDIS_URL;
    const address = String(process.env.REDIS_ADDR || "127.0.0.1:6379").trim();
    const password = String(process.env.REDIS_PASSWORD || "").trim();
    const db = Math.max(0, Number(process.env.REDIS_DB) || 0);
    return `redis://${password ? `:${encodeURIComponent(password)}@` : ""}${address}/${db}`;
}

function runKey(runId: string) {
    return `canvas-agent:run:${runId}`;
}

function resultKey(runId: string, toolCallId: string) {
    return `canvas-agent:tool-result:${runId}:${toolCallId}`;
}

function resultChannel(runId: string, toolCallId: string) {
    return resultKey(runId, toolCallId);
}

function clearPending(key: string) {
    const pending = state.pending.get(key);
    if (pending) clearTimeout(pending.timer);
    state.pending.delete(key);
}

function rejectRunPending(runId: string, error: Error) {
    const prefix = `canvas-agent:tool-result:${runId}:`;
    for (const [key, pending] of state.pending) {
        if (!key.startsWith(prefix)) continue;
        clearTimeout(pending.timer);
        pending.reject(error);
        state.pending.delete(key);
    }
}

function parseResult(payload: string) {
    const result = JSON.parse(payload) as AgentToolResult;
    if (!result || typeof result.ok !== "boolean" || typeof result.message !== "string") throw new Error("Invalid canvas tool result");
    return result;
}
