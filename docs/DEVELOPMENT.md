# 开发指南

## 环境与安装

支持 macOS、Linux；Node.js 24、npm 11、Python 3.9+。根目录 `.nvmrc` 固定 Node 主版本；使用 nvm 时先 `nvm use`。在仓库根目录执行 `npm ci`，不要在子应用创建独立锁文件。共享契约在安装后自动编译。

直接依赖以原锁定版本为基础，纳入已确认的兼容安全更新；共享依赖由根 `package-lock.json` 锁定。安全更新及剩余审计条目见 [安全更新记录](SECURITY-UPDATE.md)。`.npmrc` 使用 npm 官方仓库；企业代理和证书由使用者在自己的环境配置，不关闭 TLS 验证。

## 命令与端口

`npm run dev` 启动 Web（5173）、空白 test 业务工作台（5183）、3D（4173）。`npm run dev:operations` 启动同一组服务并打开工作台。`npm run demo` 启动构建后的独立完整演示（Web 5273、3D 4273）。端口冲突直接报错。开发端口可以用 `WEB_PORT`、`OPS_PORT`、`THREE_PORT` 调整。

共享契约变更后执行 `npm run build:contracts`，再重启应用。运行 `npm run typecheck`、`npm run lint`、`npm test`、`npm run build` 检查更改。共享包只放跨应用协议与无副作用的展示规则。

## 配置与私密信息

- Web 的 `.env.example` 说明可选模型配置；开发启动会生成本地调度及加密密钥。
- 完整演示凭证和数据库位于 `.demo-state`；工作台初始凭证位于 `.business-state/connection.json`。
- 模拟器支持 `SCALE_BASE_URL`、`SCALE_DEVICE_TOKEN`；`SCALE_ENV_FILE` 可指定独立凭证文件。默认演示使用 `.demo-state/provider.env`。
- 3D 的 `DEMO_API_TARGET` 与 `OPERATIONS_API_TARGET` 分别指定演示和业务代理，默认 Web 为 5173。
- 实际业务接入使用 `OPS_V2_ENVIRONMENT`、`OPS_V2_DATABASE_ID` 和服务端 bootstrap 凭证，见业务运行手册。

不要提交 `.env`、数据库、连接凭证、模型密钥或带私密值的诊断输出。示例中只保留空值或占位符。

## 构建与部署边界

`npm run build` 构建共享包、Worker/Web 及 3D。数据先通过清单校验后提取，编译不重新生成菜单或场景。3D 输出是 HTTP 静态资源，正式部署必须配置 API 代理；本仓库本次整理不执行云部署。

## 浏览器验证

`tests/browser` 保留对应日期与场景的历史浏览器脚本，其中一些有严格的日期、菜单及页面状态前提，不应直接对生产实例运行。当前基础 HTTP 链路使用根目录 `demo:smoke`；启动隔离演示后执行 `npx playwright install chromium`、`npm run demo:browser` 验证实际页面。也可通过 `PLAYWRIGHT_EXECUTABLE_PATH` 指定已安装的 Chromium/Chrome。已有历史通过记录不能代替新版本结果。
