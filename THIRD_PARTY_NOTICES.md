# 第三方组件与许可证

根目录 LICENSE 仅声明可适用原创内容的权利，不替代第三方许可。

| 随源码保留的来源 | 原署名 | 许可文本 |
| --- | --- | --- |
| Sites 构建插件 | Copyright (c) 2026 OpenAI | [MIT](apps/web/build/sites-vite-plugin.LICENSE) |
| shadcn Tailwind 样式 | Copyright (c) 2023 shadcn | [MIT](apps/web/vendor/shadcn-tailwind-4.13.0.LICENSE.md) |

项目使用 React、Next.js/vinext、Vite、Three.js、Cloudflare 工具、Drizzle、Zod、Lucide、Tailwind 和 Playwright 等依赖。根 `package-lock.json` 锁定完整依赖；[机器可读许可证清单](docs/dependency-licenses.json)记录锁文件与已安装元数据中的版本和许可标识，包括可选平台包。

依赖元数据包括 MIT、ISC、BSD、Apache-2.0、MPL-2.0、LGPL-3.0-or-later、CC0、CC-BY 等不同许可及组合表达式。字体、图标、原生图像库和工具链各自保有其署名与条件；不能将它们统一声明为本项目所有或 UNLICENSED。安装取得的第三方包保留其原始许可文件，本仓库不附 node_modules 或第三方编译二进制。

若另外分发构建产物或原生依赖，应针对实际分发内容核对对应许可义务。该清单是依赖元数据核查记录，不是第三方权属或法律合规的认证。品牌素材和原有截图来源见 [NOTICE.md](NOTICE.md)。
