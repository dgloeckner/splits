// Package rower owns rower profile CRUD and the "active rower per
// device" mapping. A single process-wide Holder gives the sessionizer
// (which runs off the serial loop, not an HTTP request) a consistent
// notion of who to attribute the current session to.
package rower

import (
	"context"
	"database/sql"
	"errors"
	"strings"
	"sync"
	"time"

	"github.com/google/uuid"
)

type Rower struct {
	ID        string    `json:"id"`
	Name      string    `json:"name"`
	WeightKg  *float64  `json:"weight_kg,omitempty"`
	HeightCm  *float64  `json:"height_cm,omitempty"`
	DOB       *string   `json:"dob,omitempty"`
	Color     string    `json:"color"`
	CreatedAt time.Time `json:"created_at"`
}

type CreateInput struct {
	Name     string   `json:"name"`
	WeightKg *float64 `json:"weight_kg,omitempty"`
	HeightCm *float64 `json:"height_cm,omitempty"`
	DOB      *string  `json:"dob,omitempty"`
	Color    string   `json:"color,omitempty"`
}

var (
	ErrNameRequired = errors.New("rower: name required")
	ErrNameTooLong  = errors.New("rower: name longer than 80 chars")
	ErrWeightRange  = errors.New("rower: weight must be 20-300 kg")
	ErrHeightRange  = errors.New("rower: height must be 80-260 cm")
	ErrDOBInvalid   = errors.New("rower: dob must be YYYY-MM-DD between 1900-01-01 and today")
)

const (
	maxNameLen   = 80
	minWeightKg  = 20.0
	maxWeightKg  = 300.0
	minHeightCm  = 80.0
	maxHeightCm  = 260.0
	dobLayout    = "2006-01-02"
)

// validateUpdate enforces input bounds for partial updates. Each
// field is checked only when present (non-nil pointer).
func validateUpdate(in UpdateInput) error {
	if in.Name != nil {
		if *in.Name == "" {
			return ErrNameRequired
		}
		if len([]rune(*in.Name)) > maxNameLen {
			return ErrNameTooLong
		}
	}
	if in.WeightKg != nil {
		w := *in.WeightKg
		if w < minWeightKg || w > maxWeightKg {
			return ErrWeightRange
		}
	}
	if in.HeightCm != nil {
		h := *in.HeightCm
		if h < minHeightCm || h > maxHeightCm {
			return ErrHeightRange
		}
	}
	if in.DOB != nil && *in.DOB != "" {
		t, err := time.Parse(dobLayout, *in.DOB)
		if err != nil {
			return ErrDOBInvalid
		}
		earliest := time.Date(1900, 1, 1, 0, 0, 0, 0, time.UTC)
		if t.Before(earliest) || t.After(time.Now().UTC()) {
			return ErrDOBInvalid
		}
	}
	return nil
}

// validateCreate enforces input bounds at the API/repo boundary.
// Defense-in-depth (the HTTP body limit caps payload size globally;
// these checks reject semantically invalid values before they reach
// SQL).
func validateCreate(in CreateInput) error {
	if in.Name == "" {
		return ErrNameRequired
	}
	if len([]rune(in.Name)) > maxNameLen {
		return ErrNameTooLong
	}
	if in.WeightKg != nil {
		w := *in.WeightKg
		if w < minWeightKg || w > maxWeightKg {
			return ErrWeightRange
		}
	}
	if in.HeightCm != nil {
		h := *in.HeightCm
		if h < minHeightCm || h > maxHeightCm {
			return ErrHeightRange
		}
	}
	if in.DOB != nil && *in.DOB != "" {
		t, err := time.Parse(dobLayout, *in.DOB)
		if err != nil {
			return ErrDOBInvalid
		}
		earliest := time.Date(1900, 1, 1, 0, 0, 0, 0, time.UTC)
		if t.Before(earliest) || t.After(time.Now().UTC()) {
			return ErrDOBInvalid
		}
	}
	return nil
}

type Repo struct{ db *sql.DB }

func NewRepo(db *sql.DB) *Repo { return &Repo{db: db} }

var palette = []string{"#ff6b6b", "#4ecdc4", "#ffe66d", "#a78bfa", "#f97316", "#60a5fa", "#34d399", "#f472b6"}

func (r *Repo) Create(ctx context.Context, in CreateInput) (*Rower, error) {
	if err := validateCreate(in); err != nil {
		return nil, err
	}
	if in.Color == "" {
		in.Color = palette[uint64(time.Now().UnixNano())%uint64(len(palette))]
	}
	id := uuid.NewString()
	now := time.Now().UTC()
	_, err := r.db.ExecContext(ctx,
		`INSERT INTO rowers(id, name, weight_kg, height_cm, dob, color, created_at)
		 VALUES(?, ?, ?, ?, ?, ?, ?)`,
		id, in.Name, in.WeightKg, in.HeightCm, in.DOB, in.Color, now.Format(time.RFC3339Nano),
	)
	if err != nil {
		return nil, err
	}
	return &Rower{
		ID: id, Name: in.Name, WeightKg: in.WeightKg, HeightCm: in.HeightCm, DOB: in.DOB,
		Color: in.Color, CreatedAt: now,
	}, nil
}

