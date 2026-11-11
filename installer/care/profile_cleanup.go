package main

import (
	"encoding/json"
	"errors"
	"io"
	"os"
	"path/filepath"
	"regexp"
	"runtime"
	"strconv"
	"strings"
)

const locationFile = "storage-location-v1.json"
const dataMarker = ".craftcode-link-data-v1.json"

var profileName = regexp.MustCompile(`^[a-zA-Z0-9_-]{1,48}$`)
var ownerID = regexp.MustCompile(`^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$`)
var cacheNames = []string{
	"Cache", "Code Cache", "GPUCache", "DawnCache", "DawnGraphiteCache", "DawnWebGPUCache",
	"GrShaderCache", "ShaderCache", "GraphiteDawnCache", "Crashpad", "logs", "reports", "update-cache", "media-test",
}

type storageLocation struct {
	Version   int    `json:"version"`
	Product   string `json:"product"`
	Owner     string `json:"owner"`
	Directory string `json:"directory"`
	Pending   *struct {
		Directory string `json:"directory"`
		From      string `json:"from"`
		Token     string `json:"token"`
	} `json:"pending,omitempty"`
	PreviousDirectories []string `json:"previousDirectories,omitempty"`
	RetainedStages      []string `json:"retainedStages,omitempty"`
	Migration           *struct {
		Directory string `json:"directory"`
		From      string `json:"from"`
		Token     string `json:"token"`
	} `json:"migration,omitempty"`
}

type cleanupRoot struct {
	root  *os.Root
	path  string
	stage bool
}

// Open only the directory we inspected, then keep its handle for every delete.
func openCleanupRoot(directory string) (*os.Root, error) {
	before, err := os.Lstat(directory)
	if err != nil {
		return nil, err
	}
	if !before.IsDir() || linklike(before) {
		return nil, errors.New("redirected data folder")
	}
	root, err := os.OpenRoot(directory)
	if err != nil {
		return nil, err
	}
	after, err := root.Stat(".")
	if err != nil || !os.SameFile(before, after) {
		root.Close()
		return nil, errors.New("data folder changed during cleanup")
	}
	return root, nil
}

func checkProfileGuard(root *os.Root) error {
	const name = "active-process-v1.json"
	s, err := root.Lstat(name)
	if errors.Is(err, os.ErrNotExist) {
		return nil
	}
	if err != nil {
		return err
	}
	if linklike(s) || !s.Mode().IsRegular() || s.Size() > 16384 {
		return errors.New("invalid profile process guard")
	}
	f, err := root.Open(name)
	if err != nil {
		return err
	}
	defer f.Close()
	data, err := io.ReadAll(io.LimitReader(f, 16385))
	var guard struct {
		Version   int    `json:"version"`
		Product   string `json:"product"`
		Owner     string `json:"owner"`
		PID       uint32 `json:"pid"`
		StartTime string `json:"startTime"`
	}
	if err != nil || len(data) > 16384 || json.Unmarshal(data, &guard) != nil || guard.Version != 1 || guard.Product != product || !ownerID.MatchString(guard.Owner) || guard.PID == 0 {
		return errors.New("invalid profile process guard")
	}
	started, err := strconv.ParseUint(guard.StartTime, 10, 64)
	if err != nil || started == 0 {
		return errors.New("invalid profile process guard")
	}
	return checkProfileProcess(guard.PID, started)
}

func readLocation(root *os.Root, name string) (storageLocation, error) {
	var value storageLocation
	limit := int64(65536)
	if name == dataMarker {
		limit = 1024
	}
	stat, err := root.Lstat(name)
	if err != nil {
		return value, err
	}
	if linklike(stat) || !stat.Mode().IsRegular() || stat.Size() > limit {
		return value, errors.New("invalid storage locator")
	}
	file, err := root.Open(name)
	if err != nil {
		return value, err
	}
	defer file.Close()
	data, err := io.ReadAll(io.LimitReader(file, limit+1))
	if err != nil {
		return value, err
	}
	if int64(len(data)) > limit || json.Unmarshal(data, &value) != nil || value.Version != 1 || value.Product != product || !ownerID.MatchString(value.Owner) || len(value.PreviousDirectories) > 64 || len(value.RetainedStages) > 64 {
		return value, errors.New("invalid storage locator")
	}
	return value, nil
}

