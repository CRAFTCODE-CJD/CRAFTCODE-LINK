package main

import (
	"errors"
	"fmt"
	"os"
	"path/filepath"
)

const backupDir = ".repair-backup"

// The entire new payload is unpacked on the destination volume before any installed file changes.
func repairStage(p string) (string, error) {
	if err := target(p); err != nil {
		return "", err
	}
	if err := freeSpace(p); err != nil {
		return "", err
	}
	parent := filepath.Dir(p)
	if err := os.MkdirAll(parent, 0755); err != nil {
		return "", err
	}
	dir, err := os.MkdirTemp(parent, tempPrefix)
	if err != nil {
		return "", err
	}
	return filepath.Base(dir), nil
}

type replacement struct {
	source, destination, backup string
	installed, saved            bool
}

func rollback(items []replacement) error {
	var failures []error
	for i := len(items) - 1; i >= 0; i-- {
		item := items[i]
		if item.installed {
			if err := os.Rename(item.destination, item.source); err != nil {
				failures = append(failures, err)
				continue
			}
		}
		if item.saved {
			if err := os.Rename(item.backup, item.destination); err != nil {
				failures = append(failures, err)
			}
		}
	}
	return errors.Join(failures...)
}
func repair(p, base string) error {
	s, err := stagePath(p, base)
	if err != nil {
		return err
	}
	names, err := paths()
	if err != nil {
		return err
	}
	var items []replacement
	for _, name := range append(names, "Uninstall.exe") {
		rel := filepath.FromSlash(name)
		item := replacement{source: filepath.Join(s, rel), destination: filepath.Join(p, rel), backup: filepath.Join(s, backupDir, rel)}
		if err := checkStagedFile(item.source); err != nil {
			return err
		}
		if err := safeChain(item.destination); err != nil {
			return err
		}
		dst, e := os.Lstat(item.destination)
		if e != nil && !errors.Is(e, os.ErrNotExist) {
			return e
		}
		if e == nil && !dst.Mode().IsRegular() {
			return fmt.Errorf("reserved file is a directory: %s", name)
		}
		items = append(items, item)
	}
	if err = os.Mkdir(filepath.Join(s, backupDir), 0700); err != nil {
		return err
	}
	for i := range items {
		item := &items[i]
		if err = os.MkdirAll(filepath.Dir(item.destination), 0755); err != nil {
			break
		}
		if err = os.MkdirAll(filepath.Dir(item.backup), 0700); err != nil {
			break
		}
		err = os.Rename(item.destination, item.backup)
		if err == nil {
			item.saved = true
		} else if !errors.Is(err, os.ErrNotExist) {
			break
		}
		if err = os.Rename(item.source, item.destination); err != nil {
			break
		}
		item.installed = true
	}
	if err != nil {
		if restoreErr := rollback(items); restoreErr != nil {
			return fmt.Errorf("rollback data retained in %s: %w", s, restoreErr)
		}
		_ = wipe(filepath.Join(s, backupDir))
		return err
	}
	return wipe(s)
}
func discard(p, base string) error {
	s, err := stagePath(p, base)
	if err != nil {
		return err
	}
	_, err = os.Lstat(filepath.Join(s, backupDir))
	if !errors.Is(err, os.ErrNotExist) {
		return errors.New("retained repair backup")
	}
	return wipe(s)
}
