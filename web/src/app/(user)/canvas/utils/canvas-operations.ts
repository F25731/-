import type { CanvasConnection, CanvasNodeData, ViewportTransform } from "../types";
import type { CanvasProject } from "../stores/use-canvas-store";

export type CanvasOperation =
    | { type: "canvas.applyOps"; operations: CanvasOperation[] }
    | { type: "canvas.addNode"; node: CanvasNodeData }
    | { type: "canvas.createTextNodes"; nodes: CanvasNodeData[] }
    | { type: "canvas.updateNode"; id: string; patch: Partial<CanvasNodeData> }
    | { type: "canvas.moveNodes"; items: Array<{ id: string; position?: { x: number; y: number }; dx?: number; dy?: number }> }
    | { type: "canvas.resizeNode"; id: string; width: number; height: number; freeResize?: boolean }
    | { type: "canvas.removeNodes"; ids: string[] }
    | { type: "canvas.addConnection"; connection: CanvasConnection }
    | { type: "canvas.removeConnections"; ids: string[] }
    | { type: "canvas.selectNodes"; ids: string[] }
    | { type: "canvas.setViewport"; viewport: ViewportTransform }
    | { type: "canvas.replaceDocument"; nodes: CanvasNodeData[]; connections: CanvasConnection[] };

export type CanvasOperationResult = {
    project: CanvasProject;
    inverse: CanvasOperation;
    selectedNodeIds?: string[];
    viewport?: ViewportTransform;
};

export class CanvasOperationError extends Error {
    code: "AGENT_REVISION_MISMATCH" | "AGENT_TOOL_INVALID";

    constructor(code: CanvasOperationError["code"], message: string) {
        super(message);
        this.name = "CanvasOperationError";
        this.code = code;
    }
}