// Count returns the number of non-deleted rowers. Used by the
// first-run bootstrap gate on POST /api/v1/rowers.
func (r *Repo) Count(ctx context.Context) (int, error) {
	var n int
	err := r.db.QueryRowContext(ctx,
		`SELECT COUNT(1) FROM rowers WHERE deleted_at IS NULL`).Scan(&n)
	return n, err
}

func (r *Repo) List(ctx context.Context) ([]Rower, error) {
	rows, err := r.db.QueryContext(ctx,
		`SELECT id, name, weight_kg, height_cm, dob, color, created_at
		 FROM rowers WHERE deleted_at IS NULL ORDER BY created_at ASC`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []Rower
	for rows.Next() {
		r, err := scanRower(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, *r)
	}
	return out, rows.Err()
}

func (r *Repo) Get(ctx context.Context, id string) (*Rower, error) {
	row := r.db.QueryRowContext(ctx,
		`SELECT id, name, weight_kg, height_cm, dob, color, created_at
		 FROM rowers WHERE id=?`, id)
	out, err := scanRower(row)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil
	}
	return out, err
}

type scanner interface {
	Scan(dest ...any) error
}

func scanRower(s scanner) (*Rower, error) {
	var r Rower
	var weight, height sql.NullFloat64
	var dob sql.NullString
	var createdStr string
	if err := s.Scan(&r.ID, &r.Name, &weight, &height, &dob, &r.Color, &createdStr); err != nil {
		return nil, err
	}
	if weight.Valid {
		v := weight.Float64
		r.WeightKg = &v
	}
	if height.Valid {
		v := height.Float64
		r.HeightCm = &v
	}
	if dob.Valid {
		v := dob.String
		r.DOB = &v
	}
	t, err := time.Parse(time.RFC3339Nano, createdStr)
	if err != nil {
		return nil, err
	}
	r.CreatedAt = t
	return &r, nil
}

type UpdateInput struct {
	Name     *string  `json:"name,omitempty"`
	WeightKg *float64 `json:"weight_kg,omitempty"`
	HeightCm *float64 `json:"height_cm,omitempty"`
	DOB      *string  `json:"dob,omitempty"`
	Color    *string  `json:"color,omitempty"`
}

func (r *Repo) Update(ctx context.Context, id string, in UpdateInput) (*Rower, error) {
	if err := validateUpdate(in); err != nil {
		return nil, err
	}
	sets := []string{}
	args := []any{}
	if in.Name != nil {
		sets = append(sets, "name=?")
		args = append(args, *in.Name)
	}
	if in.WeightKg != nil {
		sets = append(sets, "weight_kg=?")
		args = append(args, *in.WeightKg)
	}
	if in.HeightCm != nil {
		sets = append(sets, "height_cm=?")
		args = append(args, *in.HeightCm)
	}
	if in.DOB != nil {
		sets = append(sets, "dob=?")
		args = append(args, *in.DOB)
	}
	if in.Color != nil {
		sets = append(sets, "color=?")
		args = append(args, *in.Color)
	}
	if len(sets) > 0 {
		args = append(args, id)
		q := "UPDATE rowers SET " + strings.Join(sets, ", ") + " WHERE id=?"
		if _, err := r.db.ExecContext(ctx, q, args...); err != nil {
			return nil, err
		}
	}
	return r.Get(ctx, id)
}

func (r *Repo) SetActiveForDevice(ctx context.Context, deviceID, rowerID string) error {
	now := time.Now().UTC().Format(time.RFC3339Nano)
	_, err := r.db.ExecContext(ctx,
		`INSERT INTO device_active_rower(device_id, rower_id, updated_at)
		 VALUES(?, ?, ?)
		 ON CONFLICT(device_id) DO UPDATE SET rower_id=excluded.rower_id, updated_at=excluded.updated_at`,
		deviceID, rowerID, now,
	)
	return err
}

func (r *Repo) GetActiveForDevice(ctx context.Context, deviceID string) (*Rower, error) {
	row := r.db.QueryRowContext(ctx,
		`SELECT r.id, r.name, r.weight_kg, r.height_cm, r.dob, r.color, r.created_at
		 FROM device_active_rower d JOIN rowers r ON r.id = d.rower_id
		 WHERE d.device_id = ?`, deviceID)
	out, err := scanRower(row)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil
	}
	return out, err
}

func (r *Repo) LastActive(ctx context.Context) (*Rower, error) {
	row := r.db.QueryRowContext(ctx,
		`SELECT r.id, r.name, r.weight_kg, r.height_cm, r.dob, r.color, r.created_at
		 FROM device_active_rower d JOIN rowers r ON r.id = d.rower_id
		 ORDER BY d.updated_at DESC LIMIT 1`)
	out, err := scanRower(row)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil
	}
	return out, err
}

type Holder struct {
	mu   sync.RWMutex
	id   string
	name string
}

func NewHolder() *Holder { return &Holder{} }

func (h *Holder) Set(id, name string) {
	h.mu.Lock()
	defer h.mu.Unlock()
	h.id = id
	h.name = name
}

func (h *Holder) Resolve() (string, string) {
	h.mu.RLock()
	defer h.mu.RUnlock()
	return h.id, h.name
}
