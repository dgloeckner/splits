package workout

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"time"

	"github.com/google/uuid"
)

type Workout struct {
	ID          string          `json:"id"`
	Mode        Mode            `json:"mode"`
	ParamsJSON  json.RawMessage `json:"params"`
	Intensity   Intensity       `json:"intensity,omitempty"`
	WarmupSec   int             `json:"warmup_sec"`
	CooldownSec int             `json:"cooldown_sec"`
	CreatedAt   time.Time       `json:"created_at"`
}

type CreateWorkoutInput struct {
	Mode        Mode            `json:"mode"`
	ParamsJSON  json.RawMessage `json:"params"`
	Intensity   Intensity       `json:"intensity,omitempty"`
	WarmupSec   int             `json:"warmup_sec,omitempty"`
	CooldownSec int             `json:"cooldown_sec,omitempty"`
}

type Repo struct{ db *sql.DB }

func NewRepo(db *sql.DB) *Repo { return &Repo{db: db} }

func (r *Repo) CreateWorkout(ctx context.Context, in CreateWorkoutInput) (*Workout, error) {
	if _, err := DecodeParams(in.Mode, in.ParamsJSON); err != nil {
		return nil, err
	}
	if !in.Intensity.Valid() {
		return nil, ErrInvalidParams
	}
	if in.WarmupSec < 0 || in.CooldownSec < 0 {
		return nil, ErrInvalidParams
	}
	id := uuid.NewString()
	now := time.Now().UTC()
	_, err := r.db.ExecContext(ctx,
		`INSERT INTO workout(id, mode, params_json, intensity, warmup_sec, cooldown_sec, created_at)
         VALUES(?, ?, ?, ?, ?, ?, ?)`,
		id, string(in.Mode), string(in.ParamsJSON),
		nullString(string(in.Intensity)), in.WarmupSec, in.CooldownSec,
		now.Format(time.RFC3339Nano),
	)
	if err != nil {
		return nil, err
	}
	return &Workout{
		ID:          id,
		Mode:        in.Mode,
		ParamsJSON:  in.ParamsJSON,
		Intensity:   in.Intensity,
		WarmupSec:   in.WarmupSec,
		CooldownSec: in.CooldownSec,
		CreatedAt:   now,
	}, nil
}

func (r *Repo) GetWorkout(ctx context.Context, id string) (*Workout, error) {
	row := r.db.QueryRowContext(ctx,
		`SELECT id, mode, params_json, intensity, warmup_sec, cooldown_sec, created_at
         FROM workout WHERE id=?`, id)
	w, err := scanWorkout(row)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil
	}
	return w, err
}

type scanner interface{ Scan(...any) error }

func scanWorkout(s scanner) (*Workout, error) {
	var w Workout
	var paramsStr, createdStr string
	var intensity sql.NullString
	if err := s.Scan(&w.ID, &w.Mode, &paramsStr, &intensity, &w.WarmupSec, &w.CooldownSec, &createdStr); err != nil {
		return nil, err
	}
	w.ParamsJSON = json.RawMessage(paramsStr)
	if intensity.Valid {
		w.Intensity = Intensity(intensity.String)
	}
	t, err := time.Parse(time.RFC3339Nano, createdStr)
	if err != nil {
		return nil, err
	}
	w.CreatedAt = t
	return &w, nil
}

func nullString(s string) any {
	if s == "" {
		return nil
	}
	return s
}

type Favorite struct {
	ID          string          `json:"id"`
	RowerID     string          `json:"rower_id"`
	Name        string          `json:"name"`
	Mode        Mode            `json:"mode"`
	ParamsJSON  json.RawMessage `json:"params"`
	Intensity   Intensity       `json:"intensity,omitempty"`
	WarmupSec   int             `json:"warmup_sec"`
	CooldownSec int             `json:"cooldown_sec"`
	CreatedAt   time.Time       `json:"created_at"`
}

type CreateFavoriteInput struct {
	RowerID     string          `json:"rower_id"`
	Name        string          `json:"name"`
	Mode        Mode            `json:"mode"`
	ParamsJSON  json.RawMessage `json:"params"`
	Intensity   Intensity       `json:"intensity,omitempty"`
	WarmupSec   int             `json:"warmup_sec,omitempty"`
	CooldownSec int             `json:"cooldown_sec,omitempty"`
}

var ErrNameRequired = errors.New("workout: favorite name required")

func (r *Repo) CreateFavorite(ctx context.Context, in CreateFavoriteInput) (*Favorite, error) {
	if in.Name == "" {
		return nil, ErrNameRequired
	}
	if in.RowerID == "" {
		return nil, ErrInvalidParams
	}
	if _, err := DecodeParams(in.Mode, in.ParamsJSON); err != nil {
		return nil, err
	}
	if !in.Intensity.Valid() {
		return nil, ErrInvalidParams
	}
	if in.WarmupSec < 0 || in.CooldownSec < 0 {
		return nil, ErrInvalidParams
	}
	id := uuid.NewString()
	now := time.Now().UTC()
	_, err := r.db.ExecContext(ctx,
		`INSERT INTO workout_favorite(id, rower_id, name, mode, params_json, intensity, warmup_sec, cooldown_sec, created_at)
         VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		id, in.RowerID, in.Name, string(in.Mode), string(in.ParamsJSON),
		nullString(string(in.Intensity)), in.WarmupSec, in.CooldownSec,
		now.Format(time.RFC3339Nano),
	)
	if err != nil {
		return nil, err
	}
	return &Favorite{
		ID: id, RowerID: in.RowerID, Name: in.Name, Mode: in.Mode,
		ParamsJSON: in.ParamsJSON, Intensity: in.Intensity,
		WarmupSec: in.WarmupSec, CooldownSec: in.CooldownSec, CreatedAt: now,
	}, nil
}

func (r *Repo) ListFavorites(ctx context.Context, rowerID string) ([]Favorite, error) {
	rows, err := r.db.QueryContext(ctx,
		`SELECT id, rower_id, name, mode, params_json, intensity, warmup_sec, cooldown_sec, created_at
         FROM workout_favorite WHERE rower_id=? ORDER BY created_at DESC`, rowerID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []Favorite{}
	for rows.Next() {
		f, err := scanFavorite(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, *f)
	}
	return out, rows.Err()
}

func (r *Repo) DeleteFavorite(ctx context.Context, id string) error {
	_, err := r.db.ExecContext(ctx, `DELETE FROM workout_favorite WHERE id=?`, id)
	return err
}

func scanFavorite(s scanner) (*Favorite, error) {
	var f Favorite
	var paramsStr, createdStr string
	var intensity sql.NullString
	if err := s.Scan(&f.ID, &f.RowerID, &f.Name, &f.Mode, &paramsStr, &intensity, &f.WarmupSec, &f.CooldownSec, &createdStr); err != nil {
		return nil, err
	}
	f.ParamsJSON = json.RawMessage(paramsStr)
	if intensity.Valid {
		f.Intensity = Intensity(intensity.String)
	}
	t, err := time.Parse(time.RFC3339Nano, createdStr)
	if err != nil {
		return nil, err
	}
	f.CreatedAt = t
	return &f, nil
}
