# 接口最小样例

这里的1盘/2座方形路径仅用于契约教学与独立测试，不是门店几何或正式容量，运行服务不会读取这些文件。正式场景副本和短包唯一位于 `data/demo-v1/`。

生成：`node --experimental-strip-types scripts/write-demo-examples.ts`。state/manifest/events/reports 使用同一示例会话与45秒模拟时刻；control 使用该会话演示字段格式，实际请求必须先获取当前 sessionId/generation。

hardware-boundary-v2-NOT-IMPLEMENTED 是合法但返回501的协议样例；hardware-weight-v1 是现有严格重量协议，发送前替换设备/启动ID、采样时间并配置测试凭证。
