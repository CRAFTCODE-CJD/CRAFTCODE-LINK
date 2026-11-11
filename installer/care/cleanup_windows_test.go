package main

import (
	"os"
	"path/filepath"
	"testing"
	"time"
)

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
