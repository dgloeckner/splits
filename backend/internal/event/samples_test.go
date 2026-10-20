package event

import (
	"encoding/json"
	"testing"
)

// Summaries written before #44 hold integer SPM bucket means; they
// must keep parsing next to the decimal ones.
func TestSessionSamplesSPMParsesIntegersAndDecimals(t *testing.T) {
	var s SessionSamples
	if err := json.Unmarshal([]byte(`{"bucket_strokes":5,"t_sec":[10,20],"split":[110,108],"watt":[300,310],"spm":[27,28.6],"dps":[9.5,9.6]}`), &s); err != nil {
		t.Fatal(err)
	}
	if s.SPM[0] != 27 || s.SPM[1] != 28.6 {
		t.Errorf("spm = %v, want [27 28.6]", s.SPM)
	}
	out, err := json.Marshal(s)
	if err != nil {
		t.Fatal(err)
	}
	var round map[string]json.RawMessage
	if err := json.Unmarshal(out, &round); err != nil {
		t.Fatal(err)
	}
	if got := string(round["spm"]); got != "[27,28.6]" {
		t.Errorf("marshalled spm = %s, want [27,28.6]", got)
	}
}
