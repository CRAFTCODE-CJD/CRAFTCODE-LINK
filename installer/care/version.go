package main

import (
	"errors"
	"slices"
	"strconv"
	"strings"
)

// The per-user installer layout and uninstall key have been compatible since 0.3.1.
var firstMaintenanceVersion = [3]uint16{0, 3, 1}

func parseRelease(value string) ([3]uint16, error) {
	var release [3]uint16
	parts := strings.Split(value, ".")
	if len(parts) != len(release) {
		return release, errors.New("expected three numeric version components")
	}
	for i, part := range parts {
		n, err := strconv.ParseUint(part, 10, 16)
		if err != nil || strconv.FormatUint(n, 10) != part {
			return release, errors.New("invalid version component")
		}
		release[i] = uint16(n)
	}
	return release, nil
}

// Output goes directly to the NSIS wizard. Only update and repair may change files.
func maintenanceAction(currentText, installedText string) (string, error) {
	current, err := parseRelease(currentText)
	if err != nil {
		return "", err
	}
	installed, err := parseRelease(installedText)
	if err != nil {
		return "", err
	}
	if slices.Compare(installed[:], firstMaintenanceVersion[:]) < 0 {
		return "legacy", nil
	}
	switch slices.Compare(installed[:], current[:]) {
	case 1:
		return "newer", nil
	case 0:
		return "repair", nil
	default:
		return "update", nil
	}
}
