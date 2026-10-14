# 自动演示契约 1.0.0

本文件和 `lib/contracts/demo-v1.ts` 是主系统权威契约。类型文件包含运行时 Zod 校验及精确响应类型。所有未标 optional 的字段必填；null 为明确未知，不等于 0。菜品目录唯一来源 `data/demo-v1/dishes.json`，当前八种仅是可扩展演示菜单，不是门店容量；同一 dishId 可绑定任意多个 plateId。显示顺序由 displayOrder 配置。

## 场景提供方对接（先发布）

正式路径：`../restaurant-3d/public/data/scene-manifest.v1.json`。结构严格以 sceneSchema 为准（额外几何字段允许，摘要保留它们）。坐标 m，x/y/z 定义显式提供；速度 m/s；弧长 m；模拟时间整数 ms。方向 +1 沿 LUT 的 sM 增大，-1 相反。停用轨道的 slot 保留，餐盘固定在 s0M，无取菜/补菜动作。

核心字段：tracks[{trackId,enabled,lengthM,direction,speedMps,path:[{x,y,z}],arcLengthLut:[{sM,x,y,z}]}]；slots[{slotId,trackId,s0M,usable}]；plates[{plateId,slotId,dishId,diameterM,heightM}]；seats[{seatId,usable,position,takeWindow:{trackId,centerSM,halfWidthM}}]；kitchen.boundary 多边形；servingWindows[{windowId,position,trackId,centerSM,halfWidthM}]。coordinateSystem 包含 unit:'m',origin 文本,axes:{x,y,z},drawingScaleM,measured:false。layoutParameters 必须 65/180。

contentDigest = 'sha256:' + SHA256(移除根 contentDigest 后，对对象键递归按字典序排序，数组维持原序，JSON.stringify 的 UTF-8)。不要哈希文件缩进。轨道 LUT 从 sM=0 到 lengthM，严格递增、闭合。场景内实体 ID 稳定且各类别内唯一；绑定引用和座位有效性必须验证。样例不是正式容量。

位置 s(t)=((s0M+direction*speedMps*simTimeMs/1000)%lengthM+lengthM)%lengthM。场景轨道禁用则位置不变。取菜/供餐可达条件为环形距离 <= halfWidthM；服务端与生成器共用计算，无另一条轨道。厨房窗口位置必须在 kitchen.boundary 内。

## HTTP

所有响应 no-store；共同元数据 contractVersion,datasetId,layoutVersion,sessionId（UUID）,generation（非负整数）,revision（非负整数）,simTimeMs,source:'simulation'。

- GET /api/demo/v1/manifest → ManifestResponse，含原始场景、菜品、规则、durationMs、来源。
- GET /api/demo/v1/state → DemoState，一致快照和 eventCursor。customers 含已离店记录；3D 仅渲染 status != left，数量与 summary.inStoreCustomerCount 相同。所有物理餐盘均返回，未使用座位在 manifest。
- GET /api/demo/v1/events?after=<cursor> → EventsResponse；省略 after 从本代开始，返回已开始动作、观测和派生事件。事件流按 startTimeMs、applyTimeMs、eventId（固定 en 字符比较）排序；重量只在 applyTimeMs 生效。cursor 不透明，不要解析。state 游标覆盖该快照前所有已开始事件；activeEvents 支持中途加入/刷新后恢复动画。
- GET /api/demo/v1/reports → Reports；当前代取用、补菜和不确定重量。simulatedDay 是本数据包截至已播放最远时刻的模拟日期累计，每事件只计一次；restart 保留之前已发生事件，不提前计算未来取用；不写真实经营库，无半月/月度数据。
- POST /api/demo/v1/control → DemoState。JSON 严格 {action:'pause'|'resume'|'restart',requestId:UUID,sessionId,generation}。携带当前会话防止过期客户端误控。相同 requestId 重试不再执行；重复不同内容返回409。播放完成后停在末帧；restart 增加 generation，从0继续，不自动循环。

会话持久化至当前部署 D1，记录墙钟 anchorWallMs 和模拟 offsetMs，所有客户端共用，GET 不写业务、不增加 revision；revision 由控制变更及已生效事件数确定。服务停机期间运行会话按墙钟继续，暂停会话保持暂停。D1 丢失创建新 sessionId，可检测；数据包或布局变更创建新会话。客户端以 (datasetId,layoutVersion,sessionId,generation) 为同步身份，变化时抛弃旧动画和游标。过期游标返回410 CURSOR_EXPIRED，重新GET state；非法游标400 CURSOR_INVALID。revision 只代表离散状态变化，连续盘位置/备菜进度由 simTimeMs 决定，不因相同时间重复GET而变化。

