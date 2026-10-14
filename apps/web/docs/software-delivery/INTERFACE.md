# 红考拉共同接口契约

版本：`operations-v2` / `2.0.0-dev.5`，更新于 2026 年 10 月 13 日。当前代码已实现持久化应用服务、严格契约、权限、幂等回执、计量投影和工作站会话；不是仅返回 501 的路由骨架。业务规则见 [完整开发方案](../DEVELOPMENT-PLAN-2026-10-11.md)。

可执行定义以 [`lib/contracts/v2/endpoints.ts`](../../lib/contracts/v2/endpoints.ts) 及各域 schema 为准，当前有 39 个业务端点，另有 session 的 GET／POST／DELETE。运行实例必须配置 `OPS_DB`、明确的 `OPS_V2_ENVIRONMENT=test|demo|live` 和管理凭证；未配置或暂不可用返回 503，已配置实例的受保护接口未认证返回 401。旧进程需重启才加载新增服务。软件测试与模拟客户端回放不等于真实硬件验收，实例标签 `live` 本身也不是硬件真实性证明。

## 1 通用约定

- 使用 JSON、UTF-8、HTTP；外部联调环境使用 HTTPS，本地可使用 HTTP。时间为带时区 ISO 8601，服务端保存 UTC，页面及报表日期采用 Asia/Shanghai。
- 重量单位为克；未知值为 null，不能用零替代。ID 为非空字符串，长度上限由共享 schema 统一声明；requestId、batchId、eventId 必须是 UUID。
- 设备令牌用于设备观测接口；员工会话或可信工作站身份用于操作；管理配置需管理权限。客户端不能通过传递 role 或 actorName 自行获得权限。
- 业务查询响应带 `contractVersion`、`serverAt`、`dataRevision`；遥测回执带 `contractVersion`、`batchId`、`serverAt`，session 使用独立会话响应。分页列表带 `nextCursor`，默认 50 条、最多 200 条；实时页按启用绑定返回，不分页。
- 员工写请求包含 `requestId`；可变对象写操作额外包含 `expectedVersion`。相同调用方、同 requestId、同内容返回原响应；同号不同内容返回 409。回执和业务写入在一个事务中保存。
- 请求 envelope 或字段格式不合法返回 400；未认证 401、无权限 403、对象不存在 404、版本／幂等冲突 409、体积过大 413、限流 429、暂不可用 503。429／503 返回 `Retry-After`。

```json
{
  "error": {
    "code": "VERSION_CONFLICT",
    "message": "任务已由其他工作站更新，请刷新后重试",
    "retryable": false,
    "currentVersion": 5
  },
  "requestId": "64bfe76d-14f0-427b-8da9-81e7e508190b"
}
```

`dataRevision` 是不透明字符串，包含实例环境、数据库独立 generation 和修订号。恢复到新数据库会产生新 generation；客户端不得拆出数字比较或沿用旧库 cursor／导出版本，恢复后应重新读取。

查询总是由后端返回允许动作和原因，前端不计算取用、优先级及权威汇总。错误 `retryable` 仅表示原请求是否适合重试，版本冲突需先读取新状态，不自动更换版本再执行。

## 2 现有重量接口兼容

保留 `POST /api/scales/ingest` 及其现有严格字段校验、Bearer 认证和响应语义，现有报文不能直接添加 v2 字段。既有请求样例：

```json
{
  "samples": [
    {
      "scaleId": "belt-01",
      "bootId": "startup-a",
      "sequence": 123,
      "sampledAt": "2026-10-11T11:00:00+08:00",
      "grossG": 1100
    }
  ]
}
```

旧接口已有批量上限 1000、未来时间容差 5 秒、过旧时间 24 小时等校验，详见 [当前接入说明](../INTEGRATION.md)。旧响应为 accepted／ignored／events 计数，没有 v2 逐项原因。兼容指协议不破坏；切换到新计量的设备，服务端以配置决定计算口径，设备不能自行声明数据是演示或真实。

## 3 新设备观测接口

### 3.1 重量上传

`POST /api/v2/telemetry/samples`，使用设备 Bearer 凭证。

