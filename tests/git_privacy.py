"""Integration checks use only temporary local repositories and synthetic identities."""
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import unittest


ROOT = Path(__file__).resolve().parents[1]


class PublicationPrivacy(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.base = Path(temporary.name)
        self.repo = self.base / "source"
        self.repo.mkdir()
        self.remote = self.base / "receiver.git"
        self.env = {**os.environ, "GIT_CONFIG_NOSYSTEM": "1", "GIT_CONFIG_GLOBAL": os.devnull}
        self.git("init", "-q", "-b", "main")
        self.git("init", "--bare", "-q", str(self.remote))
        self.git("remote", "add", "receiver", str(self.remote))
        self.git("config", "user.name", "CRAFTCODE-CJD")
        self.git("config", "user.email", "123+CRAFTCODE-CJD@users.noreply.github.com")
        for name in ["scripts/git-privacy.py", "scripts/payload-privacy.json", ".gitignore"]:
            target = self.repo / name
            target.parent.mkdir(exist_ok=True)
            shutil.copyfile(ROOT / name, target)
        self.git("add", ".")
        self.git("commit", "-qm", "Public baseline")

    def run_process(self, args, success=True, input=None, env=None):
        proc = subprocess.run(args, cwd=self.repo, env={**self.env, **(env or {})},
                              text=True, capture_output=True, input=input)
        self.assertEqual(proc.returncode == 0, success, proc.stderr + proc.stdout)
        return proc.stdout + proc.stderr

    def git(self, *args, **kwargs):
        return self.run_process(["git", *args], **kwargs)

    def guard(self, *args, **kwargs):
        return self.run_process([sys.executable, "scripts/git-privacy.py", *args], **kwargs)

    def stage(self, name, data):
        file = self.repo / name
        file.parent.mkdir(parents=True, exist_ok=True)
        file.write_bytes(data)
        self.git("add", "-f", "--", name)
        return file

    def test_index_profile_archive_credentials_and_exact_staged_bytes(self):
        private = "Example-" + "LocalAlias123"
        (self.repo / ".link-private-terms").write_text(private, encoding="utf-8")
        self.git("check-ignore", "-q", ".link-private-terms")
        self.git("check-ignore", "-q", "private-release.zip")
        cases = [
            ("nested/exports/CRAFTCODE LINK Data/innocent.txt", b"hidden"),
            ("nested/diagnostics/report.txt", b"session"),
            ("nested/test-results/trace.json", b"{}"),
            ("nested/demo.cclprofile", b"private"),
            (".link-private-terms", private.encode()),
            ("release.zip", b"archive"),
            ("nested/misnamed.txt", b"PK"+bytes([3, 4])+b"private"),
            ("nested/key.txt", b"ghp_"+b"X"*39),
            ("nested/renamed.txt", b"SQLite format 3\0"+b"data"),
            ("nested/notes.md", private.swapcase().encode("utf-16le")),
            ("nested/test-path.md", ("C:"+chr(92)+"Users"+chr(92)+"demo"+chr(92)+"Downloads").encode()),
            ("nested/"+private+".txt", b"private"),
        ]
        for name, data in cases:
            with self.subTest(name=name):
                selected = self.stage(name, data)
                # Cleaning the worktree cannot clean the staged Git object.
                if name != ".link-private-terms":
                    selected.write_bytes(b"clean bytes on disk")
                out = self.guard("index", success=False)
                self.assertNotIn(private.lower(), out.lower())
                self.git("reset", "-q", "HEAD", "--", name)
        self.guard("index")

    def test_installed_hooks_share_stdin_with_existing_hook_and_block_deleted_history(self):
        hooks = self.repo / ".prior-hooks"
        hooks.mkdir()
        log = self.repo / ".git" / "prior-input"
        prior = hooks / "pre-push"
        prior.write_bytes(b"#!/bin/sh\ncat > .git/prior-input\n")
        prior.chmod(0o755)
        self.git("config", "--local", "core.hooksPath", ".prior-hooks")
        version = tuple(int(n) for n in self.git("version").split()[2].split(".")[:2])
        if version < (2, 55):
            self.skipTest("Named hooks require Git 2.55+")
        self.guard("install", "--publisher")
        self.guard("install", "--publisher")
        self.assertEqual(self.git("config", "--get", "core.hooksPath").strip(), ".prior-hooks")
        self.git("push", "-q", "receiver", "main")
        baseline = self.git("rev-parse", "HEAD").strip()
        self.assertIn(baseline, log.read_text())
        self.stage("nested/private.zip", b"data")
        self.git("commit", "-qm", "Accidental archive", success=False)
        self.git("commit", "--no-verify", "-qm", "Accidental archive")
        self.git("rm", "-q", "nested/private.zip")
        self.git("commit", "-qm", "Remove archive")
        out = self.git("push", "-q", "receiver", "main", success=False)
        self.assertIn("Publication blocked", out)
        self.assertEqual(self.git("--git-dir="+str(self.remote), "rev-parse", "main").strip(), baseline)
        self.git("tag", "all-clean-on-the-surface")
        self.git("push", "-q", "receiver", "refs/tags/all-clean-on-the-surface", success=False)
        # A contributor may use their own identity. The publisher's main/tag
        # also rejects either identity field by itself.
        self.git("switch", "-qc", "contribution", baseline)
        self.git("-c", "user.name=Example Contributor", "-c", "user.email=demo@example.invalid",
                 "commit", "--allow-empty", "-qm", "Contribution")
        self.guard("history", "HEAD", baseline, "--ci")
        self.git("push", "-q", "receiver", "contribution")
        self.git("push", "-q", "receiver", "HEAD:main", success=False)
        self.git("tag", "v-test-private-author")
        self.git("push", "-q", "receiver", "refs/tags/v-test-private-author", success=False)
        self.git("switch", "-qc", "annotate", baseline)
        self.git("-c", "user.name=Example Tagger", "-c", "user.email=demo@example.invalid",
                 "tag", "-am", "Tagged for release", "v-test-private-tagger")
        self.git("push", "-q", "receiver", "refs/tags/v-test-private-tagger", success=False)
        self.git("commit", "--allow-empty", "-qm", "Private committer",
                 env={"GIT_COMMITTER_NAME": "Example", "GIT_COMMITTER_EMAIL": "demo@example.invalid"})
        self.guard("history", "HEAD", baseline, "--release", success=False)


if __name__ == "__main__":
    unittest.main()
