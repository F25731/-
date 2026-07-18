# TODO

本文档记录当前项目后续比较值得处理的事项。

- Phase 6 内置 Canvas Agent Runtime：已改为服务端原生 function tool 循环、Redis Run 协调、同 Turn 多工具、浏览器工具结果回传和任务泳道布局；继续做真实模型与浏览器回归测试。
- 多实例/跨设备协作时，需要把当前浏览器本地写锁升级为服务端 session/lease 或 Redis lease。
