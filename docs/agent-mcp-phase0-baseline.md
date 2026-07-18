# Agent/MCP 改造 Phase 0 基线

本文档记录生产级本地画布 + 队列 + Agent/MCP 改造启动时的代码基线。Phase 0 只建立开关、错误码和回归对照，不改变现有业务行为。

## 本阶段理解与不做事项

- 不改画布本地保存方式，画布项目仍由浏览器 localForage/IndexedDB 保存。
- 不把图片任务切到 Redis Streams，现阶段仍沿用旧的创建后执行流程。
- 不启用统一 SSE，不替换前端图片任务轮询。
- 不接入内置 Agent，不开放 MCP 写操作。
- 不拆 `canvas-client-page.tsx` 和 `detail/page.tsx`。

## 已检查的当前项目文件

- `service/image_jobs.go`：当前 `CreateImageJob` 保存任务后直接启动 `go runImageJob(...)`。
- `handler/image_jobs.go`：当前只有创建、状态查询、结果读取接口。
- `repository/redis.go`：当前 Redis 封装只提供基础 `GET` / `SET` / `PING`。
- `web/src/services/api/image.ts`：当前 `requestImageJob` 创建任务后通过 `pollImageJob` 查询状态。
- `web/src/app/(user)/canvas/[id]/canvas-client-page.tsx`：当前承载画布主体、生成、恢复任务和撤销逻辑。
- `web/src/app/(user)/canvas/components/canvas-assistant-panel.tsx`：当前是画布侧生图助手，不是生产 Agent 面板。
- `web/src/app/(user)/detail/page.tsx`：当前详情图工作台状态和业务流程集中在页面内。
- `service/codex_responses.go`：当前是无工具的 Responses 转发，明确禁止工具调用。

## 参考原项目的文件及只借鉴的设计

- `canvas-agent/src/schemas.ts`：借鉴工具名、schema 分层和白名单思路，不照搬过宽工具面。
- `canvas-agent/src/canvas-session.ts`：借鉴浏览器在线桥接和 tool result 回传思路。
- `web/src/pages/canvas/hooks/use-agent-bridge.ts`：借鉴快照、apply、undo 的桥接边界。
- `web/src/lib/canvas/canvas-agent-ops.ts`：借鉴纯函数式 canvas operation 层。
- `web/src/stores/use-agent-store.ts`：借鉴 Agent UI 状态分层。

## 当前基线

- 图片任务状态：`pending -> running -> succeeded | failed`。
- 图片任务执行：单次创建直接启动 goroutine；没有真实队列、consumer group、取消、幂等键或公平调度。
- 图片任务恢复：前端保存 `imageJobId`，刷新后通过状态接口轮询恢复。
- 图片任务进度：前端 1 秒级轮询，未使用 SSE。
- Redis 用途：保存任务状态、结果二进制、worker 心跳；没有 Streams/PubSub/分布式信号量。
- 图片传输：成功响应中如果只有 base64，后端会把二进制拆到 `/api/image-jobs/result/:id/:index`；状态接口保持轻量 JSON。
- 详情图项目：使用 `detail_projects` localForage store，本地保存，上传中状态序列化为失败。
- 画布项目：使用 `infinite-canvas:canvas_store` localForage 持久化，当前没有 schemaVersion 和 project revision。

## 已建立的默认关闭开关

后端环境变量：

```env
ENABLE_IMAGE_QUEUE_V2=false
ENABLE_UNIFIED_SSE=false
ENABLE_BUILTIN_AGENT=false
ENABLE_REMOTE_MCP=false
```

前端环境变量：

```env
NEXT_PUBLIC_ENABLE_IMAGE_QUEUE_V2=false
NEXT_PUBLIC_ENABLE_UNIFIED_SSE=false
NEXT_PUBLIC_ENABLE_BUILTIN_AGENT=false
NEXT_PUBLIC_ENABLE_REMOTE_MCP=false
```

## 已建立的错误码基线

- Job：`JOB_UNSUPPORTED_TYPE`、`JOB_MISSING_API_KEY`、`JOB_NOT_FOUND`、`JOB_RESULT_INVALID`、`JOB_INVALID_BASE64_RESULT`、`JOB_REFERENCE_DOWNLOAD_FAILED`、`JOB_REFERENCE_URL_INACCESSIBLE`、`JOB_REFERENCE_TOO_LARGE`
- Agent：`AGENT_CANVAS_OFFLINE`、`AGENT_TOOL_INVALID`、`AGENT_TOOL_TIMEOUT`、`AGENT_APPROVAL_REQUIRED`、`AGENT_PERMISSION_DENIED`、`AGENT_REVISION_MISMATCH`、`AGENT_TOOL_CALL_DUPLICATE`

当前 HTTP 响应结构仍保持 `{ code, data, msg }`，错误码先作为服务端和前端的契约基线，不改变用户可见行为。

## 对现有本地存储行为的影响

无。

## 回滚方式

- 删除 `config.Config` 中新增的四个开关字段。
- 删除 `service/error_codes.go`、`service/error_codes_test.go` 和 `web/src/services/api/error-codes.ts`。
- 将 `service/image_jobs.go` 中的 `newSafeMessageError(...)` 恢复为原来的 `safeMessageError{message: ...}`。
- 将 `web/src/constant/env.ts` 中的 `readBoolEnv` 和 `FEATURE_FLAGS` 删除。

## 下一阶段前仍存在的风险

- Phase 1 需要扩展 Redis 能力；建议引入成熟 Redis 客户端或至少补完整数组响应解析，否则 Streams 实现风险较高。
- 真实队列上线前，仍可能出现单机大量 goroutine 并发执行图片任务。
- 统一 SSE 上线前，前端仍依赖轮询恢复任务状态。
- Agent 写操作上线前必须先补 `canvasRevision` 和可撤销 operation 层。