```json
{
  "version": 2,
  "batchId": "463b5c1b-9be2-47f5-9e96-fcf14fbf24a8",
  "samples": [
    {
      "scaleId": "belt-01",
      "bootId": "startup-a",
      "sequence": 123,
      "sampledAt": "2026-10-11T11:00:00+08:00",
      "grossG": 1100,
      "measurementStatus": "ok"
    }
  ]
}
```

| 字段 | 规则 |
| --- | --- |
| version | 固定 2 |
| batchId | 同一凭证范围内一次逻辑批次编号；跨接口也不能复用；网络重试复用同 ID 和原内容 |
| scaleId | 已配置且属于当前凭证范围的秤；菜品和绑定由软件维护 |
| bootId | 本次设备启动唯一编号；重启后变化 |
| sequence | 同设备同 bootId 内递增的非负安全整数 |
| sampledAt | 采样发生时间，不以重传时刻替代 |
| grossG | `measurementStatus=ok` 时为有限非负数；包含碗等承载物重量；精度最多三位小数 |
| measurementStatus | ok／fault／overload；fault 或 overload 时 grossG 必须为 null，不进入重量计算 |

每批最多 1000 条、UTF-8 请求体最多 1MB。整批 JSON 及 schema 先校验，格式错误时全批不写；通过格式校验后逐项执行，各样本保存、回执和派生记录原子提交。整个批次不承诺全有全无；请求中断后重试可恢复已完成项。

同一样本身份为 `scaleId + bootId + sequence`。首次合法样本保存有效载荷哈希，同身份同内容返回 duplicate，同身份不同内容返回 rejected／ID_CONFLICT。唯一约束与数据库事务防止并发重试重复记账。同一 batchId 和相同内容的重试可能直接返回原已保存回执（仍是 STORED）；用新批次再次提交同身份同内容，逐项才返回 DUPLICATE。两者均不生成新的原始观测。

```json
{
  "contractVersion": "operations-v2",
  "batchId": "463b5c1b-9be2-47f5-9e96-fcf14fbf24a8",
  "serverAt": "2026-10-11T03:00:01Z",
  "results": [
    {
      "index": 0,
      "scaleId": "belt-01",
      "bootId": "startup-a",
      "sequence": 123,
      "status": "accepted",
      "code": "STORED",
      "retryable": false
    }
  ]
}
```

逐项 status 为 accepted／duplicate／ignored／rejected。常用 code 为 STORED、DUPLICATE、OLD_SEQUENCE、OLD_BOOT、LATE_SAMPLE、UNKNOWN_DEVICE、DEVICE_DISABLED、CLOCK_AHEAD、TOO_OLD、ID_CONFLICT、BUSY。合法 batch 可返回 200 同时含部分 rejected，调用方必须检查每项。瞬时 BUSY 不保存为永久成功回执；同一批次重试只重做未完成项。

初始 v2 时间策略：采样时间超前服务器超过 5 秒拒绝；超过 24 小时的实时上传拒绝；其他迟到记录可保存为历史依据但不倒退 latest，不能自动补算缺测取用。以上为协议初始值，可在正式联调前版本化调整。设备离线时保留原始时间与序号，不制造零读数。

### 3.2 边界和设备状态事件

`POST /api/v2/telemetry/events`，设备 Bearer 认证。每批最多 100 条、256KB。

```json
{
  "version": 2,
  "batchId": "80e54dc0-a131-490f-a74e-9e4d16f87c1f",
  "events": [
    {
      "eventId": "3c5de1ab-a0a8-4624-b590-bec344713c26",
      "scaleId": "belt-01",
      "bootId": "startup-a",
      "eventSequence": 17,
      "occurredAt": "2026-10-11T11:00:00+08:00",
      "type": "exit_kitchen",
      "sampleRef": { "bootId": "startup-a", "sequence": 123 }
    }
  ]
}
```

type 为 exit_kitchen／enter_kitchen／device_fault／device_recovered。device_fault 必须带枚举化 `reasonCode`，device_recovered 可以省略；边界事件不接受 reasonCode。`sampleRef` 可省略，引用同 scaleId 的已上报或将上报样本。事件编号及事件序号与重量序号独立；事件可以因网络延迟乱序到达，不能仅因旧序号直接丢掉未处理边界。

