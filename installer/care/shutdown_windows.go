package main

import (
	"errors"
	"os"
	"path/filepath"
	"strings"
	"syscall"
	"time"
	"unsafe"
)

// RM_UNIQUE_PROCESS binds the request to one instance, even if Windows reuses a PID.
type rmProcess struct {
	PID     uint32
	Started syscall.Filetime
}
type installationProcess struct {
	id     rmProcess
	parent uint32
}

func installationProcesses(exe string) ([]installationProcess, error) {
	session, err := sameSession(uint32(os.Getpid()))
	if err != nil {
		return nil, err
	}
	snapshot, err := syscall.CreateToolhelp32Snapshot(syscall.TH32CS_SNAPPROCESS, 0)
	if err != nil {
		return nil, err
	}
	defer syscall.CloseHandle(snapshot)
	entry := syscall.ProcessEntry32{}
	entry.Size = uint32(unsafe.Sizeof(entry))
	var matches []installationProcess
	for err = syscall.Process32First(snapshot, &entry); err == nil; err = syscall.Process32Next(snapshot, &entry) {
		if !strings.EqualFold(syscall.UTF16ToString(entry.ExeFile[:]), filepath.Base(exe)) {
			continue
		}
		sid, e := sameSession(entry.ProcessID)
		if e != nil || sid != session {
			continue
		}
		handle, e := syscall.OpenProcess(0x1000, false, entry.ProcessID) // PROCESS_QUERY_LIMITED_INFORMATION
		if e != nil {
			if errors.Is(e, syscall.Errno(87)) {
				continue
			} // Already exited.
			return nil, e
		}
		buf := make([]uint16, 32768)
		n := uint32(len(buf))
		ok, _, queryErr := kernel.NewProc("QueryFullProcessImageNameW").Call(uintptr(handle), 0, uintptr(unsafe.Pointer(&buf[0])), uintptr(unsafe.Pointer(&n)))
		if ok == 0 {
			syscall.CloseHandle(handle)
			return nil, queryErr
		}
		if strings.EqualFold(syscall.UTF16ToString(buf[:n]), exe) {
			var creation, exit, kernelTime, userTime syscall.Filetime
			e = syscall.GetProcessTimes(handle, &creation, &exit, &kernelTime, &userTime)
			if e == nil {
				matches = append(matches, installationProcess{rmProcess{entry.ProcessID, creation}, entry.ParentProcessID})
			}
		}
		syscall.CloseHandle(handle)
		if e != nil {
			return nil, e
		}
	}
	if err != syscall.ERROR_NO_MORE_FILES {
		return nil, err
	}
	return matches, nil
}

// Companions release loopback capture and the virtual adapter after the GUI
// closes their control pipes. Never terminate a process by executable name.
func waitForCompanions(dir string) error {
	deadline := time.Now().Add(25 * time.Second)
	for {
		running := false
		for _, name := range []string{"link-game.exe", "link-audio.exe"} {
			target := filepath.Join(dir, "resources", "app", "bin", name)
			if _, err := os.Stat(target); os.IsNotExist(err) {
				continue
			} else if err != nil {
				return err
			}
			peers, err := installationProcesses(target)
			if err != nil {
				return err
			}
			if len(peers) > 0 {
				running = true
				break
			}
		}
		if !running {
			return nil
		}
		if time.Now().After(deadline) {
			return busy
		}
		time.Sleep(150 * time.Millisecond)
	}
}

func shutdownInstallation(dir string) error {
	if err := target(dir); err != nil {
		return err
	}
	exe := filepath.Join(dir, "CRAFTCODE-LINK.exe")
	if err := safeChain(exe); err != nil {
		return err
	}
	procs, err := installationProcesses(exe)
	if err != nil {
		return err
	}
	if len(procs) == 0 {
		return waitForCompanions(dir)
	}
	// Ask the main process first so it can release capture, room and profile.
	ids := make(map[uint32]bool)
	for _, p := range procs {
		ids[p.id.PID] = true
	}
	var roots []rmProcess
	for _, p := range procs {
		if !ids[p.parent] {
			roots = append(roots, p.id)
		}
	}
	if len(roots) == 0 {
		return busy
	}
	dll := syscall.NewLazyDLL("rstrtmgr.dll")
	var handle uint32
	var key [33]uint16
	code, _, _ := dll.NewProc("RmStartSession").Call(uintptr(unsafe.Pointer(&handle)), 0, uintptr(unsafe.Pointer(&key[0])))
	if code != 0 {
		return syscall.Errno(code)
	}
	defer dll.NewProc("RmEndSession").Call(uintptr(handle))
	code, _, _ = dll.NewProc("RmRegisterResources").Call(uintptr(handle), 0, 0, uintptr(len(roots)), uintptr(unsafe.Pointer(&roots[0])), 0, 0)
	if code != 0 {
		return syscall.Errno(code)
	}
	code, _, _ = dll.NewProc("RmShutdown").Call(uintptr(handle), 0, 0) // No forced shutdown.
	deadline := time.Now().Add(8 * time.Second)
	for {
		left, e := installationProcesses(exe)
		if e != nil {
			return e
		}
		if len(left) == 0 {
			return waitForCompanions(dir)
		}
		if time.Now().After(deadline) {
			if code != 0 {
				return syscall.Errno(code)
			}
			return busy
		}
		time.Sleep(150 * time.Millisecond)
	}
}
