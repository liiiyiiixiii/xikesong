// Shared by historical validation and the live simulated operator. Never hide alarms in UI.
export const anomalyPolicy = Object.freeze({version:1,maxConcurrentBowls:1,confirmationSeconds:90});
export function pendingToConfirm(pending, now=Date.now()) {
 const sorted=[...pending].sort((a,b)=>a.at.localeCompare(b.at)||a.id.localeCompare(b.id));
 const keep=sorted.find(e=>now-Date.parse(e.at)<anomalyPolicy.confirmationSeconds*1000)?.scaleId;
 return sorted.filter(e=>e.scaleId!==keep||now-Date.parse(e.at)>=anomalyPolicy.confirmationSeconds*1000);
}
export function concurrentAnomalies(intervals){
 const points=intervals.flatMap(x=>[{at:x.from,scaleId:x.scaleId,delta:1},{at:x.to,scaleId:x.scaleId,delta:-1}]).sort((a,b)=>a.at-b.at||a.delta-b.delta);
 const active=new Map();let maximum=0;
 for(const p of points){const n=(active.get(p.scaleId)||0)+p.delta;if(n>0)active.set(p.scaleId,n);else active.delete(p.scaleId);maximum=Math.max(maximum,active.size);}
 return maximum;
}
