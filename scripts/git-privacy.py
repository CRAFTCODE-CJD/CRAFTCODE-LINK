"""Check Git objects that will actually be committed or published. No dependencies."""
import fnmatch
import getpass
import hashlib
import json
import os
from pathlib import Path
import re
import socket
import subprocess
import sys
import unicodedata


HERE = Path(__file__).resolve().parent
RULES = json.loads((HERE / "payload-privacy.json").read_text(encoding="utf-8"))
VENDORED_ARCHIVE = "third-party-sources/ffmpeg/ffmpeg-9db86ce5b5b454dfc96c435f9f0723012980c37f.tar.gz"
VENDORED_DIGEST = "10c884ed84d619559e14c17f013d92192c06142b66491ae413b8c6a96d6b682b"
OID = re.compile(r"(?:[a-f0-9]{40}|[a-f0-9]{64})\Z")
PUBLIC_IDENT = re.compile(rb"CRAFTCODE-CJD <(?:[0-9]+\+)?CRAFTCODE-CJD@users\.noreply\.github\.com>\Z")
DIRECTORIES = {
    ".git", ".codex", ".ssh", ".gnupg", ".aws", ".local", ".cache", ".venv",
    "node_modules", "out", "dist", "build", "logs", "coverage", "downloads",
    "diagnostics", "profiles", "userdata", "user data", "appdata", "crashpad",
    "browser-data", "test-results", "playwright-report", "test-reports", "qa-output",
    "cache", "local storage", "session storage", "network", "indexeddb",
    *RULES["directoryNames"],
}
DIRECTORY_GLOBS = [
    *[p + "*" for p in RULES["directoryPrefixes"]], "link-chat-ui-*", "craftlink-av-ui-*",
    "link-test-reports*", "dm-????????????", "tmp-profile*", "test-profile*",
]
FILE_NAMES = {
    *RULES["fileNames"], ".link-private-terms", ".npmrc", ".netrc", "_netrc", ".git-credentials",
    "credentials", "credentials.json", "secrets.json", "id_rsa", "id_dsa", "id_ecdsa",
    "id_ed25519", "cookies", "login data", "local state", "preferences", "local.properties",
}
FILE_GLOBS = [
    *[p + "*" for p in RULES["filePrefixes"]], *["*" + s for s in RULES["fileSuffixes"]],
    "*.sqlite*", "*.db", "*.db-wal", "*.db-shm", "*.log", "*.part", "*.bak", "*.dmp",
    "*.pcap*", "*.etl", "*.har", "*.key", "*.exe", "*.msi", "*.apk", "*.aab",
    "*.zip", "*.7z", "*.rar", "*.tar", "*.gz", "*.tgz", "*.xz", "*.bz2", "*.cab",
    "link-test-reports*", "diagnosis_*.md", "diagnostics-*.json", "codex-clipboard-*",
]
CONTENT = [
    ("private key", re.compile(rb"-----BEGIN (?:[A-Z0-9]+ )*PRIVATE KEY-----\s+[A-Za-z0-9+/=]{8,}")),
    ("credential", re.compile(rb"\b(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{50,}|AKIA[A-Z0-9]{16}|npm_[a-zA-Z0-9]{32,}|xox[baprs]-[a-zA-Z0-9-]{16,}|sk-(?:proj-|svcacct-)?[a-zA-Z0-9_-]{32,})\b")),
    ("credential in URL", re.compile(rb"https?://[A-Za-z0-9_.%-]{1,80}:[A-Za-z0-9_.%+-]{6,}@")),
    ("credential assignment", re.compile(rb'''(?i)["']?(?:password|access_token|client_secret|api_key|auth_token|private_key)["']?\s*[:=]\s*["'](?!test-transfer-secret["'])[A-Za-z0-9_./+=-]{20,}["']''')),
    ("LINK identity or contact card", re.compile(rb'''(?:\bCCF1:[A-Za-z0-9_-]{70,}|"root"\s*:\s*"[0-9a-f]{64}")''')),
    ("absolute home path", re.compile(rb"(?i)(?:[a-z]:[\\/]+users[\\/]+|/(?:home|Users)/)[\w.-]{2,}[\\/]")),
]
MAX_BLOB = 32 * 1024 * 1024
ZERO = lambda oid: bool(OID.fullmatch(oid)) and set(oid) == {"0"}


