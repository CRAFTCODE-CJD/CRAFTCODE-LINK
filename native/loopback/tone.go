package main

import (
	"encoding/binary"
	"math"
	"sort"
)

const sampleRate = 48000
const gameHz = 750
const callHz = 1410

func toneWave(hz int) []byte {
	samples := sampleRate
	wave := make([]byte, 44+2*samples)
	put32 := binary.LittleEndian.PutUint32
	put16 := binary.LittleEndian.PutUint16
	copy(wave, "RIFF")
	put32(wave[4:], uint32(len(wave)-8))
	copy(wave[8:], "WAVEfmt ")
	put32(wave[16:], 16)
	put16(wave[20:], 1)
	put16(wave[22:], 1)
	put32(wave[24:], sampleRate)
	put32(wave[28:], sampleRate*2)
	put16(wave[32:], 2)
	put16(wave[34:], 16)
	copy(wave[36:], "data")
	put32(wave[40:], uint32(samples*2))
	for i := 0; i < samples; i++ {
		v := math.Sin(2*math.Pi*float64(i*hz)/sampleRate) * 2900
		put16(wave[44+i*2:], uint16(int16(v)))
	}
	return wave
}

// Median narrow-band amplitude over 100ms windows. The test never writes audio to disk.
func level(pcm []byte, hz int) float64 {
	const frames = sampleRate / 10
	coeff := 2 * math.Cos(2*math.Pi*float64(hz)/sampleRate)
	levels := []float64{}
	for len(pcm) >= 4*frames {
		var a, b float64
		for i := 0; i < frames; i++ {
			x := float64(int16(binary.LittleEndian.Uint16(pcm[4*i:]))) / 32768
			next := x + coeff*a - b
			b = a
			a = next
		}
		amp := 2 * math.Sqrt(math.Max(0, a*a+b*b-coeff*a*b)) / frames
		levels = append(levels, 20*math.Log10(math.Max(amp, 1e-6)))
		pcm = pcm[4*frames:]
	}
	if len(levels) == 0 {
		return -120
	}
	sort.Float64s(levels)
	return levels[len(levels)/2]
}