事件回执沿用逐项结果，附 `processingStatus=applied|waiting_sample|pending_review`。事件已保存但等待样本时不要求设备换 ID 重发。关联样本到达或后台投影任务运行后重新核对；缺失证据不会因等待超时自动确认。相同 batchId 的重试保留原幂等回执；新 batchId 内重复的边界事件读取已持久化轮次与计算依据，返回该 eventId 最新处理状态。已到生效时间的故障／恢复事件返回 applied，尚未到时返回 pending_review；业务上连续出口等冲突仍保存证据并待核实，不强行配对。

`sampleRef` 的身份匹配仍须通过配置的 `boundaryWindowMs`、稳定性、同一启动及无中断检查；有引用不代表可以使用很久以前的样本。未配置时间窗时只允许发生时刻完全相同的显式引用；一个样本不能支撑不同边界轮次。无引用时只在显式窗口内寻找无歧义有效样本。

软件生成 cycleId 并负责判断位置可信度；长时间没有可信边界后位置可过期，不能一直把最后区域当成当前事实。人工边界走员工接口，不能冒充设备来源。

## 4 员工操作与轮次

| 方法与路径 | 输入或查询 | 输出 |
| --- | --- | --- |
| GET `/api/v2/operations` | startDate、endDate、可选 bindingId、分页 | 操作原记录、更正链及 effective 状态 |
| POST `/api/v2/operations` | requestId、bindingId、occurredAt、type、quantityStatus、weightG、evidenceIds、note；修改对象时 expectedVersion | operationId、处理状态、受影响轮次与 dataRevision |
| POST `/api/v2/operations/boundary` | requestId、bindingId、occurredAt、type=exit_kitchen 或 enter_kitchen、note | 人工来源的 eventId、轮次和处理状态 |
| GET `/api/v2/cycles` | scaleId／dishId、日期、状态、分页 | 配对、边界重量、质量、记账版本 |
| GET `/api/v2/cycles/{id}` | 无 | 原始引用、操作、轮次及修订历史 |
| GET `/api/v2/bindings/{id}/evidence` | startAt、endAt、分页 | 绑定内原始读数、服务器证据 ID 和边界窗口，供员工核对前后称重 |
| POST `/api/v2/cycles/{id}/review` | requestId、expectedVersion、decision、evidenceIds、note | 新版本、质量及重算状态 |

操作 type 为 food_refill／ice_add／drain／partial_remove／remove_container／replace_container。数量状态为 measured／estimated／unknown，unknown 对应 weightG=null；estimated 不自动升级可信。partial_remove 等撤菜动作需 disposition=waste 或 retain 及 reason；换盘附新绑定配置和新批次所需字段，严格条件字段以 `operations.ts` 为准；撤菜动作必须携带 `expectedBindingVersion` 和当前 `freshnessBatchId`（没有批次则为 null）。

原始操作不能通过普通更新接口覆盖。更正使用新的 operation request 并引用 `correctsOperationId`、原因与对象版本；`review` 的 decision 为 confirm／keep_pending／invalidate，confirm 必须引用可核对证据。无法解释的数值不能仅因点击确认就变成自动验证。

新旧撤菜入口共享同一应用服务，不允许前端同时调用新操作接口和旧 freshness 接口实现一次换盘。业务事务失败时均不产生部分报损或部分批次关闭。

## 5 实时状态

`GET /api/v2/serving/state` 返回碗位维度的权威状态。以下为一个状态示例：

```json
{
  "contractVersion": "operations-v2",
  "serverAt": "2026-10-11T03:01:00Z",
  "dataRevision": "view-42",
  "environment": "test",
  "bowls": [
    {
      "scaleId": "belt-01",
      "bindingId": "binding-01",
      "dishId": "dish-01",
      "dishName": "示例菜",
      "positionOrder": 1,
      "bindingVersion": 1,
      "freshnessBatchId": null,
      "containerRef": "bowl-01",
      "tareG": 100,
      "servingState": "half",
      "recommendation": "defer",
      "quality": "good",
      "reasonCodes": ["HALF_NO_CHANGE"],
      "loadNetG": 500,
      "foodRemainingG": 500,
      "estimatedFoodG": 500,
      "confirmedFoodG": 500,
      "fullFoodG": 1000,
      "observedAt": "2026-10-11T03:00:59Z",
      "confirmedAt": "2026-10-11T03:00:59Z",
      "zone": "customer",
      "locationQuality": "verified",
      "locationObservedAt": "2026-10-11T03:00:00Z",
      "cycleId": "cycle-01",
      "taskId": null,
      "ruleVersion": 2
    }
  ]
}
```

