// This Windows x64/arm64 companion has exactly one capture source: WASAPI
// process loopback excluding its parent and the entire parent process tree.
// It accepts no PID, source, device or filename from external input.
package main

import (
	"errors"
	"fmt"
	"io"
	"os"
	"runtime"
	"sync/atomic"
	"syscall"
	"unsafe"
)

var (
	ole32         = syscall.NewLazyDLL("ole32.dll")
	kernel32      = syscall.NewLazyDLL("kernel32.dll")
	activate      = syscall.NewLazyDLL("mmdevapi.dll").NewProc("ActivateAudioInterfaceAsync")
	createEvent   = kernel32.NewProc("CreateEventW")
	setEvent      = kernel32.NewProc("SetEvent")
	iidAudio      = syscall.GUID{Data1: 0x1cb9ad4c, Data2: 0xdbfa, Data3: 0x4c32, Data4: [8]byte{0xb1, 0x78, 0xc2, 0xf5, 0x68, 0xa7, 0x03, 0xb2}}
	iidCapture    = syscall.GUID{Data1: 0xc8adbd64, Data2: 0xe71e, Data3: 0x48a0, Data4: [8]byte{0xa4, 0xde, 0x18, 0x5c, 0x39, 0x5c, 0xd3, 0x17}}
	iidCompletion = syscall.GUID{Data1: 0x41d949ab, Data2: 0x9862, Data3: 0x444a, Data4: [8]byte{0x80, 0xf6, 0xc2, 0x61, 0x33, 0x4d, 0xa5, 0xeb}}
	iidUnknown    = syscall.GUID{Data4: [8]byte{0xc0, 0, 0, 0, 0, 0, 0, 0x46}}
	iidAgile      = syscall.GUID{Data1: 0x94ea2b94, Data2: 0xe9cc, Data3: 0x49e0, Data4: [8]byte{0xc0, 0xff, 0xee, 0x64, 0xca, 0x8f, 0x5b, 0x90}}
)

// Native objects and async parameters have a stable address for this one-shot process.
var callbackTable [4]uintptr
var callback struct {
	table *[4]uintptr
	refs  int32
	done  syscall.Handle
}
var params struct{ kind, pid, mode uint32 }
var variant struct {
	vt        uint16
	reserved  [3]uint16
	size      uint32
	alignment uint32
	blob      unsafe.Pointer
}

func query(this uintptr, id *syscall.GUID, result *uintptr) uintptr {
	if *id == iidUnknown || *id == iidCompletion || *id == iidAgile {
		*result = this
		returnRef(this)
		return 0
	}
	*result = 0
	return 0x80004002
}
func returnRef(_ uintptr) uintptr   { return uintptr(atomic.AddInt32(&callback.refs, 1)) }
func releaseRef(_ uintptr) uintptr  { return uintptr(atomic.AddInt32(&callback.refs, -1)) }
func complete(_, _ uintptr) uintptr { setEvent.Call(uintptr(callback.done)); return 0 }

type object struct{ table *[18]uintptr }

