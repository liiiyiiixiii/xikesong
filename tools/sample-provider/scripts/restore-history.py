"""Restore a backup to an offline target. Does not stop/start processes or simulators."""
import pathlib,sqlite3,json,hashlib,sys,shutil,os,subprocess
report=json.loads(pathlib.Path(sys.argv[1]).read_text());backup=pathlib.Path(report['backup']);target=pathlib.Path(sys.argv[2] if len(sys.argv)>2 else report['database'])
assert hashlib.sha256(backup.read_bytes()).hexdigest()==report['sha256'],'backup checksum mismatch'
if target.resolve()==pathlib.Path(report['database']).resolve():
 processes=subprocess.check_output(['ps','-axo','command'],text=True)
 if any('workerd serve' in line or 'simulate-scales.mjs' in line for line in processes.splitlines()):raise RuntimeError('Stop workerd and the simulator before restoring the live database')
target.parent.mkdir(parents=True,exist_ok=True);shutil.copy2(backup,target);os.chmod(target,0o600)
for suffix in ['-wal','-shm']:pathlib.Path(str(target)+suffix).unlink(missing_ok=True)
with sqlite3.connect(target) as db:
 assert db.execute('PRAGMA integrity_check').fetchone()[0]=='ok'
 for table,count in report['counts'].items():assert db.execute('SELECT count(*) FROM "'+table+'"').fetchone()[0]==count
 row=db.execute("SELECT payload FROM history_control WHERE id='live'").fetchone();state=json.loads(row[0]) if row else None
 if state and state['phase']=='maintenance' and not state.get('reset'):
  db.execute('DELETE FROM history_control');db.execute('DELETE FROM history_batches');db.commit()
print('Verified restore:',target)
