// Package rower owns rower profile CRUD and the "active rower per
// device" mapping. A single process-wide Holder gives the sessionizer
// (which runs off the serial loop, not an HTTP request) a consistent
// notion of who to attribute the current session to.
package rower

import (
	"context"
	"database/sql"
	"errors"
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

var ErrNameRequired = errors.New("rower: name required")

type Repo struct{ db *sql.DB }

func NewRepo(db *sql.DB) *Repo { return &Repo{db: db} }

var palette = []string{"#ff6b6b", "#4ecdc4", "#ffe66d", "#a78bfa", "#f97316", "#60a5fa", "#34d399", "#f472b6"}

func (r *Repo) Create(ctx context.Context, in CreateInput) (*Rower, error) {
	if in.Name == "" {
		return nil, ErrNameRequired
	}
	if in.Color == "" {
		in.Color = palette[time.Now().UnixNano()%int64(len(palette))]
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
