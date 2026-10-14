# 验收记录

日期：2026-10-04，Asia/Shanghai。

## 当前版本

- `npm test`：10 项通过；包括 600 秒固定时间步模拟，66 位顾客到店、58 位离店，餐盘始终 42 只，菜种固定。
- 牛肉卷逐份从 3 → 2 → 1 → 0，空盘保留；空盘回厨房补满且 ID、菜种和间距不变。
- 两位厨师均执行 walk / fetch / chop / cook / plate，连续路径测试通过；移动范围分别为 2.2 和 2.4 个世界单位。
- 座位锅内状态只跟随实际就餐状态。测试覆盖已预留但未入座、坐下、离座但尚未释放预留的三个关键阶段。
- `npm run build`：TypeScript 检查和 Vite 构建通过。Three.js 供应商包约 523 KB，构建有体积提示，无构建错误。

## 实际浏览器

- 本地生产预览：`http://127.0.0.1:4173/`。
- 品牌、厨师与餐盘修改后的 Chrome 持续采样 99.6 秒、199 组状态：42 只餐盘始终存在，菜种始终固定；记录到 52 次份数减少、44 次补菜，并观察到保留的空盘。
- 同次采样末端约 118 FPS，P95 帧间隔约 12.4 ms。设备为 Windows、NVIDIA GeForce RTX 5070 Laptop GPU，不能外推至所有移动设备。
- 在 Codex 内置浏览器确认暂停、继续和重置；重置后为 8 位就餐者、42 只餐盘、146 份食材。
- 新版在窄屏预览检查后恢复正常浏览器尺寸；当前预览已刷新至空座空锅版本。
- 空锅改为有内壁、锅底的三维结构；无人时隐藏汤底、食材、气泡和该座位蒸汽，厨房蒸汽独立保留。
- 当前版本截图：`output/playwright/koala-seat-pots.png`。餐盘与厨师采样结果：`output/playwright/koala-revision-report.json`。

## 历史验证边界

初版曾在 Chrome 连续运行约 17 分钟，并检查 Edge 150、390px 窄屏和全屏操作；此记录不能替代当前修改版本的完整长时复测。当前的 10 分钟结果来自逻辑模拟，浏览器对餐盘与厨师修改做了约 100 秒实际采样。

初版的自动化标签切换未使 `document.hidden` 变为 true，因此不将其记为完整的真实后台恢复验收；固定时间步限幅与清除积压由逻辑测试验证。

### Server collection routes (2026-10-04)
- Removed the freestanding plating bench. The server alternates upper/lower kitchen pickup points, carries a mixed tray, and supplies plates at the outer left turn.
- Refills now require the server to be present, matching carried food, and a passing plate with room. Plate IDs, kinds, spacing and count remain unchanged.
- Production build and 11 tests passed, including 600 simulated seconds and route/transfer checks.
