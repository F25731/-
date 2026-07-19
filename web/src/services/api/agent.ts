import { readUserModelConfig, type AiConfig, type StoredUserModel } from "@/stores/use-config-store";
import type { CanvasAgentApplyResult, CanvasAgentEventType, CanvasAgentToolRequest, CanvasConnection, CanvasDetailAgentOptions, CanvasNodeData } from "@/app/(user)/canvas/types";

export type CanvasAgentSnapshot = {
    projectId?: string;
    canvasRevision: number;
    viewport?: { x: number; y: number; k: number };
    nodes: Array<{
        id: string;
        type: string;
        title: string;
        position: { x: number; y: number };
        width: number;
        height: number;
        text?: string;
        status?: string;
        prompt?: string;
        model?: string;
        size?: string;
        imageTier?: string;
        count?: number;
        imageJobId?: string;
        detailWorkflowId?: string;
        detailRole?: string;
        detailScreenIndex?: number;
        detailScreenCount?: number;
        detailGenerationMode?: "precise" | "rough";
        detailExecutionMode?: "step" | "continuous";
    }>;
    connections: Array<{
        id: string;
        fromNodeId: string;
        toNodeId: string;
    }>;
    selectedNodeIds: string[];
    attachments: Array<{
        id: string;
        title: string;
        url: string;
        order: number;
        label: string;
    }>;
    imageModels: Array<{
        name: string;
        supportedSizes: string[];
        supportedTiers: string[];
        defaultTier: string;
        referenceLimit: number;
        isDefault: boolean;
    }>;
    imageDefaults: {
        model: string;
        size: string;
        tier: string;
        count: number;
    };
};

export type CanvasAgentHistoryItem = {
    role: "user" | "assistant";
    text: string;
    toolName?: string;
    toolStatus?: string;
};

export type CanvasAgentStreamEvent = {
    id: string;
    type: CanvasAgentEventType | "done";
    runId: string;
    turnId?: string;
    toolCallId?: string;
    text?: string;
    mode?: "replace" | "append";
    status?: "pending" | "running" | "submitted" | "completed" | "failed" | "stopped";
    timestamp: number;
    sequence: number;
    toolRequest?: CanvasAgentToolRequest;
    data?: AgentTurnResponse;
};

export type AgentTurnResponse = {
    reply: string;
    toolRequests: CanvasAgentToolRequest[];
    summary?: string;
};

