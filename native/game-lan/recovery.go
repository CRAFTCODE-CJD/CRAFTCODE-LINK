package main

import (
	"context"
	"errors"
	"time"
)

type deviceState int

const (
	missing deviceState = iota
	productDevice
	nameConflict
	unknownDevice
)

var stale = errors.New("stale")
var collision = errors.New("name-conflict")
var recoveryFailed = errors.New("repair-failed")
var restartRequired = errors.New("restart-required")

// Caller holds the same product-wide guard used by releases 0.7.1 and 0.7.2.
// Only the explicitly requested repair may remove a positively identified device.
func prepareDevice(ctx context.Context, repair bool, inspect func() (deviceState, error), remove func() error, wait func(context.Context) error) error {
	for attempt := 0; ; attempt++ {
		if err := ctx.Err(); err != nil {
			return err
		}
		s, err := inspect()
		if err != nil {
			return err
		}
		switch s {
		case missing:
			return nil
		case nameConflict, unknownDevice:
			return collision
		case productDevice:
			if attempt == 3 {
				if !repair {
					return stale
				}
				if err := remove(); err != nil {
					return err
				}
			}
			if attempt >= 20 {
				return recoveryFailed
			}
		default:
			return recoveryFailed
		}
		if err := wait(ctx); err != nil {
			return err
		}
	}
}
func pauseProbe(ctx context.Context) error {
	select {
	case <-time.After(250 * time.Millisecond):
		return nil
	case <-ctx.Done():
		return ctx.Err()
	}
}
