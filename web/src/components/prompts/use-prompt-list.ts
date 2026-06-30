"use client";

import { useMemo } from "react";
import { useInfiniteQuery } from "@tanstack/react-query";

import { ALL_PROMPTS_OPTION, fetchPrompts } from "@/services/api/prompts";

export const PROMPT_PAGE_SIZE = 20;
const IMAGE_2_PROMPT_CATEGORY = "gpt-image-2-prompts";

export function usePromptList({ keyword, tags, category, enabled = true }: { keyword: string; tags: string[]; category: string; enabled?: boolean }) {
    const activeCategory = category === ALL_PROMPTS_OPTION ? IMAGE_2_PROMPT_CATEGORY : category;
    const query = useInfiniteQuery({
        queryKey: ["prompts", keyword, tags, activeCategory],
        queryFn: ({ pageParam }) => fetchPrompts({ keyword, tag: tags, category: activeCategory, page: pageParam, pageSize: PROMPT_PAGE_SIZE }),
        initialPageParam: 1,
        getNextPageParam: (lastPage, pages) => (pages.reduce((total, page) => total + page.items.length, 0) < lastPage.total ? pages.length + 1 : undefined),
        enabled,
    });
    const firstPage = query.data?.pages[0];
    return {
        query,
        items: useMemo(() => query.data?.pages.flatMap((page) => page.items) || [], [query.data?.pages]),
        tags: useMemo(() => [ALL_PROMPTS_OPTION, ...(firstPage?.tags || [])], [firstPage?.tags]),
        categories: useMemo(() => firstPage?.categories || [IMAGE_2_PROMPT_CATEGORY], [firstPage?.categories]),
        total: firstPage?.total || 0,
    };
}
