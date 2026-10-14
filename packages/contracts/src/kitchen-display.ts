/** Shared staff-facing labels. Weight precision remains available in the audit UI. */
export type PlateAlert = 'none'|'refill'|'empty'|'warning'|'expired'|'unknown';
export const plateAlertText:Record<PlateAlert,string>={none:'',refill:'请补菜',empty:'已空盘，请补菜',warning:'即将超时',expired:'已超时，请更换',unknown:'余量待核实'};
export const plateAlertTone:Record<PlateAlert,string>={none:'normal',refill:'yellow',empty:'red',warning:'yellow',expired:'red',unknown:'muted'};
export function plateAlerts(input:{known:boolean;empty:boolean;refill:boolean;freshness?:string|null}):PlateAlert[]{
 if(input.freshness==='expired')return ['expired'];
 const result:PlateAlert[]=[];
 if(!input.known)result.push('unknown');else if(input.empty)result.push('empty');else if(input.refill)result.push('refill');
 if(input.freshness==='warning')result.push('warning');
 return result;
}
