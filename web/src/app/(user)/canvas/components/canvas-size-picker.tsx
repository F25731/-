"use client";

import { useEffect, useRef, useState } from "react";
import { Select } from "antd";

import { IMAGE_ASPECT_OPTIONS } from "@/constant/image-model-options";
import { cn } from "@/lib/utils";

const sizeOptions = IMAGE_ASPECT_OPTIONS.map((item) => item.value);
const sizeLabels: Record<string, string> = Object.fromEntries(IMAGE_ASPECT_OPTIONS.map((item) => [item.value, `${item.label} ${item.description}`]));

type CanvasSizePickerProps = {
    value: string;
    className?: string;
    onChange: (value: string) => void;
};

export function CanvasSizePicker({ value, className, onChange }: CanvasSizePickerProps) {
    const rootRef = useRef<HTMLDivElement>(null);
    const [open, setOpen] = useState(false);
    const [search, setSearch] = useState("");
    const extraOptions = [value, search.trim()].filter((item) => item && !sizeOptions.includes(item as (typeof sizeOptions)[number]));
    const options = [...sizeOptions, ...Array.from(new Set(extraOptions))].map((size) => ({ value: size, label: sizeLabels[size] || size }));
    const selectSize = (next: string) => {
        onChange(next.trim());
        setSearch("");
        setOpen(false);
    };

    useEffect(() => {
        if (!open) return;
        const close = (event: PointerEvent) => {
            const target = event.target instanceof Element ? event.target : null;
            if (target && (rootRef.current?.contains(target) || target.closest(".ant-select-dropdown"))) return;
            setOpen(false);
        };
        window.addEventListener("pointerdown", close, true);
        return () => window.removeEventListener("pointerdown", close, true);
    }, [open]);

    return (
        <div ref={rootRef} className={className}>
            <Select
                showSearch
                open={open}
                className={cn("canvas-compact-control canvas-control-select h-full w-full")}
                value={value || undefined}
                searchValue={search}
                placeholder="比例"
                options={options}
                popupMatchSelectWidth={false}
                popupRender={(menu) => (
                    <div onMouseDown={(event) => event.stopPropagation()} onPointerDown={(event) => event.stopPropagation()}>
                        {menu}
                    </div>
                )}
                onOpenChange={setOpen}
                onSearch={setSearch}
                onChange={selectSize}
                onBlur={() => {
                    if (search.trim()) selectSize(search);
                }}
                onInputKeyDown={(event) => {
                    if (event.key === "Enter" && search.trim()) selectSize(search);
                }}
            />
        </div>
    );
}
