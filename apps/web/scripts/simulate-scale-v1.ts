import {legacyScaleRequestSchema} from '../lib/scales/ingest-contract.ts';
const send=process.argv.includes('--send'),scaleId=process.env.SCALE_ID??'demo-scale-001';
const sampledAt=new Date().toISOString(),bootId=crypto.randomUUID();
const body=legacyScaleRequestSchema.parse({samples:[{scaleId,bootId,sequence:1,sampledAt,grossG:1300}]});
if(!send){console.log(JSON.stringify({mode:'dry-run',note:'仅校验旧严格重量协议；未发送、未验收真实设备',body},null,2));}
else{
 const token=process.env.SCALE_TOKEN;if(!token)throw Error('请用 SCALE_TOKEN 提供已有测试凭证；不自动生成或轮换凭证');
 const url=new URL('/api/scales/ingest',process.env.SCALE_BASE_URL??'http://127.0.0.1:5173');
 const headers={'Content-Type':'application/json',Authorization:`Bearer ${token}`};
 // Retry exactly the same boot/sequence/time/body after an unknown network outcome.
 const r=await fetch(url,{method:'POST',headers,body:JSON.stringify(body)});
 console.log(JSON.stringify({status:r.status,response:await r.json(),note:'这是模拟上报，不代表真实设备验收'}));if(!r.ok)process.exitCode=1;
}
