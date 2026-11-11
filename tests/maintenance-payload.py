"""Exercise the maintenance filesystem engine in a temporary directory with two release installers.
Usage: python tests/maintenance-payload.py PREVIOUS-Setup.exe CURRENT-Setup.exe [CURRENT-Portable.zip]
Requires Go 1.22+, 7z and enough disk for both unpacked releases. Does not change the registry.
"""
import hashlib
import json
import os
import pathlib
import shutil
import subprocess
import sys
import tempfile
import zipfile

root = pathlib.Path(__file__).resolve().parents[1]
if len(sys.argv) not in (3, 4):
    raise SystemExit(__doc__)
previous, current = [pathlib.Path(a).resolve(strict=True) for a in sys.argv[1:3]]
def digest(path):
    with path.open('rb') as stream:
        return hashlib.file_digest(stream, 'sha256').hexdigest()

def extract(setup, to):
    subprocess.run([shutil.which('7z') or '7z','x','-y',f'-o{to}',str(setup)],check=True,stdout=subprocess.DEVNULL)
    return to / '$R9'

with tempfile.TemporaryDirectory(prefix='craftcode-maintenance-test-') as temp:
    work = pathlib.Path(temp)
    old = extract(previous, work/'older')
    fresh = extract(current, work/'newer')
    installed = work/'Программы для связи'/'CRAFTCODE LINK'
    installed.parent.mkdir()
    shutil.copytree(old, installed)
    names = sorted(f.relative_to(fresh).as_posix() for f in fresh.rglob('*') if f.is_file() and f.name != 'Uninstall.exe')
    if len(sys.argv) == 4:
        portable = pathlib.Path(sys.argv[3])
        with zipfile.ZipFile(portable) as archive:
            files = [entry.filename for entry in archive.infolist() if not entry.is_dir()]
            expected = [portable.stem + '/' + name for name in names]
            assert sorted(files) == sorted(expected), 'Installer and portable file lists differ'
            for name, member in zip(names, expected):
                with archive.open(member) as stream:
                    assert hashlib.file_digest(stream, 'sha256').hexdigest() == digest(fresh/name), name
        print(f'PASS portable ZIP and installer contain the same {len(names)} files, verified by SHA-256.')
    if os.name == 'nt':
        helper = fresh.parent / '$PLUGINSDIR' / 'care.exe'
        assert helper.is_file(), 'Missing maintenance helper in Windows installer'
    else:
        helper = work / 'care'
        build = work / 'source'
        shutil.copytree(root / 'installer/care', build)
        (build / 'payload.txt').write_text('\n'.join(names)+'\n', encoding='utf-8')
        subprocess.run(['go','build','-trimpath','-buildvcs=false','-o',str(helper),'.'],cwd=build,check=True)
    if not (fresh / 'Uninstall.exe').exists():
        # NSIS creates this file at install time; some extractors cannot reconstruct it.
        (fresh / 'Uninstall.exe').write_bytes(b'fixture for NSIS WriteUninstaller')
        print('Uninstaller replacement uses a fixture. The wizard and uninstaller are not executed.')
    def run(op, *args):
        return subprocess.check_output([str(helper),op,*map(str,args)],text=True).strip()

    # Use the same commit operation as a fresh installation, entirely under the test directory.
    clean = work/'clean'/'CRAFTCODE LINK'
    base = run('stage',clean)
    stage = clean.parent/base
    (stage/'CRAFTCODE-LINK.exe').touch()
    (stage/'Uninstall.exe').touch()
    refused = subprocess.run([str(helper),'commit',str(clean),base],capture_output=True)
    assert refused.returncode != 0 and not clean.exists(), 'Accepted an incomplete application'
    run('discard',clean,base)
    base = run('stage',clean)
    stage = clean.parent/base
    # NSIS writes the files into its staging folder. Copying the fixture there
    # also works while Windows is scanning the newly extracted directory.
    shutil.copytree(fresh, stage, dirs_exist_ok=True)
    run('commit',clean,base)
    assert not stage.exists()
    fresh = clean
    print('PASS fresh install: incomplete stage refused, complete payload committed.')

    old_version = json.loads((installed/'BUILD-INFO.json').read_text(encoding='utf-8'))['version']
    new_version = json.loads((fresh/'BUILD-INFO.json').read_text(encoding='utf-8'))['version']
    assert old_version != new_version, 'Provide an actual earlier installer'
    def wizard_action(installed_version):
        return run('maintenance-action', new_version, installed_version)
    assert wizard_action(old_version) == 'update'
    assert wizard_action(new_version) == 'repair'
    print(f'PASS version decision used by the wizard: {old_version} -> {new_version}, then same-version repair.')

    personal = installed/'my-notes.txt'
    personal.write_bytes(b'keep')
    appdata = work/'appdata'
    profile = appdata/'CRAFTCODE LINK'
    profile.mkdir(parents=True)
    login = profile/'example.bin'
    login.write_bytes(b'private-setting')
    (installed/'CRAFTCODE-LINK.exe').write_bytes(b'damaged executable')
    (installed/'Uninstall.exe').unlink(missing_ok=True)

    for _ in range(2):
        base = run('repair-stage',installed)
        stage = installed.parent/base
        shutil.copytree(fresh,stage,dirs_exist_ok=True)
        run('repair',installed,base)
        assert not stage.exists()
        assert personal.read_bytes()==b'keep' and login.read_bytes()==b'private-setting'
        for name in [*names,'Uninstall.exe']:
            assert digest(installed/name)==digest(fresh/name),name
    print(f'PASS update and repeat repair: {len(names)} files plus the uninstaller; personal file and profile preserved.')
    run('remove',installed)
    assert personal.read_bytes()==b'keep' and login.read_bytes()==b'private-setting'
    assert all(not (installed/name).exists() for name in names)
    run('purge',appdata)
    assert not profile.exists() and personal.read_bytes()==b'keep'
    print('PASS manifest removal with preserved profile, then opt-in profile cleanup.')
