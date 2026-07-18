# Agent/MCP 改造 Phase 4 画布版本与 Operation 层

Phase 4 为后续内置 Agent/MCP 写画布建立安全底座：画布项目开始携带 schema 版本、内容 revision、多标签页写锁，并新增可校验的 Canvas Operation 纯函数层。当前阶段仍不开放 Agent 写操作。

## 本阶段范围

- 画布项目 schema 升级到 v4。
- 每个项目新增 `schemaVersion`、`canvasRevision`、`lastSavedAt`、`lastWriterTabId`。
- 旧 localForage 数据和旧 zip 导入会自动 normalize，不要求用户迁移。
- 导出 zip 版本升级到 `version: 4`。
- 新增 `applyCanvasOperation(project, operation, expectedRevision)`，支持节点/连线增删改和整画布替换。
- 新增 `applyProjectOperation` store 入口，后续 Agent/MCP 必须通过 expectedRevision 调用。
- 新增浏览器标签页写锁；同一画布只允许一个活跃标签页持久化，副标签页会提示并停止覆盖保存。

## 变更文件清单

- `web/src/app/(user)/canvas/stores/use-canvas-store.ts`：项目 schema/revision、迁移、写入校验、operation store 入口。
- `web/src/app/(user)/canvas/utils/canvas-operations.ts`：可撤销 Canvas Operation 纯函数层。
- `web/src/app/(user)/canvas/utils/canvas-tab-lock.ts`：多标签页本地写锁。
- `web/src/app/(user)/canvas/[id]/canvas-client-page.tsx`：接入写锁并阻止副标签页自动持久化。
- `web/src/app/(user)/canvas/export-types.ts`、`web/src/app/(user)/canvas/utils/canvas-export.ts`：导出版本升级到 v4。

## Operation 契约

当前支持：

```ts
canvas.addNode
canvas.updateNode
canvas.removeNodes
canvas.addConnection
canvas.removeConnections
canvas.replaceDocument
```

调用方需要传入 `expectedRevision`。如果项目当前 `canvasRevision` 不一致，operation 会失败，后续 Agent 应返回 `AGENT_REVISION_MISMATCH` 并重新读取画布状态。

## 回滚方式

- 旧项目数据仍兼容；如需关闭 Phase 4 写锁，可移除 `canvas-client-page.tsx` 的 `startCanvasProjectLock` 接入。
- 如需回滚 operation 层，可删除 `canvas-operations.ts` 和 store 中的 `applyProjectOperation`，现有 UI 路径仍可继续通过 `updateProject` 保存。

## 下一阶段前仍存在的风险

- 页面内部大量交互仍直接使用 React `setNodes/setConnections`，只是持久化层带 revision；后续 Agent 写操作必须走 operation 入口，不能复用这些局部 setter。
- 多标签页锁是浏览器本地锁，不是跨设备/跨浏览器锁。
- 还没有 Agent 审批面板和 tool result 回传。
