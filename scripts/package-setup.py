"""Build the per-user Russian NSIS wizard from the verified Windows payload."""
import hashlib
import json
import os
import pathlib
import re
import shutil
import subprocess
import tempfile

root = pathlib.Path(__file__).resolve().parents[1]
version = json.loads((root / 'package.json').read_text(encoding='utf-8'))['version']
out = root / 'out'
payload = out / f'CRAFTCODE-LINK-{version}-win-x64'
dest = out / f'CRAFTCODE-LINK-{version}-Setup-x64.exe'
if dest.exists():
    raise SystemExit(f'Output already exists: {dest}')
metadata = json.loads((payload / 'BUILD-INFO.json').read_text(encoding='utf-8'))
if (metadata['version'], metadata['platform'], metadata['arch']) != (version,'win32','x64'):
    raise SystemExit('Build the matching portable x64 payload first.')
files = {}
for file in sorted(payload.rglob('*')):
    if file.is_symlink():
        raise SystemExit(f'Unexpected symbolic link: {file}')
    if not file.is_file() or re.fullmatch(r'\..+\.[A-Za-z0-9]{6}', file.name) or file == payload / 'electron.exe':
        continue
    rel = file.relative_to(payload)
    if any('"' in part or '\n' in part or '$' in part for part in rel.parts):
        raise SystemExit(f'Unsupported payload path: {rel}')
    files[rel] = file
if pathlib.Path('CRAFTCODE-LINK.exe') not in files:
    raise SystemExit('Application executable is missing')
# Per-file allocation rounded up to 64 KiB plus room for uninstaller and metadata.
required_kib = 4096 + sum(((p.stat().st_size + 65535) // 65536) * 64 for p in files.values())

def quoted(value):
    return '"' + str(value).replace('$','$$').replace('"','$\\"') + '"'

def abi_arg(arg):
    return ('/' if os.name=='nt' else '-') + arg

with tempfile.TemporaryDirectory(prefix='craftcode-setup-') as temp:
    work = pathlib.Path(temp)
    native = work / 'care'
    shutil.copytree(root / 'installer/care', native)
    (native / 'payload.txt').write_text(''.join(f'{r.as_posix()}\n' for r in files),encoding='utf-8')
    (native / 'size.go').write_text(f'package main\nconst requiredBytes uint64 = {required_kib * 1024}\n')
    exe = work / 'care.exe'
    environment = dict(os.environ, GOOS='windows', GOARCH='amd64', CGO_ENABLED='0', GOTOOLCHAIN='local', GOPROXY='off')
    subprocess.run(['go','build','-trimpath','-buildvcs=false','-ldflags=-s -w','-o',str(exe),'.'],cwd=native,env=environment,check=True)
    instructions = []
    last = None
    for rel, file in files.items():
        if rel.parent != last:
            subdir = '' if rel.parent==pathlib.Path('.') else '\\' + str(pathlib.PureWindowsPath(rel.parent))
            instructions.append('SetOutPath "$R9' + subdir + '"')
            last = rel.parent
        instructions.append('File ' + quoted(file))
    include = work / 'files.nsh'
    include.write_text('\n'.join(instructions)+'\n',encoding='utf-8-sig')
    definitions = {'HELPER':exe,'VERSION':version,'OUTPUT':work/dest.name,'PAYLOAD_NSH':include,
                   'REQUIRED_KIB':required_kib,'SIDEBAR_BITMAP':root/'installer/sidebar.bmp',
                   'HEADER_BITMAP':root/'installer/header.bmp','ICON':root/'src/renderer/assets/craftlink.ico'}
    subprocess.run(['makensis',abi_arg('V3'),*[abi_arg(f'D{k}={v}') for k,v in definitions.items()],str(root/'installer/setup.nsi')],check=True)
    shutil.copyfile(work/dest.name, dest)
print(f'{dest.name}: {len(files)} files; wizard requires {required_kib} KiB; SHA-256 {hashlib.file_digest(dest.open("rb"),"sha256").hexdigest()}')
