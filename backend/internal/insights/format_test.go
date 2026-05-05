package insights

import "testing"

func TestFormatDecimal(t *testing.T) {
	cases := []struct {
		v        float64
		decimals int
		want     string
	}{
		{3.6, 1, "3,6"},
		{0.10, 2, "0,10"},
		{6.84, 1, "6,8"},
		{2.0, 1, "2,0"},
	}
	for _, c := range cases {
		got := FormatDecimal(c.v, c.decimals)
		if got != c.want {
			t.Errorf("FormatDecimal(%v,%d) = %q, want %q", c.v, c.decimals, got, c.want)
		}
	}
}

func TestFormatSplit(t *testing.T) {
	cases := []struct {
		secPer500m float64
		want       string
	}{
		{119.6, "1:59,6"},
		{123.2, "2:03,2"},
		{60.0, "1:00,0"},
		{125.05, "2:05,1"},
	}
	for _, c := range cases {
		got := FormatSplit(c.secPer500m)
		if got != c.want {
			t.Errorf("FormatSplit(%v) = %q, want %q", c.secPer500m, got, c.want)
		}
	}
}
