export interface TrendSnapshot {date:string;origin?:'saved'|'reconstructed';version:string;cohort:string;dishes:{dishId:string;name:string;share:number|null}[];}
export function summarizeTrend(points:{date:string;share:number|null}[]){
 const valid=points.filter((p):p is {date:string;share:number}=>p.share!==null&&Number.isFinite(p.share));
 if(valid.length<2)return {change:null,label:'还不足以判断趋势',detail:'至少需要两个有足够有效样本的可比日期。'};
 const first=valid[0],last=valid.at(-1)!,change=(last.share-first.share)*100;
 return {change,label:Math.abs(change)<0.05?'区间首尾基本持平':change>0?'较起点上升':'较起点下降',detail:`${first.date} 至 ${last.date}，${valid.length}个可比日期；反映估计占比变化，不代表取用总量或未来走势。`};
}
export function trendPoints(records:TrendSnapshot[],end:string,days:number,dishId:string){
 const latest=records.find(r=>r.date===end);
 return Array.from({length:days},(_,i)=>{
  const date=new Date(Date.parse(end+'T00:00:00Z')-(days-1-i)*86400000).toISOString().slice(0,10),r=records.find(r=>r.date===date);
  const compatible=!!r&&!!latest&&r.version===latest.version&&r.cohort===latest.cohort;
  const dish=r?.dishes.find(d=>d.dishId===dishId);
  return {date,origin:r?.origin??'saved',share:compatible?dish?.share??null:null,reason:!r?'无可用历史':!compatible?'模型版本或参与菜品不同':dish?.share==null?'缺少模型值':null};
 });
}
