# Agent/MCP 改造 Phase 3 图片传输生产化

Phase 3 强化参考图上传、图片代理和 Worker 侧参考图下载边界，目标是避免大图/base64 在 Redis、SSE、Agent prompt 和 JSON 状态里来回传，同时限制 SSRF、超大文件、错误 MIME 和无限重定向风险。

## 本阶段范围

- 前端参考图上传前校验 MIME、文件大小和像素数量。
- 多参考图补传图床时限制固定并发，避免 20 张图同时上传/下载。
- 参考图按内容 hash 去重，重复图片复用已有图床 URL 或同一个进行中的上传任务。
- Next.js `/api/image-fetch` 和 `/api/media-fetch` 增加 URL 安全校验、DNS 私网阻断、最多 3 次重定向、响应大小上限和流式读取限制。
- Next.js `/api/image-bed/upload` 增加图片 MIME 和 40MB 文件大小限制。
- Go 图片任务 Worker 下载参考图时限制 URL、DNS 私网地址、重定向次数、MIME 和响应大小。

## 变更文件清单

- `web/src/services/image-bed.ts`：参考图数量、MIME、大小、像素、并发、hash 去重和图床 URL 缓存。
- `web/src/app/api/image-bed/upload/route.ts`：图床上传入口增加文件类型和大小校验。
- `web/src/app/api/image-fetch/route.ts`：图片代理增加 SSRF、重定向、MIME 和大小限制。
- `web/src/app/api/media-fetch/route.ts`：媒体代理增加 SSRF、重定向、MIME 和大小限制。
- `service/image_jobs.go`：Worker 参考图下载增加 URL/DNS/IP、重定向、MIME 和大小限制。
- `service/image_jobs_test.go`：覆盖本地/私网参考图 URL 阻断。

## 当前限制

- 画布项目仍按原设计保存在浏览器 IndexedDB/localForage，没有改成服务端项目存储。
- 生成结果如果上游直接返回 URL，仍保留 URL；如果只返回 `b64_json`，继续拆到 `/api/image-jobs/result/:id/:index`，状态 JSON 不保存大 base64。
- 跨实例事件分发、对象存储签名 URL 和资产生命周期管理还未完成，后续可在 Agent/MCP 正式开放前继续增强。

## 回滚方式

- 前端可恢复 `web/src/services/image-bed.ts` 中的直接 `Promise.all` 上传逻辑。
- 可移除代理路由和 Worker 的 URL/DNS/MIME/大小校验，但不建议在生产环境回滚这些安全边界。

## 验收重点

- 本地上传、粘贴和历史参考图补传仍能生成。
- 超过 40MB、非图片 MIME、超大像素图片会在上传/读取前失败。
- `127.0.0.1`、`localhost`、私网 IP、超过 3 次重定向的参考图 URL 会被拒绝。
- 多张参考图上传时浏览器不会同时发起无上限请求。
