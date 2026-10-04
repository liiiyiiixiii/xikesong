import test from 'node:test';
import assert from 'node:assert/strict';
import { archiveDue } from '../lib/analysis/archive-policy.ts';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
test('daily archive uses Beijing close plus 10 minutes and marks missed latest day',()=>{
 assert.deepEqual(archiveDue('2026-10-04T22:09:59+08:00','22:00'),{date:'2026-10-03',late:true});
 assert.deepEqual(archiveDue('2026-10-04T22:10:00+08:00','22:00'),{date:'2026-10-04',late:false});
 assert.deepEqual(archiveDue('2026-10-01T00:00:00+08:00','22:00'),{date:'2026-09-30',late:true});
 assert.deepEqual(archiveDue('2026-10-04T03:00:00+08:00','22:00','2026-12-01'),{date:'2026-12-01',late:false});
});
test('SQL snapshot is unique per dataset/day, immutable, and retry lease has one owner',()=>{
 const db=new DatabaseSync(':memory:');try{
 db.exec(readFileSync(new URL('../drizzle/0007_blushing_kingpin.sql',import.meta.url),'utf8'));
 const insert=db.prepare('INSERT OR IGNORE INTO portrait_archives(id,date,source,created_at,payload,status,retry_at) VALUES(?,?,?,?,?,?,?)');
 insert.run('a','2026-10-04','live','1','original','pending','1');
 insert.run('a','2026-10-04','live','2','changed','pending','1');
 insert.run('b','2026-10-04','scenario:x','2','simulation','pending','1');
 assert.equal(db.prepare('SELECT count(*) AS n FROM portrait_archives').get()!.n,2);
 assert.equal(db.prepare('SELECT payload FROM portrait_archives WHERE id=?').get('a')!.payload,'original');
 const claim=db.prepare("UPDATE portrait_archives SET lease=?,retry_at=? WHERE id=? AND status!='complete' AND retry_at<=?");
 assert.equal(claim.run('owner','3','a','1').changes,1);
 assert.equal(claim.run('racer','3','a','1').changes,0);
 assert.equal(claim.run('retry','5','a','3').changes,1);
 const finish=db.prepare("UPDATE portrait_archives SET analysis=?,status='complete' WHERE id=? AND lease=?");
 assert.equal(finish.run('outdated','a','owner').changes,0);
 assert.equal(finish.run('saved','a','retry').changes,1);
 assert.equal(claim.run('again','8','a','7').changes,0);
 assert.equal(db.prepare('SELECT payload FROM portrait_archives WHERE id=?').get('a')!.payload,'original');
 }finally{db.close();}
});
