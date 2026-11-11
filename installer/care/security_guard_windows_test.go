package main

import (
	"errors"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"syscall"
	"testing"
)

func securityProcessStart(t *testing.T) uint64 {
	t.Helper()
	handle, err := syscall.OpenProcess(0x1000, false, uint32(os.Getpid()))
	if err != nil {
		t.Fatal(err)
	}
	defer syscall.CloseHandle(handle)
	var creation, exit, kernelTime, userTime syscall.Filetime
	if err := syscall.GetProcessTimes(handle, &creation, &exit, &kernelTime, &userTime); err != nil {
		t.Fatal(err)
	}
	return uint64(creation.HighDateTime)<<32 | uint64(creation.LowDateTime)
}

func securityGuard(t *testing.T, profile string, started uint64) {
	t.Helper()
	securityJSON(t, filepath.Join(profile, "active-process-v1.json"), map[string]any{
		"version": 1, "product": "CRAFTCODE LINK", "owner": securityOwnerA,
		"pid": os.Getpid(), "startTime": strconv.FormatUint(started, 10),
	})
}

func TestSecurityLiveProfileOwnerPreventsAnyCleanup(t *testing.T) {
	for _, named := range []bool{false, true} {
		for _, erase := range []bool{false, true} {
			name := map[bool]string{false: "default", true: "named"}[named] + map[bool]string{false: "-cache", true: "-erase"}[erase]
			t.Run(name, func(t *testing.T) {
				base := filepath.Join(t.TempDir(), "AppData")
				main := filepath.Join(base, product)
				profile := main
				if named {
					profile = filepath.Join(main, "profiles", "secondary")
				}
				securityGuard(t, profile, securityProcessStart(t))
				preserved := []string{filepath.Join(main, "Cache", "keep"), filepath.Join(profile, "craftlink-account-v1.bin")}
				for _, target := range preserved {
					file(t, target)
				}
				if err := cleanProfiles(base, erase); !errors.Is(err, busy) {
					t.Fatalf("live owner was not refused: %v", err)
				}
				for _, target := range preserved {
					exists(t, target, true)
				}
			})
		}
	}
}

func TestSecurityReusedPIDDoesNotMakeStaleGuardLive(t *testing.T) {
	base := filepath.Join(t.TempDir(), "AppData")
	main := filepath.Join(base, product)
	securityGuard(t, main, securityProcessStart(t)+1)
	file(t, filepath.Join(main, "Cache", "owned"))
	file(t, filepath.Join(main, "craftlink-account-v1.bin"))
	if err := cleanProfiles(base, false); err != nil {
		t.Fatal(err)
	}
	exists(t, filepath.Join(main, "Cache"), false)
	exists(t, filepath.Join(main, "craftlink-account-v1.bin"), true)
}

func TestSecurityMaintenanceOwnsCleanupUntilRelease(t *testing.T) {
	base := t.TempDir()
	main := filepath.Join(base, product)
	file(t, filepath.Join(main, "Cache", "keep-until-release"))
	file(t, filepath.Join(main, "craftlink-account-v1.bin"))
	release, err := beginMaintenance(base)
	if err != nil {
		t.Fatal(err)
	}
	held := true
	defer func() {
		if held {
			release()
		}
	}()
	marker := filepath.Join(base, ".craftcode-link-maintenance-v1.json")
	exists(t, marker, true)
	if err := os.Remove(marker); err == nil {
		t.Fatal("held Windows maintenance marker could be removed")
	}
	for _, erase := range []bool{false, true} {
		if err := cleanProfiles(base, erase); !errors.Is(err, busy) {
			t.Fatalf("parallel cleanup was not refused: %v", err)
		}
		exists(t, filepath.Join(main, "Cache", "keep-until-release"), true)
		exists(t, filepath.Join(main, "craftlink-account-v1.bin"), true)
	}
	release()
	held = false
	exists(t, marker, false)
	if err := cleanProfiles(base, false); err != nil {
		t.Fatal(err)
	}
	exists(t, filepath.Join(main, "Cache"), false)
	exists(t, filepath.Join(main, "craftlink-account-v1.bin"), true)
	exists(t, marker, false)
}

func TestSecurityStaleMaintenanceCanBeRetried(t *testing.T) {
	base := t.TempDir()
	main := filepath.Join(base, product)
	marker := filepath.Join(base, ".craftcode-link-maintenance-v1.json")
	securityJSON(t, marker, map[string]any{
		"version": 1, "product": product, "pid": os.Getpid(),
		"startTime": strconv.FormatUint(securityProcessStart(t)+1, 10), "token": securityOwnerA,
	})
	file(t, filepath.Join(main, "Cache", "owned"))
	file(t, filepath.Join(main, "craftlink-account-v1.bin"))
	if err := cleanProfiles(base, false); err != nil {
		t.Fatal(err)
	}
	exists(t, filepath.Join(main, "Cache"), false)
	exists(t, filepath.Join(main, "craftlink-account-v1.bin"), true)
	exists(t, marker, false)
}

func TestSecurityInvalidMaintenancePreservesAllData(t *testing.T) {
	for _, content := range []string{"", "{}", "{\"version\":1,\"product\":\"other\"}"} {
		t.Run(strconv.Itoa(len(content)), func(t *testing.T) {
			base := t.TempDir()
			main := filepath.Join(base, product)
			marker := filepath.Join(base, ".craftcode-link-maintenance-v1.json")
			if err := os.WriteFile(marker, []byte(content), 0600); err != nil {
				t.Fatal(err)
			}
			file(t, filepath.Join(main, "Cache", "keep"))
			file(t, filepath.Join(main, "craftlink-account-v1.bin"))
			for _, erase := range []bool{false, true} {
				if err := cleanProfiles(base, erase); err == nil {
					t.Fatal("invalid maintenance accepted")
				}
				exists(t, filepath.Join(main, "Cache", "keep"), true)
				exists(t, filepath.Join(main, "craftlink-account-v1.bin"), true)
			}
			data, err := os.ReadFile(marker)
			if err != nil || string(data) != content {
				t.Fatal("invalid guard was replaced")
			}
		})
	}
}

func TestSecurityBootstrapRejectsHeldNativeMaintenance(t *testing.T) {
	node := os.Getenv("CRAFTCODE_SECURITY_NODE")
	if node == "" {
		var err error
		node, err = exec.LookPath("node")
		if err != nil {
			t.Skip("Node is required for native-to-JavaScript integration")
		}
	}
	base := t.TempDir()
	release, err := beginMaintenance(base)
	if err != nil {
		t.Fatal(err)
	}
	defer release()
	module, err := filepath.Abs(filepath.Join("..", "..", "src", "storage-location.cjs"))
	if err != nil {
		t.Fatal(err)
	}
	script := `const fs=require('node:fs'),path=require('node:path');
const {StorageLocation}=require(process.argv[1]),base=process.argv[2],anchor=path.join(base,'CRAFTCODE LINK');
const storage=new StorageLocation({anchor,downloads:path.join(base,'Downloads'),maintenanceDirectory:base,guardOwner:true});
let blocked=false;try { storage.bootstrap(); } catch(error) { blocked=/Обслуживание|maintenance/i.test(error.message); }
if(!blocked||fs.existsSync(anchor))process.exit(2);`
	if output, err := exec.Command(node, "-e", script, module, base).CombinedOutput(); err != nil {
		t.Fatalf("bootstrap ran during held native cleanup: %v: %s", err, output)
	}
	exists(t, filepath.Join(base, ".craftcode-link-maintenance-v1.json"), true)
}
