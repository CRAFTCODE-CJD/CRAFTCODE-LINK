package main

import (
	"errors"
	"os"
	"path/filepath"
	"runtime"
)

const dataDirectory = "CRAFTCODE LINK Data"

// A normal fresh install needs an empty folder. A reinstall may surround only
// its own preserved data child with program files; the data itself never moves
// through the installer staging area and is never part of the payload catalog.
func installationContents(directory string) (bool, error) {
	entries, err := os.ReadDir(directory)
	if errors.Is(err, os.ErrNotExist) {
		return false, nil
	}
	if err != nil {
		return false, err
	}
	if len(entries) == 0 {
		return false, nil
	}
	if len(entries) != 1 || entries[0].Name() != dataDirectory || !entries[0].IsDir() {
		return false, errors.New("folder is not empty")
	}
	dataPath := filepath.Join(directory, dataDirectory)
	if err := safeChain(dataPath); err != nil {
		return false, err
	}
	data, err := openCleanupRoot(dataPath)
	if err != nil {
		return false, err
	}
	defer data.Close()
	marker, err := readLocation(data, dataMarker)
	if err != nil {
		return false, err
	}
	base := os.Getenv("APPDATA")
	if !filepath.IsAbs(base) {
		return false, errors.New("profile ownership is unavailable")
	}
	anchor := filepath.Join(base, product)
	if err := safeChain(anchor); err != nil {
		return false, err
	}
	profile, err := openCleanupRoot(anchor)
	if err != nil {
		return false, err
	}
	defer profile.Close()
	locator, err := readLocation(profile, locationFile)
	if err != nil || locator.Owner != marker.Owner {
		return false, errors.New("preserved data ownership could not be verified")
	}
	held, err := data.Stat(".")
	if err != nil {
		return false, err
	}
	for _, reference := range append([]string{locator.Directory}, locator.PreviousDirectories...) {
		if !filepath.IsAbs(reference) || runtime.GOOS == "windows" && len(filepath.VolumeName(reference)) != 2 || safeChain(reference) != nil {
			continue
		}
		stat, e := os.Stat(reference)
		if e == nil && os.SameFile(held, stat) {
			return true, nil
		}
	}
	return false, errors.New("preserved data is not associated with this profile")
}
