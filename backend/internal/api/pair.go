package api

import (
	"database/sql"
	"encoding/json"
	"errors"
	"net/http"
	"time"

	"github.com/gloeckner-daniel/splits/internal/rower"
)

const pairingTokenTTL = 24 * time.Hour

// MintTokenHandler returns POST /api/v1/rowers/{id}/pairing-tokens.
// Requires the calling device to be paired with the target rower.
// Mints a single-use, 24h-expiring token; returns plaintext + URL + QR.
func MintTokenHandler(repo *rower.Repo, link *rower.DeviceLink, store *rower.PairingStore, baseURL string) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		id := r.PathValue("id")
		target, err := repo.Get(r.Context(), id)
		if errors.Is(err, sql.ErrNoRows) || (err == nil && target == nil) {
			http.NotFound(w, r)
			return
		}
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		devID := DeviceIDFromContext(r.Context())
		paired, err := link.IsPaired(r.Context(), devID, id)
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		if !paired {
			http.Error(w, "calling device not paired with this rower", http.StatusForbidden)
			return
		}
		plain, err := store.Mint(r.Context(), id, pairingTokenTTL)
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		base := resolveBaseURL(r, baseURL)
		url := base + "/pair#t=" + plain
		svg, err := renderQRSVG(url)
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{
			"token":      plain,
			"url":        url,
			"qr_svg":     svg,
			"expires_at": time.Now().Add(pairingTokenTTL).UTC().Format(time.RFC3339),
		})
	}
}

// PairExchangeHandler returns POST /api/v1/pair. Unauthenticated by
// design — the token IS the proof. On success: inserts (device_id,
// rower_id) into device_rowers, sets the active rower for the device,
// updates the Holder. Token row is deleted (single-use).
func PairExchangeHandler(repo *rower.Repo, holder *rower.Holder, link *rower.DeviceLink, store *rower.PairingStore) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var body struct {
			Token string `json:"token"`
		}
		dec := json.NewDecoder(r.Body)
		dec.DisallowUnknownFields()
		if err := dec.Decode(&body); err != nil || body.Token == "" {
			http.Error(w, "token required", http.StatusBadRequest)
			return
		}
		rowerID, err := store.Consume(r.Context(), body.Token)
		if errors.Is(err, rower.ErrInvalidToken) {
			http.Error(w, "token unknown, expired, or consumed", http.StatusGone)
			return
		}
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		target, err := repo.Get(r.Context(), rowerID)
		if err != nil || target == nil {
			http.Error(w, "rower vanished", http.StatusGone)
			return
		}
		devID := DeviceIDFromContext(r.Context())
		if err := link.Pair(r.Context(), devID, rowerID); err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		if err := repo.SetActiveForDevice(r.Context(), devID, rowerID); err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		holder.Set(target.ID, target.Name)
		w.WriteHeader(http.StatusOK)
	}
}

// resolveBaseURL prefers the configured PublicURL when set; otherwise
// derives "https://" + Host from the request. The fallback path is for
// dev where SPLITS_PUBLIC_URL is empty.
func resolveBaseURL(r *http.Request, fallback string) string {
	if fallback != "" {
		return fallback
	}
	host := r.Header.Get("X-Forwarded-Host")
	if host == "" {
		host = r.Host
	}
	return "https://" + host
}
