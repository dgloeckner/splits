package api

import (
	"strconv"
	"strings"

	"github.com/skip2/go-qrcode"
)

// renderQRSVG returns an inline SVG (UTF-8 string) encoding the given
// URL at medium error correction. Cell size is 8 px; resulting size is
// (matrix-side * 8) px square. Plenty for a phone camera at arm's length.
func renderQRSVG(url string) (string, error) {
	q, err := qrcode.New(url, qrcode.Medium)
	if err != nil {
		return "", err
	}
	bm := q.Bitmap()
	const cell = 8
	size := len(bm) * cell
	var sb strings.Builder
	sb.WriteString(`<svg xmlns="http://www.w3.org/2000/svg" width="`)
	sb.WriteString(strconv.Itoa(size))
	sb.WriteString(`" height="`)
	sb.WriteString(strconv.Itoa(size))
	sb.WriteString(`" viewBox="0 0 `)
	sb.WriteString(strconv.Itoa(size))
	sb.WriteString(` `)
	sb.WriteString(strconv.Itoa(size))
	sb.WriteString(`" shape-rendering="crispEdges">`)
	sb.WriteString(`<rect width="100%" height="100%" fill="#fff"/>`)
	for y, row := range bm {
		for x, on := range row {
			if !on {
				continue
			}
			sb.WriteString(`<rect x="`)
			sb.WriteString(strconv.Itoa(x * cell))
			sb.WriteString(`" y="`)
			sb.WriteString(strconv.Itoa(y * cell))
			sb.WriteString(`" width="`)
			sb.WriteString(strconv.Itoa(cell))
			sb.WriteString(`" height="`)
			sb.WriteString(strconv.Itoa(cell))
			sb.WriteString(`" fill="#000"/>`)
		}
	}
	sb.WriteString(`</svg>`)
	return sb.String(), nil
}