示例不规定阈值。`foodRemainingG` 为当前可供状态计算的量，不可解释或过期时 null；估计与确认字段可分别保留并带各自时间，confirmedFoodG 不是最新量保证。servingState 等枚举见总体方案。zone 为 kitchen／customer／unknown，locationQuality 为 verified／manual／stale／unknown；设备事件来源也需通过时序及新鲜度校验才能标 verified。

`positionOrder` 只表示固定排列。前端不可据此生成真实位置或到达时间。数据错误、未配置、离线等原因通过 reasonCodes 传递，不用业务正常值掩盖。

## 6 任务与规则

| 方法与路径 | 用途 |
| --- | --- |
| GET `/api/v2/refill/tasks` | 按责任区域、状态、优先级、碗位分页；紧急优先，同优先级按创建时间 |
| GET `/api/v2/refill/tasks/{id}` | 任务、允许动作、处理历史、当前核验依据 |
| POST `/api/v2/refill/tasks/{id}/actions` | claim／defer／handoff／report_complete／verify_manual／cancel |
| GET `/api/v2/serving/rules` | 菜品阈值、半盘规则、高峰时段及版本 |
| PUT `/api/v2/serving/rules/{dishId}` | requestId、expectedVersion、完整规则；管理权限 |
| GET `/api/v2/devices/diagnostics` | 采样与接收时间、延迟、故障、重复／拒绝数量及原因；不返回密钥 |

任务动作示例：

```json
{
  "requestId": "64bfe76d-14f0-427b-8da9-81e7e508190b",
  "expectedVersion": 4,
  "action": "defer",
  "until": "2026-10-11T11:10:00+08:00",
  "reason": "半盘且近期取用很少，稍后复查"
}
```

动作响应返回完整 task：id、bindingId、status、priority、responsibility、assignee、version、deferUntil、verificationMethod、allowedActions、updatedAt。responsibility 为 kitchen／front／unassigned。handoff 附目标责任组和原因，report_complete 引用本次操作编号；verify_manual 需要管理配置允许并附理由，不能写成 measurement 核验。

状态迁移、暂缓期限、紧急任务限制均由服务端验证。客户端 role 筛选只影响列表，不影响权限。传错版本返回 409，不执行动作。

## 7 报表与导出

`GET /api/v2/reports/consumption?startDate=2026-10-01&endDate=2026-10-11&basis=cycle_balance_v2`。

当前支持 1 至 31 天闭区间日期，服务器转为北京时间左闭右开时间范围。`cycle_balance_v2` 已实现；schema 保留 `legacy_delta_v1`，但当前 v2 报表服务明确返回 503，旧口径需独立查看旧报表，不提供混合总量。支持 dishId 和分页，服务端按取用量排序；总量针对完整筛选结果，不只针对当前页。

结果包含 scope、basis、dataRevision、projectionStatus、serverAt、asOf、totals、rows 和 nextCursor。每行包含 dishId、name、rank、confirmedTakeG、pendingCycles、observationCoverage、cycleCoverage、stockoutMinutes、recordedDays、operatingDays、operatingDaysBasis、qualityReasons。recordedDays 只数已闭合轮次日期；operatingDays 来自绑定应供时段，basis 为 binding_schedule，无绑定依据为 null／unknown，不代表已接入门店营业日历。旧口径响应使用 observedTakeG 而非把旧值改名 confirmedTakeG。无有效数据的 quantity／rank／无法计算的 coverage 为 null。

`GET /api/v2/reports/consumption/export` 使用同样筛选并要求 dataRevision 和 snapshotAt（原报表的 serverAt），返回全部筛选结果 CSV。不要携带 limit 或 cursor。固定快照时间避免无新写入时，覆盖率随时钟变化导致页面与导出不一致；分页游标也保存首次查询时间。未来 snapshotAt 拒绝为 400。版本已过期返回 409／REPORT_REVISION_CHANGED，汇总未就绪返回 409／REPORT_REBUILDING；页面刷新后明确重新导出，不静默混用版本。CSV 包含范围、快照时刻、口径、数据版本、质量和单位，并转义公式及特殊字符。

