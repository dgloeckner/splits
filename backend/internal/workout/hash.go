package workout

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"sort"
)

// ShapeHash returns a stable identifier of a workout's comparability
// shape, derived solely from params_json (canonicalised by sorted keys
// and stripped whitespace). Used by both the PB pipeline (pb_workout)
// and Trends to bucket comparable sessions.
//
// What's deliberately excluded:
//   - Mode: race {meters:N} and distance {meters:N} share a hash. The
//     "fastest 2 k effort" is one PB and one trend series, regardless
//     of session type.
//   - Warmup / cooldown durations: not part of the piece itself.
//   - Intensity: a UX tag, not a shape attribute.
//
// See ADR-0015 (2026-05-25 amendment) for the rationale.
func ShapeHash(params json.RawMessage) (string, error) {
	canon, err := canonicalJSON(params)
	if err != nil {
		return "", err
	}
	sum := sha256.Sum256(canon)
	return hex.EncodeToString(sum[:]), nil
}

// canonicalJSON re-serialises a JSON object with sorted keys and no
// whitespace. Nil/empty input is normalised to `{}`. Non-object values
// (numbers, strings, booleans, arrays) are returned as-is so they
// contribute their actual content to the hash.
func canonicalJSON(in json.RawMessage) (json.RawMessage, error) {
	if len(in) == 0 {
		return json.RawMessage("{}"), nil
	}
	var asMap map[string]json.RawMessage
	if err := json.Unmarshal(in, &asMap); err != nil {
		// Not an object — return verbatim (number, string, bool, array).
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
