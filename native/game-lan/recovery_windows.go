package main

import (
	"context"
	"errors"
	"net"
	"os/exec"
	"path/filepath"
	"strings"
	"syscall"
	"time"
	"unsafe"
)

const instanceID = `SWD\Wintun\{0c45ad15-12f8-48bb-a9ab-0df169c455fc}`

type propertyKey struct {
	Format syscall.GUID
	ID     uint32
}

// DEVPKEY_Wintun_Name, recorded by Wintun independently of the editable network alias.
var wintunName = propertyKey{syscall.GUID{Data1: 0x3361c968, Data2: 0x2f2e, Data3: 0x4660, Data4: [8]byte{0xb4, 0x7e, 0x69, 0x9c, 0xdc, 0x4c, 0x32, 0xb9}}, 3}

func prepareWindowsDevice(ctx context.Context, sysdir string, repair bool) error {
	cm := syscall.NewLazyDLL(filepath.Join(sysdir, "cfgmgr32.dll"))
	locate := cm.NewProc("CM_Locate_DevNodeW")
	get := cm.NewProc("CM_Get_DevNode_PropertyW")
	inspect := func() (deviceState, error) {
		var dev uint32
		cr, _, _ := locate.Call(uintptr(unsafe.Pointer(&dev)), uintptr(unsafe.Pointer(utf(instanceID))), 0)
		if cr == 0x0d { // CR_NO_SUCH_DEVNODE. A cached interface GUID does not imply a live device.
			ifaces, err := net.Interfaces()
			if err != nil {
				return unknownDevice, err
			}
			for _, n := range ifaces {
				if strings.EqualFold(n.Name, adapterName) {
					return nameConflict, nil
				}
			}
			return missing, nil
		}
		if cr != 0 {
			return unknownDevice, recoveryFailed
		}
		var name [256]uint16
		var typ uint32
		size := uint32(unsafe.Sizeof(name))
		cr, _, _ = get.Call(uintptr(dev), uintptr(unsafe.Pointer(&wintunName)), uintptr(unsafe.Pointer(&typ)), uintptr(unsafe.Pointer(&name[0])), uintptr(unsafe.Pointer(&size)), 0)
		if cr != 0 || typ != 0x12 || !strings.EqualFold(syscall.UTF16ToString(name[:]), adapterName) {
			return unknownDevice, nil
		}
		return productDevice, nil
	}
	remove := func() error {
		if err := ctx.Err(); err != nil {
			return err
		}
		state, err := inspect()
		if err != nil {
			return err
		}
		if state == missing {
			return nil
		}
		if state != productDevice {
			return collision
		}
		limited, cancel := context.WithTimeout(ctx, 8*time.Second)
		defer cancel()
		cmd := exec.CommandContext(limited, filepath.Join(sysdir, "pnputil.exe"), "/remove-device", instanceID)
		cmd.SysProcAttr = &syscall.SysProcAttr{HideWindow: true}
		if err := cmd.Run(); err != nil {
			var exit *exec.ExitError
			if errors.As(err, &exit) && exit.ExitCode() == 3010 {
				return restartRequired
			}
			return recoveryFailed
		}
		return nil
	}
	return prepareDevice(ctx, repair, inspect, remove, pauseProbe)
}

func acquireGuard(ctx context.Context, kernel *syscall.LazyDLL) (syscall.Handle, error) {
	create := kernel.NewProc("CreateMutexW")
	for attempt := 0; ; attempt++ {
		if err := ctx.Err(); err != nil {
			return 0, err
		}
		lock, _, err := create.Call(0, 0, uintptr(unsafe.Pointer(utf(`Global\CRAFTCODE-LINK-GameLAN-0c45ad15-12f8-48bb-a9ab-0df169c455fc`))))
		if lock != 0 && err != syscall.ERROR_ALREADY_EXISTS {
			return syscall.Handle(lock), nil
		}
		if lock != 0 {
			syscall.CloseHandle(syscall.Handle(lock))
		} else if err != syscall.ERROR_ACCESS_DENIED {
			return 0, err
		}
		if attempt >= 12 {
			return 0, errors.New("busy")
		}
		if err := pauseProbe(ctx); err != nil {
			return 0, err
		}
	}
}
