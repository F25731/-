import type { AgentEventEmitter, ModelResponse, ResponseOutputItem } from "./types";

type ModelRequest = {
    baseUrl: string;
    apiKey: string;
    model: string;
    instructions: string;
    input: unknown[];
    tools: readonly unknown[];
    signal: AbortSignal;
    runId: string;
    emit: AgentEventEmitter;
};

export async function requestModelResponse(input: ModelRequest): Promise<ModelResponse> {
    const startedAt = Date.now();
    let lastActivityAt = startedAt;
    const heartbeat = setInterval(() => {
        if (Date.now() - lastActivityAt < 4000) return;
        lastActivityAt = Date.now();
        input.emit({ type: "turn.activity", text: `Agent 正在处理，已用时 ${Math.max(1, Math.round((Date.now() - startedAt) / 1000))} 秒`, mode: "replace", status: "running" });
    }, 4000);

    try {
        const response = await fetch(`${normalizeBaseUrl(input.baseUrl)}/responses`, {
            method: "POST",
            signal: input.signal,
            headers: { Authorization: `Bearer ${input.apiKey}`, "Content-Type": "application/json" },
            body: JSON.stringify({
                model: input.model,
                instructions: input.instructions,
                input: input.input,
                tools: input.tools,
                tool_choice: "auto",
                parallel_tool_calls: false,
                reasoning: { effort: "medium", summary: "auto" },
                store: false,
                stream: true,
            }),
        });
        if (!response.ok) throw new Error(readUpstreamError(await response.text(), response.status));
        if (!response.body) throw new Error("Agent model returned an empty response");
        if (!String(response.headers.get("content-type") || "").includes("text/event-stream")) {
            const payload = JSON.parse(await response.text()) as Record<string, unknown>;
            return responseFromPayload(payload);
        }

        input.emit({ type: "turn.activity", text: "已连接 Agent 模型", mode: "replace", status: "running" });
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        const outputItems = new Map<number, ResponseOutputItem>();
        let buffer = "";
        let outputText = "";
        let reasoningText = "";
        let completed: Record<string, unknown> | undefined;

        while (true) {
            const { value, done } = await reader.read();
            if (done) break;
            buffer += decoder.decode(value, { stream: true });
            const chunks = buffer.split("\n\n");
            buffer = chunks.pop() || "";
            for (const chunk of chunks) {
                const event = parseSseData(chunk);
                if (!event) continue;
                lastActivityAt = Date.now();
                const type = String(event.type || "");
                if (type === "response.output_text.delta" && typeof event.delta === "string") {
                    outputText += event.delta;
                    input.emit({ type: "assistant.delta", text: outputText, mode: "replace", status: "running" });
                }
                if ((type.includes("reasoning_summary") || type.includes("reasoning.summary")) && type.endsWith(".delta") && typeof event.delta === "string") {
                    reasoningText = compactText(`${reasoningText}${event.delta}`, 500);
                    input.emit({ type: "reasoning.delta", text: reasoningText, mode: "replace", status: "running" });
                }
                if (type === "response.output_item.done" && event.item && typeof event.item === "object") {
                    outputItems.set(Number(event.output_index) || outputItems.size, event.item as ResponseOutputItem);
                }
                if (type === "response.completed" && event.response && typeof event.response === "object") completed = event.response as Record<string, unknown>;
                if (type.endsWith(".failed") || type === "error") throw new Error(extractError(event) || "Agent model request failed");
            }
        }

        const result = completed ? responseFromPayload(completed) : { output: Array.from(outputItems.values()), outputText };
        if (!result.outputText) result.outputText = outputText;
        if (!result.output.length) result.output = Array.from(outputItems.values());
        logRawModelOutput(input.runId, result);
        return result;
    } finally {
        clearInterval(heartbeat);
    }
}

function responseFromPayload(payload: Record<string, unknown>): ModelResponse {
    const output = Array.isArray(payload.output) ? (payload.output.filter((item) => item && typeof item === "object") as ResponseOutputItem[]) : [];
    return {
        id: typeof payload.id === "string" ? payload.id : undefined,
        output,
        outputText: typeof payload.output_text === "string" ? payload.output_text : extractOutputText(output),
    };
}

function extractOutputText(output: ResponseOutputItem[]) {
    return output
        .filter((item) => item.type === "message")
        .flatMap((item) => (Array.isArray(item.content) ? item.content : []))
        .flatMap((content) => {
            if (!content || typeof content !== "object") return [];
            const record = content as Record<string, unknown>;
            return typeof record.text === "string" ? [record.text] : [];
        })
        .join("")
        .trim();
}

function parseSseData(chunk: string): Record<string, unknown> | null {
    const line = chunk
        .split("\n")
        .map((item) => item.trim())
        .find((item) => item.startsWith("data:"));
    if (!line || line === "data: [DONE]") return null;
    try {
        return JSON.parse(line.slice(5).trim()) as Record<string, unknown>;
    } catch {
        return null;
    }
}

function normalizeBaseUrl(value: string) {
    return value.trim().replace(/\/$/, "").replace(/\/v1$/i, "") + "/v1";
}

function readUpstreamError(text: string, status: number) {
    try {
        const payload = JSON.parse(text) as { error?: { message?: string } | string; message?: string };
        if (typeof payload.error === "string") return payload.error;
        return payload.error?.message || payload.message || `Agent model request failed (${status})`;
    } catch {
        return text.trim().slice(0, 800) || `Agent model request failed (${status})`;
    }
}

function extractError(payload: Record<string, unknown>) {
    const error = payload.error;
    if (typeof error === "string") return error;
    if (error && typeof error === "object" && typeof (error as Record<string, unknown>).message === "string") return String((error as Record<string, unknown>).message);
    return "";
}

function compactText(value: string, max: number) {
    return value.replace(/\s+/g, " ").trim().slice(-max);
}

function logRawModelOutput(runId: string, response: ModelResponse) {
    const safe = {
        responseId: response.id,
        outputText: response.outputText.slice(0, 12000),
        output: response.output.map((item) => ({ type: item.type, id: item.id, call_id: item.call_id, name: item.name, arguments: typeof item.arguments === "string" ? item.arguments.slice(0, 12000) : item.arguments })),
    };
    console.info(`[canvas-agent] ${JSON.stringify({ runId, event: "model.raw_output", data: safe })}`);
}
