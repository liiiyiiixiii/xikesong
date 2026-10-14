import {writeFileSync,mkdirSync} from 'node:fs';
const names=['豆皮','鲜虾','土豆','豆腐','香菇','生菜','丸子','海带','藕片','西瓜','小馒头','腐竹','五花肉','羊肉','鸡肉','菠菜','鱼片','鱿鱼','扇贝','青口贝','蟹棒','鱼丸','豆腐','鹌鹑蛋','鸡蛋','豆皮','冻豆腐','腐竹','魔芋','粉丝','年糕','生菜','米饭','玉米','南瓜','西瓜','胡萝卜','白萝卜','西兰花','白菜','菠菜','娃娃菜'];
let seed=20261004;const random=()=>((seed=(Math.imul(seed,1664525)+1013904223)>>>0)/4294967296);
const start=Date.parse('2026-10-04T12:00:00+08:00');
const plates=names.map((dishName,i)=>({slotId:i+1,scaleId:`lunch-${i+1}`,dishId:`dish-${names.indexOf(dishName)+1}`,dishName,fullG:1000,remainingG:i<4?220:350+Math.floor(random()*500),status:'active',observedAt:new Date(start).toISOString()}));
const events=[],snapshots=[];let count=4,entered=0,left=0;
for(let second=0;second<=600;second++){
 const at=new Date(start+second*1000).toISOString();
 if([30,70,110,160,215,270,330,390].includes(second)){count++;entered++;events.push({second,kind:'enter',count:1});}
 if([460,540].includes(second)){count--;left++;events.push({second,kind:'leave',count:1});}
 for(let i=0;i<42;i++){
  const p=plates[i];let take=0,refill=0;
  if(i<4){if(second===40+i*35)take=100;if(second===55+i*35)take=120;if(second===75+i*35)refill=850;}
  if(second>220&&second%7===0&&random()<.13)take=Math.min(p.remainingG,15+Math.floor(random()*35));
  if(i>=4&&second>0&&second%11===0&&random()<.11)take=Math.min(p.remainingG,15+Math.floor(random()*30));
  if(second>240&&p.remainingG<120&&second%23===0)refill=900-p.remainingG;
  if(take){p.remainingG-=take;events.push({second,kind:'take',slotId:i+1,weightG:take});}
  if(refill){p.remainingG+=refill;events.push({second,kind:'refill',slotId:i+1,weightG:refill});}
  p.status=p.remainingG===0?'empty':'active';p.observedAt=at;
 }
 snapshots.push({second,observedAt:at,customers:{count,entered,left,initial:4},plates:structuredClone(plates)});
}
const manifest={id:'lunch-demo-20261004-v1',seed:20261004,start:'2026-10-04T12:00:00+08:00',durationSeconds:600,frameCount:601,synthetic:true,description:'独立午餐仿真，不参与经营历史或分析'};
mkdirSync('data/lunch-demo',{recursive:true});
for(const [name,value] of Object.entries({manifest,events,snapshots}))writeFileSync(`data/lunch-demo/${name}.json`,JSON.stringify(value));
console.log({frames:snapshots.length,events:events.length,finalCustomers:count});
