"use client";

import { Button } from "antd";
import { ArrowLeft, ArrowRight } from "lucide-react";

import type { CanvasTheme } from "@/lib/canvas-theme";
import type { NodeGenerationInput } from "./canvas-node-generation";

type CanvasReferenceStripProps = {
    inputs: NodeGenerationInput[];
    theme: CanvasTheme;
    onMove: (input: NodeGenerationInput, offset: number) => void;
};

export function CanvasReferenceStrip({ inputs, theme, onMove }: CanvasReferenceStripProps) {
    const imageInputs = inputs.filter((input) => input.type === "image" && input.image);
    if (!imageInputs.length) return null;

    return (
        <div className="thin-scrollbar mb-2 flex max-w-full cursor-default gap-1.5 overflow-x-auto pb-1" onMouseDown={(event) => event.stopPropagation()} onPointerDown={(event) => event.stopPropagation()}>
            {imageInputs.map((input, index) => (
                <div key={input.nodeId} className="w-[72px] shrink-0 overflow-hidden rounded-lg border" style={{ background: theme.node.fill, borderColor: theme.node.stroke }}>
                    <div className="relative">
                        <img src={input.image!.dataUrl} alt={input.title} className="aspect-square w-full object-cover" />
                        <span className="absolute left-1 top-1 rounded bg-black/60 px-1 py-0.5 text-[9px] font-semibold text-white">图{index + 1}</span>
                        <div className="absolute inset-x-1 bottom-1 flex justify-between">
                            <Button size="small" className="!h-5 !w-5 !min-w-5 !rounded-full !bg-white/85 !p-0 !shadow-sm" icon={<ArrowLeft className="size-3" />} disabled={index <= 0} onClick={() => onMove(input, -1)} />
                            <Button size="small" className="!h-5 !w-5 !min-w-5 !rounded-full !bg-white/85 !p-0 !shadow-sm" icon={<ArrowRight className="size-3" />} disabled={index >= imageInputs.length - 1} onClick={() => onMove(input, 1)} />
                        </div>
                    </div>
                </div>
            ))}
        </div>
    );
}
