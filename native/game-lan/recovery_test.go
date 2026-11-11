package main

import (
	"context"
	"errors"
	"testing"
)

func TestDevicePreparation(t *testing.T) {
	tests := []struct {
		name         string
		initial      deviceState
		repair       bool
		vanishes     int
		removedState deviceState
		want         error
		removals     int
	}{
		{"clean", missing, false, 0, missing, nil, 0},
		{"device still retiring", productDevice, false, 2, missing, nil, 0},
		{"orphan needs consent", productDevice, false, 0, missing, stale, 0},
		{"positive ownership and consent", productDevice, true, 0, missing, nil, 1},
		{"different device using name", nameConflict, true, 0, missing, collision, 0},
		{"no driver proof", unknownDevice, true, 0, missing, collision, 0},
		{"Windows kept the node", productDevice, true, 0, productDevice, recoveryFailed, 1},
	}
	for _, c := range tests {
		t.Run(c.name, func(t *testing.T) {
			state := c.initial
			probes, removed := 0, 0
			err := prepareDevice(context.Background(), c.repair, func() (deviceState, error) {
				probes++
				if probes == c.vanishes {
					state = missing
				}
				return state, nil
			}, func() error { removed++; state = c.removedState; return nil }, func(context.Context) error { return nil })
			if !errors.Is(err, c.want) || removed != c.removals {
				t.Fatalf("err=%v removed=%d", err, removed)
			}
		})
	}
}
func TestCancelledRepairDoesNotRemove(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	err := prepareDevice(ctx, true, func() (deviceState, error) { return productDevice, nil }, func() error { t.Fatal("unexpected removal"); return nil }, func(context.Context) error { cancel(); return ctx.Err() })
	if !errors.Is(err, context.Canceled) {
		t.Fatal(err)
	}
}
