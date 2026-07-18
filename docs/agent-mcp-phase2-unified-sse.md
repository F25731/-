# Agent/MCP 改造 Phase 2 统一 SSE 事件流

Phase 2 新增统一事件通道，先承载图片任务状态事件，并为后续内置 Agent 与 MCP tool call 事件预留同一协议。开关默认关闭，未开启前前端仍使用原 1 秒轮询。

## 本阶段范围

- 新增 `GET /api/events?topics=image-job&jobId=...` SSE 端点。
- 图片任务发布 `job.queued`、`job.started`、`job.succeeded`、`job.failed`、`job.canceled`。
- 前端在 `NEXT_PUBLIC_ENABLE_UNIFIED_SSE=true` 时优先使用 SSE，失败后自动回退到原状态轮询。
- 保留 `GET /api/image-jobs/status/:id` 作为兼容 fallback。
- SSE 只传 JSON 元数据和结果 URL，不传 base64 图片正文。

## 变更文件清单

- `service/events.go`：新增内存事件总线、短期回放、topic/job 过滤与事件契约。
- `handler/events.go`：新增 SSE handler、heartbeat、`Last-Event-ID` 回放入口。
- `router/router.go`：挂载 `/api/events`。
- `service/image_jobs.go`、`service/image_queue.go`：在图片任务状态变化时发布事件。
- `web/src/app/api/events/route.ts`：新增 Next.js 同源 SSE 代理。
- `web/src/services/api/image.ts`：图片任务优先订阅 SSE，自动降级轮询。
- `service/events_test.go`：覆盖事件过滤、回放和 `Last-Event-ID`。

## 新增配置

```env
ENABLE_UNIFIED_SSE=false
NEXT_PUBLIC_ENABLE_UNIFIED_SSE=false
```

## 事件格式

```json
{
  "id": "20260717120000.000000000-random",
  "type": "job.succeeded",
  "topic": "image-job",
  "timestamp": 1780000000000,
  "jobId": "image-job-id",
  "payload": {
    "id": "image-job-id",
    "status": "succeeded",
    "data": {}
  }
}
```

## 回滚方式

- 保持 `ENABLE_UNIFIED_SSE=false` 和 `NEXT_PUBLIC_ENABLE_UNIFIED_SSE=false` 即回到原轮询路径。
- 如需移除代码，可删除 `service/events.go`、`handler/events.go`、`web/src/app/api/events/route.ts` 和事件发布调用，并恢复 `web/src/services/api/image.ts` 的 `pollImageJob` 调用。

## 下一阶段前仍存在的风险

- 当前事件回放是单进程内存队列；多实例生产部署需要继续接 Redis Streams/PubSub 做跨实例分发。
- Agent 事件类型已预留，但还没有内置 Agent runtime、工具审批或 MCP Server。
- 画布写操作仍未开放；Phase 4 前必须先补 `canvasRevision` 和可撤销 Canvas Command/Operation 层。
