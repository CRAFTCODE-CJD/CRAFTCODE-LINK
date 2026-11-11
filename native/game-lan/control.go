package main

import (
	"context"
	"encoding/binary"
	"errors"
	"io"
	"net"
	"time"
)

func writeFrame(w io.Writer, b []byte) error {
	data := make([]byte, len(b)+2)
	binary.BigEndian.PutUint16(data, uint16(len(b)))
	copy(data[2:], b)
	_, err := w.Write(data)
	return err
}
func readFrame(r io.Reader) ([]byte, error) {
	var size [2]byte
	if _, e := io.ReadFull(r, size[:]); e != nil {
		return nil, e
	}
	n := binary.BigEndian.Uint16(size[:])
	if n > 1500 {
		return nil, errors.New("size")
	}
	b := make([]byte, n)
	_, e := io.ReadFull(r, b)
	return b, e
}

// Detect a lost parent even before setup finishes. Keep the writing half open
// until the caller has released the session, adapter and machine-wide guard.
func watchParent(conn net.Conn) (context.Context, <-chan []byte, context.CancelFunc, func()) {
	lifetime, stop := context.WithCancel(context.Background())
	frames := make(chan []byte, 1)
	done := make(chan struct{})
	go func() {
		defer close(done)
		defer stop()
		for {
			b, err := readFrame(conn)
			if err != nil || len(b) == 0 {
				return
			}
			select {
			case frames <- b:
			case <-lifetime.Done():
				return
			}
		}
	}()
	wait := func() { stop(); conn.SetReadDeadline(time.Now()); <-done }
	return lifetime, frames, stop, wait
}