`GET /api/v2/intelligence/evidence` 使用相同的导出筛选、dataRevision、snapshotAt，仅允许 cycle_balance_v2。返回同版本完整 report，以及 training={enabled:false,reason:SEPARATE_BASIS}、externalModelCalled=false。此接口供 AI 只读工具接入与依据下载，不调用外部模型，也不把新账本混入旧模型训练。

## 8 配置、身份与保鲜

以下端点与前文共同构成 32 个业务端点。权限来自服务端凭证；设备角色不能读取员工业务视图，员工／管理凭证也不能冒充设备写遥测。

| 方法与路径 | 权限 | 用途 |
| --- | --- | --- |
| GET `/api/v2/devices` | manager | 设备、当前绑定、版本、计量参数与固定显示顺序 |
| PUT `/api/v2/devices/{id}` | manager | requestId、expectedVersion、设备配置；保存绑定历史 |
| GET `/api/v2/access/credentials` | manager | 凭证身份、范围、停用与到期信息；不返回令牌 |
| POST `/api/v2/access/credentials` | manager | 登记凭证，设备凭证必须明确 scaleIds 和 system 身份 |
| POST `/api/v2/access/credentials/{id}/revoke` | manager | requestId；撤销凭证 |
| GET `/api/v2/freshness/rules` | staff | v2 保鲜规则 |
| PUT `/api/v2/freshness/rules/{dishId}` | manager | requestId、expectedVersion、完整保鲜规则 |
| GET `/api/v2/freshness/batches` | staff | active／closed／all、dishId／bindingId 及分页 |
| POST `/api/v2/freshness/batches` | staff | requestId、bindingId、expectedBindingVersion、startedAt、openingFoodG |
| GET `/api/v2/freshness/removals` | staff | 起止日期、dishId 及分页；含更正链和 effective 状态 |
| GET `/api/v2/system/retention` | manager | 原始样本清理策略与最近完成／失败／取消结果 |
| PUT `/api/v2/system/retention` | manager | requestId、expectedVersion、config.enabled、config.rawRetentionHours |
| GET `/api/v2/system/diagnostics` | manager | 持久化作业计数、失败摘要、最早积压时间与最后调度状态 |

计量配置包含边界窗口、采样间隙、新鲜度、稳定窗口和样本数量、稳定容差、负值容差、最大变化量、位置新鲜度和规则版本。`boundaryWindowMs`、`maxStepG`、`locationFreshMs` 可以按 schema 显式为 null，表示该判断依据未配置；不能由前端套演示阈值。绑定包含 dishId、dishName、containerRef、tareG、fullFoodG、foodOnly。历史绑定和配置快照参与重建，不能用当前配置回写过去事实。

v2 保鲜数据来自同一 `OPS_DB` 内的规则、批次和操作记录，以 `source=operations_v2` 标识。撤菜与换盘走 `/api/v2/operations`；不允许前端再写一次旧 freshness 接口来“同步”。

清理策略默认 `{version:0,updatedAt:null,config:{enabled:false,rawRetentionHours:24}}`，明确启用后在当前 OPS 环境执行；保留窗口范围为 24 至 8760 小时。GET 另返回 `lastRun:null` 或 `{startedAt,completedAt,cutoffAt,deletedSamples,protectedSamples,status,errorCode}`，status 为 complete／failed／cancelled，失败仅公开 CLEANUP_FAILED。保护数量表示本轮已检查且超过时限、因引用或绑定状态而保留的样本，不是全库数量；已取消轮次的数量仅代表停止前完成的批次。

采样时间与接收时间都严格早于 cutoffAt 才进入清理候选。当前绑定和待核实轮次／操作／作业／任务保护完整绑定内历史；账本所有版本、轮次修订与计算依据包、操作、明确 sampleRef、最新状态、供应区间等引用永久保护。只删除无引用的原始 samples，不删除操作、设备边界、轮次、账本或算法摘要。原始波形不承诺无限保存或未来全量重算；当前重建依赖绑定全历史，故活动绑定暂不清理。清理保留样本身份及内容哈希墓碑：同身份同内容的新 batch 仍返回 DUPLICATE，不同内容返回 ID_CONFLICT，不恢复已清理波形。

