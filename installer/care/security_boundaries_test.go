package main

import (
	"encoding/json"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
)

const securityOwnerA = "11111111-1111-4111-8111-111111111111"
const securityOwnerB = "22222222-2222-4222-8222-222222222222"

func securityJSON(t *testing.T, target string, value any) {
	t.Helper()
	data, err := json.Marshal(value)
	if err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(filepath.Dir(target), 0700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(target, data, 0600); err != nil {
		t.Fatal(err)
	}
}

func securityLocator(t *testing.T, profile, external, owner string) {
	t.Helper()
	securityJSON(t, filepath.Join(profile, "storage-location-v1.json"), map[string]any{
		"version": 1, "product": "CRAFTCODE LINK", "owner": owner, "directory": external,
	})
}

func securityMarker(t *testing.T, external, owner string) {
	t.Helper()
	securityJSON(t, filepath.Join(external, ".craftcode-link-data-v1.json"), map[string]any{
		"version": 1, "product": "CRAFTCODE LINK", "owner": owner,
	})
}

// Junctions do not require Windows' symbolic-link privilege. Every path supplied
// here belongs to the test's temporary tree; no real profile is accessed.
func securityDirectoryLink(t *testing.T, link, destination string) {
	t.Helper()
	if err := os.Symlink(destination, link); err == nil {
		return
	} else if runtime.GOOS != "windows" {
		t.Skipf("directory links unavailable: %v", err)
	}
	quote := func(value string) string { return "'" + strings.ReplaceAll(value, "'", "''") + "'" }
	script := "$ErrorActionPreference='Stop'; $null = New-Item -ItemType Junction -Path " + quote(link) + " -Target " + quote(destination)
	if output, err := exec.Command("powershell.exe", "-NoProfile", "-NonInteractive", "-Command", script).CombinedOutput(); err != nil {
		t.Fatalf("could not create isolated junction: %v: %s", err, output)
	}
}

func TestSecurityCacheCleanupPreservesProfileAndForeignFiles(t *testing.T) {
	root := t.TempDir()
	base := filepath.Join(root, "AppData")
	main := filepath.Join(base, product)
	named := filepath.Join(main, "profiles", "secondary")
	external := filepath.Join(root, "another-drive", "CRAFTCODE LINK Data")
	securityMarker(t, external, securityOwnerA)
	securityLocator(t, main, external, securityOwnerA)
	profiles := []string{main, named, external}
	preserve := []string{
		"craftlink-account-v1.bin", "link-personal-chats-v1.sqlite", "link-personal-chats-v1.sqlite-journal",
		"Local Storage/leveldb/000001.log", "groups/attachment.bin", "unknown/photos/keep.png",
	}
	caches := []string{"Cache", "Code Cache", "GPUCache", "DawnCache", "DawnGraphiteCache", "DawnWebGPUCache", "GrShaderCache", "ShaderCache", "GraphiteDawnCache", "Crashpad", "logs", "reports", "update-cache", "media-test"}
	for _, profile := range profiles {
		for _, name := range preserve {
			file(t, filepath.Join(profile, filepath.FromSlash(name)))
		}
		for _, name := range caches {
			file(t, filepath.Join(profile, name, "owned.tmp"))
		}
	}
	download := filepath.Join(root, "Downloads", "CRAFTCODE LINK", "DM-example", "keep.webm")
	otherApp := filepath.Join(base, "another-application", "Cache", "keep")
	file(t, download)
	file(t, otherApp)
	for attempt := 0; attempt < 2; attempt++ {
		if err := cleanProfiles(base, false); err != nil {
			t.Fatal(err)
		}
	}
	for _, profile := range profiles {
		for _, name := range preserve {
			exists(t, filepath.Join(profile, filepath.FromSlash(name)), true)
		}
		for _, name := range caches {
			exists(t, filepath.Join(profile, name), false)
		}
	}
	exists(t, filepath.Join(main, "storage-location-v1.json"), true)
	exists(t, filepath.Join(external, ".craftcode-link-data-v1.json"), true)
	exists(t, download, true)
	exists(t, otherApp, true)
}

func TestSecurityInvalidExternalOwnershipPreventsAllDeletion(t *testing.T) {
	for _, mode := range []string{"missing-marker", "wrong-owner", "wrong-product", "oversized-marker", "wrong-leaf-name", "invalid-owner"} {
		for _, erase := range []bool{false, true} {
			t.Run(mode+map[bool]string{false: "-cache", true: "-erase"}[erase], func(t *testing.T) {
				root := t.TempDir()
				base := filepath.Join(root, "AppData")
				main := filepath.Join(base, product)
				external := filepath.Join(root, "external", "CRAFTCODE LINK Data")
				if mode == "wrong-leaf-name" {
					external = filepath.Join(root, "external", "Personal Documents")
				}
				securityLocator(t, main, external, securityOwnerA)
				securityMarker(t, external, securityOwnerA)
				marker := filepath.Join(external, ".craftcode-link-data-v1.json")
				switch mode {
				case "missing-marker":
					if err := os.Remove(marker); err != nil {
						t.Fatal(err)
					}
				case "wrong-owner":
					securityMarker(t, external, securityOwnerB)
				case "wrong-product":
					securityJSON(t, marker, map[string]any{"version": 1, "product": "other", "owner": securityOwnerA})
				case "oversized-marker":
					if err := os.WriteFile(marker, []byte(strings.Repeat(" ", 20000)), 0600); err != nil {
						t.Fatal(err)
					}
				case "invalid-owner":
					securityLocator(t, main, external, "not-an-owner-uuid")
				}
				preserved := []string{
					filepath.Join(main, "craftlink-account-v1.bin"), filepath.Join(main, "Cache", "must-remain"),
					filepath.Join(main, "profiles", "second", "Cache", "must-remain"),
					filepath.Join(external, "personal-sentinel"), filepath.Join(external, "Cache", "must-remain"),
				}
				for _, target := range preserved {
					file(t, target)
				}
				if err := cleanProfiles(base, erase); err == nil {
					t.Fatal("invalid ownership was accepted")
				}
				for _, target := range preserved {
					exists(t, target, true)
				}
			})
		}
	}
}

func TestSecurityDuplicateExternalReferenceStillChecksOwner(t *testing.T) {
	root := t.TempDir()
	base := filepath.Join(root, "AppData")
	main := filepath.Join(base, product)
	named := filepath.Join(main, "profiles", "second")
	external := filepath.Join(root, "external", "CRAFTCODE LINK Data")
	securityMarker(t, external, securityOwnerA)
	securityLocator(t, main, external, securityOwnerA)
	securityLocator(t, named, external, securityOwnerB)
	for _, target := range []string{filepath.Join(main, "Cache", "keep"), filepath.Join(external, "Cache", "keep")} {
		file(t, target)
	}
	if err := cleanProfiles(base, true); err == nil {
		t.Fatal("a duplicate path bypassed the second locator's ownership check")
	}
	exists(t, filepath.Join(main, "Cache", "keep"), true)
	exists(t, filepath.Join(external, "Cache", "keep"), true)
}

func TestSecurityRedirectedExternalRootIsRejected(t *testing.T) {
	root := t.TempDir()
	base := filepath.Join(root, "AppData")
	main := filepath.Join(base, product)
	outside := filepath.Join(root, "foreign")
	securityMarker(t, outside, securityOwnerA)
	file(t, filepath.Join(outside, "personal-sentinel"))
	external := filepath.Join(root, "CRAFTCODE LINK Data")
	securityDirectoryLink(t, external, outside)
	securityLocator(t, main, external, securityOwnerA)
	file(t, filepath.Join(main, "Cache", "keep"))
	if err := cleanProfiles(base, true); err == nil {
		t.Fatal("redirected external root accepted")
	}
	exists(t, filepath.Join(main, "Cache", "keep"), true)
	exists(t, filepath.Join(outside, "personal-sentinel"), true)
}

func TestSecurityCacheJunctionNeverDeletesItsTarget(t *testing.T) {
	for _, nested := range []bool{false, true} {
		t.Run(map[bool]string{false: "cache-leaf", true: "cache-child"}[nested], func(t *testing.T) {
			root := t.TempDir()
			base := filepath.Join(root, "AppData")
			main := filepath.Join(base, product)
			outside := filepath.Join(root, "Downloads")
			file(t, filepath.Join(outside, "personal-sentinel"))
			file(t, filepath.Join(main, "craftlink-account-v1.bin"))
			link := filepath.Join(main, "Cache")
			if nested {
				file(t, filepath.Join(link, "owned-cache-file"))
				link = filepath.Join(link, "redirected")
			}
			securityDirectoryLink(t, link, outside)
			// A safe refusal is acceptable; traversal into the target is never safe.
			_ = cleanProfiles(base, false)
			exists(t, filepath.Join(outside, "personal-sentinel"), true)
			exists(t, filepath.Join(main, "craftlink-account-v1.bin"), true)
		})
	}
}

func TestSecurityEraseValidatedExternalPreservesUnrelatedSibling(t *testing.T) {
	root := t.TempDir()
	base := filepath.Join(root, "AppData")
	main := filepath.Join(base, product)
	external := filepath.Join(root, "external", "CRAFTCODE LINK Data")
	securityMarker(t, external, securityOwnerA)
	securityLocator(t, main, external, securityOwnerA)
	file(t, filepath.Join(external, "link-personal-chats-v1.sqlite"))
	file(t, filepath.Join(main, "craftlink-account-v1.bin"))
	sibling := filepath.Join(root, "external", "family-photo.png")
	file(t, sibling)
	if err := cleanProfiles(base, true); err != nil {
		t.Fatal(err)
	}
	exists(t, external, false)
	exists(t, main, false)
	exists(t, sibling, true)
}

func TestSecurityRedirectedNamedProfileCannotAuthorizeExternalCleanup(t *testing.T) {
	for _, erase := range []bool{false, true} {
		t.Run(map[bool]string{false: "cache", true: "erase"}[erase], func(t *testing.T) {
			root := t.TempDir()
			base := filepath.Join(root, "AppData")
			main := filepath.Join(base, product)
			foreign := filepath.Join(root, "foreign-profile")
			external := filepath.Join(root, "external", "CRAFTCODE LINK Data")
			securityMarker(t, external, securityOwnerA)
			securityLocator(t, foreign, external, securityOwnerA)
			file(t, filepath.Join(external, "Cache", "keep"))
			file(t, filepath.Join(foreign, "Cache", "keep"))
			file(t, filepath.Join(main, "profiles", "ordinary", "Cache", "owned"))
			securityDirectoryLink(t, filepath.Join(main, "profiles", "redirected"), foreign)
			if err := cleanProfiles(base, erase); err != nil {
				t.Fatal(err)
			}
			exists(t, filepath.Join(foreign, "Cache", "keep"), true)
			exists(t, filepath.Join(external, "Cache", "keep"), true)
			exists(t, filepath.Join(external, ".craftcode-link-data-v1.json"), true)
		})
	}
}

func TestSecurityRetryEraseAcceptsOnlyEmptyUnmarkedExternalRoot(t *testing.T) {
	base := filepath.Join(t.TempDir(), "AppData")
	main := filepath.Join(base, product)
	external := filepath.Join(filepath.Dir(base), "external", "CRAFTCODE LINK Data")
	securityLocator(t, main, external, securityOwnerA)
	if err := os.MkdirAll(external, 0700); err != nil {
		t.Fatal(err)
	}
	file(t, filepath.Join(main, "craftlink-account-v1.bin"))
	if err := cleanProfiles(base, true); err != nil {
		t.Fatal(err)
	}
	exists(t, external, false)
	exists(t, main, false)
}

func TestSecurityKeepProfileRemovesOnlyReferencedOwnedStages(t *testing.T) {
	root := t.TempDir()
	base := filepath.Join(root, "AppData")
	main := filepath.Join(base, product)
	parent := filepath.Join(root, "destination")
	pending := filepath.Join(parent, "CRAFTCODE LINK Data")
	stage := filepath.Join(parent, ".craftcode-link-move-"+securityOwnerA)
	retained := filepath.Join(parent, ".craftcode-link-move-"+securityOwnerB)
	foreign := filepath.Join(parent, ".craftcode-link-move-33333333-3333-4333-8333-333333333333")
	unreferenced := filepath.Join(parent, ".craftcode-link-move-44444444-4444-4444-8444-444444444444")
	previous := filepath.Join(root, "previous", "CRAFTCODE LINK Data")
	for _, folder := range []string{stage, retained, unreferenced, previous} {
		securityMarker(t, folder, securityOwnerA)
	}
	securityMarker(t, foreign, securityOwnerB)
	for _, folder := range []string{stage, retained, foreign, unreferenced} {
		file(t, filepath.Join(folder, "private-copy.sqlite"))
	}
	file(t, filepath.Join(previous, "Cache", "owned"))
	file(t, filepath.Join(previous, "craftlink-account-v1.bin"))
	file(t, filepath.Join(main, "craftlink-account-v1.bin"))
	securityJSON(t, filepath.Join(main, "storage-location-v1.json"), map[string]any{
		"version": 1, "product": product, "owner": securityOwnerA, "directory": main,
		"pending":             map[string]any{"directory": pending, "from": main, "token": securityOwnerA},
		"previousDirectories": []string{previous}, "retainedStages": []string{retained},
	})
	if err := cleanProfiles(base, false); err != nil {
		t.Fatal(err)
	}
	exists(t, stage, false)
	exists(t, retained, false)
	exists(t, filepath.Join(foreign, "private-copy.sqlite"), true)
	exists(t, filepath.Join(unreferenced, "private-copy.sqlite"), true)
	exists(t, filepath.Join(previous, "Cache"), false)
	exists(t, filepath.Join(previous, "craftlink-account-v1.bin"), true)
	exists(t, filepath.Join(main, "craftlink-account-v1.bin"), true)
	exists(t, pending, false)
}

func TestSecurityRecordedStageOwnershipMismatchPreservesAllData(t *testing.T) {
	base := filepath.Join(t.TempDir(), "AppData")
	main := filepath.Join(base, product)
	stage := filepath.Join(filepath.Dir(base), ".craftcode-link-move-"+securityOwnerA)
	securityMarker(t, stage, securityOwnerB)
	file(t, filepath.Join(stage, "private-copy.sqlite"))
	file(t, filepath.Join(main, "Cache", "keep"))
	securityJSON(t, filepath.Join(main, "storage-location-v1.json"), map[string]any{
		"version": 1, "product": product, "owner": securityOwnerA, "directory": main, "retainedStages": []string{stage},
	})
	for _, erase := range []bool{false, true} {
		if err := cleanProfiles(base, erase); err == nil {
			t.Fatal("recorded stage ownership mismatch accepted")
		}
		exists(t, filepath.Join(main, "storage-location-v1.json"), true)
		exists(t, filepath.Join(main, "Cache", "keep"), true)
		exists(t, filepath.Join(stage, "private-copy.sqlite"), true)
	}
}

func TestSecurityUnavailableRequiredStoragePreservesLocator(t *testing.T) {
	root := t.TempDir()
	base := filepath.Join(root, "AppData")
	main := filepath.Join(base, product)
	parent := filepath.Join(root, "unavailable-volume")
	external := filepath.Join(parent, "CRAFTCODE LINK Data")
	securityMarker(t, external, securityOwnerA)
	file(t, filepath.Join(external, "craftlink-account-v1.bin"))
	securityLocator(t, main, external, securityOwnerA)
	file(t, filepath.Join(main, "Cache", "keep"))
	if err := os.Rename(parent, parent+"-detached"); err != nil {
		t.Fatal(err)
	}
	if err := cleanProfiles(base, true); err == nil {
		t.Fatal("unavailable required storage was reported as erased")
	}
	exists(t, filepath.Join(main, "storage-location-v1.json"), true)
	exists(t, filepath.Join(main, "Cache", "keep"), true)
	exists(t, filepath.Join(parent+"-detached", "CRAFTCODE LINK Data", "craftlink-account-v1.bin"), true)
}

func TestSecurityAdjacentDataSurvivesRepairAndPayloadRemoval(t *testing.T) {
	root := t.TempDir()
	installed := filepath.Join(root, "installed", product)
	base := filepath.Join(root, "AppData")
	main := filepath.Join(base, product)
	staged, _ := prepare(t, installed)
	if err := commit(installed, staged); err != nil {
		t.Fatal(err)
	}
	data := filepath.Join(installed, "CRAFTCODE LINK Data")
	securityMarker(t, data, securityOwnerA)
	securityLocator(t, main, data, securityOwnerA)
	identityFile := filepath.Join(data, "craftlink-account-v1.bin")
	historyFile := filepath.Join(data, "link-personal-chats-v1.sqlite")
	foreign := filepath.Join(installed, "personal-notes.txt")
	for _, name := range []string{identityFile, historyFile, foreign, filepath.Join(data, "Cache", "owned-cache")} {
		file(t, name)
	}
	identityBefore, err := os.ReadFile(identityFile)
	if err != nil {
		t.Fatal(err)
	}
	historyBefore, err := os.ReadFile(historyFile)
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(installed, "CRAFTCODE-LINK.exe"), []byte("old release"), 0600); err != nil {
		t.Fatal(err)
	}
	update := seedRepair(t, installed)
	if err := repair(installed, update); err != nil {
		t.Fatal(err)
	}
	application, err := os.ReadFile(filepath.Join(installed, "CRAFTCODE-LINK.exe"))
	if err != nil || string(application) != "sample" {
		t.Fatalf("application did not update: %v", err)
	}
	for _, filename := range []string{identityFile, historyFile, foreign, filepath.Join(data, "Cache", "owned-cache")} {
		exists(t, filename, true)
	}
	if err := cleanProfiles(base, false); err != nil {
		t.Fatal(err)
	}
	if err := removePayload(installed); err != nil {
		t.Fatal(err)
	}
	identityAfter, err := os.ReadFile(identityFile)
	if err != nil || string(identityAfter) != string(identityBefore) {
		t.Fatalf("kept identity changed: %v", err)
	}
	historyAfter, err := os.ReadFile(historyFile)
	if err != nil || string(historyAfter) != string(historyBefore) {
		t.Fatalf("kept history changed: %v", err)
	}
	exists(t, filepath.Join(data, "Cache"), false)
	exists(t, filepath.Join(data, ".craftcode-link-data-v1.json"), true)
	exists(t, filepath.Join(main, "storage-location-v1.json"), true)
	exists(t, foreign, true)
	exists(t, filepath.Join(installed, "CRAFTCODE-LINK.exe"), false)
	// Explicit profile erasure removes only the verified data child; neither
	// its installation parent nor unrelated user files are recursively deleted.
	if err := cleanProfiles(base, true); err != nil {
		t.Fatal(err)
	}
	exists(t, data, false)
	exists(t, main, false)
	exists(t, installed, true)
	exists(t, foreign, true)
}

