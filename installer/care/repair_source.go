package main

import (
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"io"
	"os"
	"path/filepath"
)

// Copy a selected installer to a fresh directory before executing it. Only the
// bytes in this copy are verified; adjacent files from the source never follow it.
func copyRepairSource(source, privateDir, expected string) (string, error) {
	if len(expected) != sha256.Size*2 {
		return "", errors.New("missing installer fingerprint")
	}
	if !filepath.IsAbs(source) || !filepath.IsAbs(privateDir) {
		return "", errors.New("expected absolute repair paths")
	}
	if err := safeChain(privateDir); err != nil {
		return "", err
	}
	input, err := os.Open(source)
	if err != nil {
		return "", err
	}
	defer input.Close()
	info, err := input.Stat()
	const maxSetupSize = 512 << 20 // same limit as the in-app updater
	if err != nil || !info.Mode().IsRegular() || info.Size() < 2 || info.Size() > maxSetupSize {
		return "", errors.New("invalid installer")
	}
	dir, err := os.MkdirTemp(privateDir, "repair-")
	if err != nil {
		return "", err
	}
	file := filepath.Join(dir, "Setup.exe")
	result, err := os.OpenFile(file, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0700)
	if err != nil {
		_ = os.Remove(dir)
		return "", err
	}
	hash := sha256.New()
	written, copyErr := io.Copy(io.MultiWriter(result, hash), io.LimitReader(input, info.Size()+1))
	closeErr := result.Close()
	if copyErr != nil || closeErr != nil || written != info.Size() || hex.EncodeToString(hash.Sum(nil)) != expected {
		_ = os.Remove(file)
		_ = os.Remove(dir)
		if err := errors.Join(copyErr, closeErr); err != nil {
			return "", err
		}
		return "", errors.New("different installer fingerprint")
	}
	// NSIS consumes just the ASCII directory name (nsExec output is code-page dependent).
	return filepath.Base(dir), nil
}
