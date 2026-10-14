# 当前工程架构

更新：2026-10-14。产品名“知膳”，团队“天工”。

## 应用与契约

仓库使用 npm workspaces。`apps/web` 保持 Next.js/vinext、React、Cloudflare Worker 与 D1 技术栈；`apps/restaurant-3d` 使用 Three.js/Vite；`tools/sample-provider` 为独立模拟器。本次整理不替换框架、不变更数据库结构。

`packages/contracts` 是 HTTP 类型、校验规则和纯展示标签的唯一源码位置，只有 Zod 运行依赖。`npm ci` 的 postinstall 构建共享包，类型检查、测试和构建命令也先构建该包。应用消费 `@zhishan/contracts/*` 的 JavaScript 和 `.d.ts`，不依赖 Node 对 node_modules 中 TypeScript 的直接执行。

3D 通过 HTTP 读取状态，不导入 Web 内部规则。需要调用双方实现进行比对的测试位于 `tests/integration`；维护数据包的工具脚本可显式跨应用协作，不进入浏览器运行代码。`npm run lint` 检查这条边界及业务模块循环依赖。

## 业务内聚与事务

Web 的 `lib/operations-v2` 中：

- `measurement`：计量规则、证据和轮次推导。
- `serving-projection`：供餐状态与区间计算。
- `task-state`：补菜状态转换、核实依据与角色能力。
- `serving-coordinator`：读取同版状态，协调供餐与补菜，并以原有乐观版本事务一起提交。
- `queries`、`storage`：完整分页读取、受限查询与 D1 原子写入。
- `serving`、`tasks`：请求级权限、输入处理及服务响应；`application` 负责装配。

协调模块依赖规则模块，规则模块不回调 HTTP 服务层。重构保留重试次数、版本冲突、任务幂等、账本精度、审计证据和调度行为。

## 三种数据职责

旧统计画像库、新业务 `OPS_DB`、演示数据与播放会话继续分开。旧历史不能直接当成新业务原始采样，午高峰真值不能作为画像算法已知输入。外部 v1/v2 协议、页面路径、身份校验方式及数据库结构保持不变。

默认完整演示使用 `.demo-state` 中的独立 D1 和随机本机凭证。开发工作台使用 `.business-state` 中的独立 test 业务库。正式业务部署仍需按既有运行手册显式配置独立 `OPS_DB`，不会回退演示数据库。
