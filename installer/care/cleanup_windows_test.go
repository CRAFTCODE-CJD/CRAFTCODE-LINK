package main

import (
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"syscall"
	"testing"
	"time"
)

func TestSpaceDiagnosticUsesTargetVolumeAndAvailableBytes(t *testing.T) {
	const mib = 1024 * 1024
	if err := checkFreeSpace("D:", 3*mib, 3*mib); err != nil {
		t.Fatal(err)
	}
	err := checkFreeSpace("D:", 2*mib-1, 3*mib+1)
	var shortage *diskSpaceError
	if !errors.As(fmt.Errorf("preflight: %w", err), &shortage) || err.Error() != "D:  1 / 4 MiB" {
		t.Fatal(err)
	}
}

func TestRepairCompletesWhenWindowsKeepsStagingDirectoryOpen(t *testing.T) {
	root := t.TempDir()
	installed := filepath.Join(root, "Программа")
	base := seedRepair(t, installed)
	staging := filepath.Join(root, base)
	exe := filepath.Join(installed, "CRAFTCODE-LINK.exe")
	file(t, exe)
	if err := os.WriteFile(exe, []byte("previous release"), 0600); err != nil {
		t.Fatal(err)
	}
	// A directory opened without FILE_SHARE_DELETE can still have its files
	// moved. The handle blocks only the final deletion of the empty directory.
	directory, err := syscall.UTF16PtrFromString(filepath.Join(staging, "resources", "app"))
	if err != nil {
		t.Fatal(err)
	}
	handle, err := syscall.CreateFile(directory, syscall.GENERIC_READ, syscall.FILE_SHARE_READ|syscall.FILE_SHARE_WRITE, nil, syscall.OPEN_EXISTING, syscall.FILE_FLAG_BACKUP_SEMANTICS, 0)
	if err != nil {
		t.Fatal(err)
	}
	repairErr := repair(installed, base)
	if err := syscall.CloseHandle(handle); err != nil {
		t.Fatal(err)
	}
	if !errors.Is(repairErr, cleanupPending) {
		t.Fatalf("expected committed installation with pending cleanup, got %v", repairErr)
	}
	for _, name := range []string{"CRAFTCODE-LINK.exe", "resources/app/package.json", "Uninstall.exe"} {
		data, err := os.ReadFile(filepath.Join(installed, name))
		if err != nil || string(data) != "sample" {
			t.Fatalf("installed %s: %q, %v", name, data, err)
		}
	}
	if err := cleanCommitted(installed, base); err != nil {
		t.Fatal(err)
	}
	exists(t, staging, false)
}

func TestRemoveEmptiedDirWaitsForLastChild(t *testing.T) {
	dir := filepath.Join(t.TempDir(), "staging")
	if err := os.Mkdir(dir, 0700); err != nil {
		t.Fatal(err)
	}
	child := filepath.Join(dir, "pending")
	if err := os.WriteFile(child, []byte("pending"), 0600); err != nil {
		t.Fatal(err)
	}
	released := make(chan error, 1)
	go func() {
		time.Sleep(50 * time.Millisecond)
		released <- os.Remove(child)
	}()
	err := removeEmptiedDir(dir)
	if cleanup := <-released; cleanup != nil {
		t.Fatal(cleanup)
	}
	if err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(dir); !os.IsNotExist(err) {
		t.Fatalf("staging still present: %v", err)
	}
}
