# Agent/MCP 改造 Phase 1 图片任务队列

Phase 1 将图片任务的可选执行链路改为 Redis Streams + 固定 Worker Pool。开关默认关闭，未开启时仍沿用原来的创建后 goroutine 执行方式。

## 本阶段理解与不做事项

- 本阶段只处理图片任务队列，不启用统一 SSE。
- 本阶段不改变画布和详情图项目的本地保存方式。
- 本阶段不开放 Agent 写操作，不接 MCP。
- 本阶段不改变额度结算逻辑。

## 变更文件清单

- `config/config.go`：新增图片队列与并发相关环境变量。
- `repository/redis.go`：新增 Redis Streams、`SET NX` 和 RESP 数组解析能力。
- `service/image_jobs.go`：接入队列开关、取消状态、可取消上下文和参考图下载并发槽。
- `service/image_queue.go`：新增 Redis Streams 入队、加密 payload、固定 Worker Pool、并发限制、重试、取消和 pending 接管。
- `handler/image_jobs.go`、`router/router.go`：新增取消接口。
- `web/src/services/api/image.ts`：识别 `canceled` 状态并提供取消 API。
- `web/src/app/api/image-jobs/cancel/[id]/route.ts`：新增 Next.js 代理路由。
- `repository/redis_test.go`、`service/image_queue_test.go`：新增队列基础测试。

## 新增配置

```env
ENABLE_IMAGE_QUEUE_V2=false
IMAGE_WORKERS=32
IMAGE_GLOBAL_CONCURRENCY=32
IMAGE_PER_USER_CONCURRENCY=4
IMAGE_PER_MODEL_CONCURRENCY=12
REFERENCE_DOWNLOAD_CONCURRENCY=16
IMAGE_JOB_TIMEOUT_SECONDS=480
```

## 队列设计

- Stream：`queue:image-jobs:v2`
- Consumer group：`image-workers`
- 消费模式：`XREADGROUP GROUP image-workers <consumer> STREAMS queue:image-jobs:v2 >`
- Pending 接管：worker 使用 `XAUTOCLAIM` 接管超过 `IMAGE_JOB_TIMEOUT_SECONDS + 60` 秒未 ack 的消息。
- 入队 payload：使用 `JWT_SECRET` 派生 AES-GCM key 加密，Redis stream 不保存明文 API token。
- 并发控制：固定 worker 数 + 进程内全局/用户/模型信号量。
- 幂等：支持 `Idempotency-Key`，同一 kind、token、幂等键会复用已有任务。
- 取消：`POST /api/image-jobs/cancel/:id` 会把任务置为 `canceled`，运行中的队列任务会触发 context cancel。

## 对现有本地存储行为的影响

无。

## 回滚方式

- 保持 `ENABLE_IMAGE_QUEUE_V2=false` 即可回到旧执行链路。
- 如需删除代码，可移除 `service/image_queue.go`、`repository/redis_test.go`、`service/image_queue_test.go`、取消路由和新增 Redis Stream 方法，并将 `service/image_jobs.go` 恢复到直接 `go runImageJob(...)`。

## 下一阶段前仍存在的风险

- 统一 SSE 尚未接入，前端仍通过轮询读取队列任务状态。
- 并发限制目前是进程内信号量，多实例全局公平性仍需 Phase 2/后续引入 Redis 分布式信号量。
- 队列 payload 依赖稳定 `JWT_SECRET` 解密；生产环境必须配置固定密钥，不能使用启动时随机密钥。
