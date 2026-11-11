package main

import "testing"

func TestMaintenanceActionAtWizardEntry(t *testing.T) {
	tests := []struct{ setup, installed, want string }{
		{"0.6.1", "0.6.0", "update"}, // Entry rejected by the original 0.6.1 installer.
		{"0.6.2", "0.6.0", "update"},
		{"0.6.2", "0.6.1", "update"},
		{"0.6.2", "0.6.2", "repair"},
		{"0.6.2", "0.6.3", "newer"},
		{"0.6.2", "0.5.7", "update"},
		{"0.6.2", "0.3.1", "update"},
		{"0.6.2", "0.3.0", "legacy"},
		{"0.6.2", "0.10.0", "newer"},
		{"0.10.0", "0.9.9", "update"},
		{"1.0.0", "0.10.0", "update"},
		{"1.0.0", "1.0.0-rc1", ""},
		{"0.6.2", "", ""},
		{"0.6.2", "0.6", ""},
		{"0.6.2", "0.6.0.1", ""},
		{"0.6.2", "0.6.02", ""},
		{"0.6.2", "0.6.-1", ""},
		{"0.6.2", "0.6.+2", ""},
		{"0.6.2", "0.6.65536", ""},
		{"0.6.2", "0.6.1 ", ""},
		{"bad-build", "0.6.0", ""},
	}
	for _, tc := range tests {
		t.Run(tc.installed+"-to-"+tc.setup, func(t *testing.T) {
			got, err := run([]string{"maintenance-action", tc.setup, tc.installed})
			if got != tc.want || (err != nil) != (tc.want == "") {
				t.Fatalf("got %q, %v; want %q", got, err, tc.want)
			}
		})
	}
}
