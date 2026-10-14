# 硬件协议交接（2026-10-12）

本轮交付软件契约、模拟协议工具和校验，不开发硬件。正式演示使用 `simulation` 适配器，不把脚本成功称为真实称重/边界设备验收。

## 已实现与未实现

| 路径 | 实际状态 | 用途 |
|---|---|---|
| `/api/demo/v1/{manifest,state,events,reports,control}` | 本轮实现并联调 | 模拟场景统一回放，绝不接收真实设备数据 |
| `POST /api/scales/ingest` | 原有严格重量接口保留 | 已登记秤的毛重输入；没有边界/操作信息，旧差分取用仅是重量估计，不能据此称已识别真实顾客取用 |
| `/api/scales/devices`、`/state`、`/summary`、`/actions` | 原有功能保留 | 设备绑定、凭证、旧模式显示；本轮不改旧经营库 |
| `/api/restaurant/state` | 原有称重展示适配器保留 | 不含真实顾客与座位记录；新3D不依赖它 |
| `/api/v2/telemetry/samples`、`/telemetry/events` | 只有可执行严格契约，合法请求501 | v2重量/故障/边界报文，尚无持久化接收 |
| `/api/v2/operations`、`/operations/boundary`、`/cycles`、`/cycles/{id}`、`/cycles/{id}/review` | 合法请求501 | 操作、边界与轮次计算待实现 |
| `/api/v2/serving/state`、`/refill/tasks`、`/refill/tasks/{id}`、`/refill/tasks/{id}/actions`、`/serving/rules`、`/serving/rules/{dishId}` | 合法请求501 | 与本轮 demo-v1 完全不同的生产服务骨架 |
| `/api/v2/devices/diagnostics`、`/reports/consumption`、`/reports/consumption/export` | 合法请求501 | 未实现持久化诊断/报表 |
| `/api/demo/lunch/state`、`/control` | 410 LEGACY_RETIRED | 旧独立演示时钟已停用 |

v2 骨架错误是 `lib/contracts/v2/errors.ts` 定义的结构化结果，含 requestId、code；不要以“类型存在”冒充服务可用。本轮演示所需路径全部在 demo-v1，不依赖任何501路径。

## 身份与计量

实际硬件须提供 deviceId（网关/设备）、scaleId（称重单元），软件登记 scaleId→餐盘/容器→dishId 的绑定及生效时间。旧配置保存 scaleId/dishId/tareG/fullG/position；旧 position 是显示编号，不能当成新场景的稳定 slotId。新演示用 `scale:${plateId}`，与实体 plateId/slotId/dishId 显式关联，不能原样当成已安装设备清单。

重量单位 g。grossG 包含盘/承载物等总重量，tareG 是当前绑定的皮重，remainingG = grossG - tareG（负数为异常/移盘，不补为零后记取用）；fullG 为食物标准满盘净重。含冰、积水、加热物的承重组成必须现场确认，不能只靠差分分解成食物。真实采样时间 sampledAt 使用带时区 ISO8601，服务接收时间独立保存；demo-v1 使用模拟毫秒 simTimeMs，不要上传到 sampledAt。

旧协议精确报文（每层严格校验，禁止额外字段）：

```json
{"samples":[{"scaleId":"demo-scale-001","bootId":"boot-unique-per-start","sequence":1,"sampledAt":"2026-10-12T09:00:00+08:00","grossG":1300}]}
```

scaleId 1–80字符、bootId 1–100字符、sequence 非负安全整数、grossG 0–10000000g，单批1–1000样本，请求文本不超过300000字符。当前不支持 null故障读数；设备无有效读数应停止上报有效重量，不能伪报0。软件离线/过期的配置及显示需结合采样周期验证。