func TestSecurityReinstallPreservesAuthorizedAdjacentData(t *testing.T) {
	for _, reference := range []string{"current", "previous"} {
		t.Run(reference, func(t *testing.T) {
			root := t.TempDir()
			base := filepath.Join(root, "AppData")
			t.Setenv("APPDATA", base)
			installed := filepath.Join(root, "installed", product)
			data := filepath.Join(installed, dataDirectory)
			anchor := filepath.Join(base, product)
			securityMarker(t, data, securityOwnerA)
			identity := filepath.Join(data, "craftlink-account-v1.bin")
			history := filepath.Join(data, "link-personal-chats-v1.sqlite")
			file(t, identity)
			file(t, history)
			before, err := os.Stat(data)
			if err != nil {
				t.Fatal(err)
			}
			locator := map[string]any{"version": 1, "product": product, "owner": securityOwnerA, "directory": data}
			if reference == "previous" {
				active := filepath.Join(root, "other-drive", dataDirectory)
				securityMarker(t, active, securityOwnerA)
				locator["directory"] = active
				locator["previousDirectories"] = []string{data}
			}
			securityJSON(t, filepath.Join(anchor, locationFile), locator)
			staged, stagingPath := prepare(t, installed)
			if err := commit(installed, staged); err != nil {
				t.Fatal(err)
			}
			after, err := os.Stat(data)
			if err != nil || !os.SameFile(before, after) {
				t.Fatalf("data directory was replaced: %v", err)
			}
			for _, name := range []string{identity, history} {
				bytes, err := os.ReadFile(name)
				if err != nil || string(bytes) != "sample" {
					t.Fatalf("preserved data changed: %v", err)
				}
			}
			exists(t, filepath.Join(installed, "CRAFTCODE-LINK.exe"), true)
			exists(t, filepath.Join(installed, "Uninstall.exe"), true)
			exists(t, stagingPath, false)
		})
	}
}

