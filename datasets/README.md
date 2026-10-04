# 完整合成数据集

`restaurant-complete-v4.zip` 是当前活动场景的完整数据包，不是抽样。`manifest.json` 记录压缩包 SHA-256 与每个成员的大小和 SHA-256。

- 范围：2026-09-03 至 2026-10-05，共 33 天。
- 36 种菜品，42 个碗位，20 个模拟座位，1,188 个菜品日批次。
- 包含全部批次中的分钟观测、重量事件、日统计、厨房流水与执行记录。
- 包含全部模拟真值：模拟顾客、取用事件、隐藏需求及采样。全部由固定种子程序产生，不是实际顾客信息。
- 包含目录/碗位映射、原始校验文件、分布统计、厨房来源与可视化报告。
- 另附独立午餐演示的 601 帧快照、事件及说明。

原始内容约 396 MB，压缩包约 16 MB。没有放入旧版本归档、过时 CSV、导入机器的备份路径/运行报告或含凭证的数据库。当前完整观测以 batches/ 为准。

```sh
npm run data:verify
npm run data:extract
npm run simulate:profile
```

Python 3.9+ 的标准库负责解包。解包先核对完整清单、文件大小、哈希与路径，不覆盖内容不同的已有文件。当前场景解到 sample-provider/output，午餐数据解到 red-koala/data/lunch-demo；这些工作目录保持忽略提交。

画像离线演示只读取批次中的日观测，不把 truth/ 中模拟顾客的隐藏意图作为画像输入。报告写入 sample-provider/output/profile-simulation.json，明确为合成数据、历史估计。它不包含当天实时修正或时段视图；完整页面由后端导入后计算。

重新生成：在 sample-provider 运行 `npm run history:generate`，再运行 `npm run history:report`。数据来自 `lib/history/generate.mjs`；顾客/座位/取用仿真也见 `lib/restaurant.mjs`。生成器与画像推断算法分别保留在源码中。
