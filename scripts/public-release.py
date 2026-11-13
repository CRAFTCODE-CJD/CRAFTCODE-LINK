"""Build and verify Windows release assets from a tag or immutable commit in an empty stage."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
import tempfile
import zipfile


def git(repo, *args):
    return subprocess.check_output(['git', '-C', str(repo), *args])


def commit_for(repo, ref):
    if re.fullmatch(r'v(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)', ref):
        ref = 'refs/tags/' + ref
    elif not re.fullmatch(r'[0-9a-f]{40}|[0-9a-f]{64}', ref):
        raise ValueError('Specify a stable vX.Y.Z tag or a full commit ID.')
    return git(repo, 'rev-parse', '--verify', ref + '^{commit}').decode().strip()


def digest(file):
    with file.open('rb') as stream:
        return hashlib.file_digest(stream, 'sha256').hexdigest()


def snapshot(repo, ref, work, source):
    commit = commit_for(repo, ref)
    algorithm = git(repo, 'rev-parse', '--show-object-format').decode().strip()
    blobs = {}
    for record in git(repo, 'ls-tree', '-rz', commit).split(b'\0'):
        if not record:
            continue
        metadata, raw_name = record.split(b'\t', 1)
        mode, kind, oid = metadata.decode().split()
        name = raw_name.decode('utf-8')
        if kind != 'blob' or mode not in ('100644', '100755'):
            raise ValueError('Unsupported release input: ' + name)
        blobs[name] = oid
    zip_path = work / 'selected-commit.zip'
    git(repo, 'archive', '--format=zip', '--output=' + str(zip_path), commit)
    hashes = {}
    with zipfile.ZipFile(zip_path) as archive:
        files = [entry for entry in archive.infolist() if not entry.is_dir()]
        if len(files) != len(blobs) or {e.filename for e in files} != set(blobs):
            raise ValueError('git archive does not contain the complete selected tree.')
        for entry in files:
            target = (source / entry.filename).resolve()
            if not target.is_relative_to(source):
                raise ValueError('Invalid archive path: ' + entry.filename)
            data = archive.read(entry)
            actual = hashlib.new(algorithm, b'blob ' + str(len(data)).encode() + b'\0' + data)
            if actual.hexdigest() != blobs[entry.filename]:
                raise ValueError('git archive changed the selected blob: ' + entry.filename)
            target.parent.mkdir(parents=True, exist_ok=True)
            with target.open('xb') as stream:
                stream.write(data)
            hashes[entry.filename] = hashlib.sha256(data).hexdigest()
    version = json.loads((source / 'package.json').read_text(encoding='utf8'))['version']
    lock = json.loads((source / 'package-lock.json').read_text(encoding='utf8'))
    if not re.fullmatch(r'(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)', version):
        raise ValueError('package.json must declare a stable release version.')
    if lock['version'] != version or lock['packages']['']['version'] != version or (ref.startswith('v') and ref != 'v' + version):
        raise ValueError('The selected tag, package and locked package version must match.')
    return commit, version, hashes


def zip_hashes(archive_path, prefix):
    result = {}
    with zipfile.ZipFile(archive_path) as archive:
        for entry in archive.infolist():
            if entry.is_dir():
                continue
            name = entry.filename.removeprefix(prefix)
            if name == entry.filename or not name or name in result or '\\' in name or '..' in name.split('/') or name.startswith('/'):
                raise ValueError('Invalid or duplicate archive member: ' + entry.filename)
            with archive.open(entry) as stream:
                result[name] = hashlib.file_digest(stream, 'sha256').hexdigest()
    return result


def tree_hashes(root):
    return {f.relative_to(root).as_posix(): digest(f) for f in root.rglob('*') if f.is_file()}


def verify_offline_package(package, installer, version, public_key):
    # Construct the only header we expect from the independently built EXE.
    # Node's OpenSSL verifies the CNG signature with an explicit salt length.
    header = f'LINKUPD1{version} {installer.stat().st_size} {digest(installer)}\n'.encode('ascii')
    with package.open('rb') as stream, installer.open('rb') as original:
        if stream.read(len(header)) != header:
            raise ValueError('Offline metadata differs from the selected installer.')
        signature = stream.read(384)
        verify = """
          const fs=require('node:fs'),crypto=require('node:crypto');
          const jwk=JSON.parse(fs.readFileSync(process.argv[1],'utf8'));
          if(Object.keys(jwk).sort().join(',')!=='e,kty,n'||jwk.kty!=='RSA')process.exit(1);
          const key=crypto.createPublicKey({format:'jwk',key:jwk});
          const options={key,padding:crypto.constants.RSA_PKCS1_PSS_PADDING,saltLength:32};
          const input=fs.readFileSync(0);
          if(key.asymmetricKeyDetails.modulusLength!==3072||input.length<385||
             !crypto.verify('sha256',input.subarray(384),options,input.subarray(0,384)))process.exit(1);
        """
        subprocess.run(['node', '-e', verify, str(public_key)], input=signature + header, check=True)
        while chunk := original.read(1024*1024):
            if stream.read(len(chunk)) != chunk:
                raise ValueError('Offline package contains different installer bytes.')
        if stream.read(1):
            raise ValueError('Unexpected trailing offline package data.')


def add_offline_package(source, version):
    out = source / 'out'
    prefix = 'CRAFTCODE-LINK-' + version
    installer = out / (prefix + '-Setup-x64.exe')
    package = out / (prefix + '-Offline-x64.linkupdate')
    sums = out / (prefix + '-SHA256SUMS.txt')
    shell = Path(os.environ['SystemRoot']) / 'System32/WindowsPowerShell/v1.0/powershell.exe'
    signer = Path(__file__).resolve().with_name('offline-package.ps1')
    subprocess.run([str(shell), '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', str(signer),
                    '-Installer', str(installer), '-Output', str(package),
                    '-PublicKey', str(source/'src/offline-release-key.json')], check=True)
    with sums.open('ab') as stream:
        stream.write(f'{digest(package)}  {package.name}\n'.encode('ascii'))


def verify_release_manifest(source, version, signed_offline):
    out = source / 'out'
    prefix = 'CRAFTCODE-LINK-' + version
    portable = out / (prefix + '-Portable-x64.zip')
    installer = out / (prefix + '-Setup-x64.exe')
    archive = out / (prefix + '-Source.zip')
    code = out / (prefix + '-Update-Code.txt')
    sums = out / (prefix + '-SHA256SUMS.txt')
    assets = [installer, portable, archive, code]
    if signed_offline:
        package = out / (prefix + '-Offline-x64.linkupdate')
        verify_offline_package(package, installer, version, source/'src/offline-release-key.json')
        assets.append(package)
    assets.append(sums)
    expected = {file.name: digest(file) for file in assets[:-1]}
    lines = sums.read_text(encoding='ascii').splitlines()
    if sorted(lines) != sorted(sha+'  '+name for name, sha in expected.items()):
        raise ValueError('SHA256SUMS does not describe the other release files.')
    if code.read_text(encoding='ascii').splitlines() != ['LINK-UPDATE '+version+' '+expected[installer.name]]:
        raise ValueError('The update code does not match the installer.')
    return assets


def verify_output(source, version, tracked, work, seven_zip):
    assets = verify_release_manifest(source, version, False)
    installer, portable, archive = assets[:3]
    sources = zip_hashes(archive, 'SOURCE/')
    manifest = sources.pop('FILES.sha256')
    with zipfile.ZipFile(archive) as packaged:
        listed = packaged.read('SOURCE/FILES.sha256')
    if hashlib.sha256(listed).hexdigest() != manifest or sorted(listed.decode().splitlines()) != sorted(s+'  '+p for p,s in sources.items()):
        raise ValueError('Source ZIP checksum manifest differs from its contents.')
    if sources != tracked:
        unexpected = sorted(set(sources) ^ set(tracked))[:5]
        changed = [name for name in tracked if name in sources and sources[name] != tracked[name]][:5]
        raise ValueError(f'Source ZIP does not match selected Git blobs: {unexpected + changed}')
    payload = zip_hashes(portable, portable.stem + '/')
    app = {key.removeprefix('resources/app/'): value for key,value in payload.items() if key.startswith('resources/app/src/')}
    if app != {key:value for key,value in tracked.items() if key.startswith('src/')}:
        raise ValueError('Windows renderer or application source differs from the selected Git tree.')
    extracted = work / 'setup-extraction'
    subprocess.run([seven_zip, 'x','-y', '-o'+str(extracted), str(installer)], check=True, stdout=subprocess.DEVNULL)
    if tree_hashes(extracted / '$R9') != payload:
        raise ValueError('NSIS embedded application differs from the portable archive.')
    return assets


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('ref', help='stable tag or full commit SHA before tagging')
    parser.add_argument('destination', type=Path, help='new directory for the verified deliverables')
    parser.add_argument('--runtime-zip', type=Path, help='optional locally cached official Electron archive')
    parser.add_argument('--signed-offline', action='store_true',
                        help='official release: require publisher CNG key and include signed offline package')
    args = parser.parse_args()
    if os.name != 'nt':
        parser.error('Run the Windows release build on Windows x64.')
    repo = Path(__file__).resolve().parents[1]
    destination = args.destination.resolve()
    destination.parent.mkdir(parents=True, exist_ok=True)
    if destination.exists():
        parser.error('The destination already exists. Choose a new directory.')
    npm = shutil.which('npm.cmd')
    seven_zip = shutil.which('7z')
    if not npm or not seven_zip:
        parser.error('Add npm.cmd and 7z.exe to PATH.')
    with tempfile.TemporaryDirectory(prefix='.link-release-', dir=destination.parent) as raw:
        work = Path(raw)
        source = work / 'source'
        commit, version, tracked = snapshot(repo, args.ref, work, source)
        print(f'Building CRAFTCODE LINK {version} from {commit}', flush=True)
        subprocess.run([sys.executable, str(repo/'scripts/git-privacy.py'), 'history', commit, '--release'],
                       cwd=repo, check=True)
        # Each existing packager runs inside the selected checkout. Never inherit
        # module resolution paths from another Electron application or dev tree.
        env = dict(os.environ, PYTHONDONTWRITEBYTECODE='1')
        env.pop('NODE_PATH', None)
        def run(*command):
            subprocess.run(command, cwd=source, env=env, check=True)
        run(npm, 'ci', '--no-audit', '--no-fund', '--include=dev')
        run(npm, 'run', 'check')
        run(npm, 'test')
        pack = ['node', 'scripts/package-win.cjs']
        if args.runtime_zip:
            pack.extend(['--runtime-zip', str(args.runtime_zip.resolve())])
        run(*pack)
        run(sys.executable, 'scripts/package-setup.py')
        run('node', 'scripts/handoff.cjs', '--installer')
        # Sign only after the source, installer contents and original checksum
        # manifest have been verified against the selected Git tree.
        assets = verify_output(source, version, tracked, work, seven_zip)
        if args.signed_offline:
            add_offline_package(source, version)
            assets = verify_release_manifest(source, version, True)
        delivery = work / 'delivery'
        delivery.mkdir()
        for file in assets:
            file.rename(delivery / file.name)
        delivery.rename(destination)
        print(f'Verified {len(tracked)} Git blobs and {len(assets)} release assets from {commit}: {destination}')


if __name__ == '__main__':
    main()
