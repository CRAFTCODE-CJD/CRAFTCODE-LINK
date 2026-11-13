//go:build !windows

package main

import (
	"fmt"
	"os"
	"path/filepath"
	"syscall"
	"time"
)

func writeDiagnostic(err error)             { fmt.Fprintln(os.Stderr, err) }
func linklike(f os.FileInfo) bool           { return f.Mode()&os.ModeSymlink != 0 }
func removeDir(p string) error              { return os.NewSyscallError("rmdir", syscall.Rmdir(p)) }
func removeEmptiedDir(p string) error       { return removeDir(p) }
func retryStageCleanup(err error) bool      { return false }
func platformPath(p string) error           { return nil }
func freeSpace(p string) error              { return nil }
func shutdownInstallation(dir string) error { return target(dir) }
func checkRunning() error                   { return nil }
func createMaintenanceFile(base string) (*os.File, error) {
	return os.OpenFile(filepath.Join(base, maintenanceFile), os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0600)
}
func checkProfileProcess(pid uint32, started uint64) error {
	if err := syscall.Kill(int(pid), 0); err == syscall.ESRCH {
		return nil
	}
	return busy
}
func currentProcessStart() (uint64, error) { return uint64(time.Now().UnixNano()), nil }
