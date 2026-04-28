package api

import (
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestDeviceCookie_SetsWhenAbsent(t *testing.T) {
	var seen string
	h := DeviceCookie(DeviceCookieOptions{})(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		seen = DeviceIDFromContext(r.Context())
	}))
	req := httptest.NewRequest("GET", "/api/v1/rowers", nil)
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	if seen == "" {
		t.Fatalf("handler saw empty device id")
	}
	res := rec.Result()
	cookies := res.Cookies()
	if len(cookies) != 1 || cookies[0].Name != "device_id" || cookies[0].Value == "" {
		t.Fatalf("cookie not set: %+v", cookies)
	}
	if !cookies[0].HttpOnly {
		t.Fatalf("cookie must be HttpOnly")
	}
}

func TestDeviceCookie_ReusesExisting(t *testing.T) {
	var seen string
	h := DeviceCookie(DeviceCookieOptions{})(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		seen = DeviceIDFromContext(r.Context())
	}))
	req := httptest.NewRequest("GET", "/api/v1/rowers", nil)
	req.AddCookie(&http.Cookie{Name: "device_id", Value: "pre-existing"})
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	if seen != "pre-existing" {
		t.Fatalf("expected pre-existing, got %q", seen)
	}
	if len(rec.Result().Cookies()) != 0 {
		t.Fatalf("should not re-set cookie")
	}
}

func TestDeviceCookie_SecureWhenOptSet(t *testing.T) {
	mw := DeviceCookie(DeviceCookieOptions{Secure: true})
	h := mw(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {}))
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/", nil))
	res := rec.Result()
	defer res.Body.Close()
	found := false
	for _, c := range res.Cookies() {
		if c.Name == "device_id" {
			found = true
			if !c.Secure {
				t.Fatal("want Secure=true")
			}
			if !c.HttpOnly {
				t.Fatal("want HttpOnly=true")
			}
		}
	}
	if !found {
		t.Fatal("device_id cookie not set")
	}
}

func TestDeviceCookie_NoSecureWhenOptUnset(t *testing.T) {
	mw := DeviceCookie(DeviceCookieOptions{Secure: false})
	h := mw(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {}))
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/", nil))
	res := rec.Result()
	defer res.Body.Close()
	found := false
	for _, c := range res.Cookies() {
		if c.Name == "device_id" {
			found = true
			if c.Secure {
				t.Fatal("want Secure=false")
			}
		}
	}
	if !found {
		t.Fatal("device_id cookie not set")
	}
}
