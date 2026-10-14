# 2026-10-14 依赖安全更新记录

本次根据项目提供者确认纳入兼容范围内的安全更新，保留现有框架和外部接口。根锁文件固定实际安装版本；审计结果只反映执行时 npm 公告数据库，不能等同于没有安全风险。

## 已更新

- Next.js 与 eslint-config-next：16.3.4 → 16.3.8。
- React、React DOM、React Server Components：19.2.8。
- Web Vite：8.0.13 → 8.0.16。
- Cloudflare Vite 插件与 Wrangler：同一主版本内更新到 1.49.0、4.151.0，构建产物启用 `new_module_registry`，修复构建产物中 `import.meta.url` 的本地运行兼容问题。
- 开发 Vite 插件固定在兼容的 1.49.0，避免 1.64.0 间接引入的 Miniflare 5 模块回退协议不兼容；保留热更新及原框架。
- 直接使用的 Miniflare API 保持 4.x，明确声明 4.20260730.0；Wrangler 自己管理其内部运行时依赖，不让业务启动器隐式依赖 Wrangler 的内部版本。
- 根 overrides 固定 `ws 8.21.0`、`undici 7.29.1`、`sharp 0.35.5`、`image-size 2.0.3`，并核对锁文件中所有副本。

相关上游资料：[Next.js 公告](https://github.com/advisories/GHSA-vcvr-r3jv-pc5j)、[React 公告](https://github.com/advisories/GHSA-wx67-qw84-cm4g)、[Cloudflare 模块加载说明](https://blog.cloudflare.com/workers-module-registry-nodejs/)。

## 尚未消除的上游问题

`npm audit --omit=dev` 的生产依赖审计为 0 个已知漏洞。完整依赖审计仍报告 12 个受影响条目（8 high、4 moderate、0 critical），来自以下两条依赖链。同一漏洞会令多个上游包被计数，因此这些条目不是 12 个独立漏洞。

| 根因 | 涉及范围 | 本轮处理 |
| --- | --- | --- |
| [braces 深度嵌套模式导致栈耗尽](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm) | ESLint / vinext 构建插件 → fast-glob → micromatch → braces 3.0.3 | 公告与 npm 仓库暂无已修补版本，保留并记录；不接受来自不可信用户的构建 glob 配置 |
| [旧 esbuild 开发服务器跨站读取](https://github.com/advisories/GHSA-67mh-4wv8-2f99) | drizzle-kit → @esbuild-kit/esm-loader → core-utils → esbuild 0.18.20 | 属于数据库生成工具的旧依赖链；本项目启动命令不启动此 esbuild 的 serve 服务。保留工具版本，不执行 npm 建议的跨版本降级 |

`npm audit fix --force` 给出的 eslint-config-next 14、drizzle-kit 0.18、vinext 0.0 等变更超出本轮兼容更新范围，未采用。替换框架、迁移这类工具或自行修改第三方源码，需要另行讨论与验证。

当前开发启动器绑定本机回环地址；真实生产部署仍需按实际服务、配置和访问方式重新评估。未把“未发现现有调用路径触发”写成漏洞已修复。复核命令：`npm audit`、`npm audit --omit=dev`。
