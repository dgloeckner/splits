package api

import (
	"net/http"

	"github.com/gloeckner-daniel/splits/internal/rower"
)

// RequireRower returns a middleware that rejects requests from
// devices that are not paired with at least one rower. Devices are
// identified by the device_id cookie set by the DeviceCookie
// middleware (which must run before this one).
//
// Bypass routes (health, pair exchange, get-active-rower for the
// onboarding probe, and POST /rowers under the bootstrap rule) are
// not wrapped by this middleware — they handle authentication on
// their own terms.
func RequireRower(link *rower.DeviceLink) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			devID := DeviceIDFromContext(r.Context())
			if devID == "" {
				http.Error(w, "device cookie missing", http.StatusUnauthorized)
				return
			}
			ok, err := link.HasAnyPairing(r.Context(), devID)
			if err != nil {
				http.Error(w, err.Error(), http.StatusInternalServerError)
				return
			}
			if !ok {
				http.Error(w, "device not paired with any rower", http.StatusUnauthorized)
				return
			}
			next.ServeHTTP(w, r)
		})
	}
}
