"""Reject runtime profile material before any release archive is created."""
import json
import pathlib
import stat

RULES = json.loads(pathlib.Path(__file__).with_name('payload-privacy.json').read_text(encoding='utf-8'))
MESSAGE = ('Refusing to package runtime user data or redirected files. '
           'Preserve the existing data and rebuild in a new clean output directory.')


def verify_payload_privacy(directory):
    directory = pathlib.Path(directory)

    def walk(current):
        info = current.lstat()
        is_directory = stat.S_ISDIR(info.st_mode)
        if stat.S_ISLNK(info.st_mode) or getattr(info, 'st_file_attributes', 0) & 0x400:
            raise ValueError(MESSAGE)
        if not is_directory and not stat.S_ISREG(info.st_mode):
            raise ValueError(MESSAGE)
        name = current.name.lower()
        if is_directory:
            forbidden = name in RULES['directoryNames'] or any(name.startswith(p) for p in RULES['directoryPrefixes'])
        else:
            forbidden = (name in RULES['fileNames'] or any(name.startswith(p) for p in RULES['filePrefixes'])
                         or any(name.endswith(p) for p in RULES['fileSuffixes']))
        if forbidden:
            raise ValueError(MESSAGE)
        if is_directory:
            for child in current.iterdir():
                walk(child)

    if not stat.S_ISDIR(directory.lstat().st_mode):
        raise ValueError(MESSAGE)
    walk(directory)
