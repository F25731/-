# CHANGELOG

## Unreleased

+ [Refactor] Canvas Agent now uses a native server-side function tool loop with Redis Run coordination, same-turn tool results, missing-tool repair, and structured runtime logs.
+ [Layout] Independent tasks use vertical lanes; references, prompts, configs, and results flow left-to-right, with result grids capped at two columns and image ratios preserved.

+ [新增] 画布 Agent 支持 SSE 运行日志、停止当前 turn、会话摘要记忆，并扩展审批工具到批量文本、移动节点、缩放节点、更新选区和调整视口。
+ [调整] 右侧画布助手改为纯画布 Agent，移除助手内生图模式、模型选择、图片设置和生成图插入；Phase 6 暂不开放 Remote MCP Server。
+ [调整] 移除视频/音频生成相关能力：删除 `/video` 工作台、视频模型配置、后端视频代理、画布 Video 节点、视频设置面板和本地媒体存储；画布导入/导出与素材库收窄为文本/图片。

+ [新增] Agent/MCP 改造 Phase 6 改为内置 Canvas Agent Runtime，右侧 Agent 模式会调用已配置模型生成受控画布工具请求，并继续通过审批卡和 Operation 层执行。

+ [新增] Agent/MCP 改造 Phase 5 新增内置 Agent MVP，右侧画布助手在开关开启后支持 Agent 模式、工具审批卡，并通过 Phase 4 Operation 层执行安全画布写操作。
+ [修复] 补齐前端配置、视频、聚合模型和画布节点生成相关类型收窄，Phase 5 开关开启时 `tsc` 与生产构建可通过。

+ [新增] Agent/MCP 改造 Phase 4 新增画布 schema v4、`canvasRevision`、多标签页写锁和可校验 Canvas Operation 层，为后续 Agent/MCP 写画布提供版本冲突与撤销基础。

+ [新增] Agent/MCP 改造 Phase 3 强化参考图上传与图片传输，新增前端 MIME/大小/像素校验、图床上传并发与 hash 去重、代理路由和 Worker 参考图下载 SSRF/重定向/大小/MIME 限制。

+ [新增] Agent/MCP 改造 Phase 2 新增统一 SSE 事件流，图片任务支持 `job.queued/started/succeeded/failed/canceled` 事件，前端可在开关开启后优先订阅事件并自动降级轮询。

+ [新增] 图片任务新增可选 Redis Streams 队列执行链路，支持固定 Worker Pool、加密队列载荷、并发限制、幂等键、取消和 pending 接管。
+ [新增] 建立生产级 Agent/MCP 改造 Phase 0 基线，新增默认关闭的队列、SSE、内置 Agent 和远程 MCP 开关及 Job/Agent 错误码契约。

## v0.1.0 - 2026-05-26

+ [优化] 优化我的画布、我的素材导出功能
+ [修复] 修复画布撤销，配置节点等bug问题

## v0.0.9 - 2026-05-26

+ [新增] 新增视频创作台页面。
+ [修复] 修复图片节点size参数传递问题。

## v0.0.8 - 2026-05-24

+ [新增] 新增用户账号与算力点体系，支持账号密码注册登录、Linux.do OAuth。
+ [新增] 管理后台公开配置支持设置模型算力点、支持计费查询。
+ [新增] 画布右上角展示用户算力点余额，生成按钮会展示本次预计消耗算力点。
+ [新增] 新增视频生成节点。

## v0.0.7 - 2026-05-23

+ [新增] 管理后台提示词管理支持多选批量删除。
+ [新增] 新增定义拉取GitHub提示词源功能。
+ [新增] 新增awesome-gpt-image2-prompts提示词来源。
+ [优化] 优化模型下拉选择样式、优化生图编辑设置

## v0.0.6 - 2026-05-22

+ [新增] 管理后台支持配置模型渠道，前端当前无需鉴权即可直接使用后端渠道能力。
+ [优化] 统一整理后端错误提示、AI 代理、图片节点生成与重试、参考图缺失处理等细节。
+ [优化] 后端模型代理路径调整为 OpenAI 风格。

## v0.0.5 - 2026-05-20

+ [新增] 右上角版本号支持点击查看版本更新弹窗，展示当前版本、最新版本和按时间线整理的更新日志。
+ [新增] 设置弹窗支持配置系统提示词，AI 生图、编辑图和文本请求会自动携带。

## v0.0.4 - 2026-05-20

+ [调整] Docker 运行入口改为 Next.js 对外提供页面，`/api/*` 由 Next.js 代理到内部 Go 服务。
+ [修复] 文本复制在局域网 IP 访问时可能失败的问题。

## v0.0.3 - 2026-05-19

+ [修复] 更新 nanoid 依赖并修改 ID 生成方式，防止其他ip无法使用crypto模块导致的ID生成失败问题。

## v0.0.2 - 2026-05-19

+ [新增] 增加生图工作台功能，支持文生图、图生图、查看历史记录，并增加移动端适配。
+ [修复] 画布生成尺寸控件支持选择更多常用比例，并可直接输入自定义比例。
+ [修复] 生成配置节点恢复拖拽操作，避免面板控件拦截整块节点拖动。
+ [文档] 增加 Render 部署说明。

## v0.0.1 - 2026-05-19

+ [新增] 首次开源版本，包含无限画布能力：多画布项目、节点拖拽缩放、连线、小地图、撤销重做、导入导出。
+ [新增] AI 创作能力：支持 OpenAI 兼容接口的文生图、图生图、参考图编辑和文本问答。
+ [新增] 画布助手能力：支持围绕选中节点和上游节点对话、生图，并把结果插回画布。
+ [新增] 提示词库能力：抓取多个 GitHub 开源项目，按案例整理数百个图片提示词。
