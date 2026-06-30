import type { NextRequest } from "next/server";

import { getImageJob } from "@/server/image-jobs/store";

export const runtime = "nodejs";

type RouteContext = {
    params: Promise<{ id: string }>;
};

export async function GET(_request: NextRequest, context: RouteContext) {
    const { id } = await context.params;
    const job = getImageJob(id);
    if (!job) {
        return Response.json({ code: 1, data: null, msg: "Image job not found or expired" }, { status: 404 });
    }
    return Response.json({ code: 0, data: job, msg: "ok" });
}
