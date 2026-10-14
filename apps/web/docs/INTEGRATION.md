# 联网秤接入

每个秤固定在传送带承载位置上，通过秤编号绑定菜品。碗可以离开秤，秤的碗皮重必须大于零；没有摄像头、图像上传或计件识别。

## 配置与上传

在管理端设备设置中配置 `id`、`dishId`、`dishName`、`tareG`、`fullG`、`noiseG`、`enabled`，可选 `position`（1–10000 的整数，表示菜品固定排列顺序）。`fullG` 是食物的标准满碗净重；默认噪声阈值 3 克。多秤可以绑定同一道菜。

管理端生成统一的设备凭证，所有上报使用同一套接口；上传报文不能选择真实、模拟或联调模式。凭证重建后旧凭证失效。

主设备每秒请求 `POST /api/scales/ingest`，使用 `Authorization: Bearer <设备凭证>`：

```json
{
  "samples": [
    {
      "scaleId": "belt-01",
      "bootId": "本次启动唯一编号",
      "sequence": 123,
      "sampledAt": "2026-10-03T12:00:00+08:00",
      "grossG": 950
    }
  ]
}
```

毛重以克为单位，含碗重。每秤在同一启动内序号递增，启动编号重启时更新，采样时间必须真实并同步时钟。重复报文不会重复统计；旧序号、旧启动或倒退时间不会修改实时状态。多个秤可以合并到一次请求，最多 1000 个样本。

## 读数处理

连续三个稳定读数后建立或更新净重。下降记录取用，上升记录补充；小于阈值的变化积累至阈值再记录。第一次接入的重量是初始基线，不能算作补充。

低于碗皮重表示碗离开；离开期间停止取用统计。重新放回、重启、清零、校准、换菜或超过十秒的断线都会重新建立基线。期间差值或异常大幅变化待人工确认，不把恢复后的差值补算为取用。

人工处置区分报损、撤下保留和测量修正。报损原因分为 `display_age`（放置过久）、`closing`（当日剩余）、`other`。同一待确认事件只能处理一次，报损不会同时计入取用。人工撤下记录携带唯一 `requestId`，重复提交不会重复计量；若对应最近已测得的取用，则替换该笔分类。无法匹配秤变化的人工记录单独标为人工记录，不虚构新的重量基线。

## 读取与操作

- `GET /api/scales/state`：按菜汇总的轻量实时状态、单秤信息、五分钟速度、三十分钟趋势和待确认变化。
- `GET /api/scales/summary?date=2026-10-03`：当天取用、上台补充、报损、保留和剩余。
- `GET /api/scales/devices`：秤配置、营业时间与凭证是否已配置；不返回已有凭证。
- `POST /api/scales/devices`：保存配置、校准、修改营业时间、生成设备凭证。
- `POST /api/scales/actions`：处理待确认变化及人工处置。

浏览器每秒读取实时状态；浏览器关闭不影响主设备上传和后台调度。有效观测不足时消耗速度为空，离线量不当作零余量。原始采样保留 24 小时，分钟汇总保留 90 天，日统计和备料记录长期保存。

旧 `/api/ingest`、`/api/state`、视觉及经营数据导入接口已移除，旧设备必须改用新的称重协议。

## 历史数据接口 v1

`POST /api/preferences/import` 使用同一个 `Authorization: Bearer <设备凭证>`。请求为 `{"version":1,"dataset":{"catalog":[],"stores":[],"days":[]}}`，成功返回 `{"success":true,"version":1,"catalog":12,"stores":90,"days":1080}`。不接受 `files`、CSV 或来源选项。数据总量不超过 2MB；较大历史按日期拆分，每批携带所涉及的目录与门店日期。

- `catalog`：`id`、`name`、`category`、`unit`（固定 `g`）、`pieceWeightG`（统一克数据填 `null`）、`launchDate`。
- `stores`：`date`、`status`（`open/closed`）、`snapshotAt`、`finalAt`。
- `days`：`date`、`dishId`、`status`（`complete/partial/missing/not_launched/closed`）、`take20`、`takeFinal`、`takeG`、`opening`、`replenished`、`waste`、`closing`、`supply`（`adequate/stockout/unknown/not_launched/closed`）、`stockoutMinutes`、`snapshotAt`、`finalAt`；可选 `ageWaste`、`closingWaste`、`retainedKitchen`。

