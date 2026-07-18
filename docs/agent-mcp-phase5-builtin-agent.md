# Agent/MCP 改造 Phase 5 内置 Agent MVP

Phase 5 新增网页内置 Agent 的最小闭环：用户在画布助手里切换到 Agent 模式后，Agent 读取当前画布摘要，生成结构化工具请求；用户审批后，工具才通过 Phase 4 的 Canvas Operation 层写入画布。

## 开关

```env
ENABLE_BUILTIN_AGENT=false
NEXT_PUBLIC_ENABLE_BUILTIN_AGENT=false
```

开关关闭时，右侧助手保持原来的生图模式，不显示 Agent 模式。

## 本阶段范围

- 画布助手新增 Agent 模式入口。
- Agent 消息支持携带 `toolRequest` 审批卡。
- 审批卡展示工具名、描述和 `expectedRevision`。
- 批准后调用 Phase 4 `applyCanvasOperation`，失败时把错误写回消息。
- 当前支持的安全工具：
  - `canvas.addNode`：根据“添加/新增/创建/插入文本...”创建文本节点。
  - `canvas.removeNodes`：根据“删除/删掉/移除...”删除当前选中节点。
- 未匹配到安全工具时，Agent 只返回画布摘要，不执行写操作。

## 变更文件清单

- `web/src/app/(user)/canvas/types.ts`：新增 `CanvasAgentToolRequest` 和 Agent 消息模式。
- `web/src/app/(user)/canvas/components/canvas-assistant-panel.tsx`：新增 Agent 模式、工具审批卡、批准/拒绝回写。
- `web/src/app/(user)/canvas/[id]/canvas-client-page.tsx`：新增审批后应用工具请求的 bridge。
- `web/src/app/(user)/canvas/stores/use-canvas-store.ts`：修正 `canvasRevision` 语义，聊天记录保存不再递增画布内容 revision。
- `web/src/stores/use-config-store.ts`、`web/src/services/api/image.ts` 等：补齐前端类型收窄，保证 Agent 开关开启时完整类型检查通过。

## 使用方式

1. 打开 `NEXT_PUBLIC_ENABLE_BUILTIN_AGENT=true`。
2. 打开画布右侧助手。
3. 切换到 Agent。
4. 示例：
   - `添加文本节点：这里写一段说明`
   - 先选中节点，再输入 `删除选中节点`
5. 查看审批卡，点击“批准”后才会修改画布。

## 测试结果

```bash
cd web
npm install --no-package-lock --legacy-peer-deps
npx tsc --noEmit --pretty false
NEXT_PUBLIC_ENABLE_BUILTIN_AGENT=true npm run build
git diff --check
```

- `npx tsc --noEmit --pretty false`：通过。
- `NEXT_PUBLIC_ENABLE_BUILTIN_AGENT=true npm run build`：通过。
- `git diff --check`：通过，仅输出 Git CRLF 提示。
- 本机缺少 `go` 和 `bun`，Go 测试与 Bun 原生命令未执行；前端依赖通过 npm `--legacy-peer-deps` 安装，因为当前 `antd@6` 与 `@ant-design/pro-components@3.0.0-beta.3` 的 peer 声明不一致。

## 回滚方式

- 关闭 `NEXT_PUBLIC_ENABLE_BUILTIN_AGENT` 即可隐藏 Agent 模式，恢复原画布助手生图入口。
- 如需代码级回滚，可撤销本阶段涉及的 Agent UI、`CanvasAgentToolRequest` 类型和 `applyAgentToolRequest` bridge 改动；Phase 4 的 operation 层可保留。

## 仍未完成

- 还没有接入真正的 LLM tool-calling runtime。
- 还没有服务端 Agent Gateway、会话审计和 SSE 增量消息。
- 还没有 MCP Server；外部 Codex/Claude 仍不能直接通过 MCP 控制画布。
- 当前工具范围很窄，目的是先验证审批、revision 和 operation 链路。
