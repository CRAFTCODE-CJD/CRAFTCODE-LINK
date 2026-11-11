package main

import (
	"bufio"
	"context"
	"errors"
	"fmt"
	"io"
	"os"
	"os/exec"
	"runtime"
	"syscall"
	"time"
	"unsafe"
)

// The coordinator plays the game tone. A grandchild of the simulated call process
// plays the voice tone. A separate observer must hear both on the same test run.
func playTone(hz int) (func(), error) {
	wave := toneWave(hz)
	play := syscall.NewLazyDLL("winmm.dll").NewProc("PlaySoundW")
	ok, _, _ := play.Call(uintptr(unsafe.Pointer(&wave[0])), 0, 1|2|4|8) // async, nodefault, memory, loop
	if ok == 0 {
		return nil, errors.New("test output device unavailable")
	}
	return func() { play.Call(0, 0, 0); runtime.KeepAlive(wave) }, nil
}

func runChild(ctx context.Context, args ...string) (*exec.Cmd, io.WriteCloser, *bufio.Reader, error) {
	exe, err := os.Executable()
	if err != nil {
		return nil, nil, nil, err
	}
	cmd := exec.CommandContext(ctx, exe, args...)
	input, err := cmd.StdinPipe()
	if err != nil {
		return nil, nil, nil, err
	}
	output, err := cmd.StdoutPipe()
	if err != nil {
		input.Close()
		return nil, nil, nil, err
	}
	cmd.Stderr = os.Stderr
	if err = cmd.Start(); err != nil {
		input.Close()
		output.Close()
		return nil, nil, nil, err
	}
	return cmd, input, bufio.NewReader(output), nil
}
func finish(cmd *exec.Cmd, input io.WriteCloser) { input.Close(); cmd.Wait() }
func ready(r *bufio.Reader, expected string) error {
	line, err := r.ReadString('\n')
	if err != nil {
		return err
	}
	if line != expected+"\n" {
		return errors.New("unexpected test response")
	}
	return nil
}
func sample(ctx context.Context) (float64, float64, error) {
	cmd, input, out, err := runChild(ctx)
	if err != nil {
		return 0, 0, err
	}
	defer func() { input.Close(); cmd.Process.Kill(); cmd.Wait() }()
	if err = ready(out, "CCPCM01"); err != nil {
		return 0, 0, err
	}
	pcm := make([]byte, 2*sampleRate*4)
	if _, err = io.ReadFull(out, pcm); err != nil {
		return 0, 0, err
	}
	return level(pcm, gameHz), level(pcm, callHz), nil
}
func runCheck(mode string) error {
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	defer cancel()
	switch mode {
	case "--check-tone":
		stop, err := playTone(callHz)
		if err != nil {
			return err
		}
		defer stop()
		fmt.Println("READY")
		io.Copy(io.Discard, os.Stdin)
		return nil
	case "--check-owner":
		tone, input, out, err := runChild(ctx, "--check-tone")
		if err != nil {
			return err
		}
		defer finish(tone, input)
		if err = ready(out, "READY"); err != nil {
			return err
		}
		fmt.Println("READY")
		game, voice, err := sample(ctx)
		if err != nil {
			return err
		}
		fmt.Printf("%.2f %.2f\n", game, voice)
		io.Copy(io.Discard, os.Stdin)
		return nil
	case "--check-observer":
		game, voice, err := sample(ctx)
		if err != nil {
			return err
		}
		fmt.Printf("%.2f %.2f\n", game, voice)
		return nil
	case "--check":
		stop, err := playTone(gameHz)
		if err != nil {
			return err
		}
		defer stop()
		owner, input, out, err := runChild(ctx, "--check-owner")
		if err != nil {
			return err
		}
		defer finish(owner, input)
		if err = ready(out, "READY"); err != nil {
			return err
		}
		observer, otherInput, otherOut, err := runChild(ctx, "--check-observer")
		if err != nil {
			return err
		}
		defer finish(observer, otherInput)
		var game, voice, refGame, refVoice float64
		if _, err = fmt.Fscan(otherOut, &refGame, &refVoice); err != nil {
			return err
		}
		if _, err = fmt.Fscan(out, &game, &voice); err != nil {
			return err
		}
		fmt.Printf("Control: game %.1f dB, call %.1f dB. Protected: game %.1f dB, call %.1f dB.\n", refGame, refVoice, game, voice)
		if refGame < -55 || refVoice < -55 {
			return errors.New("INCONCLUSIVE: reference tones too quiet")
		}
		if game < refGame-10 || voice > refVoice-30 || voice > game-30 {
			return errors.New("FAIL: could not establish separation")
		}
		fmt.Println("PASS: game audible, simulated call excluded.")
		return nil
	}
	return errors.New("unknown option")
}
