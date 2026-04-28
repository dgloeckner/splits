package main

import (
	"strings"
	"testing"
)

func emptyEnv(string) string { return "" }

func TestEnforceTLSPolicy_DevModeAllowsAnything(t *testing.T) {
	for _, addr := range []string{":8080", "0.0.0.0:8080", "1.2.3.4:8080", "127.0.0.1:8080"} {
		if err := enforceTLSPolicy(addr, true, emptyEnv); err != nil {
			t.Errorf("DevMode=true addr=%q: unexpected error %v", addr, err)
		}
	}
}

func TestEnforceTLSPolicy_LocalhostAllowed(t *testing.T) {
	for _, addr := range []string{"127.0.0.1:8080", "localhost:8080", "[::1]:8080"} {
		if err := enforceTLSPolicy(addr, false, emptyEnv); err != nil {
			t.Errorf("addr=%q: unexpected error %v", addr, err)
		}
	}
}

func TestEnforceTLSPolicy_BareColonRefused(t *testing.T) {
	err := enforceTLSPolicy(":8080", false, emptyEnv)
	if err == nil {
		t.Fatal("expected error for :8080 without dev/proxy, got nil")
	}
	if !strings.Contains(err.Error(), "refusing to start") {
		t.Errorf("error message missing 'refusing to start': %v", err)
	}
}

func TestEnforceTLSPolicy_AllInterfacesRefused(t *testing.T) {
	if err := enforceTLSPolicy("0.0.0.0:8080", false, emptyEnv); err == nil {
		t.Fatal("expected error for 0.0.0.0:8080, got nil")
	}
}

func TestEnforceTLSPolicy_ProxyEnvAllows(t *testing.T) {
	env := func(k string) string {
		if k == "SPLITS_TLS_TERMINATED_BY" {
			return "proxy"
		}
		return ""
	}
	if err := enforceTLSPolicy(":8080", false, env); err != nil {
		t.Errorf("unexpected error with proxy env: %v", err)
	}
}

func TestEnforceTLSPolicy_ProxyEnvCaseInsensitive(t *testing.T) {
	env := func(k string) string {
		if k == "SPLITS_TLS_TERMINATED_BY" {
			return "Proxy"
		}
		return ""
	}
	if err := enforceTLSPolicy(":8080", false, env); err != nil {
		t.Errorf("unexpected error with mixed-case proxy env: %v", err)
	}
}

func TestIsLocalhost(t *testing.T) {
	cases := map[string]bool{
		"127.0.0.1:8080": true,
		"localhost:8080": true,
		"LOCALHOST:8080": true,
		"[::1]:8080":     true,
		":8080":          false,
		"0.0.0.0:8080":   false,
		"1.2.3.4:8080":   false,
		"":               false,
	}
	for addr, want := range cases {
		if got := isLocalhost(addr); got != want {
			t.Errorf("isLocalhost(%q) = %v, want %v", addr, got, want)
		}
	}
}
