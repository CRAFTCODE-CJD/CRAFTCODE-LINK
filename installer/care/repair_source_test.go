package main

import (
	"os"
	"path/filepath"
	"testing"
)

func TestRepairSourceIsPinnedAndIsolated(t *testing.T) {
	downloads, temp := t.TempDir(), t.TempDir()
	setup := filepath.Join(downloads, "Selected.exe")
	good := []byte("MZ matching release")
	if err := os.WriteFile(setup, good, 0600); err != nil {
		t.Fatal(err)
	}
	want, err := digest(setup)
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(downloads, "adjacent.dll"), []byte("untrusted"), 0600); err != nil {
		t.Fatal(err)
	}
	dir, err := run([]string{"prepare-repair", setup, temp, want})
	if err != nil {
		t.Fatal(err)
	}
	entries, err := os.ReadDir(filepath.Join(temp, dir))
	if err != nil || len(entries) != 1 || entries[0].Name() != "Setup.exe" {
		t.Fatalf("expected a private setup alone: %v, %v", entries, err)
	}
	if err := os.WriteFile(setup, []byte("MZ replaced after selection"), 0600); err != nil {
		t.Fatal(err)
	}
	if got, err := digest(filepath.Join(temp, dir, "Setup.exe")); err != nil || got != want {
		t.Fatalf("prepared installer changed: %q, %v", got, err)
	}
	for _, candidate := range []string{setup, filepath.Join(downloads, "missing.exe"), downloads} {
		if _, err := copyRepairSource(candidate, temp, want); err == nil {
			t.Fatalf("accepted unavailable or mismatched source %s", candidate)
		}
	}
	remaining, err := os.ReadDir(temp)
	if err != nil || len(remaining) != 1 || remaining[0].Name() != dir {
		t.Fatalf("failed verification retained temporary files: %v, %v", remaining, err)
	}
}