export function buildCanvasAgentSnapshot(input: {
    projectId?: string;
    canvasRevision: number;
    viewport?: { x: number; y: number; k: number };
    nodes: CanvasNodeData[];
    connections: CanvasConnection[];
    selectedNodeIds: Set<string>;
    config: AiConfig;
    attachments?: Array<{ id: string; title: string; remoteUrl?: string }>;
}): CanvasAgentSnapshot {
    const userModels = readUserModelConfig().models.filter((model) => model.type === "image");
    const configuredImageNames = input.config.models.filter((name) => input.config.modelTypes[name] === "image");
    if (!configuredImageNames.length && input.config.imageModel) configuredImageNames.push(input.config.imageModel);
    const fallbackImageModels: StoredUserModel[] = configuredImageNames.map((name) => ({
        id: name,
        name,
        type: "image" as const,
        apiUrl: "",
        enabled: true,
    }));
    const imageModels = (userModels.length ? userModels : fallbackImageModels).map((model) => {
        const supportedSizes = input.config.modelSupportedSizes[model.name] || model.supportedSizes || [];
        const supportedTiers = input.config.modelTierOptions[model.name] || Object.keys(model.tierModels || {});
        return {
            name: model.name,
            supportedSizes,
            supportedTiers,
            defaultTier: input.config.modelDefaultTiers[model.name] || model.defaultTier || supportedTiers[0] || "1k",
            referenceLimit: input.config.modelReferenceLimits[model.name] || model.referenceLimit || 0,
            isDefault: model.name === input.config.imageModel,
        };
    });
    return {
        projectId: input.projectId,
        canvasRevision: input.canvasRevision,
        viewport: input.viewport,
        selectedNodeIds: Array.from(input.selectedNodeIds),
        attachments: (input.attachments || [])
            .map((item, index) => ({ id: item.id, title: item.title, url: String(item.remoteUrl || "").trim(), order: index + 1, label: `图${index + 1}` }))
            .filter((item) => /^https?:\/\//i.test(item.url))
            .slice(0, 6),
        nodes: input.nodes.slice(0, 200).map((node) => ({
            id: node.id,
            type: node.type,
            title: node.title,
            position: node.position,
            width: node.width,
            height: node.height,
            text: node.type === "text" ? String(node.metadata?.content || "").slice(0, 1200) : undefined,
            status: node.metadata?.status,
            prompt: node.metadata?.prompt ? String(node.metadata.prompt).slice(0, 1200) : undefined,
            model: node.metadata?.model,
            size: node.metadata?.size,
            imageTier: node.metadata?.imageTier,
            count: node.metadata?.count,
            imageJobId: node.metadata?.imageJobId,
            detailWorkflowId: node.metadata?.detailWorkflowId,
            detailRole: node.metadata?.detailRole,
            detailScreenIndex: node.metadata?.detailScreenIndex,
            detailScreenCount: node.metadata?.detailScreenCount,
            detailGenerationMode: node.metadata?.detailGenerationMode,
            detailExecutionMode: node.metadata?.detailExecutionMode,
        })),
        connections: input.connections.slice(0, 400).map((connection) => ({
            id: connection.id,
            fromNodeId: connection.fromNodeId,
            toNodeId: connection.toNodeId,
        })),
        imageModels,
        imageDefaults: {
            model: input.config.imageModel || input.config.model,
            size: input.config.size,
            tier: input.config.imageTier,
            count: Math.max(1, Math.min(8, Math.floor(Number(input.config.count)) || 1)),
        },
    };
}

export async function requestCanvasAgentTurnStream(
    config: AiConfig,
    prompt: string,
    snapshot: CanvasAgentSnapshot,
    history: CanvasAgentHistoryItem[] = [],
    summary = "",
    options: {
        signal?: AbortSignal;
        onEvent?: (event: CanvasAgentStreamEvent) => void;
        onToolRequest: (request: CanvasAgentToolRequest) => Promise<CanvasAgentApplyResult>;
        agentModel?: string;
        agentMode?: "general" | "detail";
        detailOptions?: CanvasDetailAgentOptions;
        runId?: string;
        turnId?: string;
    },
) {
    const payload = {
        ...buildAgentTurnPayload(config, prompt, snapshot, history, options.agentModel),
        agentMode: options.agentMode || "general",
        detailOptions: options.agentMode === "detail" ? options.detailOptions : undefined,
        summary,
        stream: true,
        runId: options.runId,
        turnId: options.turnId,
    };
    const response = await fetch("/api/agent/turn", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        signal: options.signal,
    });
    if (!response.ok || !response.body) {
        const message = await readAgentError(response);
        throw new Error(message);
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let result: AgentTurnResponse | null = null;
    while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const chunks = buffer.split("\n\n");
        buffer = chunks.pop() || "";
        for (const chunk of chunks) {
            const event = parseAgentStreamChunk(chunk);
            if (!event) continue;
            options.onEvent?.(event);
            if (event.type === "tool.requested" && event.toolRequest) {
                const toolResult = await options.onToolRequest(event.toolRequest);
                await submitCanvasToolResult(event.runId, event.toolRequest.toolCallId || event.toolRequest.id, toolResult, options.signal);
            }
            if (event.type === "done" && event.data) result = event.data;
            if (event.type === "error") throw new Error(event.text || "Agent 调用失败");
        }
    }
    if (buffer.trim()) {
        const event = parseAgentStreamChunk(buffer);
        if (event) {
            options.onEvent?.(event);
            if (event.type === "tool.requested" && event.toolRequest) {
                const toolResult = await options.onToolRequest(event.toolRequest);
                await submitCanvasToolResult(event.runId, event.toolRequest.toolCallId || event.toolRequest.id, toolResult, options.signal);
            }
            if (event.type === "done" && event.data) result = event.data;
            if (event.type === "error") throw new Error(event.text || "Agent 调用失败");
        }
    }
    if (!result) throw new Error("Agent 流式响应没有返回结果");
    return result;
}

async function submitCanvasToolResult(runId: string, toolCallId: string, result: CanvasAgentApplyResult, signal?: AbortSignal) {
    const response = await fetch(`/api/agent/runs/${encodeURIComponent(runId)}/tool-results`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ toolCallId, result: serializeToolResult(result) }),
        signal,
    });
    if (!response.ok) throw new Error(await readAgentError(response));
}