新 bootId 重新建立基线；同 bootId sequence 递增。重复或旧序号/旧启动被忽略，不重复累计；旧接口尚无同身份异重量的独立冲突码。旧接口保留最多32个旧boot记录，不能承诺无限重启去重。断网缓存原 boot/sequence/time，重试不得生成新身份；超前5秒或过旧24小时拒绝。旧算法连续性超过10秒需重建基线，恢复差值不能直接计取用。旧短重量接口不具备完整因果识别能力，生产迁移依赖边界及操作服务。

## 边界与操作（版本2契约，服务尚未实现）

精确类型：`lib/contracts/v2/telemetry.ts`、`operations.ts`，样例在 examples。重量顶层 `{version:2,batchId,samples}`，每样本带 measurementStatus:'ok'|'fault'|'overload'；ok 有 grossG，故障/超载 grossG:null。

边界顶层 `{version:2,batchId,events}`；每事件需 eventId(UUID)、scaleId、bootId、eventSequence、occurredAt，type:'exit_kitchen'|'enter_kitchen'，可选 sampleRef:{bootId,sequence}。eventSequence 与称重 sequence 分开，网络重试复用同一 eventId。出厨=进入前厅，回厨=返回厨房；没有边界检测能力就没有可验证轮次，不假设 RFID、光电或其他传感器已安装。缺测、冲突、无绑定或无依据操作只能未知/待核实。

加冰、排水、移盘、换盘等操作必须带绑定 ID、来源、发生时间、依据与重量已知性，不能把重量增加都叫补菜、下降都叫顾客取菜。当前 v2 只有校验，尚不能提交后声称自动消解。

## 认证、权限、错误及网络

旧重量上传要求 `Authorization: Bearer <token>`。凭证由已部署实例 `/admin?mode=live` 的设备设置生成，服务只存 SHA256，重新生成会使旧凭证失效，本轮不轮换。测试密钥用环境变量 SCALE_TOKEN，禁止提交到源码、报文样例或日志。当前旧凭证是 source=live 级范围，未实现每设备细粒度权限；管理页面权限依赖部署外层认证，不应直接向公网暴露本地开发服务。

当前本地库开启历史冻结保护，ingest 在认证前可能返回409 `{error:string,frozen:true}`，本轮不解除保护。未冻结时旧接口401 `{error:"设备凭证无效"}`；400 `{error:string,details?:string[]}` 保留兼容；demo-v1 才使用本轮统一 error.code/message/details/requestId。旧接口不会突然升级响应包破坏硬件客户端。

401 停止并核对配置；400 修正数据而非盲目重试；超时/5xx 用同一报文重试并做有界指数退避。时钟超前校准后续采样，不篡改原始时间冒充新数据。超24小时的缓冲应走未来历史导入流程，不能硬塞实时链路。生产限流、设备密钥隔离、吞吐、断网长时间缓存及密钥轮换尚未做真实设备验收。

## 模拟工具与联调检查

```
node --experimental-strip-types scripts/simulate-scale-v1.ts
SCALE_ID=<已登记测试秤> SCALE_TOKEN=<测试凭证> node --experimental-strip-types scripts/simulate-scale-v1.ts --send
npm run test:demo
node --experimental-strip-types scripts/probe-hardware-contracts.ts
```

首命令仅本地协议校验；--send 必须选择独立测试实例/测试设备，调用实际旧接口，不自动登记或更改凭证。probe验证v2合法请求确实501及旧接口无凭证401或现有冻结保护409，不写入经营数据。

联调逐项记录：合法/无效凭证；单位和毛皮净重；重复/乱序/重启；超前/过旧；断网与恢复；移盘和故障；边界与读数关联（未实现）；加冰/排水可解释性（待设备/操作证据）；绑定更换；真实人数/满载持续运行；延迟、误差、环境油水温度。硬件方仍需提供型号/量程/精度/稳定采样节奏、设备身份与绑定方式、承重组成、边界能力、时间同步、断网缓存、真实容量/速度、校准及现场验收标准。

本轮已验证内容以 `VALIDATION.md` 为准；没有真实硬件接入验收，不承诺生产识别精度或持续运行能力。
