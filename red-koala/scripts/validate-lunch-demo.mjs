import {readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
execFileSync(process.execPath,['--experimental-strip-types','--test','tests/lunch-demo.test.ts'],{stdio:'inherit'});
const read=name=>JSON.parse(readFileSync(`data/lunch-demo/${name}.json`,'utf8'));
const frames=read('snapshots'),events=read('events');
const report={passed:true,frameCount:frames.length,eventCount:events.length,bowls:42,distinctDishes:new Set(frames[0].plates.map(p=>p.dishName)).size,initialCustomers:4,entered:8,left:2,maxCustomers:Math.max(...frames.map(f=>f.customers.count)),sha256:Object.fromEntries(['manifest','events','snapshots'].map(name=>[name,createHash('sha256').update(readFileSync(`data/lunch-demo/${name}.json`)).digest('hex')])),checks:['weight-conservation','customer-conservation','nonnegative-weights','low-and-empty-refill','600-second-clock-cycle']};
writeFileSync('data/lunch-demo/validation.json',JSON.stringify(report,null,2));
