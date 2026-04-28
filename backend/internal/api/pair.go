package api

import (
	"database/sql"
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
