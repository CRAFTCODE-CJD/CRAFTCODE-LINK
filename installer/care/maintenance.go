package main

import (
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"io"
	"os"
	"strconv"
)

const maintenanceFile = ".craftcode-link-maintenance-v1.json"

type maintenanceRecord struct {
	Version   int    `json:"version"`
	Product   string `json:"product"`
	PID       uint32 `json:"pid"`
	StartTime string `json:"startTime"`
	Token     string `json:"token"`
}

// The bootstrap checks this marker both before and after publishing its live
// owner guard. Keeping the maintenance file open prevents its replacement on
// Windows. It lives outside every profile that this operation may delete.
func beginMaintenance(base string) (func(), error) {
	root, err := openCleanupRoot(base)
	if err != nil {
		return nil, err
	}
	fail := func(err error) (func(), error) { root.Close(); return nil, err }
	file, err := createMaintenanceFile(base)
	if errors.Is(err, os.ErrExist) {
		info, e := root.Lstat(maintenanceFile)
		if e != nil {
			return fail(e)
		}
		if linklike(info) || !info.Mode().IsRegular() || info.Size() > 4096 {
			return fail(errors.New("invalid maintenance guard"))
		}
		existing, e := root.Open(maintenanceFile)
		if e != nil {
			return fail(e)
		}
		held, e := existing.Stat()
		if e != nil || !os.SameFile(info, held) {
			existing.Close()
			return fail(busy)
		}
		bytes, e := io.ReadAll(io.LimitReader(existing, 4097))
		var old maintenanceRecord
		if e != nil || len(bytes) > 4096 || json.Unmarshal(bytes, &old) != nil || old.Version != 1 || old.Product != product || old.PID == 0 || !ownerID.MatchString(old.Token) {
			existing.Close()
			return fail(errors.New("invalid maintenance guard"))
		}
		started, e := strconv.ParseUint(old.StartTime, 10, 64)
		if e != nil || started == 0 {
			existing.Close()
			return fail(errors.New("invalid maintenance guard"))
		}
		e = checkProfileProcess(old.PID, started)
		existing.Close()
		if e != nil {
			return fail(e)
		}
		if e = root.Remove(maintenanceFile); e != nil {
			return fail(e)
		}
		file, err = createMaintenanceFile(base)
	}
	if err != nil {
		return fail(err)
	}
	opened, err := file.Stat()
	anchored, anchoredErr := root.Lstat(maintenanceFile)
	if err != nil || anchoredErr != nil || linklike(anchored) || !os.SameFile(opened, anchored) {
		file.Close()
		return fail(errors.New("maintenance folder changed"))
	}
	started, err := currentProcessStart()
	if err != nil {
		file.Close()
		root.Remove(maintenanceFile)
		return fail(err)
	}
	random := make([]byte, 16)
	if _, err = rand.Read(random); err != nil {
		file.Close()
		root.Remove(maintenanceFile)
		return fail(err)
	}
	random[6] = random[6]&15 | 64
	random[8] = random[8]&63 | 128
	token := hex.EncodeToString(random)
	token = token[:8] + "-" + token[8:12] + "-" + token[12:16] + "-" + token[16:20] + "-" + token[20:]
	data, err := json.Marshal(maintenanceRecord{1, product, uint32(os.Getpid()), strconv.FormatUint(started, 10), token})
	if err == nil {
		_, err = file.Write(data)
	}
	if err == nil {
		err = file.Sync()
	}
	if err != nil {
		file.Close()
		root.Remove(maintenanceFile)
		return fail(err)
	}
	return func() { file.Close(); root.Remove(maintenanceFile); root.Close() }, nil
}