清理以每批 50 条、每次调度最多 10 批有界执行，进度及计数持久化，进程重启或租约到期可继续；同策略完整扫描后至少间隔 1 小时，配置变更可立即执行并取消旧扫描。每批通过版本 CAS 重查并发引用，恢复中的维护锁阻止删除。runtime 的独立调度心跳不改变 dataRevision，避免无业务变化时使报表游标过期；业务写入和清理仍更新业务版本。

`/api/v2/session` 不在上述业务注册表内：GET 返回 `authenticated:false` 或已认证的 actor／role／environment；POST 接受 `{token}` 并建立 HttpOnly、SameSite=Strict 会话 cookie；DELETE 注销。POST／DELETE 必须同源，HTTPS 使用 Secure cookie。工作站与 3D 使用此会话，凭证不存入前端持久化状态。三维 `?mode=live` 只读取 session 和 serving/state，按真实绑定作固定排列，不创建顾客或人员轨迹。

## 9 软件自检与硬件验收

只读探针检查未认证 GET，不上传任何观测或凭证：

```sh
node --experimental-strip-types scripts/probe-hardware-contracts.ts --base https://测试实例域名
```

401 只说明认证保护存在；503 表示未配置或暂不可用；200、501 或非标准错误会使探针失败。探针不证明设备可写入、计量正确或硬件在线。

原始 JSONL 发送工具及现场执行步骤见 [硬件交接清单](HARDWARE-HANDOFF.md)。纯软件测试使用 `node --experimental-strip-types --test tests/hardware-client.test.ts`，覆盖固定批次重试、逐项拒绝、身份回执核对、全文件校验和认证探针。现场 H01—H09 需另存真实设备、时钟、边界及测量误差的证据。


## 后厨十盘与固定盘序扩展（2026-10-13）

| 接口 | 身份 | 用途 |
| --- | --- | --- |
| GET /api/v2/conveyor/config | 管理 | 自动识别开关、轨道、盘托、窗口和配置版本 |
| PUT /api/v2/conveyor/config | 管理 | requestId + expectedVersion 保存，无生产预置尺寸 |
| POST /api/v2/telemetry/conveyor | 设备 | requestId + motion；凭证必须授权 trackIds |
| POST /api/v2/conveyor/calibrate | 管理 | 对最新停止心跳的 bootId/sequence 校准 phaseM |
| GET /api/v2/conveyor/state | 员工 | 位置质量、心跳有效期、速度、推算盘托位置 |
| GET /api/v2/kitchen/board?windowId=… | 员工 | 到入口的前十盘、后厨待处理、其他窗口计数、余量与时限质量 |
| GET /api/v2/kitchen/visits?bindingId=… | 员工 | 系统推断的处理段、原始依据、原因、版本及历史修订 |

`motion` 包含 trackId、bootId、连续 sequence、occurredAt、running、speedMps、direction。停止时速度必须为零；先停止并上报新鲜心跳，再提交校准。丢序、方向变更、重新启动、配置变化或过期心跳后的恢复均要求重新校准；仅正常停机且持续心跳时保持可信位置。旧报文不会倒退位置，同号不同内容冲突。恢复到新数据库后也必须重新校准。

`kitchen_visits` 与 `conveyor_events` 纳入逻辑备份；旧备份缺少这两个新增表时允许恢复为空。识别来源固定为 `system_inference`；自动完成任务标为 `verificationMethod=automatic`，记录处理段 ID/版本。失效时保留历史并重新待核实。未开启前不新增历史识别，关闭后已有记录仍接受更正重算。

推算位置仅用于呈现与排序。自动识别和取用账本继续依赖实际进出后厨事件及原始称重；轨道心跳不会生成边界事件或顾客取用量。

发现盘托移位/基准丢失时，网关上报 `motion.positionValid=false`，服务器立即锁定重新校准状态。恢复有效且静止的心跳后仍需管理校准；单纯恢复心跳不会自动相信盘序。没有移位传感器时必须由现场停机检查与重新校准，软件不能凭速度心跳发现机械移位。