//go:uintptrescapes
func (o *object) call(index int, args ...uintptr) uintptr {
	hr, _, _ := syscall.SyscallN(o.table[index], append([]uintptr{uintptr(unsafe.Pointer(o))}, args...)...)
	return hr
}
func check(op string, hr uintptr) error {
	if int32(hr) < 0 {
		return fmt.Errorf("%s: %08x", op, uint32(hr))
	}
	return nil
}
func event() (syscall.Handle, error) {
	h, _, err := createEvent.Call(0, 0, 0, 0)
	if h == 0 {
		return 0, err
	}
	return syscall.Handle(h), nil
}
func capture() error {
	runtime.LockOSThread()
	defer runtime.UnlockOSThread()
	hr, _, _ := ole32.NewProc("CoInitializeEx").Call(0, 0)
	if err := check("COM", hr); err != nil {
		return err
	}
	defer ole32.NewProc("CoUninitialize").Call()
	if err := activate.Find(); err != nil {
		return err
	}
	parent := os.Getppid()
	if parent <= 0 {
		return errors.New("no parent process")
	}
	// AUDIOCLIENT_ACTIVATION_TYPE_PROCESS_LOOPBACK / EXCLUDE_TARGET_PROCESS_TREE.
	params.kind, params.pid, params.mode = 1, uint32(parent), 1
	variant.vt, variant.size, variant.blob = 65, uint32(unsafe.Sizeof(params)), unsafe.Pointer(&params)
	done, err := event()
	if err != nil {
		return err
	}
	// done is intentionally owned until process exit: a late completion after a timeout is possible.
	callbackTable = [4]uintptr{syscall.NewCallback(query), syscall.NewCallback(returnRef), syscall.NewCallback(releaseRef), syscall.NewCallback(complete)}
	callback.table, callback.refs, callback.done = &callbackTable, 1, done
	device, _ := syscall.UTF16PtrFromString(`VAD\Process_Loopback`)
	var op *object
	hr, _, _ = activate.Call(uintptr(unsafe.Pointer(device)), uintptr(unsafe.Pointer(&iidAudio)), uintptr(unsafe.Pointer(&variant)), uintptr(unsafe.Pointer(&callback)), uintptr(unsafe.Pointer(&op)))
	if err := check("process loopback", hr); err != nil {
		return err
	}
	if op == nil {
		return errors.New("no activation operation")
	}
	defer op.call(2)
	status, err := syscall.WaitForSingleObject(done, 4500)
	if err != nil || status != 0 {
		return errors.New("activation timeout")
	}
	var result uint32
	var activated *object
	if err := check("activation result", op.call(3, uintptr(unsafe.Pointer(&result)), uintptr(unsafe.Pointer(&activated)))); err != nil {
		return err
	}
	if err := check("process exclusion", uintptr(result)); err != nil {
		return err
	}
	if activated == nil {
		return errors.New("no activated audio interface")
	}
	defer activated.call(2)
	var client *object
	if err := check("QueryInterface IAudioClient", activated.call(0, uintptr(unsafe.Pointer(&iidAudio)), uintptr(unsafe.Pointer(&client)))); err != nil {
		return err
	}
	if client == nil {
		return errors.New("no audio client")
	}
	defer client.call(2)
	// WAVEFORMATEX packed layout. Shared PCM16 stereo 48 kHz with automatic sample conversion.
	format := struct {
		tag, channels      uint16
		rate, bytes        uint32
		align, bits, extra uint16
	}{1, 2, 48000, 192000, 4, 16, 0}
	const flags = 0x20000 | 0x40000 | 0x80000000 // LOOPBACK, EVENTCALLBACK, AUTOCONVERTPCM
	if err := check("Initialize", client.call(3, 0, flags, 0, 0, uintptr(unsafe.Pointer(&format)), 0)); err != nil {
		return err
	}
	available, err := event()
	if err != nil {
		return err
	}
	defer syscall.CloseHandle(available)
	if err := check("SetEventHandle", client.call(13, uintptr(available))); err != nil {
		return err
	}
	var reader *object
	if err := check("GetService", client.call(14, uintptr(unsafe.Pointer(&iidCapture)), uintptr(unsafe.Pointer(&reader)))); err != nil {
		return err
	}
	if reader == nil {
		return errors.New("no capture service")
	}
	defer reader.call(2)
	if err := check("Start", client.call(10)); err != nil {
		return err
	}
	defer client.call(11)
	if _, err = os.Stdout.Write([]byte("CCPCM01\n")); err != nil {
		return err
	}
	var size, frames, packetFlags uint32
	var data *byte
	for {
		status, err = syscall.WaitForSingleObject(available, 500)
		if err != nil {
			return err
		}
		if status != 0 && status != syscall.WAIT_TIMEOUT {
			return errors.New("invalid audio event")
		}
		for {
			if err := check("NextPacket", reader.call(5, uintptr(unsafe.Pointer(&size)))); err != nil {
				return err
			}
			if size == 0 {
				break
			}
			if err := check("GetBuffer", reader.call(3, uintptr(unsafe.Pointer(&data)), uintptr(unsafe.Pointer(&frames)), uintptr(unsafe.Pointer(&packetFlags)), 0, 0)); err != nil {
				return err
			}
			if frames > 48000 {
				reader.call(4, uintptr(frames))
				return errors.New("unexpected packet length")
			}
			block := make([]byte, int(frames)*4)
			if packetFlags&2 == 0 && data != nil {
				copy(block, unsafe.Slice(data, len(block)))
			}
			if err := check("ReleaseBuffer", reader.call(4, uintptr(frames))); err != nil {
				return err
			}
			if _, err = os.Stdout.Write(block); err != nil {
				return err
			}
		}
	}
}
func main() {
	if len(os.Args) == 2 {
		if err := runCheck(os.Args[1]); err != nil {
			fmt.Fprintln(os.Stderr, err)
			os.Exit(1)
		}
		return
	}
	if len(os.Args) != 1 {
		os.Exit(2)
	}
	// Parent death closes stdin even if its audio stream is completely silent.
	go func() { io.Copy(io.Discard, os.Stdin); os.Exit(0) }()
	if err := capture(); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}
