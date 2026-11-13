package main

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func file(t *testing.T, p string) {
	t.Helper()
	if err := os.MkdirAll(filepath.Dir(p), 0755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(p, []byte("sample"), 0644); err != nil {
		t.Fatal(err)
	}
}
func exists(t *testing.T, p string, want bool) {
	t.Helper()
	_, err := os.Stat(p)
	if (err == nil) != want {
		t.Fatalf("%s: want exists=%v, got %v", p, want, err)
	}
}
func prepare(t *testing.T, p string) (string, string) {
	t.Helper()
	base, err := stage(p)
	if err != nil {
		t.Fatal(err)
	}
	staged := filepath.Join(filepath.Dir(p), base)
	names, err := paths()
	if err != nil {
		t.Fatal(err)
	}
	for _, name := range append(names, "Uninstall.exe") {
		file(t, filepath.Join(staged, filepath.FromSlash(name)))
	}
	return base, staged
}
func TestInstallInCustomFolder(t *testing.T) {
	p := filepath.Join(t.TempDir(), "Игры и связь", "CRAFTCODE LINK")
	base, s := prepare(t, p)
	if err := commit(p, base); err != nil {
		t.Fatal(err)
	}
	exists(t, filepath.Join(p, "CRAFTCODE-LINK.exe"), true)
	exists(t, s, false)
}
func TestExistingEmptyFolder(t *testing.T) {
	p := filepath.Join(t.TempDir(), "existing")
	os.Mkdir(p, 0755)
	base, _ := prepare(t, p)
	if err := commit(p, base); err != nil {
		t.Fatal(err)
	}
}
func TestRejectOccupied(t *testing.T) {
	p := filepath.Join(t.TempDir(), "folder")
	file(t, filepath.Join(p, "photo.png"))
	if _, err := stage(p); err == nil {
		t.Fatal("accepted occupied folder")
	}
	exists(t, filepath.Join(p, "photo.png"), true)
}
func TestLateCollisionAndCancel(t *testing.T) {
	p := filepath.Join(t.TempDir(), "custom")
	base, s := prepare(t, p)
	file(t, filepath.Join(p, "personal.txt"))
	if err := commit(p, base); err == nil {
		t.Fatal("committed to occupied folder")
	}
	if _, err := run([]string{"discard", p, base}); err != nil {
		t.Fatal(err)
	}
	exists(t, filepath.Join(p, "personal.txt"), true)
	exists(t, s, false)
}
func TestInvalidStage(t *testing.T) {
	p := filepath.Join(t.TempDir(), "custom")
	for _, base := range []string{"..", "photos", tempPrefix + "../../../x"} {
		if _, err := stagePath(p, base); err == nil {
			t.Fatal(base)
		}
	}
}
func TestIncompleteStage(t *testing.T) {
	p := filepath.Join(t.TempDir(), "custom")
	base, s := prepare(t, p)
	os.Remove(filepath.Join(s, "Uninstall.exe"))
	if err := commit(p, base); err == nil {
		t.Fatal("incomplete")
	}
	exists(t, p, false)
}
func TestMissingApplicationFileCancelsInstall(t *testing.T) {
	p := filepath.Join(t.TempDir(), "custom")
	base, staged := prepare(t, p)
	if err := os.Remove(filepath.Join(staged, "resources", "app", "package.json")); err != nil {
		t.Fatal(err)
	}
	if err := commit(p, base); err == nil {
		t.Fatal("committed an application that cannot start")
	}
	exists(t, p, false)
	if err := discard(p, base); err != nil {
		t.Fatal(err)
	}
	exists(t, staged, false)
}

func TestRemoveChecksForConflictingFoldersBeforeChangingFiles(t *testing.T) {
	p := filepath.Join(t.TempDir(), "custom")
	exe := filepath.Join(p, "CRAFTCODE-LINK.exe")
	file(t, exe)
	personal := filepath.Join(p, "resources", "app", "package.json", "notes.txt")
	file(t, personal)
	if err := removePayload(p); err == nil {
		t.Fatal("accepted a folder at an application file path")
	}
	exists(t, exe, true)
	exists(t, personal, true)
}
func TestRemoveKeepAndRetry(t *testing.T) {
	root := t.TempDir()
	p := filepath.Join(root, "custom")
	base, _ := prepare(t, p)
	if err := commit(p, base); err != nil {
		t.Fatal(err)
	}
	preserved := filepath.Join(root, "appdata", product, "prefs")
	file(t, preserved)
	extra := filepath.Join(p, "resources", "photos", "photo.png")
	file(t, extra)
	for i := 0; i < 2; i++ {
		if err := removePayload(p); err != nil {
			t.Fatal(err)
		}
	}
	exists(t, filepath.Join(p, "CRAFTCODE-LINK.exe"), false)
	exists(t, extra, true)
	exists(t, preserved, true)
	exists(t, filepath.Join(p, "Uninstall.exe"), true)
}
func TestPurgeOnlyOwnProfile(t *testing.T) {
	base := t.TempDir()
	for _, part := range []string{"Local Storage/leveldb/db", "logs/main.log", "reports/result.json", "media-test/Cache/db", "craftlink-account-v1.bin"} {
		file(t, filepath.Join(base, product, part))
	}
	other := filepath.Join(base, "другие данные", "photo")
	file(t, other)
	for i := 0; i < 2; i++ {
		if err := purge(base); err != nil {
			t.Fatal(err)
		}
	}
	exists(t, filepath.Join(base, product), false)
	exists(t, other, true)
}
func TestNoTraversalViaLinks(t *testing.T) {
	root := t.TempDir()
	outside := filepath.Join(root, "personal")
	file(t, filepath.Join(outside, "keep"))
	base := filepath.Join(root, "data")
	p := filepath.Join(base, product)
	os.MkdirAll(p, 0755)
	if err := os.Symlink(outside, filepath.Join(p, "linked")); err != nil {
		t.Skip(err)
	}
	if err := purge(base); err != nil {
		t.Fatal(err)
	}
	exists(t, filepath.Join(outside, "keep"), true)
	if err := os.Symlink(outside, p); err != nil {
		t.Fatal(err)
	}
	if err := purge(base); err != nil {
		t.Fatal(err)
	}
	exists(t, filepath.Join(outside, "keep"), true)
	inst := filepath.Join(root, "installed")
	os.Mkdir(inst, 0755)
	file(t, filepath.Join(inst, "CRAFTCODE-LINK.exe"))
	os.Symlink(outside, filepath.Join(inst, "resources"))
	if err := removePayload(inst); err == nil {
		t.Fatal("followed link")
	}
	exists(t, filepath.Join(inst, "CRAFTCODE-LINK.exe"), true)
	if err := validate(filepath.Join(inst, "resources", "app")); err == nil {
		t.Fatal("accepted redirected target")
	}
}
func TestDigest(t *testing.T) {
	p := filepath.Join(t.TempDir(), "link")
	file(t, p)
	h, err := digest(p)
	if err != nil || !strings.HasPrefix(h, "af2bdbe1") || len(h) != 64 {
		t.Fatal(h, err)
	}
}
func seedRepair(t *testing.T, p string) string {
	t.Helper()
	base, err := repairStage(p)
	if err != nil {
		t.Fatal(err)
	}
	s := filepath.Join(filepath.Dir(p), base)
	names, _ := paths()
	for _, n := range append(names, "Uninstall.exe") {
		file(t, filepath.Join(s, n))
	}
	return base
}
func TestRepairCorruptMissingAndUninstaller(t *testing.T) {
	root := t.TempDir()
	// Windows can retain a deleted child briefly after replacing application files.
	// Clean up this test's private tree before TempDir's single RemoveAll attempt.
	t.Cleanup(func() {
		if err := wipeStage(root); err != nil {
			t.Error(err)
		}
	})
	p := filepath.Join(root, "Установка")
	file(t, filepath.Join(p, "CRAFTCODE-LINK.exe"))
	os.WriteFile(filepath.Join(p, "CRAFTCODE-LINK.exe"), []byte("broken"), 0644)
	own := filepath.Join(p, "resources", "personal.txt")
	file(t, own)
	account := filepath.Join(root, "profile", "credentials")
	file(t, account)
	for i := 0; i < 2; i++ {
		base := seedRepair(t, p)
		if err := repair(p, base); err != nil {
			t.Fatal(err)
		}
		for _, n := range []string{"CRAFTCODE-LINK.exe", "resources/app/package.json", "Uninstall.exe"} {
			got, err := os.ReadFile(filepath.Join(p, n))
			if err != nil || string(got) != "sample" {
				t.Fatal(n, err)
			}
		}
		exists(t, own, true)
		exists(t, account, true)
		exists(t, filepath.Join(root, base), false)
	}
}
func TestRepairPreflightPreservesInstallation(t *testing.T) {
	root := t.TempDir()
	p := filepath.Join(root, "app")
	old := filepath.Join(p, "CRAFTCODE-LINK.exe")
	file(t, old)
	os.WriteFile(old, []byte("original"), 0644)
	base := seedRepair(t, p)
	os.MkdirAll(filepath.Join(p, "resources/app/package.json"), 0755)
	if err := repair(p, base); err == nil {
		t.Fatal("overwrote directory")
	}
	got, _ := os.ReadFile(old)
	if string(got) != "original" {
		t.Fatal("changed before validation")
	}
	if err := discard(p, base); err != nil {
		t.Fatal(err)
	}
}
func TestRepairMissingInstallDirectory(t *testing.T) {
	p := filepath.Join(t.TempDir(), "gone")
	base := seedRepair(t, p)
	if err := repair(p, base); err != nil {
		t.Fatal(err)
	}
	exists(t, filepath.Join(p, "Uninstall.exe"), true)
}
func TestKeepBackupWhenRollbackIncomplete(t *testing.T) {
	root := t.TempDir()
	p := filepath.Join(root, "app")
	base := seedRepair(t, p)
	old := filepath.Join(root, base, backupDir, "old-file")
	file(t, old)
	if err := discard(p, base); err == nil {
		t.Fatal("removed backup")
	}
	exists(t, old, true)
}
func TestRollbackRestoresOldAndRemovesNew(t *testing.T) {
	root := t.TempDir()
	old := replacement{source: filepath.Join(root, "source"), destination: filepath.Join(root, "target"), backup: filepath.Join(root, "old"), installed: true, saved: true}
	file(t, old.destination)
	file(t, old.backup)
	os.WriteFile(old.backup, []byte("previous"), 0644)
	added := replacement{source: filepath.Join(root, "incoming"), destination: filepath.Join(root, "new"), installed: true}
	file(t, added.destination)
	if err := rollback([]replacement{old, added}); err != nil {
		t.Fatal(err)
	}
	data, _ := os.ReadFile(old.destination)
	if string(data) != "previous" {
		t.Fatal("wrong rollback")
	}
	exists(t, added.destination, false)
}
