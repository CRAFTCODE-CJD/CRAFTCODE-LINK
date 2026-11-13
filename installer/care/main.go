// Small per-user filesystem helper for the NSIS wizard. No network or subprocesses.
package main

import (
	"crypto/sha256"
	_ "embed"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"sort"
	"strings"
)

//go:embed payload.txt
var catalog string

const product = "CRAFTCODE LINK"
const tempPrefix = ".craftcode-install-"

var busy = errors.New("application is running")

type diskSpaceError struct {
	volume              string
	available, required uint64
}

func (e *diskSpaceError) Error() string {
	const mib uint64 = 1024 * 1024
	return fmt.Sprintf("%s  %d / %d MiB", e.volume, e.available/mib, (e.required-1)/mib+1)
}

func paths() ([]string, error) {
	names := strings.FieldsFunc(catalog, func(r rune) bool { return r == '\r' || r == '\n' })
	if len(names) == 0 {
		return nil, errors.New("empty catalog")
	}
	for _, n := range names {
		if !filepath.IsLocal(n) || strings.ContainsAny(n, "\\:") || filepath.ToSlash(filepath.Clean(n)) != n || strings.EqualFold(strings.SplitN(n, "/", 2)[0], dataDirectory) {
			return nil, errors.New("invalid catalog")
		}
	}
	return names, nil
}
func safeChain(p string) error {
	for {
		st, err := os.Lstat(p)
		if err != nil && !errors.Is(err, os.ErrNotExist) {
			return err
		}
		if err == nil && linklike(st) {
			return errors.New("redirected folder")
		}
		next := filepath.Dir(p)
		if next == p {
			return nil
		}
		p = next
	}
}
func target(p string) error {
	if !filepath.IsAbs(p) || filepath.Clean(p) != p || filepath.Dir(p) == p || len([]rune(p)) > 180 {
		return errors.New("invalid installation folder")
	}
	if err := platformPath(p); err != nil {
		return err
	}
	return safeChain(p)
}
func validate(p string) error {
	if err := target(p); err != nil {
		return err
	}
	if _, err := installationContents(p); err != nil {
		return err
	}
	return freeSpace(p)
}
func stage(p string) (string, error) {
	if err := validate(p); err != nil {
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
func stagePath(p, base string) (string, error) {
	if err := target(p); err != nil {
		return "", err
	}
	suffix, ok := strings.CutPrefix(base, tempPrefix)
	if !ok || len(suffix) < 1 || len(suffix) > 20 || strings.Trim(suffix, "0123456789") != "" {
		return "", errors.New("invalid stage")
	}
	s := filepath.Join(filepath.Dir(p), base)
	if strings.EqualFold(p, s) {
		return "", errors.New("invalid target")
	}
	if err := safeChain(s); err != nil {
		return "", err
	}
	return s, nil
}
func commit(p, base string) error {
	s, err := stagePath(p, base)
	if err != nil {
		return err
	}
	names, err := paths()
	if err != nil {
		return err
	}
	for _, name := range append(names, "Uninstall.exe") {
		if err := checkStagedFile(filepath.Join(s, filepath.FromSlash(name))); err != nil {
			return err
		}
	}
	preserved, err := installationContents(p)
	if err != nil {
		return err
	}
	if preserved {
		// Only the data child was authorized. A program file appearing after
		// selection is not an installed payload and must not be overwritten.
		for _, name := range append(names, "Uninstall.exe") {
			if _, e := os.Lstat(filepath.Join(p, filepath.FromSlash(name))); !errors.Is(e, os.ErrNotExist) {
				return errors.New("installation folder changed")
			}
		}
		return repair(p, base)
	}
	err = removeDir(p)
	existed := err == nil
	if !existed && !errors.Is(err, os.ErrNotExist) {
		return err
	}
	if err = os.Rename(s, p); err != nil && existed {
		_ = os.Mkdir(p, 0755)
	}
	return err
}

func checkStagedFile(p string) error {
	if err := safeChain(p); err != nil {
		return err
	}
	st, err := os.Lstat(p)
	if err != nil {
		return err
	}
	if !st.Mode().IsRegular() {
		return fmt.Errorf("expected staged file: %s", p)
	}
	return nil
}

// Remove reparse points as leaves. Never walk into a junction or symlink.
func wipe(p string) error {
	if !filepath.IsAbs(p) || filepath.Dir(p) == p {
		return errors.New("invalid cleanup folder")
	}
	root, err := os.OpenRoot(filepath.Dir(p))
	if errors.Is(err, os.ErrNotExist) {
		return nil
	}
	if err != nil {
		return err
	}
	defer root.Close()
	return root.RemoveAll(filepath.Base(p))
}
func purge(base string) error {
	return cleanProfiles(base, true)
}
func removePayload(p string) error {
	if err := target(p); err != nil {
		return err
	}
	names, err := paths()
	if err != nil {
		return err
	}
	dirs := map[string]bool{}
	var files []string
	// Check the entire catalog before a conflicting directory can cause partial removal.
	for _, name := range names {
		item := filepath.Join(p, filepath.FromSlash(name))
		dir := filepath.Dir(item)
		for dir != p && !dirs[dir] {
			if err := safeChain(dir); err != nil {
				return err
			}
			dirs[dir] = true
			dir = filepath.Dir(dir)
		}
		st, err := os.Lstat(item)
		if errors.Is(err, os.ErrNotExist) {
			continue
		}
		if err != nil {
			return err
		}
		if st.IsDir() && !linklike(st) {
			return errors.New("file replaced by directory")
		}
		files = append(files, item)
	}
	for _, item := range files {
		if err = os.Remove(item); err != nil && !errors.Is(err, os.ErrNotExist) {
			return err
		}
	}
	sorted := make([]string, 0, len(dirs))
	for dir := range dirs {
		sorted = append(sorted, dir)
	}
	sort.Slice(sorted, func(i, j int) bool { return len(sorted[i]) > len(sorted[j]) })
	for _, dir := range sorted {
		err := removeDir(dir)
		if err != nil && !errors.Is(err, os.ErrNotExist) {
			entries, e := os.ReadDir(dir)
			if errors.Is(e, os.ErrNotExist) {
				continue
			}
			if e != nil {
				return e
			}
			if len(entries) == 0 {
				if retryErr := removeEmptiedDir(dir); retryErr != nil && !errors.Is(retryErr, os.ErrNotExist) {
					return retryErr
				}
			}
		}
	}
	return nil
}
func digest(p string) (string, error) {
	f, err := os.Open(p)
	if err != nil {
		return "", err
	}
	defer f.Close()
	h := sha256.New()
	if _, err = io.Copy(h, f); err != nil {
		return "", err
	}
	return fmt.Sprintf("%x", h.Sum(nil)), nil
}
func run(a []string) (string, error) {
	if len(a) == 1 && a[0] == "running" {
		return "", checkRunning()
	}
	if len(a) == 2 {
		switch a[0] {
		case "close-installation":
			return "", shutdownInstallation(a[1])
		case "validate":
			return "", validate(a[1])
		case "repair-stage":
			return repairStage(a[1])
		case "stage":
			return stage(a[1])
		case "remove":
			return "", removePayload(a[1])
		case "purge":
			if err := checkRunning(); err != nil {
				return "", err
			}
			return "", purge(a[1])
		case "cache":
			if err := checkRunning(); err != nil {
				return "", err
			}
			return "", cleanProfiles(a[1], false)
		case "hash":
			return digest(a[1])
		}
	}
	if len(a) == 3 {
		switch a[0] {
		case "maintenance-action":
			return maintenanceAction(a[1], a[2])
		case "repair":
			return "", repair(a[1], a[2])
		case "commit":
			return "", commit(a[1], a[2])
		case "discard":
			return "", discard(a[1], a[2])
		case "clean-committed":
			return "", cleanCommitted(a[1], a[2])
		}
	}
	if len(a) == 4 && a[0] == "prepare-repair" {
		return copyRepairSource(a[1], a[2], a[3])
	}
	return "", errors.New("invalid arguments")
}
func main() {
	s, err := run(os.Args[1:])
	if err != nil {
		writeDiagnostic(err)
		if errors.Is(err, busy) {
			os.Exit(2)
		}
		var shortage *diskSpaceError
		if errors.As(err, &shortage) {
			os.Exit(3)
		}
		if errors.Is(err, cleanupPending) {
			os.Exit(4)
		}
		os.Exit(1)
	}
	fmt.Print(s)
}
