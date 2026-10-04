"""Verify and unpack the bundled synthetic dataset. Python standard library only."""
from pathlib import Path, PurePosixPath
import hashlib, json, shutil, sys, zipfile
ROOT = Path(__file__).resolve().parents[1]
META = json.loads((ROOT / 'datasets/manifest.json').read_text())
archive = ROOT / 'datasets' / META['archive']
def digest(path):
    h = hashlib.sha256()
    with path.open('rb') as f:
        for chunk in iter(lambda: f.read(1024 * 1024), b''): h.update(chunk)
    return h.hexdigest()
assert digest(archive) == META['sha256'], 'Archive checksum mismatch'
files = {item['path']: item for item in META['files']}
assert len(files) == len(META['files']), 'Duplicate manifest entries'
verify_only = '--verify-only' in sys.argv
with zipfile.ZipFile(archive) as z:
    assert len(z.namelist()) == len(files) and set(z.namelist()) == set(files), 'Archive inventory mismatch'
    destinations = {}
    for name, item in files.items():
        parts = PurePosixPath(name).parts
        assert not name.startswith('/') and '..' not in parts and '\\' not in name, 'Unsafe archive path'
        if parts[0] == 'csv': base = ROOT / 'sample-provider/data'
        elif parts[0] == 'lunch-demo': base = ROOT / 'red-koala/data/lunch-demo'
        elif parts[0] == 'unified-36x42-20260903-20261005-v4': base = ROOT / 'sample-provider/output' / parts[0]
        else: raise ValueError('Unexpected dataset root')
        dest = base.joinpath(*parts[1:])
        assert not any(p.is_symlink() for p in [dest, *dest.parents] if p != ROOT.parent), 'Symlink destination rejected'
        data = z.read(name)
        assert len(data) == item['bytes'] and hashlib.sha256(data).hexdigest() == item['sha256'], name
        if not verify_only and dest.exists(): assert digest(dest) == item['sha256'], f'Existing file differs; move it aside first: {dest}'
        destinations[name] = dest
    if not verify_only:
        for name, dest in destinations.items():
            if dest.exists(): continue
            dest.parent.mkdir(parents=True, exist_ok=True)
            with z.open(name) as source, dest.open('wb') as target: shutil.copyfileobj(source, target)
print(('Verified' if verify_only else 'Verified and extracted') + f' {len(files)} files; synthetic dataset {META["datasetId"]}')
