'use client';
import type {SnapshotMetadata} from '@/lib/analysis/snapshot-version';
export default function SnapshotNotice({snapshot}:{snapshot?:SnapshotMetadata}){
 return <div className="scale-muted"><p>画像数据依据：旧版称重差分账本（legacy_delta_v1）。{snapshot?<>来源 {snapshot.source} · 算法 {snapshot.algorithmVersion} · 截止 {new Date(snapshot.asOf).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai'})}。</>:'该快照尚无版本校验信息。'}新业务工作台的轮次计量不并入此画像。</p>{snapshot&&<p role={snapshot.currentness==='outdated'?'status':undefined}>{snapshot.currentness==='outdated'?'依据已变化；保留原快照与原备餐确认，请重新评估后再制定新计划。':snapshot.currentness==='current'?'相同截止时间的依据校验一致。':snapshot.currentness==='unknown'?'暂无法核验当前依据，保留原快照。':'该历史快照尚未核验是否过期。'}</p>}{snapshot&&<details><summary>快照依据指纹</summary><small>{snapshot.fingerprint}</small><p>最近核验：{snapshot.checkedAt?new Date(snapshot.checkedAt).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai'}):'未核验'}</p></details>}</div>;
}
