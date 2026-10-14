import { localDate,shiftDate } from '../preferences/types.ts';
// The latest due day only: never manufacture a run of missed historical snapshots.
export function archiveDue(now:string,closeTime:string,scenarioEnd?:string){
 if(scenarioEnd)return {date:scenarioEnd,late:false};
 const today=localDate(now),cutoff=Date.parse(`${today}T${closeTime}:00+08:00`)+600000;
 return Date.parse(now)>=cutoff?{date:today,late:false}:{date:shiftDate(today,-1),late:true};
}