## 事件与计算

InputEvent 是按 eventType 区分的精确联合类型。所有事件含 eventId,targetEntityId,startTimeMs,applyTimeMs,endTimeMs。action 是有来源的操作记录，observation 是模拟适配器重量/质量观测，derived 是规则计算出的任务/提醒。验证真值另存 validation-truth.json，不送入运行服务或报表。类型同刻处理顺序为 enter → seat → take → refill → weight → quality → depart → leave；先检查备菜就绪派生条件。重复完全相同 eventId 幂等，冲突内容拒绝；数组乱序按 applyTimeMs/类型/eventId 重排。设备样本按 plateId/scaleId,bootId,sequence 检查，旧序号忽略，换 boot 只建立基线不补计差值。

顾客必须先进入才能入座，座位必须有效且未占用；取菜时已入座且餐盘到达 takeWindow。补菜必须在供餐口、任务就绪。半盘默认创建备菜任务，员工按配置耗时自动准备，然后等盘回厨；少量必须补、空盘紧急。实际余量、任务、质量分别返回。离线/过期/未知/移盘不显示空盘。只有 good 连续观测、明确关联操作且区域匹配的差分计入取用/补菜；异常跳变、换 boot、质量恢复、没有因果操作的差分不计作取用。加冰、沥水等只有重量时为不确定，不能声称已自动识别。

## 错误与兼容

统一 {error:{code,message,details?,requestId}}。details 包含 eventId,targetEntityId,simTimeMs,reason 等可定位信息，不截断实体。
400 INVALID_REQUEST/SCHEMA_INVALID/CURSOR_INVALID；409 REFERENCE_INVALID/CAPACITY_INVALID/SPATIAL_INVALID/PRECONDITION_FAILED/DATASET_MISMATCH/DIGEST_MISMATCH/SESSION_CONFLICT；410 CURSOR_EXPIRED/LEGACY_RETIRED；503 SCENE_NOT_READY/STORAGE_UNAVAILABLE；404 NOT_FOUND；405 METHOD_NOT_ALLOWED；500 INTERNAL_ERROR。

1.x 只增加可选字段，不改变枚举或单位；破坏性变化发布 /v2 新路径。当前严格接受 1.0.0，不兼容时显式失败。旧 /api/v2 仍是独立合同骨架，演示不依赖；旧 scales ingest 不扩充新字段。

## 行走恢复补充（实施期 1.0.0 对齐）

customer.seat / customer.leave 事件可带 path:[{x,y,z}]，startTimeMs 到 applyTimeMs 是完整行走时段，路径直接来自 scene.seats[].approachPath。CustomerState.movement:{path,startTimeMs,endTimeMs} 和 targetSeatId 在行走时提供，刷新无需猜测。customer.depart 在离席时生效，释放座位、状态 walking，customer.leave 在走到入口后生效 left。进入按1.2m/s演示步速从导出路径长度计算；员工 position 为所属供餐工作站坐标，本轮在该工作站备菜和补菜，无虚构穿墙移动。

状态快照附带同刻 `reports`，厨房/管理只需读取一次 state 即可获取原子一致的事实与统计；单独 reports 接口保留。quality.expired、action.started、action.ended、playback.completed 是确定时刻的派生事件，连同任务转态构成离散 revision。补菜结束动画前 staff.taskId 仍对应原任务。servingWindows.staffPosition 为3D导出的厨房地面工作点，启用供餐口缺少此字段时正式数据包校验失败，禁止用轨道中心替代。

规则唯一配置 `data/demo-v1/rules.json`，修改后执行生成和验证；生成失败时保留旧正式包，不无条件写出成功。datasetId 对数据包内容摘要派生，规则或动作变化即产生新ID，D1检测fingerprint后切换会话。客户端不要推断ID结构。

当前正式清单 LUT 的 y=0 表示水平路径投影，供餐口 position.y=0.98 表示台面高度，staffPosition.y=0 表示地面站位。厨房/前厅区域和供餐口弧长对齐在x/z平面判定，不能要求这些不同语义的y相等。实际取菜必须在厨房边界外、补菜在厨房内；两者仍按同一导出LUT插值定位。