export function applyCanvasOperation(project: CanvasProject, operation: CanvasOperation, expectedRevision?: number): CanvasOperationResult {
    if (typeof expectedRevision === "number" && project.canvasRevision !== expectedRevision) {
        throw new CanvasOperationError("AGENT_REVISION_MISMATCH", "canvas revision mismatch");
    }

    switch (operation.type) {
        case "canvas.applyOps": {
            let nextProject = project;
            const inverseOperations: CanvasOperation[] = [];
            let selectedNodeIds: string[] | undefined;
            let viewport: ViewportTransform | undefined;
            for (const item of operation.operations) {
                if (item.type === "canvas.applyOps") throw new CanvasOperationError("AGENT_TOOL_INVALID", "nested operation batches are not supported");
                const result = applyCanvasOperation(nextProject, item);
                nextProject = result.project;
                inverseOperations.unshift(result.inverse);
                if (result.selectedNodeIds) selectedNodeIds = result.selectedNodeIds;
                if (result.viewport) viewport = result.viewport;
            }
            return {
                project: nextProject,
                inverse: { type: "canvas.applyOps", operations: inverseOperations },
                selectedNodeIds,
                viewport,
            };
        }
        case "canvas.addNode":
            ensureUniqueNode(project, operation.node.id);
            return {
                project: { ...project, nodes: [...project.nodes, operation.node] },
                inverse: { type: "canvas.removeNodes", ids: [operation.node.id] },
                selectedNodeIds: [operation.node.id],
            };
        case "canvas.createTextNodes": {
            operation.nodes.forEach((node) => ensureUniqueNode(project, node.id));
            return {
                project: { ...project, nodes: [...project.nodes, ...operation.nodes] },
                inverse: { type: "canvas.removeNodes", ids: operation.nodes.map((node) => node.id) },
                selectedNodeIds: operation.nodes.map((node) => node.id),
            };
        }
        case "canvas.updateNode": {
            const before = project.nodes.find((node) => node.id === operation.id);
            if (!before) throw new CanvasOperationError("AGENT_TOOL_INVALID", "node not found");
            const after = { ...before, ...operation.patch, metadata: operation.patch.metadata ? { ...before.metadata, ...operation.patch.metadata } : before.metadata };
            return {
                project: { ...project, nodes: project.nodes.map((node) => (node.id === operation.id ? after : node)) },
                inverse: { type: "canvas.updateNode", id: operation.id, patch: before },
            };
        }
        case "canvas.moveNodes": {
            const beforeNodes = project.nodes;
            const currentById = new Map(project.nodes.map((node) => [node.id, node]));
            const items = operation.items.filter((item) => currentById.has(item.id));
            if (!items.length) throw new CanvasOperationError("AGENT_TOOL_INVALID", "nodes not found");
            const itemById = new Map(items.map((item) => [item.id, item]));
            return {
                project: {
                    ...project,
                    nodes: project.nodes.map((node) => {
                        const item = itemById.get(node.id);
                        if (!item) return node;
                        return {
                            ...node,
                            position: item.position || {
                                x: node.position.x + (item.dx || 0),
                                y: node.position.y + (item.dy || 0),
                            },
                        };
                    }),
                },
                inverse: { type: "canvas.replaceDocument", nodes: beforeNodes, connections: project.connections },
                selectedNodeIds: items.map((item) => item.id),
            };
        }
        case "canvas.resizeNode": {
            const before = project.nodes.find((node) => node.id === operation.id);
            if (!before) throw new CanvasOperationError("AGENT_TOOL_INVALID", "node not found");
            const ratio = Math.max(0.01, before.width / Math.max(1, before.height));
            const width = operation.width;
            const height = width / ratio;
            return {
                project: {
                    ...project,
                    nodes: project.nodes.map((node) =>
                        node.id === operation.id
                            ? {
                                  ...node,
                                  width,
                                  height,
                                  metadata: { ...node.metadata, freeResize: false },
                              }
                            : node,
                    ),
                },
                inverse: { type: "canvas.updateNode", id: operation.id, patch: before },
                selectedNodeIds: [operation.id],
            };
        }
        case "canvas.removeNodes": {
            const ids = new Set(operation.ids);
            return {
                project: {
                    ...project,
                    nodes: project.nodes.filter((node) => !ids.has(node.id)),
                    connections: project.connections.filter((connection) => !ids.has(connection.fromNodeId) && !ids.has(connection.toNodeId)),
                },
                inverse: { type: "canvas.replaceDocument", nodes: project.nodes, connections: project.connections },
            };
        }
        case "canvas.addConnection":
            ensureConnectionNodes(project, operation.connection);
            if (project.connections.some((connection) => connection.id === operation.connection.id)) {
                throw new CanvasOperationError("AGENT_TOOL_INVALID", "connection already exists");
            }
            return {
                project: { ...project, connections: [...project.connections, operation.connection] },
                inverse: { type: "canvas.removeConnections", ids: [operation.connection.id] },
            };
        case "canvas.removeConnections": {
            const ids = new Set(operation.ids);
            return {
                project: { ...project, connections: project.connections.filter((connection) => !ids.has(connection.id)) },
                inverse: { type: "canvas.replaceDocument", nodes: project.nodes, connections: project.connections },
            };
        }
        case "canvas.selectNodes": {
            const existing = new Set(project.nodes.map((node) => node.id));
            const ids = operation.ids.filter((id) => existing.has(id));
            return {
                project,
                inverse: { type: "canvas.selectNodes", ids: [] },
                selectedNodeIds: ids,
            };
        }
        case "canvas.setViewport":
            return {
                project: { ...project, viewport: operation.viewport },
                inverse: { type: "canvas.setViewport", viewport: project.viewport },
                viewport: operation.viewport,
            };
        case "canvas.replaceDocument":
            ensureDocumentIntegrity(operation.nodes, operation.connections);
            return {
                project: { ...project, nodes: operation.nodes, connections: operation.connections },
                inverse: { type: "canvas.replaceDocument", nodes: project.nodes, connections: project.connections },
            };
        default:
            throw new CanvasOperationError("AGENT_TOOL_INVALID", "unsupported canvas operation");
    }
}

function ensureUniqueNode(project: CanvasProject, id: string) {
    if (!id.trim()) throw new CanvasOperationError("AGENT_TOOL_INVALID", "node id is required");
    if (project.nodes.some((node) => node.id === id)) throw new CanvasOperationError("AGENT_TOOL_INVALID", "node already exists");
}

function ensureConnectionNodes(project: CanvasProject, connection: CanvasConnection) {
    const ids = new Set(project.nodes.map((node) => node.id));
    if (!ids.has(connection.fromNodeId) || !ids.has(connection.toNodeId)) {
        throw new CanvasOperationError("AGENT_TOOL_INVALID", "connection references missing node");
    }
}

function ensureDocumentIntegrity(nodes: CanvasNodeData[], connections: CanvasConnection[]) {
    const ids = new Set<string>();
    for (const node of nodes) {
        if (!node.id || ids.has(node.id)) throw new CanvasOperationError("AGENT_TOOL_INVALID", "invalid node ids");
        ids.add(node.id);
    }
    for (const connection of connections) {
        if (!ids.has(connection.fromNodeId) || !ids.has(connection.toNodeId)) {
            throw new CanvasOperationError("AGENT_TOOL_INVALID", "connection references missing node");
        }
    }
}
