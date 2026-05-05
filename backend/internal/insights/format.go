package insights

import (
	"fmt"
	"math"
	"strings"
)

// FormatDecimal renders a float with comma decimal separator and the
// given number of fractional digits. Used in all German messages.
func FormatDecimal(v float64, decimals int) string {
	s := fmt.Sprintf("%.*f", decimals, v)
	return strings.Replace(s, ".", ",", 1)
}

// FormatSplit renders seconds-per-500m as "m:ss,t" with comma
// decimal. Rounds to one decimal.
func FormatSplit(secPer500m float64) string {
	rounded := math.Round(secPer500m*10) / 10
	mins := int(rounded) / 60
	rem := rounded - float64(mins*60)
	wholeSec := int(rem)
	tenths := int(math.Round((rem-float64(wholeSec))*10)) % 10
	if tenths < 0 {
		tenths += 10
	}
	return fmt.Sprintf("%d:%02d,%d", mins, wholeSec, tenths)
}
