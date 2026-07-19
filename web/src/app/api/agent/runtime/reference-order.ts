export type OrderedAgentAttachment = {
    id?: string;
    title?: string;
    url?: string;
    order?: number;
    label?: string;
};

export function selectAttachmentsInUploadOrder<T extends OrderedAgentAttachment>(attachments: T[] | undefined, requestedIds: string[], limit: number) {
    const requested = new Set(requestedIds.filter(Boolean));
    return (attachments || []).filter((attachment) => attachment.id && attachment.url && (!requested.size || requested.has(String(attachment.id)))).slice(0, Math.max(0, limit));
}

export function attachmentCanvasTitle(attachment: OrderedAgentAttachment, index: number) {
    const order = Number(attachment.order) || index + 1;
    const label = String(attachment.label || `图${order}`);
    const title = String(attachment.title || "参考图").trim();
    return `${label} · ${title}`.slice(0, 64);
}
