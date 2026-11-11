package main

import (
	"bytes"
	"net"
	"testing"
	"time"
)

func TestParentGoneDuringSetup(t *testing.T) {
	parent, helper := net.Pipe()
	defer helper.Close()
	lifetime, _, _, wait := watchParent(helper)
	defer wait()
	parent.Close()
	select {
	case <-lifetime.Done():
	case <-time.After(time.Second):
		t.Fatal("parent loss did not cancel setup")
	}
}
func TestShutdownRetainsReturnChannelUntilCleanup(t *testing.T) {
	parent, helper := net.Pipe()
	defer parent.Close()
	defer helper.Close()
	lifetime, frames, _, wait := watchParent(helper)
	defer wait()
	parent.SetDeadline(time.Now().Add(2 * time.Second))
	helper.SetDeadline(time.Now().Add(2 * time.Second))
	packet := []byte{1, 2, 3}
	if err := writeFrame(parent, packet); err != nil {
		t.Fatal(err)
	}
	select {
	case got := <-frames:
		if !bytes.Equal(got, packet) {
			t.Fatal("unexpected frame")
		}
	case <-time.After(time.Second):
		t.Fatal("missing frame")
	}
	if err := writeFrame(parent, nil); err != nil {
		t.Fatal(err)
	}
	select {
	case <-lifetime.Done():
	case <-time.After(time.Second):
		t.Fatal("cancel frame ignored")
	}
	go func() { _, _ = helper.Write([]byte{42}) }()
	var marker [1]byte
	if _, err := parent.Read(marker[:]); err != nil || marker[0] != 42 {
		t.Fatalf("early close: %v", err)
	}
}
