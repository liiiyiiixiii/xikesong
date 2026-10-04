import { readFileSync,writeFileSync,mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
const input=resolve(process.argv[2]??'output/unified-36x42-20260903-20261005-v4'),output=resolve(process.argv[3]??input+'/csv'),read=p=>JSON.parse(readFileSync(input+'/'+p,'utf8')),manifest=read('manifest.json');mkdirSync(output,{recursive:true});
const bundles=Array.from({length:manifest.expectedBatches},(_,i)=>JSON.parse(read(`batches/${String(i+1).padStart(4,'0')}.json`).payload));
const save=(name,headers,rows)=>{const escape=v=>v==null?'NA':'"'+String(v).replaceAll('"','""')+'"';writeFileSync(output+'/'+name,[headers,...rows].map(r=>r.map(escape).join(',')).join('\r\n')+'\r\n');};
save('dishes.csv',['dish_id','name','category','unit','synthetic_piece_weight_g','launch_date'],manifest.catalog.map(c=>[c.id,c.name,c.category,'g',null,c.launchDate]));
save('store_days.csv',['date','business_status','snapshot_available_at','final_available_at'],[...new Set(bundles.map(b=>b.daily.date))].map(d=>[d,'open',d+'T20:00:00+08:00',d+'T22:00:00+08:00']));
const fields={date:'date',dish_id:'dishId',data_status:'status',taken_20:'take20',taken_final:'takeFinal',taken_weight_g:'takeG',opening_stock:'opening',replenished:'replenished',waste:'waste',closing_stock:'closing',supply_status:'supply',stockout_minutes:'stockoutMinutes',snapshot_available_at:'snapshotAt',final_available_at:'finalAt',age_waste:'ageWaste',closing_waste:'closingWaste',kitchen_retained:'retainedKitchen'};
save('dish_days.csv',Object.keys(fields),bundles.map(b=>Object.values(fields).map(k=>b.daily[k])));console.log('Derived CSV exports:',output);
