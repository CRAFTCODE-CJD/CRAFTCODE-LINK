"""Archive the Windows application folder with a single enclosing directory."""
import pathlib
import re
import sys
import zipfile
from payload_privacy import verify_payload_privacy

payload, destination = map(pathlib.Path, sys.argv[1:])
if not (payload / 'CRAFTCODE-LINK.exe').is_file():
    raise SystemExit('Missing CRAFTCODE-LINK.exe in the portable folder.')
try:
    verify_payload_privacy(payload)
except ValueError as error:
    raise SystemExit(str(error)) from None
with zipfile.ZipFile(destination, 'x', zipfile.ZIP_DEFLATED, compresslevel=6) as archive:
    for source in sorted(payload.rglob('*')):
        if not source.is_file() or source == payload / 'electron.exe':
            continue
        if re.fullmatch(r'\..+\.[A-Za-z0-9]{6}', source.name):
            continue
        archive.write(source, pathlib.Path(destination.stem) / source.relative_to(payload))
