export type AgentNodeSnapshot = {
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
};

export type AgentCanvasSnapshot = {
    projectId?: string;
    canvasRevision: number;
    viewport?: { x: number; y: number; k: number };
    nodes: AgentNodeSnapshot[];
    connections: Array<{ id: string; fromNodeId: string; toNodeId: string }>;
    selectedNodeIds: string[];
    attachments?: Array<{ id?: string; title?: string; url?: string }>;
    imageModels?: Array<{
        name?: string;
        supportedSizes?: string[];
        supportedTiers?: string[];
        defaultTier?: string;
        referenceLimit?: number;
        isDefault?: boolean;
    }>;
    imageDefaults?: { model?: string; size?: string; tier?: string; count?: number };
};

export type AgentHistoryItem = {
    role: "user" | "assistant";
    text: string;
};

export type AgentRunPayload = {
    runId?: string;
    turnId?: string;
    prompt?: string;
    model?: string;
    modelId?: string;
    baseUrl?: string;
    apiKey?: string;
    agentMode?: "general" | "detail";
    snapshot?: AgentCanvasSnapshot;
    summary?: string;
    history?: Array<{ role?: string; text?: string }>;
};

export type AgentToolRequest = {
    id: string;
    runId: string;
    turnId: string;
    toolCallId: string;
    name: string;
    description: string;
    expectedRevision: number;
    operation: unknown;
    status: "pending";
};

export type AgentToolResult = {
    ok: boolean;
    message: string;
    generationRunIds?: string[];
    imageJobIds?: string[];
    artifacts?: Array<{ id: string; type: "image"; title: string; url: string; storageKey?: string; nodeId?: string }>;
    nextCanvas?: {
        nodes: AgentNodeSnapshot[];
        connections: AgentCanvasSnapshot["connections"];
        selectedNodeIds: string[];
        viewport: { x: number; y: number; k: number };
    };
};

export type AgentEventType =
    "run.started" | "turn.started" | "turn.activity" | "reasoning.delta" | "assistant.delta" | "model.response" | "tool.requested" | "tool.validation_failed" | "tool.result" | "turn.completed" | "run.completed" | "run.stopped" | "error" | "done";

export type AgentStreamEvent = {
    id?: string;
    type: AgentEventType;
    runId?: string;
    turnId?: string;
    toolCallId?: string;
    text?: string;
    mode?: "replace" | "append";
    status?: "pending" | "running" | "submitted" | "completed" | "failed" | "stopped";
    timestamp?: number;
    sequence?: number;
    toolRequest?: AgentToolRequest;
    data?: AgentRunResponse;
};

export type AgentRunResponse = {
    reply: string;
    summary?: string;
    toolRequests: AgentToolRequest[];
};

export type AgentEventEmitter = (event: AgentStreamEvent) => void;

export type ResponseOutputItem = Record<string, unknown> & {
    type?: string;
    id?: string;
    call_id?: string;
    name?: string;
    arguments?: string;
};

export type ModelResponse = {
    id?: string;
    output: ResponseOutputItem[];
    outputText: string;
};
