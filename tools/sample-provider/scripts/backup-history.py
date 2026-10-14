"""Local maintenance backup. Business replacement/import itself happens over HTTP."""
import sqlite3, pathlib, hashlib, json, shutil, sys, os
source=pathlib.Path(sys.argv[1]).resolve(); destination=pathlib.Path(sys.argv[2]).resolve();destination.mkdir(parents=True,exist_ok=False);os.chmod(destination,0o700)
backup=destination/'database.sqlite'
with sqlite3.connect(source) as db, sqlite3.connect(backup) as target:
 db.backup(target)
 assert target.execute('PRAGMA integrity_check').fetchone()[0]=='ok'
 history_row=target.execute("SELECT payload FROM history_control WHERE id='live'").fetchone();history_state=json.loads(history_row[0]) if history_row else None
 counts={t:target.execute('SELECT count(*) FROM "'+t+'"').fetchone()[0] for (t,) in target.execute("SELECT name FROM sqlite_master WHERE type='table'")}
os.chmod(backup,0o600)
provider=pathlib.Path(__file__).resolve().parents[1]
for folder in ['data','output']:
 if (provider/folder).exists():shutil.copytree(provider/folder,destination/folder,ignore=shutil.ignore_patterns('history-*') if folder=='output' else None)
# Exercise restore to an isolated copy, keeping the running app's DB untouched.
restore=destination/'restore-test.sqlite';shutil.copy2(backup,restore)
with sqlite3.connect(restore) as db:
 assert db.execute('PRAGMA integrity_check').fetchone()[0]=='ok'
 for t,n in counts.items():assert db.execute('SELECT count(*) FROM "'+t+'"').fetchone()[0]==n
 db.execute('DELETE FROM history_control');db.execute('DELETE FROM history_batches');db.commit()
restore.unlink()
sha=hashlib.sha256(backup.read_bytes()).hexdigest()
report={'database':str(source),'backup':str(backup),'sha256':sha,'counts':counts,'historyStateBefore':history_state,'restoreTest':'passed','restore':'Stop dev server/workerd and forecast scheduler. Restore database.sqlite to database path; remove its -wal/-shm only after all DB processes stop. Preserve a ready history_control snapshot. Clear the lock only if the backup snapshot was taken before reset under initial maintenance, then restart app. Restore data/ and output/ from this directory if needed. Do not start simulate-scales.'}
(destination/'backup.json').write_text(json.dumps(report,ensure_ascii=False,indent=2));print(json.dumps({'backup':str(destination),'sha256':sha,'restoreTest':'passed'}))