class Refusal(Exception):
    pass


def git(*args, optional=False):
    result = subprocess.run(["git", "--no-replace-objects", *args], stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    if optional and result.returncode == 1:
        return b""
    if result.returncode:
        raise Refusal("Git could not read the selected objects or configuration. Fetch full history and retry.")
    return result.stdout


def oid_for(revision):
    value = git("rev-parse", "--verify", "--end-of-options", revision).decode().strip()
    if not OID.fullmatch(value):
        raise Refusal("Unexpected object ID.")
    return value


def local_terms():
    base = Path(git("rev-parse", "--show-toplevel").decode().strip())
    values = {getpass.getuser(), Path.home().name, socket.gethostname()}
    # Generic OS accounts such as 'root' and 'runner' are common in source code.
    generic = {"root", "runner", "admin", "administrator", "user", "default", "public", "guest", "system", "build", "jenkins", "developer", "craftcode-cjd"}
    terms = {value.casefold() for value in values if len(value) >= 4 and value.casefold() not in generic}
    private = base / ".link-private-terms"
    if private.exists():
        terms.update(line.strip().casefold() for line in private.read_text(encoding="utf-8-sig").splitlines()
                     if line.strip() and not line.lstrip().startswith("#"))
    return sorted(unicodedata.normalize("NFKC", term) for term in terms)


def safe_label(path, terms):
    if any(term in unicodedata.normalize("NFKC", path).casefold() for term in terms) or not path.isprintable():
        return "(private path redacted)"
    return ascii(path)[:200]


def bad_path(path):
    parts = unicodedata.normalize("NFKC", path).casefold().replace("\\", "/").split("/")
    if any(not part or part in (".", "..") or ":" in part or not part.isprintable() for part in parts):
        return True
    if any(part in DIRECTORIES or any(fnmatch.fnmatchcase(part, pat) for pat in DIRECTORY_GLOBS) for part in parts[:-1]):
        return True
    name = parts[-1]
    return (name in FILE_NAMES or (name.startswith(".env") and name != ".env.example") or
            path != VENDORED_ARCHIVE and any(fnmatch.fnmatchcase(name, pat) for pat in FILE_GLOBS))


def check_data(data, terms, location):
    samples = [data]
    head = data[:512]
    if data.startswith(b"\xff\xfe") or head[1::2].count(0) > len(head) // 5:
        samples.append(data.decode("utf-16-le", errors="ignore").encode())
    if data.startswith(b"\xfe\xff") or head[::2].count(0) > len(head) // 5:
        samples.append(data.decode("utf-16-be", errors="ignore").encode())
    for sample in samples:
        for reason, pattern in CONTENT:
            if pattern.search(sample):
                raise Refusal(f"{location}: {reason}.")
        if terms:
            text = unicodedata.normalize("NFKC", sample.decode("utf-8", errors="replace")).casefold()
            if any(term in text for term in terms):
                raise Refusal(f"{location}: private local term (value redacted).")


def read_tags(oid, release, terms):
    while git("cat-file", "-t", oid).strip() == b"tag":
        data = git("cat-file", "tag", oid)
        check_data(data, terms, "tag " + oid[:12])
        if release:
            require_identity(data.partition(b"\n\n")[0], [b"tagger"], oid)
        oid = data.splitlines()[0].split()[1].decode()
    if git("cat-file", "-t", oid).strip() != b"commit":
        raise Refusal("Public refs must point to a commit.")
    return oid


def require_identity(headers, keys, oid):
    for key in keys:
        entries = [line[len(key)+1:].rsplit(b" ", 2)[0] for line in headers.splitlines() if line.startswith(key+b" ")]
        if len(entries) != 1 or not PUBLIC_IDENT.fullmatch(entries[0]):
            raise Refusal(f"{oid[:12]}: expected the public project {key.decode()} name and GitHub noreply address.")


class Audit:
    def __init__(self, terms):
        self.terms = terms
        self.paths = {}
        self.checked_blobs = set()
        self.commits = {}
        self.trees = set()

    def tree(self, tree, source):
        if tree in self.trees:
            return
        paths = git("ls-tree", "-rz", "--full-tree", tree).split(b"\0")[:-1]
        todo = {}
        for entry in paths:
            meta, raw = entry.split(b"\t", 1)
            mode, kind, obj = meta.split()
            path = raw.decode("utf-8")
            location = source + " " + safe_label(path, self.terms)
            if path not in self.paths:
                if bad_path(path):
                    raise Refusal(location + ": private or generated path.")
                check_data(raw, self.terms, location)
                self.paths[path] = True
            if kind != b"blob" or mode not in (b"100644", b"100755"):
                raise Refusal(location + ": redirected or non-file entry.")
            # The vendor archive exception is bound both to this path and its bytes.
            key = (obj, path == VENDORED_ARCHIVE)
            if key not in self.checked_blobs:
                todo[key] = (path, location)
        if todo:
            with subprocess.Popen(["git", "--no-replace-objects", "cat-file", "--batch"], stdin=subprocess.PIPE, stdout=subprocess.PIPE) as reader:
                try:
                    for key, (path, location) in todo.items():
                        obj, vendor = key
                        reader.stdin.write(obj + b"\n")
                        reader.stdin.flush()
                        header = reader.stdout.readline().split()
                        if len(header) != 3 or header[:2] != [obj, b"blob"] or not 0 <= int(header[2]) <= MAX_BLOB:
                            raise Refusal(location + ": missing or oversized object.")
                        size = int(header[2])
                        blob = reader.stdout.read(size)
                        if len(blob) != size or reader.stdout.read(1) != b"\n":
                            raise Refusal("Truncated Git object.")
                        if vendor:
                            if hashlib.sha256(blob).hexdigest() != VENDORED_DIGEST:
                                raise Refusal(location + ": unverified third-party archive.")
                        else:
                            if blob.startswith((b"PK\x03\x04", b"PK\x05\x06", b"PK\x07\x08", b"7z\xbc\xaf\x27\x1c", b"Rar!\x1a\x07", b"\x1f\x8b\x08", b"SQLite format 3\0", b"CCPROF1\n", b"version https://git-lfs.github.com/spec/v1\n")):
                                raise Refusal(location + ": archive, profile, database or unchecked LFS pointer.")
                            check_data(blob, self.terms, location)
                        self.checked_blobs.add(key)
                finally:
                    reader.stdin.close()
                    reader.kill()
        self.trees.add(tree)

    def range(self, new, old=None, release=False):
        check_data(new.encode(), self.terms, "ref name")
        new = read_tags(oid_for(new), release, self.terms)
        revisions = [new]
        if old and not ZERO(old):
            # After a force-push the previous remote object may not exist locally.
            result = subprocess.run(["git", "--no-replace-objects", "rev-parse", "--verify", "--quiet", "--end-of-options", old+"^{commit}"], capture_output=True)
            if not result.returncode:
                revisions.append("^"+result.stdout.decode().strip())
        commits = git("rev-list", "--topo-order", *revisions).decode().splitlines()
        # A new lightweight tag or a recreated branch can point at a commit the
        # remote already has. Still check its final tree and release metadata.
        for oid in dict.fromkeys([new, *commits]):
            if oid in self.commits and (self.commits[oid] or not release):
                continue
            data = git("cat-file", "commit", oid)
            header = data.partition(b"\n\n")[0]
            if release:
                require_identity(header, [b"author", b"committer"], oid)
            check_data(data, self.terms, "commit " + oid[:12])
            self.tree(header.splitlines()[0].split()[1].decode(), oid[:12])
            self.commits[oid] = release


def install(publisher):
    version = git("version").decode()
    match = re.search(r"(\d+)\.(\d+)", version)
    if not match or tuple(map(int, match.groups())) < (2, 55):
        raise Refusal("Install Git 2.55 or newer for composable config hooks. Manual 'index' and 'history' checks also work on older versions.")
    additions = []
    hooks = [("link-index-privacy", "pre-commit", "index"), ("link-push-privacy", "pre-push", "push")]
    for name, event, command in hooks:
        prefix = "hook." + name
        for group in [event, name]:
            if git("config", "--bool", "--get", "hook."+group+".enabled", optional=True).strip() == b"false":
                raise Refusal(event + " is disabled. Existing hook settings were preserved.")
        # Use repository-relative scripts, including for linked worktrees.
        python = "python" if os.name == "nt" else "python3"
        for suffix, value in [(".command", python + " scripts/git-privacy.py " + command), (".event", event)]:
            key = prefix + suffix
            current = git("config", "--get-all", key, optional=True).decode().splitlines()
            if current and current != [value]:
                raise Refusal("Existing hook name conflicts with " + name + ". No existing hook was replaced.")
            if not current:
                additions.append((key, value))
    for key, value in additions:
        git("config", "--local", key, value)
    for name, event, _ in hooks:
        if name not in git("hook", "list", event).decode().splitlines():
            raise Refusal(event + " is disabled; enable the configured project hook.")
    if publisher:
        git("config", "--local", "craftlink.privacyPublisher", "true")
    print("Project privacy hooks installed. Existing hooks and core.hooksPath are preserved.")


def main(args):
    if args in (["install"], ["install", "--publisher"]):
        install(len(args) == 2)
        return
    hook = bool(args) and args[0] == "push"
    # Git supplies the remote name and URL as arbitrary trailing arguments.
    # Neither is a scanner switch, even if a remote is literally named --ci.
    if hook:
        args = ["push"]
    release = "--release" in args
    ci = "--ci" in args
    args = [arg for arg in args if arg not in ("--release", "--ci")]
    audit = Audit([] if ci else local_terms())
    if args == ["index"]:
        audit.tree(git("write-tree").decode().strip(), "index")
    elif args and args[0] == "history" and 2 <= len(args) <= 3:
        if git("rev-parse", "--is-shallow-repository").strip() == b"true":
            raise Refusal("Fetch complete history before publication.")
        audit.range(args[1], args[2] if len(args) == 3 else None, release)
    elif args and args[0] == "push":
        publisher = git("config", "--local", "--bool", "--get", "craftlink.privacyPublisher", optional=True).strip() == b"true"
        if git("rev-parse", "--is-shallow-repository").strip() == b"true":
            raise Refusal("Fetch complete history before publication.")
        for line in sys.stdin.buffer:
            _, oid, dest, old = line.decode().strip().split()
            if not OID.fullmatch(oid) or not OID.fullmatch(old):
                raise Refusal("Invalid pre-push input.")
            if ZERO(oid):
                continue
            check_data(dest.encode(), audit.terms, "ref name")
            protected = dest == "refs/heads/main" or dest.startswith("refs/tags/")
            audit.range(oid, old, publisher and protected)
    else:
        raise Refusal("Usage: git-privacy.py index | history HEAD [BASE] [--release] [--ci] | install [--publisher]")
    print(f"Publication privacy check passed ({len(audit.commits)} commits, {len(audit.trees)} trees).")


if __name__ == "__main__":
    try:
        main(sys.argv[1:])
    except (OSError, UnicodeError, ValueError, Refusal) as error:
        # System/path errors can themselves contain a private name.
        print("Publication blocked:", str(error) if isinstance(error, Refusal) else "unreadable input.", file=sys.stderr)
        sys.exit(1)
