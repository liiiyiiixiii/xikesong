# 知膳 Web 与后端

该工作区包含管理端、厨房端、业务工作台、HTTP API、D1、统计画像及共享演示会话。完整启动请从[仓库 README](../../README.md)开始。

在仓库根目录执行 `npm ci`。日常使用 `npm run dev`、`npm run dev:operations` 或 `npm run demo`，共享契约和数据由根脚本准备；单独调试前先执行 `npm run build:contracts && npm run data:extract`。

根目录可执行 `npm test -w @zhishan/web`、`npm run typecheck -w @zhishan/web`、`npm run lint -w @zhishan/web`、`npm run build -w @zhishan/web`。正式发布执行根目录全量检查，以涵盖 3D 和跨应用契约。

- [当前分层架构](../../docs/ARCHITECTURE.md)
- [业务运行与恢复](docs/software-delivery/OPERATIONS-RUNBOOK.md)
- [硬件交接](docs/software-delivery/HARDWARE-HANDOFF.md)
- [旧称重接入](docs/INTEGRATION.md)、[智能分析](docs/INTELLIGENCE.md)

`lib/operations-v2` 为新业务，`lib/demo-v1` 为最新午高峰共享演示，旧统计画像模块继续保留。`packages/contracts` 位于仓库根目录，原 `lib/contracts` 已迁出。历史文档中的路径和验收记录以其日期为界，不代表当前版本已验收。