func externalDataRoot(directory, owner string, retryErase, stage bool) (*cleanupRoot, error) {
	base := filepath.Base(directory)
	validBase := base == "CRAFTCODE LINK Data"
	if stage {
		validBase = strings.HasPrefix(base, ".craftcode-link-move-") && ownerID.MatchString(strings.TrimPrefix(base, ".craftcode-link-move-"))
	}
	if !filepath.IsAbs(directory) || filepath.Clean(directory) != directory || !validBase || runtime.GOOS == "windows" && len(filepath.VolumeName(directory)) != 2 {
		return nil, errors.New("invalid data folder")
	}
	if err := safeChain(directory); err != nil {
		return nil, err
	}
	root, err := openCleanupRoot(directory)
	if err != nil {
		return nil, err
	}
	marker, err := readLocation(root, dataMarker)
	if retryErase && errors.Is(err, os.ErrNotExist) {
		// A previous attempt may have removed the final marker before Windows
		// released a child handle. Only an entirely empty root is retryable.
		file, e := root.Open(".")
		if e == nil {
			names, readErr := file.Readdirnames(1)
			file.Close()
			if len(names) == 0 && errors.Is(readErr, io.EOF) {
				return &cleanupRoot{root, directory, stage}, nil
			}
		}
	}
	if err != nil || marker.Owner != owner {
		root.Close()
		return nil, errors.New("storage ownership could not be verified")
	}
	return &cleanupRoot{root, directory, stage}, nil
}

// ENOENT may also mean an unavailable drive. Retrying an already removed leaf
// is safe only while its original parent is present and held open.
func verifiedMissingLeaf(directory string) bool {
	parent := filepath.Dir(directory)
	if safeChain(parent) != nil {
		return false
	}
	root, err := openCleanupRoot(parent)
	if err != nil {
		return false
	}
	defer root.Close()
	_, err = root.Lstat(filepath.Base(directory))
	return errors.Is(err, os.ErrNotExist)
}