function serializeToolResult(result: CanvasAgentApplyResult) {
    if (!result.nextCanvas) return result;
    return {
        ...result,
        nextCanvas: {
            ...result.nextCanvas,
            nodes: result.nextCanvas.nodes.map((node) => ({
                id: node.id,
                type: node.type,
                title: node.title,
                position: node.position,
                width: node.width,
                height: node.height,
                text: node.type === "text" ? String(node.metadata?.content || "").slice(0, 1200) : undefined,
                status: node.metadata?.status,
                prompt: node.metadata?.prompt ? String(node.metadata.prompt).slice(0, 1200) : undefined,
                model: node.metadata?.model,
                size: node.metadata?.size,
                imageTier: node.metadata?.imageTier,
                count: node.metadata?.count,
                imageJobId: node.metadata?.imageJobId,
                detailWorkflowId: node.metadata?.detailWorkflowId,
                detailRole: node.metadata?.detailRole,
                detailScreenIndex: node.metadata?.detailScreenIndex,
                detailScreenCount: node.metadata?.detailScreenCount,
                detailGenerationMode: node.metadata?.detailGenerationMode,
                detailExecutionMode: node.metadata?.detailExecutionMode,
            })),
        },
    };
}

function buildAgentTurnPayload(config: AiConfig, prompt: string, snapshot: CanvasAgentSnapshot, history: CanvasAgentHistoryItem[] = [], agentModel = "") {
    const agent = selectAgentModel(config, agentModel);
    const apiKey = agent.apiKey;
    const baseUrl = String(agent.model.apiUrl || config.baseUrl || "").trim();
    const modelId = String(agent.model.modelId || agent.model.name).trim();
    if (!apiKey) throw new Error("请先在 API Key 配置里填写 Agent 模型密钥");
    if (!baseUrl) throw new Error("请先配置 Agent 模型请求地址");
    if (!modelId) throw new Error("请先选择 Agent 模型");
    return {
        prompt,
        snapshot,
        history: history.slice(-12),
        model: agent.model.name,
        modelId,
        baseUrl,
        apiKey,
    };
}

function selectAgentModel(_config: AiConfig, requestedModel = "") {
    const userModelConfig = readAgentLanguageModelConfig();
    const byName = new Map(userModelConfig.models.map((model) => [model.name, model]));
    const selected = byName.get(requestedModel);
    if (selected) return { model: selected, apiKey: userModelConfig.apiKeys[selected.id] };
    const detailPromptModels = userModelConfig.models.filter((model) => model.type === "detail_prompt");
    const defaultDetailPrompt = detailPromptModels.find((model) => model.isDefault);
    if (defaultDetailPrompt) return { model: defaultDetailPrompt, apiKey: userModelConfig.apiKeys[defaultDetailPrompt.id] };
    if (detailPromptModels[0]) return { model: detailPromptModels[0], apiKey: userModelConfig.apiKeys[detailPromptModels[0].id] };
    throw new Error("请先在 API Key 配置里为 ChatGPT 5.5 或 Claude Agent 模型填写密钥");
}

export function listCanvasAgentModels() {
    const config = readAgentLanguageModelConfig();
    return config.models.map((model) => ({ name: model.name, isDefault: Boolean(model.isDefault), type: model.type }));
}

function readAgentLanguageModelConfig() {
    const stored = readUserModelConfig();
    const sharedApiKey = String(stored.aggregate.apiKey || "").trim();
    const models = stored.models.filter((model) => model.type === "detail_prompt");
    const apiKeys = sharedApiKey ? Object.fromEntries(models.map((model) => [model.id, sharedApiKey])) : {};
    return { models: sharedApiKey ? models : ([] as StoredUserModel[]), apiKeys };
}

function parseAgentStreamChunk(chunk: string): CanvasAgentStreamEvent | null {
    const dataLine = chunk
        .split("\n")
        .map((line) => line.trim())
        .find((line) => line.startsWith("data:"));
    if (!dataLine) return null;
    try {
        return JSON.parse(dataLine.slice(5).trim()) as CanvasAgentStreamEvent;
    } catch {
        return null;
    }
}

async function readAgentError(response: Response) {
    try {
        const payload = (await response.json()) as { msg?: string; error?: string };
        return payload.msg || payload.error || "Agent 调用失败";
    } catch {
        return "Agent 调用失败";
    }
}
