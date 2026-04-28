package api

import (
	"strings"
	"testing"
)

func TestRenderQRSVG_ContainsValidSVGTags(t *testing.T) {
	t.Parallel()
	svg, err := renderQRSVG("https://example.com/pair#t=foo")
	if err != nil {
		t.Fatal(err)
	}
	for _, want := range []string{`<svg`, `</svg>`, `viewBox=`, `<rect`} {
		if !strings.Contains(svg, want) {
			t.Errorf("missing %q in svg: %s", want, svg)
		}
	}
}
