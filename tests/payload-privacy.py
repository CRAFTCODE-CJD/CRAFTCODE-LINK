"""Exercise both Python release builders with synthetic, isolated payloads."""
import pathlib
import shutil
import subprocess
import sys
import tempfile
import unittest
import zipfile

ROOT = pathlib.Path(__file__).resolve().parents[1]


class PayloadPrivacy(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='link-release-privacy-')
        self.addCleanup(self.temp.cleanup)
        self.root = pathlib.Path(self.temp.name)
        self.scripts = self.root / 'scripts'
        self.scripts.mkdir()
        for name in ('package-setup.py', 'package-portable.py', 'payload_privacy.py', 'payload-privacy.json'):
            shutil.copyfile(ROOT / 'scripts' / name, self.scripts / name)
        (self.root / 'package.json').write_text('{"version":"0.0.1"}', encoding='utf-8')
        self.payload = self.root / 'out' / 'CRAFTCODE-LINK-0.0.1-win-x64'
        self.payload.mkdir(parents=True)
        (self.payload / 'CRAFTCODE-LINK.exe').write_bytes(b'MZ synthetic executable')

    def run_builder(self, name, *args):
        return subprocess.run([sys.executable, str(self.scripts / name), *map(str, args)],
                              cwd=self.root, capture_output=True, text=True)

    def test_both_builders_refuse_adjacent_profile_before_any_artifact(self):
        for relative in ('CRAFTCODE LINK Data/private-copy.txt', 'nested/link-personal-chats-v1.sqlite',
                         'nested/storage-location-v1.json', 'nested/profile.cclprofile'):
            with self.subTest(relative=relative):
                secret = self.payload / relative
                secret.parent.mkdir(parents=True, exist_ok=True)
                secret.write_bytes(b'synthetic private fixture')
                portable = self.root / 'portable.zip'
                for script, args in (('package-portable.py', (self.payload, portable)), ('package-setup.py', ())):
                    result = self.run_builder(script, *args)
                    self.assertNotEqual(result.returncode, 0)
                    self.assertIn('Refusing to package runtime user data', result.stderr)
                    self.assertFalse(portable.exists())
                    self.assertFalse((self.root / 'out' / 'CRAFTCODE-LINK-0.0.1-Setup-x64.exe').exists())
                    self.assertEqual(secret.read_bytes(), b'synthetic private fixture')
                shutil.rmtree(self.payload / pathlib.Path(relative).parts[0])

    def test_clean_portable_still_builds(self):
        portable = self.root / 'portable.zip'
        result = self.run_builder('package-portable.py', self.payload, portable)
        self.assertEqual(result.returncode, 0, result.stderr)
        with zipfile.ZipFile(portable) as archive:
            self.assertEqual(archive.namelist(), ['portable/CRAFTCODE-LINK.exe'])
            self.assertEqual(archive.read(archive.namelist()[0]), b'MZ synthetic executable')


if __name__ == '__main__':
    unittest.main()
