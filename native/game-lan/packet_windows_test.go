package main

import (
	"encoding/binary"
	"net"
	"testing"
)

func TestGameTCPPacketStaysInsideAssignedSubnet(t *testing.T) {
	ip := net.IPv4(10, 91, 24, 2).To4()
	b := make([]byte, 1500)
	b[0], b[8], b[9], b[32], b[33] = 0x45, 64, 6, 0x80, 2
	binary.BigEndian.PutUint16(b[2:], uint16(len(b)))
	copy(b[12:], ip)
	copy(b[16:], net.IPv4(10, 91, 24, 1).To4())
	binary.BigEndian.PutUint16(b[20:], 49111)
	binary.BigEndian.PutUint16(b[22:], 25565)
	if !validPacket(b, ip, true) || validPacket(b, ip, false) {
		t.Fatal("expected only local transmission")
	}
	if !validPacket(b, b[16:20], false) {
		t.Fatal("addressed remote seat could not receive a full-length TCP segment")
	}
	for _, test := range []struct {
		offset int
		value  byte
	}{{32, 0x40}, {6, 0x20}, {9, 1}, {19, 255}, {16, 127}} {
		bad := append([]byte(nil), b...)
		bad[test.offset] = test.value
		if validPacket(bad, ip, true) {
			t.Errorf("invalid packet accepted at offset %d", test.offset)
		}
	}
}
