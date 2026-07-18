import type { Position, ViewportTransform } from "../types";

export type CanvasLayoutRect = Position & {
    width: number;
    height: number;
    id?: string;
};

export type CanvasLayoutItem = Pick<CanvasLayoutRect, "width" | "height" | "id"> &
    Partial<Position> & {
        position?: Position;
    };

const DEFAULT_NODE_GAP = 56;
const MAX_LAYOUT_RINGS = 24;

export function findOpenNodePosition(occupied: CanvasLayoutItem[], preferred: Position, size: Pick<CanvasLayoutRect, "width" | "height">, options: { gap?: number; ignoreIds?: Iterable<string> } = {}) {
    const gap = Math.max(0, options.gap ?? DEFAULT_NODE_GAP);
    const ignored = new Set(options.ignoreIds || []);
    const blockers = occupied
        .filter((rect) => !rect.id || !ignored.has(rect.id))
        .map((rect) => ({
            id: rect.id,
            x: rect.position?.x ?? rect.x ?? 0,
            y: rect.position?.y ?? rect.y ?? 0,
            width: rect.width,
            height: rect.height,
        }));
    const width = Math.max(1, size.width);
    const height = Math.max(1, size.height);
    const stepX = width + gap;
    const stepY = height + gap;

    for (let ring = 0; ring <= MAX_LAYOUT_RINGS; ring += 1) {
        for (const offset of ringOffsets(ring)) {
            const candidate = {
                x: preferred.x + offset.x * stepX,
                y: preferred.y + offset.y * stepY,
                width,
                height,
            };
            if (!blockers.some((blocker) => rectsOverlap(candidate, blocker, gap))) {
                return { x: candidate.x, y: candidate.y };
            }
        }
    }

    const bottom = blockers.reduce((value, rect) => Math.max(value, rect.y + rect.height), preferred.y);
    return { x: preferred.x, y: bottom + gap };
}

export function minimallyRevealRect(viewport: ViewportTransform, viewportSize: { width: number; height: number }, rect: CanvasLayoutRect, padding = 40) {
    if (viewportSize.width <= 0 || viewportSize.height <= 0 || viewport.k <= 0) return viewport;

    const left = viewport.x + rect.x * viewport.k;
    const top = viewport.y + rect.y * viewport.k;
    const right = left + rect.width * viewport.k;
    const bottom = top + rect.height * viewport.k;
    const availableWidth = Math.max(0, viewportSize.width - padding * 2);
    const availableHeight = Math.max(0, viewportSize.height - padding * 2);
    const renderedWidth = rect.width * viewport.k;
    const renderedHeight = rect.height * viewport.k;
    let dx = 0;
    let dy = 0;

    if (renderedWidth <= availableWidth) {
        if (left < padding) dx = padding - left;
        else if (right > viewportSize.width - padding) dx = viewportSize.width - padding - right;
    } else if (right < padding) {
        dx = padding - right;
    } else if (left > viewportSize.width - padding) {
        dx = viewportSize.width - padding - left;
    }

    if (renderedHeight <= availableHeight) {
        if (top < padding) dy = padding - top;
        else if (bottom > viewportSize.height - padding) dy = viewportSize.height - padding - bottom;
    } else if (bottom < padding) {
        dy = padding - bottom;
    } else if (top > viewportSize.height - padding) {
        dy = viewportSize.height - padding - top;
    }

    if (!dx && !dy) return viewport;
    return { ...viewport, x: viewport.x + dx, y: viewport.y + dy };
}

function ringOffsets(ring: number) {
    if (ring === 0) return [{ x: 0, y: 0 }];
    const offsets: Position[] = [];
    offsets.push({ x: 0, y: ring });
    for (let x = 1; x <= ring; x += 1) offsets.push({ x, y: ring }, { x: -x, y: ring });
    for (let y = ring - 1; y >= -ring; y -= 1) offsets.push({ x: ring, y }, { x: -ring, y });
    for (let x = ring - 1; x >= -ring + 1; x -= 1) offsets.push({ x, y: -ring });
    return offsets;
}

function rectsOverlap(a: CanvasLayoutRect, b: CanvasLayoutRect, gap: number) {
    return a.x < b.x + b.width + gap && a.x + a.width + gap > b.x && a.y < b.y + b.height + gap && a.y + a.height + gap > b.y;
}