数量都是克，未知值为 `null`，日期为 `YYYY-MM-DD`，时间必须带时区。库存守恒、日期、重复键和数据可获得时点由主体校验。同一记录重复上传幂等，已存完整日记录不可覆盖。隐藏模拟需求和场景信息不会进入主体。

状态码：`200` 成功；`400` 报文或业务校验失败；`401` 凭证无效。错误响应含 `error`。管理端设备配置及业务操作通过同源接口完成，上报和历史接口通过设备凭证认证。既有 `source=demo/test` 请求被拒绝，数据库内部保留 `live` 键仅用于兼容旧表结构。

设备读取接口按 `position` 升序返回，未配置位置的设备排在末尾，同位置按设备编号自然排序。位置仅描述固定顺序，不随重量变化调整。样例环境每 5 秒移动一位，同一补菜窗口每 210 秒重复一圈；它的经过流水保存在样例项目中，称重上传协议保持不变。

## v2 历史批次（本地统一模拟）

保留原 v1 JSON 协议。v2 同样 POST `/api/preferences/import`，Bearer 使用现有设备凭证，UTF-8 请求体最多 2,000,000 字节。当前历史数据集约束：36 种菜品、42 个启用碗位、2026-09-03—2026-10-05、每天 11:00—22:00。完整类型和校验见 `lib/preferences/history-contract.ts`。

所有请求携带 `version:2`、`action`、`datasetId`。动作顺序：

1. `begin` + `manifest`：核对当前菜单、名称、秤和顺序，进入维护。维护控制仅接受 localhost/127.0.0.1。
2. 本地 SQLite online backup，暂停模拟器和调度；`reset` + `backupChecksum`：清除旧业务命名空间，保留设备配置、凭证、模型连接与营业设置。
3. `batch` + `batchId`（0001—1188）、`checksum`、`payload`：payload 是原始 JSON 字符串，checksum 对该字符串 UTF-8 字节做 SHA-256。一个批次一道菜一天，每碗 660 条分钟记录，全部事件、日统计、厨房流水、执行记录。同号同哈希幂等，同号异内容报错；不同批次不能覆盖相同菜品日。数据与回执同事务提交。
4. `status`：回传已接收批次供续传。`audit` + `date`：维护期间认证回读已存日记录、分钟汇总和日视图。
5. `replay` + `date`：齐备 1188 批次后调用主体模型按当日 20:00 回放。原始 generatedAt 为实际计算时间，provenance=`historical-replay`，不足21个有效样本保持空值。
6. `confirm` + `confirmation`：人工模拟经营决策，保留20:10决策时间与理由；禁止创建10月4日实际确认/执行。9月4日开档执行通过批次记录，明确无前日预测。
7. 回读验证全部通过后 `finish`：需30份预测、29份模拟确认。解除读取维护锁，经营数据冻结；自动调度跳过，普通业务写入拒绝，AI读取与按需分析继续可用。

导入从不写 scale_latest / scale_samples，历史设备不能因此在线。未知观测保留 null，库存、厨房转出、分钟统计、快照与日汇总由主体逐批核验。历史分钟缺少区间明细时，单碗缺菜秒数可用汇总；多碗不得凭汇总假定同时空碗。

本地维护与恢复脚本在独立 sample-provider 项目；具体步骤及备份位置见其 README 与运行产生的 backup.json。失败不得手工解除维护锁；续传或恢复一致的旧库。

### 统一场景数据源

当前 manifest.parameters.mode 为 scenario，33 天完整合成数据含未来日期。日期与批次数由 manifest 校验（1–90 天），实时采样接口原有时间限制不变且当前禁止写入。仅维护导入的模型回放允许计算场景未来截止点；普通生成接口仍拒绝未来预测。每日总结／画像使用数据集统计边界；实时与厨房接口从最后一天 19:00–20:00 的已观测分钟记录循环回放，返回 scenario.datasetId 和回放时间，不写入 scale_latest 或原始采样。独立模拟器不能在此模式启用。
