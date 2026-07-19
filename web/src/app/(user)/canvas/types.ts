export type Position = {
    x: number;
    y: number;
};

export type ViewportTransform = {
    x: number;
    y: number;
    k: number;
};

export enum CanvasNodeType {
    Image = "image",
    Text = "text",
    Config = "config",
}

export type CanvasNodeStatus = "idle" | "success" | "loading" | "error";
export type CanvasGenerationMode = "text" | "image";
export type CanvasImageGenerationType = "generation" | "edit";

export type CanvasNodeMetadata = {
    content?: string;
    prompt?: string;
    composerContent?: string;
    originalPrompt?: string;
    status?: CanvasNodeStatus;
    errorDetails?: string;
    fontSize?: number;
    generationMode?: CanvasGenerationMode;
    generationType?: CanvasImageGenerationType;
    model?: string;
    size?: string;
    quality?: string;
    imageTier?: string;
    count?: number;
    references?: string[];
    naturalWidth?: number;
    naturalHeight?: number;
    freeResize?: boolean;
    isBatchRoot?: boolean;
    batchRootId?: string;
    batchChildIds?: string[];
    batchUsesReferenceImages?: boolean;
    primaryImageId?: string;
    imageBatchExpanded?: boolean;
    inputOrder?: string[];
    storageKey?: string;
    remoteUrl?: string;
    mimeType?: string;
    bytes?: number;
    imageJobId?: string;
    resumeOnReload?: boolean;
    detailWorkflowId?: string;
    detailRole?: "plan" | "screen-prompt" | "screen-config" | "screen-result" | "long-image" | "reference";
    detailScreenIndex?: number;
    detailScreenCount?: number;
    detailStyleSummary?: string;
    detailGoal?: string;
    detailGenerationMode?: "precise" | "rough";
    detailExecutionMode?: "step" | "continuous";
    detailReferenceNodeIds?: string[];
    detailActiveReferenceNodeIds?: string[];
    detailReferenceRoles?: Array<"product" | "first-screen" | "previous-screen">;
    detailPromptNodeId?: string;
    detailAttempt?: number;
    detailCompositionStale?: boolean;
    detailNeedsRegeneration?: boolean;
    referenceOrder?: number;
    referenceLabel?: string;
};

export type CanvasNodeData = {
    id: string;
    type: CanvasNodeType;
    title: string;
    position: Position;
    width: number;
    height: number;
    metadata?: CanvasNodeMetadata;
};

export type CanvasConnection = {
    id: string;
    fromNodeId: string;
    toNodeId: string;
};

export type CanvasAssistantReference = {
    id: string;
    type: CanvasNodeType;
    title: string;
    dataUrl?: string;
    remoteUrl?: string;
    storageKey?: string;
    text?: string;
};

export type CanvasDetailAgentOptions = {
    generationMode: "precise" | "rough";
    executionMode: "step" | "continuous";
    editScope: "current" | "downstream" | "all";
    composeWhenComplete: boolean;
};

export type CanvasAgentToolRequest = {
    id: string;
    runId?: string;
    turnId?: string;
    toolCallId?: string;
    name:
        | "canvas.applyOps"
        | "canvas.generateImage"
        | "canvas.generateText"
        | "canvas.detailWorkflow"
        | "canvas.retryFailedImages"
        | "canvas.runGeneration"
        | "canvas.addNode"
        | "canvas.createTextNodes"
        | "canvas.updateNode"
        | "canvas.moveNodes"
        | "canvas.resizeNode"
        | "canvas.removeNodes"
        | "canvas.addConnection"
        | "canvas.removeConnections"
        | "canvas.selectNodes"
        | "canvas.setViewport"
        | "canvas.replaceDocument";
    description: string;
    expectedRevision: number;
    operation: unknown;
    status: "pending" | "approved" | "applying" | "applied" | "submitted" | "running" | "rejected" | "completed" | "failed";
    result?: string;
    error?: string;
    generationRunIds?: string[];
    imageJobIds?: string[];
    artifacts?: CanvasAgentArtifact[];
};

export type CanvasAgentArtifact = {
    id: string;
    type: "image";
    title: string;
    url: string;
    storageKey?: string;
    nodeId?: string;
};

export type CanvasAgentEventType =
    | "run.started"
    | "turn.started"
    | "turn.activity"
    | "reasoning.delta"
    | "assistant.delta"
    | "model.response"
    | "tool.requested"
    | "tool.validation_failed"
    | "tool.result"
    | "tool.approved"
    | "canvas.applied"
    | "generation.started"
    | "image-job.submitted"
    | "image-job.running"
    | "image-job.completed"
    | "image-job.failed"
    | "generation.completed"
    | "generation.failed"
    | "detail.workflow.created"
    | "detail.workflow.updated"
    | "detail.workflow.regenerating"
    | "detail.screen.started"
    | "detail.screen.completed"
    | "detail.screen.failed"
    | "detail.workflow.completed"
    | "detail.long-image.completed"
    | "tool.completed"
    | "tool.failed"
    | "turn.completed"
    | "run.completed"
    | "run.stopped"
    | "error";

export type CanvasAgentEvent = {
    id: string;
    type: CanvasAgentEventType;
    runId: string;
    turnId?: string;
    toolCallId?: string;
    generationRunId?: string;
    imageJobId?: string;
    nodeId?: string;
    targetNodeId?: string;
    text: string;
    status?: "pending" | "running" | "submitted" | "completed" | "failed" | "stopped";
    timestamp: number;
    sequence: number;
};

export type CanvasAgentApplyResult = {
    ok: boolean;
    message: string;
    generationRunIds?: string[];
    imageJobIds?: string[];
    artifacts?: CanvasAgentArtifact[];
    nextCanvas?: {
        nodes: CanvasNodeData[];
        connections: CanvasConnection[];
        selectedNodeIds: string[];
        viewport: ViewportTransform;
    };
};

export type CanvasAssistantMessage = {
    id: string;
    runId?: string;
    turnId?: string;
    role: "user" | "assistant";
    mode: "agent";
    agentMode?: "general" | "detail";
    detailOptions?: CanvasDetailAgentOptions;
    text: string;
    isLoading?: boolean;
    startedAt?: number;
    references?: CanvasAssistantReference[];
    toolRequest?: CanvasAgentToolRequest;
    toolRequests?: CanvasAgentToolRequest[];
    toolName?: CanvasAgentToolRequest["name"];
    toolStatus?: CanvasAgentToolRequest["status"];
    toolResult?: string;
    logs?: string[];
    activityText?: string;
    events?: CanvasAgentEvent[];
};

export type CanvasAssistantSession = {
    id: string;
    title: string;
    summary?: string;
    messages: CanvasAssistantMessage[];
    createdAt: string;
    updatedAt: string;
};

export type ConnectionHandle = {
    nodeId: string;
    handleType: "source" | "target";
};

export type SelectionBox = {
    startWorldX: number;
    startWorldY: number;
    currentWorldX: number;
    currentWorldY: number;
    additive: boolean;
    initialSelectedNodeIds: string[];
};

export type ContextMenuState = {
    type: "node";
    x: number;
    y: number;
    nodeId: string;
};
