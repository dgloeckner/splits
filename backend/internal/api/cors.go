package api

import (
	"net/http"
	"strings"
)

// CORSGuard rejects cross-origin requests with 403. The PWA is served
// from the same origin as the API (Caddy reverse-proxy), so legitimate
// requests never carry a foreign Origin header. A reflected preflight
// or fetch from a malicious site is therefore an attack surface we
// can simply close: any Origin that doesn't match Host gets rejected
// before reaching the handler.
//
// Configuration: pass the canonical Host (without scheme), e.g.
// "splits.example.de". Empty allowedHost disables the guard, useful
// for local dev when SPLITS_PUBLIC_URL isn't set.
//
// SSE (`/api/v1/stream`) is exempt because EventSource doesn't send
// an Origin header on same-origin connections in some browsers, and
// our threat model already covers stream auth via the device cookie.
func CORSGuard(allowedHost string) Middleware {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if allowedHost == "" {
				next.ServeHTTP(w, r)
				return
			}
			origin := r.Header.Get("Origin")
			if origin == "" {
				next.ServeHTTP(w, r)
				return
			}
			if originHostMatches(origin, allowedHost) {
				next.ServeHTTP(w, r)
				return
			}
			http.Error(w, "cross-origin request rejected", http.StatusForbidden)
		})
	}
}

// originHostMatches returns true when the host portion of `origin`
// equals `allowed` (case-insensitive). Origins look like
// "https://splits.example.de"; we compare only the host part to avoid
// scheme mismatches when behind a TLS-terminating proxy.
func originHostMatches(origin, allowed string) bool {
	o := strings.ToLower(origin)
	o = strings.TrimPrefix(o, "https://")
	o = strings.TrimPrefix(o, "http://")
	if i := strings.IndexByte(o, '/'); i >= 0 {
		o = o[:i]
	}
	return o == strings.ToLower(allowed)
}

// allowedHostFromPublicURL extracts the host portion of a configured
// SPLITS_PUBLIC_URL (e.g. "https://splits.example.de" → "splits.example.de").
// Empty string when PublicURL is unset, which disables the CORS guard.
func allowedHostFromPublicURL(publicURL string) string {
	if publicURL == "" {
		return ""
	}
	s := strings.TrimPrefix(publicURL, "https://")
	s = strings.TrimPrefix(s, "http://")
	if i := strings.IndexByte(s, '/'); i >= 0 {
		s = s[:i]
	}
	return s
}
