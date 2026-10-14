import type { Control } from '@zhishan/contracts/demo-v1';
import { DemoError } from './core.ts';
export type Session = { sessionId:string;datasetId:string;fingerprint:string;generation:number;controlRevision:number;offsetMs:number;anchorWallMs:number;paused:boolean;dayThroughMs:number };
export function newSession(datasetId:string,fingerprint:string,now:number):Session{return {sessionId:crypto.randomUUID(),datasetId,fingerprint,generation:0,controlRevision:0,offsetMs:0,anchorWallMs:now,paused:false,dayThroughMs:0};}
export function timeOf(s:Session,now:number,durationMs:number){return Math.min(durationMs,Math.floor(s.offsetMs+(s.paused?0:Math.max(0,now-s.anchorWallMs))));}
export function transition(s:Session,c:Control,now:number,durationMs:number):Session{
  if(c.sessionId!==s.sessionId||c.generation!==s.generation)throw new DemoError('SESSION_CONFLICT','播放会话已变化，请重新同步');
  const dayThroughMs=Math.max(s.dayThroughMs??0,timeOf(s,now,durationMs));
  if(c.action==='restart')return {...s,dayThroughMs,generation:s.generation+1,controlRevision:s.controlRevision+1,offsetMs:0,anchorWallMs:now,paused:false};
  const paused=c.action==='pause';if(paused===s.paused)return s;
  return {...s,dayThroughMs,paused,offsetMs:timeOf(s,now,durationMs),anchorWallMs:now,controlRevision:s.controlRevision+1};
}
export interface SessionStore { read():Promise<Session>; control(input:Control):Promise<Session> }
export function d1Store(db:D1Database,datasetId:string,fingerprint:string,durationMs:number,wallNow=()=>Date.now()):SessionStore{
  async function init(){
    await db.batch([
      db.prepare('CREATE TABLE IF NOT EXISTS demo_v1_session (id INTEGER PRIMARY KEY CHECK(id=1), version INTEGER NOT NULL, payload TEXT NOT NULL)'),
      db.prepare('CREATE TABLE IF NOT EXISTS demo_v1_controls (request_id TEXT PRIMARY KEY, signature TEXT NOT NULL, session_id TEXT NOT NULL)'),
    ]);
  }
  async function row(){return await db.prepare('SELECT version,payload FROM demo_v1_session WHERE id=1').first<{version:number;payload:string}>();}
  async function read(){
    await init();
    await db.prepare('INSERT OR IGNORE INTO demo_v1_session(id,version,payload) VALUES(1,0,?)').bind(JSON.stringify(newSession(datasetId,fingerprint,wallNow()))).run();
    for(let i=0;i<8;i++){
      const current=(await row())!,session=JSON.parse(current.payload) as Session;
      if(session.fingerprint===fingerprint)return session;
      await db.prepare('UPDATE demo_v1_session SET payload=?,version=version+1 WHERE id=1 AND version=?').bind(JSON.stringify(newSession(datasetId,fingerprint,wallNow())),current.version).run();
    }throw new DemoError('SESSION_CONFLICT','会话更新冲突，请重试');
  }
  async function control(input:Control){
    await read();const signature=JSON.stringify(input);
    for(let i=0;i<8;i++){
      const receipt=await db.prepare('SELECT signature,session_id FROM demo_v1_controls WHERE request_id=?').bind(input.requestId).first<{signature:string;session_id:string}>();
      if(receipt){if(receipt.signature!==signature)throw new DemoError('SESSION_CONFLICT','requestId 已用于不同控制请求');const current=await read();if(current.sessionId!==receipt.session_id)throw new DemoError('SESSION_CONFLICT','该控制请求属于旧会话');return current;}
      const current=(await row())!,session=JSON.parse(current.payload) as Session;
      if(session.fingerprint!==fingerprint)throw new DemoError('SESSION_CONFLICT','数据包已经变化');
      let next:Session;
      try{next=transition(session,input,wallNow(),durationMs);}catch(error){const retryReceipt=await db.prepare('SELECT signature,session_id FROM demo_v1_controls WHERE request_id=?').bind(input.requestId).first<{signature:string;session_id:string}>();if(retryReceipt?.signature===signature&&retryReceipt.session_id===session.sessionId)return await read();throw error;}
      const result=await db.batch([
        db.prepare('UPDATE demo_v1_session SET payload=?,version=version+1 WHERE id=1 AND version=? AND NOT EXISTS (SELECT 1 FROM demo_v1_controls WHERE request_id=?)').bind(JSON.stringify(next),current.version,input.requestId),
        db.prepare('INSERT OR IGNORE INTO demo_v1_controls(request_id,signature,session_id) SELECT ?,?,? WHERE changes()=1').bind(input.requestId,signature,session.sessionId),
      ]);
      if(result[0].meta.changes)return next;
    }throw new DemoError('SESSION_CONFLICT','控制请求并发冲突，请重试');
  }
  return {read,control};
}
