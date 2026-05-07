package workout

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"sort"
)

// ShapeHash returns a stable identifier of a workout's geometry, used
// by FEAT-0010 to bucket workout-specific PBs across workouts created
// separately but with identical configuration. The canonical form
// includes mode, params (sorted-keys JSON), warmup_sec, cooldown_sec.
// Intensity is excluded — it is a UX tag, not part of the workout
// shape, so two workouts that differ only in intensity share a PB.
func ShapeHash(mode Mode, params json.RawMessage, warmupSec, cooldownSec int) (string, error) {
	if mode == ModeRace {
		mode = ModeDistance
	}
	canonParams, err := canonicalJSON(params)
	if err != nil {
		return "", err
	}
	canonical := struct {
		Mode        string          `json:"mode"`
		Params      json.RawMessage `json:"params"`
		WarmupSec   int             `json:"warmup_sec"`
		CooldownSec int             `json:"cooldown_sec"`
	}{string(mode), canonParams, warmupSec, cooldownSec}
	blob, err := json.Marshal(canonical)
	if err != nil {
		return "", err
	}
	sum := sha256.Sum256(blob)
	return hex.EncodeToString(sum[:]), nil
}

// canonicalJSON re-serialises a JSON object with sorted keys and no
// whitespace. Returns the raw input unchanged when it does not parse
// as an object (e.g. an empty `{}` or a number) — the SHA-256 over
// the raw bytes still gives a stable hash for that case.
func canonicalJSON(in json.RawMessage) (json.RawMessage, error) {
	if len(in) == 0 {
		return json.RawMessage("{}"), nil
	}
	var asMap map[string]json.RawMessage
	if err := json.Unmarshal(in, &asMap); err != nil {
		return in, nil
	}
	keys := make([]string, 0, len(asMap))
	for k := range asMap {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	buf := []byte{'{'}
	for i, k := range keys {
		if i > 0 {
			buf = append(buf, ',')
		}
		kb, err := json.Marshal(k)
		if err != nil {
			return nil, err
		}
		buf = append(buf, kb...)
		buf = append(buf, ':')
		v, err := canonicalJSON(asMap[k])
		if err != nil {
			return nil, err
		}
		buf = append(buf, v...)
	}
	buf = append(buf, '}')
	return buf, nil
}
