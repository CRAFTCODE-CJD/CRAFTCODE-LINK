package main

import (
	"encoding/binary"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"syscall"
	"time"
	"unicode/utf16"
	"unsafe"
)

var kernel = syscall.NewLazyDLL("kernel32.dll")

// nsExec reads the helper's redirected diagnostic as ANSI or UTF-16LE.
// Emit a single Unicode record so non-Latin folder names survive either locale.
func writeDiagnostic(err error) {
	line := utf16.Encode([]rune("\uFEFF" + err.Error()))
	_ = binary.Write(os.Stderr, binary.LittleEndian, line)
}

// Do not share DELETE (unlike Go's default OpenFile): the startup/cleanup
// handshake must remain present until this operation explicitly releases it.
func createMaintenanceFile(base string) (*os.File, error) {
	name := filepath.Join(base, maintenanceFile)
	pointer, err := syscall.UTF16PtrFromString(name)
	if err != nil {
		return nil, err
	}
	handle, err := syscall.CreateFile(pointer, syscall.GENERIC_READ|syscall.GENERIC_WRITE, syscall.FILE_SHARE_READ, nil, syscall.CREATE_NEW, syscall.FILE_ATTRIBUTE_NORMAL, 0)
	if err != nil {
		return nil, &os.PathError{Op: "create maintenance guard", Path: name, Err: err}
	}
	return os.NewFile(uintptr(handle), name), nil
}

func linklike(f os.FileInfo) bool {
	return f.Sys().(*syscall.Win32FileAttributeData).FileAttributes&syscall.FILE_ATTRIBUTE_REPARSE_POINT != 0
}
func removeDir(p string) error { return os.NewSyscallError("RemoveDirectory", syscall.Rmdir(p)) }

func retryStageCleanup(err error) bool {
	return errors.Is(err, syscall.ERROR_DIR_NOT_EMPTY) || errors.Is(err, syscall.ERROR_ACCESS_DENIED) ||
		errors.Is(err, syscall.Errno(32)) || errors.Is(err, syscall.Errno(33)) // sharing or lock violation
}

// A child marked for deletion can keep its parent nonempty until the last
// Windows handle closes. Only retry rmdir on the directory already traversed.
func removeEmptiedDir(p string) error {
	err := removeDir(p)
	for delay := 20 * time.Millisecond; errors.Is(err, syscall.ERROR_DIR_NOT_EMPTY) && delay <= 320*time.Millisecond; delay *= 2 {
		time.Sleep(delay)
		err = removeDir(p)
	}
	if err != nil {
		return &os.PathError{Op: "remove emptied directory", Path: p, Err: err}
	}
	return nil
}
func platformPath(p string) error {
	vol := filepath.VolumeName(p)
	if len(vol) != 2 || vol[1] != ':' || len(utf16.Encode([]rune(p))) > 180 {
		return errors.New("use a local disk")
	}
	for _, part := range strings.Split(p[len(vol)+1:], "\\") {
		if !filepath.IsLocal(part) || strings.ContainsAny(part, "<>:\"/|?*") || strings.HasSuffix(part, ".") || strings.HasSuffix(part, " ") {
			return errors.New("invalid folder name")
		}
	}
	for _, key := range []string{"APPDATA", "LOCALAPPDATA", "TEMP", "USERPROFILE", "WINDIR", "ProgramFiles", "ProgramFiles(x86)"} {
		root := os.Getenv(key)
		if root != "" && strings.EqualFold(root, p) {
			return errors.New("select an application subfolder")
		}
	}
	for _, protected := range []string{filepath.Join(os.Getenv("APPDATA"), product), os.Getenv("WINDIR")} {
		rel, err := filepath.Rel(protected, p)
		if err == nil && (rel == "." || filepath.IsLocal(rel)) {
			return errors.New("protected folder")
		}
	}
	return nil
}
func freeSpace(p string) error {
	for {
		_, err := os.Stat(p)
		if err == nil {
			break
		}
		if !errors.Is(err, os.ErrNotExist) {
			return err
		}
		parent := filepath.Dir(p)
		if parent == p {
			return err
		}
		p = parent
	}
	ptr, err := syscall.UTF16PtrFromString(p)
	if err != nil {
		return err
	}
	var available uint64
	r, _, err := kernel.NewProc("GetDiskFreeSpaceExW").Call(uintptr(unsafe.Pointer(ptr)), uintptr(unsafe.Pointer(&available)), 0, 0)
	if r == 0 {
		return err
	}
	return checkFreeSpace(filepath.VolumeName(p), available, requiredBytes)
}

func checkFreeSpace(volume string, available, required uint64) error {
	if available < required {
		return &diskSpaceError{volume, available, required}
	}
	return nil
}
func sameSession(pid uint32) (uint32, error) {
	var session uint32
	ok, _, err := kernel.NewProc("ProcessIdToSessionId").Call(uintptr(pid), uintptr(unsafe.Pointer(&session)))
	if ok == 0 {
		return 0, err
	}
	return session, nil
}
func checkRunning() error {
	session, err := sameSession(uint32(os.Getpid()))
	if err != nil {
		return err
	}
	snap, err := syscall.CreateToolhelp32Snapshot(syscall.TH32CS_SNAPPROCESS, 0)
	if err != nil {
		return err
	}
	defer syscall.CloseHandle(snap)
	var entry syscall.ProcessEntry32
	entry.Size = uint32(unsafe.Sizeof(entry))
	for err = syscall.Process32First(snap, &entry); err == nil; err = syscall.Process32Next(snap, &entry) {
		if strings.EqualFold(syscall.UTF16ToString(entry.ExeFile[:]), "CRAFTCODE-LINK.exe") {
			id, e := sameSession(entry.ProcessID)
			if e != nil || id == session {
				return busy
			}
		}
	}
	if err == syscall.ERROR_NO_MORE_FILES {
		return nil
	}
	return err
}

func checkProfileProcess(pid uint32, started uint64) error {
	handle, err := syscall.OpenProcess(0x1000, false, pid)
	if errors.Is(err, syscall.Errno(87)) {
		return nil
	} // Process already exited.
	if err != nil {
		return err
	}
	defer syscall.CloseHandle(handle)
	var creation, exit, kernelTime, userTime syscall.Filetime
	if err = syscall.GetProcessTimes(handle, &creation, &exit, &kernelTime, &userTime); err != nil {
		return err
	}
	if uint64(creation.HighDateTime)<<32|uint64(creation.LowDateTime) != started {
		return nil
	}
	if exit.HighDateTime != 0 || exit.LowDateTime != 0 {
		return nil
	}
	return busy
}

func currentProcessStart() (uint64, error) {
	handle, err := syscall.OpenProcess(0x1000, false, uint32(os.Getpid()))
	if err != nil {
		return 0, err
	}
	defer syscall.CloseHandle(handle)
	var creation, exit, kernelTime, userTime syscall.Filetime
	if err = syscall.GetProcessTimes(handle, &creation, &exit, &kernelTime, &userTime); err != nil {
		return 0, err
	}
	return uint64(creation.HighDateTime)<<32 | uint64(creation.LowDateTime), nil
}
