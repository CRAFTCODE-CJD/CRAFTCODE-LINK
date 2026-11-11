package main

import (
	"encoding/binary"
	"math"
	"testing"
)

func TestToneLevels(t *testing.T) {
	a, b := toneWave(gameHz)[44:], toneWave(callHz)[44:]
	if len(a) != sampleRate*2 {
		t.Fatal("bad PCM wave length")
	}
	mix := make([]byte, len(a)*2)
	for _, second := range []bool{true, false} {
		for i := 0; i < sampleRate; i++ {
			v := int16(binary.LittleEndian.Uint16(a[2*i:]))
			if second {
				v += int16(binary.LittleEndian.Uint16(b[2*i:]))
			}
			binary.LittleEndian.PutUint16(mix[4*i:], uint16(v))
		}
		if math.Abs(level(mix, gameHz)+21) > 1 {
			t.Fatal("game marker missing")
		}
		v := level(mix, callHz)
		if second && math.Abs(v+21) > 1 || !second && v > -75 {
			t.Fatal("incorrect marker", v)
		}
	}
}
