# 统一模拟数据提供端

唯一活动数据集：`output/unified-36x42-20260903-20261005-v4/`。

- 北京时间 2026-09-03 至 2026-10-05，共 33 个完整营业日，11:00–22:00。
- 36 种菜品、42 个碗位；1,188 条菜品日记录、914,760 条碗位分钟记录。
- 固定种子 20260904，20 座；顾客、取用、补菜、厨房库存、撤下与报损由同一事件流水推导。
- 同时最多一个设备／数据异常碗位；缺测保留未知。回放只使用主体中的已观测分钟记录，不用隐藏真值补齐。
- 包含未来日期的合成场景，不代表实际经营。每日总结、趋势、画像、备料、预测、导出共用同一批数据。
- 实时管理与厨房页面为只读数据集回放（10 月 5 日 19:00–20:00 循环），不再独立生成实时样本。页面标注日期与回放性质。`npm start` 在此模式下不启动独立模拟器。
- 模型依每日 20:00 的信息边界回放；保留实际计算时间，少于 21 个有效样本仍学习中。10 月 6 日可有建议，没有该日经营数据。

## 重建与检查

在 sample-provider 目录执行：

```sh
npm run history:generate
npm run history:check
npm run history:report
npm run history:verify
node scripts/check-anomaly-budget.mjs
npm test
```

生成输出含 manifest、版本参数、truth、batches、checksums、validation、distribution、report.html、kitchen-sourcing；导入后包含 import-report、verification。`data/*.csv` 由同一批次导出，不能独立随机生成。

业务数据只通过设备凭证认证的 HTTP v2 批次接口导入，维持 2 MB 限制、幂等和断点续传。先备份再 begin/reset/import；维护中禁止读取半套数据。凭证与模型连接设置保留。旧实时记录和旧数据集仅存备份／归档，不参与页面数据源。

最近替换前备份：`backups/before-unified-33days-20261004/backup.json`。恢复时先停止主体/workerd、调度器和模拟器，再运行 `python3 scripts/restore-history.py backups/before-unified-33days-20261004/backup.json`；该工具验证备份校验值，不能在服务运行时覆盖数据库。
