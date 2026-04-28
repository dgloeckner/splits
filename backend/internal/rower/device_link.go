package rower

import (
	"context"
	"database/sql"
)

// DeviceLink tracks which (device, rower) pairs are allowed to set the
// active rower. Pairings are created implicitly today (on rower POST
// and on first SET active-rower) and will be created explicitly via
// the QR pairing flow in FEAT-0002.
type DeviceLink struct{ DB *sql.DB }

func NewDeviceLink(db *sql.DB) *DeviceLink { return &DeviceLink{DB: db} }

func (d *DeviceLink) Pair(ctx context.Context, deviceID, rowerID string) error {
	_, err := d.DB.ExecContext(ctx,
		`INSERT OR IGNORE INTO device_rowers(device_id, rower_id) VALUES(?, ?)`,
		deviceID, rowerID)
	return err
}

func (d *DeviceLink) IsPaired(ctx context.Context, deviceID, rowerID string) (bool, error) {
	var n int
	err := d.DB.QueryRowContext(ctx,
		`SELECT COUNT(1) FROM device_rowers WHERE device_id = ? AND rower_id = ?`,
		deviceID, rowerID).Scan(&n)
	if err != nil {
		return false, err
	}
	return n > 0, nil
}
