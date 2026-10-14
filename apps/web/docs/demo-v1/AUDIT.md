# 旧实现核查与本轮边界

按企业需求记录与用户本轮已确认规则实施，半盘默认准备优先于旧“多圈暂缓”策略。现有未提交改动全部保留，没有 reset/clean，没有改3D文件。

| 核查项 | 证据 / 结论 | 本轮处理 |
|---|---|---|
| 42盘、固定菜名与随机取菜时刻 | scripts/generate-lunch-demo.mjs 的 names、`i<42`、随机条件及600秒循环确实存在 | 旧文件保留为历史材料；活跃演示不再导入，正式生成器读取scene IDs与弧长 |
| 14人 | tests/lunch-demo.test.ts 对旧聚合人数断言<=14；旧顾客只有count/entered/left | demo-v1身份记录不截断，22人在店且18座的独立测试通过，已入座另验容量 |
| 取菜/补菜不验位置 | 旧生成器只有second/slotId/weightG，无座位或供餐口约束 | 正式数据每次apply按导出轨道验证窗口与任务前置条件 |
| 大量快照 | 旧 snapshots.json 保存601个全店帧 | 新包只有一次初始重量与254个增量事件，无逐秒全店快照 |
| 独立时钟/GET改revision | lib/demo/lunch.ts 的globalThis时钟及`++clock.revision`属实 | 旧两API返回410；新D1唯一播放锚点和确定性投影，GET不推业务 |
| 厨房本地轮播 | components/scales/kitchen.tsx 每5秒切展示项，并读取旧API | 默认厨房用固定顺序新看板，无业务本地时钟；旧设备界面仅mode=live保留 |
| 管理/日统计来源混杂 | 旧admin读取scales/历史库，旧午餐另读快照 | 新admin/state嵌入同刻reports；历史入口明确独立，短包不写旧库 |
| restaurant接口不含身份人流 | /api/restaurant/state 为称重映射，customers:null，revision墙钟 | 原接口保留兼容；真正3D已接 /api/demo/v1，未用red-koala-3d-ui替代 |
| v2有效请求501 | lib/operations-v2/contract-route.ts 是纯契约路由 | 保持明确未实现，实测telemetry样例返回501，demo-v1所需五接口全部实现 |
| 仅重量难以识别原因 | 旧engine稳定下降通常归take、上升归refill，无区域依据 | 不宣传旧算法因果识别；新演示需good观测+来源操作+空间验证，无来源差分归uncertain |

原旧午餐测试仍保留验证旧归档样例，不作为本轮验收证据；只将其中隐式any补成类型以通过全项目lint。未生成30天/半月/月度数据，不开发真实传感器或固件。
