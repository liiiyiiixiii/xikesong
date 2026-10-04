"""Back up only this repository's isolated demo database; never a user-supplied DB."""
from pathlib import Path
import sqlite3, json, hashlib, datetime
root = Path(__file__).resolve().parents[1]
state = root / '.demo-state'
files = [p for p in (state / 'v3/d1').rglob('*.sqlite') if p.name != 'metadata.sqlite']
assert len(files) == 1, 'Expected exactly one isolated demo D1 database'
source = files[0]
assert not source.is_symlink() and source.resolve().is_relative_to(state.resolve())
folder = state / 'backups' / datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%S%f')
folder.mkdir(parents=True, mode=0o700)
backup = folder / 'database.sqlite'
with sqlite3.connect(source) as db, sqlite3.connect(backup) as dest:
    db.backup(dest)
    assert dest.execute('PRAGMA integrity_check').fetchone()[0] == 'ok'
backup.chmod(0o600)
report = folder / 'backup.json'
report.write_text(json.dumps({'database':str(source), 'backup':str(backup), 'sha256':hashlib.sha256(backup.read_bytes()).hexdigest()}))
report.chmod(0o600)
(state / 'seed-backup-path.txt').write_text(str(report))
print('Isolated demo database backup verified.')
