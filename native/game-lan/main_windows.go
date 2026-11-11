// The elevated companion owns only one temporary game adapter. Its supervising
// TCP stream closes on application exit, even if the GUI process is killed.
package main

import (
	"bytes"
	"context"
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"encoding/binary"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"net"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strconv"
	"syscall"
	"time"
	"unsafe"
)

func utf(s string) *uint16 { p, _ := syscall.UTF16PtrFromString(s); return p }
func validPacket(b, ip []byte, fromOS bool) bool {
	if len(b) < 28 || len(b) > 1500 || b[0] != 0x45 || int(binary.BigEndian.Uint16(b[2:])) != len(b) || binary.BigEndian.Uint16(b[6:])&0xbfff != 0 {
		return false
	}
	switch b[9] {
	case 17:
		if int(binary.BigEndian.Uint16(b[24:])) != len(b)-20 {
			return false
		}
	case 6:
		if len(b) < 40 || b[32]>>4 < 5 || 20+4*int(b[32]>>4) > len(b) || b[19] == 255 {
			return false
		}
	default:
		return false
	}
	src, dst := b[12:16], b[16:20]
	all := bytes.Equal(dst, []byte{255, 255, 255, 255})
	if !bytes.Equal(src[:3], ip[:3]) || src[3] < 1 || src[3] > 17 || (!all && (!bytes.Equal(dst[:3], ip[:3]) || (dst[3] > 17 && dst[3] != 255) || dst[3] == 0)) {
		return false
	}
	if fromOS {
		return bytes.Equal(src, ip)
	}
	return !bytes.Equal(src, ip) && (all || dst[3] == 255 || bytes.Equal(dst, ip))
}

// This product-wide GUID is a Windows device identity, never a user or room key.
const adapterName = "CRAFTCODE LINK LAN"

var adapterGUID = syscall.GUID{Data1: 0x0c45ad15, Data2: 0x12f8, Data3: 0x48bb, Data4: [8]byte{0xa9, 0xab, 0x0d, 0xf1, 0x69, 0xc4, 0x55, 0xfc}}

func setupError(conn net.Conn, code string) error {
	conn.SetWriteDeadline(time.Now().Add(time.Second))
	_ = writeFrame(conn, []byte(code))
	return errors.New(code)
}