// All locations are opened and their markers checked before changing any data.
// On Windows the open roots also prevent a directory rename during cleanup.
func cleanProfiles(base string, erase bool) error {
	if !filepath.IsAbs(base) || filepath.Dir(base) == base {
		return errors.New("invalid profile parent")
	}
	if err := safeChain(base); err != nil {
		return err
	}
	release, err := beginMaintenance(base)
	if err != nil {
		return err
	}
	defer release()
	defaultPath := filepath.Join(base, product)
	stat, err := os.Lstat(defaultPath)
	if errors.Is(err, os.ErrNotExist) {
		return nil
	}
	if err != nil {
		return err
	}
	if linklike(stat) {
		if erase {
			return wipe(defaultPath)
		}
		return errors.New("redirected profile folder")
	}
	main, err := openCleanupRoot(defaultPath)
	if err != nil {
		return err
	}
	opened := []*cleanupRoot{{main, defaultPath, false}}
	defer func() {
		for _, item := range opened {
			item.root.Close()
		}
	}()
	var profiles *os.Root
	if info, e := main.Lstat("profiles"); e == nil && info.IsDir() && !linklike(info) {
		profiles, e = main.OpenRoot("profiles")
		if e != nil {
			return e
		}
		defer profiles.Close()
		entries, e := profiles.Open(".")
		if e != nil {
			return e
		}
		names, e := entries.Readdirnames(-1)
		entries.Close()
		if e != nil {
			return e
		}
		for _, name := range names {
			if !profileName.MatchString(name) {
				continue
			}
			info, e := profiles.Lstat(name)
			if e != nil {
				return e
			}
			if linklike(info) || !info.IsDir() {
				continue
			}
			root, e := profiles.OpenRoot(name)
			if e != nil {
				return e
			}
			opened = append(opened, &cleanupRoot{root, filepath.Join(defaultPath, "profiles", name), false})
		}
	} else if e != nil && !errors.Is(e, os.ErrNotExist) {
		return e
	}
	localCount := len(opened)
	seen := make(map[string]string)
	for _, local := range opened[:localCount] {
		if e := checkProfileGuard(local.root); e != nil {
			return e
		}
		locator, e := readLocation(local.root, locationFile)
		if errors.Is(e, os.ErrNotExist) {
			continue
		}
		if e != nil {
			return e
		}
		type reference struct {
			directory       string
			optional, stage bool
		}
		locations := []reference{{locator.Directory, false, false}}
		if locator.Pending != nil {
			locations = append(locations, reference{locator.Pending.Directory, true, false})
			if locator.Pending.Token != "" {
				if !ownerID.MatchString(locator.Pending.Token) {
					return errors.New("invalid migration token")
				}
				locations = append(locations, reference{filepath.Join(filepath.Dir(locator.Pending.Directory), ".craftcode-link-move-"+locator.Pending.Token), true, true})
			}
		}
		if locator.Migration != nil {
			locations = append(locations, reference{locator.Migration.From, false, false})
		}
		for _, directory := range locator.PreviousDirectories {
			locations = append(locations, reference{directory, false, false})
		}
		for _, directory := range locator.RetainedStages {
			locations = append(locations, reference{directory, false, true})
		}
		for _, ref := range locations {
			directory := ref.directory
			isLocal := false
			for _, known := range opened[:localCount] {
				if strings.EqualFold(directory, known.path) {
					isLocal = true
					break
				}
			}
			if isLocal {
				continue
			}
			if owner, found := seen[strings.ToLower(directory)]; found {
				if owner != locator.Owner {
					return errors.New("conflicting storage ownership")
				}
				continue
			}
			root, e := externalDataRoot(directory, locator.Owner, erase, ref.stage)
			if e != nil {
				// A selected destination can still be empty or not created. It is
				// only ours after migration has written and verified its marker.
				if ref.optional || errors.Is(e, os.ErrNotExist) && verifiedMissingLeaf(directory) {
					continue
				}
				return e
			}
			seen[strings.ToLower(directory)] = locator.Owner
			opened = append(opened, root)
		}
	}
	if !erase {
		for _, item := range opened {
			if item.stage {
				if err := eraseExternal(item); err != nil {
					return err
				}
				continue
			}
			for _, name := range cacheNames {
				if err := item.root.RemoveAll(name); err != nil {
					return err
				}
			}
		}
		return nil
	}
	// Delete the verified external contents while their roots are still held.
	for _, item := range opened[localCount:] {
		if err := eraseExternal(item); err != nil {
			return err
		}
	}
	// Keep the default root anchored while deleting children too: closing it
	// before recursive deletion would allow a replacement directory to be hit.
	for _, item := range opened[1:localCount] {
		item.root.Close()
	}
	if profiles != nil {
		profiles.Close()
	}
	file, err := main.Open(".")
	if err != nil {
		return err
	}
	names, err := file.Readdirnames(-1)
	file.Close()
	if err != nil {
		return err
	}
	for _, name := range names {
		if err := main.RemoveAll(name); err != nil {
			return err
		}
	}
	main.Close()
	err = removeEmptiedDir(defaultPath)
	if errors.Is(err, os.ErrNotExist) {
		return nil
	}
	return err
}

func eraseExternal(item *cleanupRoot) error {
	file, err := item.root.Open(".")
	if err != nil {
		return err
	}
	names, err := file.Readdirnames(-1)
	file.Close()
	if err != nil {
		return err
	}
	for _, name := range names {
		if name != dataMarker {
			if err := item.root.RemoveAll(name); err != nil {
				return err
			}
		}
	}
	if err := item.root.Remove(dataMarker); err != nil && !errors.Is(err, os.ErrNotExist) {
		return err
	}
	item.root.Close()
	err = removeEmptiedDir(item.path)
	if errors.Is(err, os.ErrNotExist) {
		return nil
	}
	return err
}
