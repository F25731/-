import type { NextRequest } from "next/server";

import { submitToolResult } from "../../../runtime/run-registry";
import type { AgentToolResult } from "../../../runtime/types";

export const runtime = "nodejs";

type RouteContext = {
    params: Promise<{ runId: string }>;
};

export async function POST(request: NextRequest, context: RouteContext) {
    const { runId } = await context.params;
    const payload = (await request.json().catch(() => null)) as { toolCallId?: string; result?: AgentToolResult } | null;
    const toolCallId = String(payload?.toolCallId || "").trim();
    const result = payload?.result;
    if (!toolCallId || !result || typeof result.ok !== "boolean" || typeof result.message !== "string") {
        return Response.json({ code: 1, data: null, msg: "工具执行结果无效" }, { status: 400 });
    }
    const accepted = await submitToolResult(runId, toolCallId, result);
    if (!accepted) return Response.json({ code: 1, data: null, msg: "Agent Run 不存在或已结束" }, { status: 409 });
    return Response.json({ code: 0, data: { accepted: true }, msg: "ok" });
}
