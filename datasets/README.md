# 可复现的完整合成数据

两套数据用于不同功能，不能合并解释为同一门店同一时段的实际经营结果。

| 数据包 | 内容 | 清单 |
| --- | --- | --- |
| `restaurant-complete-v4.zip` | 2026-09-03 至 2026-10-05；36 菜、42 碗位、1,188 菜品日批次；分钟观测、事件、统计及模拟真值，另保留旧午餐演示数据 | `manifest.json` |
| `lunch-rush-v6.zip` | 最新 12:00–12:10 午高峰；主轨 96 道菜／96 盘／47 席，备用轨 78 盘／33 席停用；场景、事件、菜品、真值与验证报告 | `lunch-rush-manifest.json` |

历史原始文件约 396 MB，压缩包约 16 MB；午高峰 JSON 约 8 MB。所有顾客与经营记录为程序合成，不包含真实顾客身份。模拟真值仅用于验证，不能作为画像或在线业务的已知事实。

```sh
npm run data:verify
npm run data:extract
npm run simulate:profile
```

解包校验压缩包及成员 SHA-256、大小、清单和路径，拒绝路径穿越、符号链接及覆盖不同内容。历史提取到 `tools/sample-provider/data` 与 `output`，午高峰提取到 `apps/web/data/demo-v1`；这些目录不提交。还会核对最新 3D 场景与后端场景内容和摘要。

历史生成器在 `tools/sample-provider/lib/history`，入口 `npm run history:generate -w @zhishan/sample-provider`。当前午高峰生成器在 `apps/web/lib/demo-v1/rush-generator.ts`，入口 `npm run demo:generate -w @zhishan/web`。后者要求已解包的当前菜品和匹配的 3D 场景，会写入运行数据，应在独立副本执行。

场景几何的唯一生成源在 `apps/restaurant-3d/src/demo/layout.ts`。修改场景或菜单后，需同时重新生成数据包、更新校验清单并通过跨应用测试；正常安装不运行会改变场景的生成命令。原始历史包与整理前本地文件逐项哈希一致；午高峰包把来源路径改为可移植路径，并据此重算数据包标识；场景和事件保持一致。
