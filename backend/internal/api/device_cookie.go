package api

import (
	"context"
	"net/http"
	"time"

	"github.com/google/uuid"
)

type ctxKey struct{ name string }

var deviceIDKey = ctxKey{"device_id"}

const deviceCookieName = "device_id"
const deviceCookieMaxAge = 10 * 365 * 24 * 60 * 60 // ~10 years

// DeviceCookieOptions configures the DeviceCookie middleware.
type DeviceCookieOptions struct {
	// Secure controls the Secure flag on the issued cookie. Set true
	// in production (HTTPS) and false in dev (plain HTTP loopback).
	Secure bool
}

// DeviceCookie returns middleware that ensures every request carries a
// stable "device_id" cookie. On first contact the middleware generates
// a UUIDv4, sets an HttpOnly cookie, and stuffs the id into the request
// context for downstream handlers.
func DeviceCookie(opts DeviceCookieOptions) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			id := ""
			if c, err := r.Cookie(deviceCookieName); err == nil && c.Value != "" {
				id = c.Value
			} else {
				id = uuid.NewString()
				http.SetCookie(w, &http.Cookie{
					Name:     deviceCookieName,
					Value:    id,
					Path:     "/",
					HttpOnly: true,
					Secure:   opts.Secure,
					SameSite: http.SameSiteLaxMode,
					MaxAge:   deviceCookieMaxAge,
					Expires:  time.Now().Add(time.Duration(deviceCookieMaxAge) * time.Second),
				})
			}
			next.ServeHTTP(w, r.WithContext(context.WithValue(r.Context(), deviceIDKey, id)))
		})
	}
}

func DeviceIDFromContext(ctx context.Context) string {
	v, _ := ctx.Value(deviceIDKey).(string)
	return v
}
