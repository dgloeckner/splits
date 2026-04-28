package api

import (
	"database/sql"
	"net/http"
	"strconv"

	"github.com/gloeckner-daniel/splits/internal/rower"
	"github.com/gloeckner-daniel/splits/internal/stats"
)

// StatsVersionHeader resolves the active rower for each request and
// stamps the response with the current X-Stats-Version. The frontend
// polls this header to detect when an asynchronous recompute has
// completed (FEAT-0010 post-session-end UX).
//
// Header is omitted when no rower is resolvable or the lookup fails —
// it is a hint, not a contract.
func StatsVersionHeader(db *sql.DB, holder *rower.Holder) Middleware {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if id, _ := holder.Resolve(); id != "" {
				if v, err := stats.StatsVersion(r.Context(), db, id); err == nil && v > 0 {
					w.Header().Set("X-Stats-Version", strconv.Itoa(v))
				}
			}
			next.ServeHTTP(w, r)
		})
	}
}