func run() error {
	repair := len(os.Args) == 5 && os.Args[4] == "repair"
	if len(os.Args) != 4 && !repair {
		return errors.New("args")
	}
	ip := net.ParseIP(os.Args[1]).To4()
	port, e := strconv.ParseUint(os.Args[2], 10, 16)
	token, te := hex.DecodeString(os.Args[3])
	if ip == nil || ip[0] != 10 || ip[1] < 80 || ip[1] > 223 || ip[2] < 1 || ip[2] > 253 || ip[3] < 1 || ip[3] > 17 || e != nil || port < 1024 || te != nil || len(token) != 32 {
		return errors.New("args")
	}
	conn, e := net.DialTimeout("tcp4", fmt.Sprintf("127.0.0.1:%d", port), 4*time.Second)
	if e != nil {
		return e
	}
	defer conn.Close()
	conn.SetDeadline(time.Now().Add(5 * time.Second))
	nonce := make([]byte, 32)
	if _, e = rand.Read(nonce); e != nil {
		return e
	}
	mac := hmac.New(sha256.New, token)
	mac.Write(append([]byte("helper"), nonce...))
	if _, e = conn.Write(append(nonce, mac.Sum(nil)...)); e != nil {
		return e
	}
	proof := make([]byte, 32)
	if _, e = io.ReadFull(conn, proof); e != nil {
		return e
	}
	mac.Reset()
	mac.Write(append([]byte("app"), nonce...))
	if !hmac.Equal(proof, mac.Sum(nil)) {
		return errors.New("authentication")
	}
	conn.SetDeadline(time.Time{})
	lifetime, incoming, stop, waitReader := watchParent(conn)
	defer waitReader()
	kernel := syscall.NewLazyDLL("kernel32.dll")
	lock, err := acquireGuard(lifetime, kernel)
	if err != nil {
		if err.Error() == "busy" {
			return setupError(conn, "busy")
		}
		return err
	}
	defer syscall.CloseHandle(lock)
	exe, e := os.Executable()
	if e != nil {
		return e
	}
	file := filepath.Join(filepath.Dir(exe), "wintun.dll")
	// Deny writes/deletion while both verifying and loading the signed vendor DLL.
	fd, e := syscall.CreateFile(utf(file), syscall.GENERIC_READ, syscall.FILE_SHARE_READ, nil, syscall.OPEN_EXISTING, 0, 0)
	if e != nil {
		return e
	}
	f := os.NewFile(uintptr(fd), file)
	defer f.Close()
	hash := sha256.New()
	if _, e = io.Copy(hash, f); e != nil {
		return e
	}
	want := map[string]string{"amd64": "e5da8447dc2c320edc0fc52fa01885c103de8c118481f683643cacc3220dafce", "arm64": "f7ba89005544be9d85231a9e0d5f23b2d15b3311667e2dad0debd344918a3f80"}
	if hex.EncodeToString(hash.Sum(nil)) != want[runtime.GOARCH] {
		return errors.New("dll digest")
	}
	var sysdir [260]uint16
	n, _, _ := kernel.NewProc("GetSystemDirectoryW").Call(uintptr(unsafe.Pointer(&sysdir[0])), 260)
	if n == 0 || n >= 260 {
		return errors.New("system directory")
	}
	system := syscall.UTF16ToString(sysdir[:])
	raw, _, e := kernel.NewProc("LoadLibraryExW").Call(uintptr(unsafe.Pointer(utf(file))), 0, 0x800)
	if raw == 0 {
		return e
	}
	dll := &syscall.DLL{Handle: syscall.Handle(raw)}
	defer dll.Release()
	if err = prepareWindowsDevice(lifetime, system, repair); err != nil {
		switch err {
		case stale, collision, recoveryFailed, restartRequired:
			return setupError(conn, err.Error())
		}
		return err
	}
	// Recheck after the UAC prompt; another VPN may have started during approval.
	addresses, err := net.InterfaceAddrs()
	if err != nil {
		return err
	}
	gameNet := net.IPNet{IP: ip.Mask(net.CIDRMask(24, 32)), Mask: net.CIDRMask(24, 32)}
	for _, addr := range addresses {
		if n, ok := addr.(*net.IPNet); ok && n.IP.To4() != nil && (n.Contains(ip) || gameNet.Contains(n.IP)) {
			return setupError(conn, "overlap")
		}
	}
	ipHelper := syscall.NewLazyDLL(filepath.Join(system, "iphlpapi.dll"))
	if lifetime.Err() != nil {
		return lifetime.Err()
	}
	ad, _, e := dll.MustFindProc("WintunCreateAdapter").Call(uintptr(unsafe.Pointer(utf(adapterName))), uintptr(unsafe.Pointer(utf("CRAFTCODE LINK"))), uintptr(unsafe.Pointer(&adapterGUID)))
	if ad == 0 {
		return e
	}
	defer dll.MustFindProc("WintunCloseAdapter").Call(ad)
	var luid uint64
	dll.MustFindProc("WintunGetAdapterLUID").Call(ad, uintptr(unsafe.Pointer(&luid)))
	var idx uint32
	var assigned syscall.GUID
	lookup, _, _ := ipHelper.NewProc("ConvertInterfaceLuidToGuid").Call(uintptr(unsafe.Pointer(&luid)), uintptr(unsafe.Pointer(&assigned)))
	if lookup != 0 || assigned != adapterGUID {
		return errors.New("unexpected adapter identity")
	}
	ret, _, _ := ipHelper.NewProc("ConvertInterfaceLuidToIndex").Call(uintptr(unsafe.Pointer(&luid)), uintptr(unsafe.Pointer(&idx)))
	if ret != 0 || idx == 0 {
		return errors.New("interface")
	}
	session, _, e := dll.MustFindProc("WintunStartSession").Call(ad, 0x400000)
	if session == 0 {
		return e
	}
	defer dll.MustFindProc("WintunEndSession").Call(session)
	idxArg := "name=" + strconv.FormatUint(uint64(idx), 10)
	ctx, cancel := context.WithTimeout(lifetime, 20*time.Second)
	defer cancel()
	cmd := exec.CommandContext(ctx, filepath.Join(system, "netsh.exe"), "interface", "ipv4", "add", "address", idxArg, "address="+ip.String(), "mask=255.255.255.0", "store=active")
	cmd.SysProcAttr = &syscall.SysProcAttr{HideWindow: true}
	if e = cmd.Run(); e != nil {
		return e
	}
	// Wintun can advertise a 65535-byte MTU. Match TCP segmentation on
	// this interface to LINK's 1500-byte authenticated packet envelope.
	mtu := exec.CommandContext(ctx, filepath.Join(system, "netsh.exe"), "interface", "ipv4", "set", "subinterface", "interface="+strconv.FormatUint(uint64(idx), 10), "mtu=1500", "store=active")
	mtu.SysProcAttr = &syscall.SysProcAttr{HideWindow: true}
	if e = mtu.Run(); e != nil {
		return setupError(conn, "mtu")
	}
	signal, _, _ := dll.MustFindProc("WintunGetReadWaitEvent").Call(session)
	receive := dll.MustFindProc("WintunReceivePacket")
	release := dll.MustFindProc("WintunReleaseReceivePacket")
	allocate := dll.MustFindProc("WintunAllocateSendPacket")
	send := dll.MustFindProc("WintunSendPacket")
	if lifetime.Err() != nil {
		return lifetime.Err()
	}
	if e = writeFrame(conn, nil); e != nil {
		return e
	}
	done := make(chan struct{})
	exited := make(chan struct{})
	defer func() { close(done); conn.SetWriteDeadline(time.Now()); <-exited }()
	go func() {
		defer close(exited)
		defer stop()
		for {
			select {
			case <-done:
				return
			default:
			}
			var size uint32
			p, _, err := receive.Call(session, uintptr(unsafe.Pointer(&size)))
			if p == 0 {
				if err != syscall.Errno(259) {
					return
				}
				syscall.WaitForSingleObject(syscall.Handle(signal), 120)
				continue
			}
			var data []byte
			if size <= 1500 {
				data = append(data, unsafe.Slice((*byte)(unsafe.Pointer(p)), int(size))...)
			}
			release.Call(session, p)
			if validPacket(data, ip, true) {
				conn.SetWriteDeadline(time.Now().Add(3 * time.Second))
				if writeFrame(conn, data) != nil {
					return
				}
			}
		}
	}()
	for {
		var b []byte
		select {
		case <-lifetime.Done():
			return nil
		case b = <-incoming:
		}
		if lifetime.Err() != nil {
			return nil
		}
		if !validPacket(b, ip, false) {
			continue
		}
		p, _, _ := allocate.Call(session, uintptr(len(b)))
		if p != 0 {
			copy(unsafe.Slice((*byte)(unsafe.Pointer(p)), len(b)), b)
			send.Call(session, p)
		}
	}
}
func main() {
	if run() != nil {
		os.Exit(1)
	}
}
