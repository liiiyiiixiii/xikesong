# 浏览器检查脚本

从 red-koala-suite 根目录运行脚本。需自行安装 Playwright 及 Chromium（例如 `npm install --no-save --package-lock=false playwright`，然后 `npx playwright install chromium`）。可用 PLAYWRIGHT_EXECUTABLE_PATH 指定现有浏览器。

脚本连接本地 5173 服务，并依赖各文件内指定日期的合成场景、菜单与页面状态；本次源码交付没有附带该运行数据，未重新执行这些端到端检查。截图输出到 ui-preview，异常验证结果写入 sample-provider/output。脚本不代表通用新库冒烟测试。