func TestSecurityReinstallRejectsUnverifiedAdjacentData(t *testing.T) {
	for _, mode := range []string{"missing-locator", "wrong-owner", "unreferenced", "pending-only", "extra-sibling", "redirected-data"} {
		t.Run(mode, func(t *testing.T) {
			root := t.TempDir()
			base := filepath.Join(root, "AppData")
			t.Setenv("APPDATA", base)
			installed := filepath.Join(root, "installed", product)
			data := filepath.Join(installed, dataDirectory)
			physicalData := data
			if mode == "redirected-data" {
				physicalData = filepath.Join(root, "outside")
			}
			securityMarker(t, physicalData, securityOwnerA)
			privateFile := filepath.Join(physicalData, "link-personal-chats-v1.sqlite")
			file(t, privateFile)
			if mode == "redirected-data" {
				if err := os.MkdirAll(installed, 0700); err != nil {
					t.Fatal(err)
				}
				securityDirectoryLink(t, data, physicalData)
			}
			if mode != "missing-locator" {
				locator := map[string]any{"version": 1, "product": product, "owner": securityOwnerA, "directory": data}
				if mode == "wrong-owner" {
					locator["owner"] = securityOwnerB
				}
				if mode == "unreferenced" || mode == "pending-only" {
					locator["directory"] = filepath.Join(base, product)
					if mode == "pending-only" {
						locator["pending"] = map[string]any{"directory": data, "from": filepath.Join(base, product), "token": securityOwnerA}
					}
				}
				securityJSON(t, filepath.Join(base, product, locationFile), locator)
			}
			if mode == "extra-sibling" {
				file(t, filepath.Join(installed, "unrelated.txt"))
			}
			if _, err := stage(installed); err == nil {
				t.Fatal("unverified preserved folder accepted")
			}
			bytes, err := os.ReadFile(privateFile)
			if err != nil || string(bytes) != "sample" {
				t.Fatalf("refused data changed: %v", err)
			}
			exists(t, filepath.Join(installed, "CRAFTCODE-LINK.exe"), false)
			if mode == "extra-sibling" {
				exists(t, filepath.Join(installed, "unrelated.txt"), true)
			}
		})
	}
}

func TestSecurityPayloadCatalogCannotTargetAdjacentData(t *testing.T) {
	original := catalog
	t.Cleanup(func() { catalog = original })
	for _, forbidden := range []string{dataDirectory, dataDirectory + "/craftlink-account-v1.bin", "craftcode link data/link-personal-chats-v1.sqlite"} {
		t.Run(forbidden, func(t *testing.T) {
			root := t.TempDir()
			identity := filepath.Join(root, dataDirectory, "craftlink-account-v1.bin")
			file(t, identity)
			catalog = "CRAFTCODE-LINK.exe\n" + forbidden + "\n"
			if _, err := paths(); err == nil {
				t.Fatal("reserved data accepted into catalog")
			}
			if err := removePayload(root); err == nil {
				t.Fatal("reserved catalog accepted for removal")
			}
			bytes, err := os.ReadFile(identity)
			if err != nil || string(bytes) != "sample" {
				t.Fatalf("reserved data changed: %v", err)
			}
		})
	}
}
