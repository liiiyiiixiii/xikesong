/** Deterministic poses sampled from the shared presentation clock, in seconds. */
export function kitchenMotion(time:number,role:string,phase=0){
 const t=time+phase*.13;
 const chop=Math.sin(t*Math.PI*3.2),stir=t*Math.PI*.85;
 const plateCycle=((t/3.6)%1+1)%1;
 const transfer=Math.sin(plateCycle*Math.PI*2);
 if(role==='chop')return {rightX:-1.24+chop*.53,rightY:0,rightZ:-.06,leftX:-1.37,leftY:.1,lean:.10+Math.max(0,-chop)*.045,head:.23,food:false};
 if((role==='cook'||role==='mix'))return {rightX:-1.28+Math.sin(stir)*.24,rightY:Math.cos(stir)*.33,rightZ:-.14+Math.sin(stir)*.17,leftX:-1.22,leftY:-.2,lean:.09+Math.sin(stir)*.03,head:.18,food:false};
 return {rightX:-1.30+Math.cos(plateCycle*Math.PI*2)*.31,rightY:transfer*.52,rightZ:-.10,leftX:-1.36,leftY:-.16,lean:.07+Math.max(0,transfer)*.055,head:.20,food:plateCycle>.15&&plateCycle<.57};
}
