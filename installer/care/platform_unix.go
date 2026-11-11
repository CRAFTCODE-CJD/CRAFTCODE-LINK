//go:build !windows

package main

import (
	"os"
	"syscall"
)

func linklike(f os.FileInfo) bool           { return f.Mode()&os.ModeSymlink != 0 }
func removeDir(p string) error              { return os.NewSyscallError("rmdir", syscall.Rmdir(p)) }
func removeEmptiedDir(p string) error       { return removeDir(p) }
func platformPath(p string) error           { return nil }
func freeSpace(p string) error              { return nil }
func shutdownInstallation(dir string) error { return target(dir) }
func checkRunning() error                   { return nil }
