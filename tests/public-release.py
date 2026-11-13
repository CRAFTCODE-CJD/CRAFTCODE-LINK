"""Tests for selecting immutable Git inputs and detecting archive drift without publishing."""
import hashlib
import importlib.util
import json
from pathlib import Path
import subprocess
import tempfile
import unittest
import zipfile


script = Path(__file__).resolve().parents[1] / 'scripts/public-release.py'
spec = importlib.util.spec_from_file_location('release', script)
release = importlib.util.module_from_spec(spec)
spec.loader.exec_module(release)


class PublicRelease(unittest.TestCase):
    def test_tag_ignores_later_commits_worktree_changes_and_private_files(self):
        with tempfile.TemporaryDirectory() as raw:
            base = Path(raw)
            repo = base/'project'; repo.mkdir()
            def git(*args):
                return release.git(repo,'-c','user.name=Test','-c','user.email=test@example.invalid', *args)
            git('init','-q')
            (repo/'package.json').write_text('{"version":"1.2.3"}')
            (repo/'package-lock.json').write_text(json.dumps({'version':'1.2.3','packages':{'':{'version':'1.2.3'}}}))
            (repo/'tracked').write_bytes(b'original')
            git('add','.');git('commit','-qm','base');git('tag','v1.2.3')
            (repo/'tracked').write_bytes(b'different')
            git('commit','-qam','newer')
            (repo/'private.log').write_bytes(b'untracked')
            (repo/'tracked').write_bytes(b'uncommitted')
            source=base/'source'
            commit,version,hashes=release.snapshot(repo,'v1.2.3',base,source)
            self.assertEqual(commit,git('rev-parse','v1.2.3^{}').decode().strip())
            self.assertEqual(version,'1.2.3')
            self.assertEqual(hashes['tracked'],hashlib.sha256(b'original').hexdigest())
            self.assertEqual((source/'tracked').read_bytes(),b'original')
            self.assertFalse((source/'private.log').exists())
            with self.assertRaises(ValueError):release.commit_for(repo,'HEAD')
            git('tag','v1.2.4')
            with self.assertRaisesRegex(ValueError,'version'):release.snapshot(repo,'v1.2.4',base,base/'other')

    def test_export_ignore_and_noncanonical_zip_members_are_rejected(self):
        with tempfile.TemporaryDirectory() as raw:
            root=Path(raw)
            subprocess.run(['git','init','-q',root],check=True)
            (root/'.gitattributes').write_text('required export-ignore\n')
            (root/'required').write_text('a')
            release.git(root,'add','.')
            release.git(root,'-c','user.name=Test','-c','user.email=test@example.invalid','commit','-qm','fixture')
            release.git(root,'tag','v1.0.0')
            with self.assertRaisesRegex(ValueError,'complete selected tree'):
                release.snapshot(root,'v1.0.0',root,root/'src')
            path=root/'a.zip'
            with zipfile.ZipFile(path,'w') as archive:archive.writestr('SOURCE/../file',b'a')
            with self.assertRaisesRegex(ValueError,'archive member'):release.zip_hashes(path,'SOURCE/')


if __name__ == '__main__':
    unittest.main()
