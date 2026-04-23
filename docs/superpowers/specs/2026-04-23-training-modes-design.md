# Training Modes v1 — Design

- **Date**: 2026-04-23
- **Related spec**: [FEAT-0005a Workout-Auswahl](../../../specs/feat/0005a-workout-selection.md) (this design narrows + overrides scope)
- **Status**: Approved for planning

## Summary

First iteration of pre-session workout selection. Four modes — **Just Row**, **Distanz**, **Zeit**, **Intervalle**. Pyramide is explicitly deferred. Intensity is captured as a target *range* for split + SPM (no enforcement, no audio alerts). Warm-up / Cool-down are optional toggles on the confirm screen for every mode except Just Row. Workouts and user-named favorites live in separate tables to keep cleanup cheap.

## Scope changes vs FEAT-0005a

- **Out**: Pyramide mode (Step 1 entry, Step 2 presets, Step 4 custom configurator)
- **Out**: Per-user default splits sourced from FEAT-0004 PBs — static table only, marked TODO for FEAT-0004
- **Out**: Audio/haptic enforcement tied to intensity (haptic still fires on segment transitions, that is orthogonal)
- **Changed**: Intensity is now a *range* (split lo/hi + SPM lo/hi), not a point value
- **Changed**: Workouts and favorites are separate tables (simpler cleanup)

## Flow (3–4 steps)

### Step 1 — Mode
Chips / cards on the entry screen (from Live View's "Workout starten"):

- **Nur rudern** → start Just-Row immediately, no further steps
- **Letztes Workout** (shown only if the active rower has a prior `workout` row) → start immediately
- **Favoriten** (shown only if the active rower has `workout_favorite` rows) → sub-list, tap a favorite to start
- **Distanz**
- **Zeit**
- **Intervalle**

### Step 2 — Dimension (branch)

Preset chips plus "Eigene" which reveals a stepper.

- **Distanz**: `500 m / 1 km / 2 km / 5 km / 6 km / 10 km / HM / Marathon / Eigene`
- **Zeit**: `10 / 20 / 30 / 45 / 60 min / Eigene`
- **Intervalle**: `8×500 m / 5×1000 m / 4×2000 m / 6×1 min / 4×4 min / Eigene`

"Eigene" for Distanz / Zeit = single stepper. "Eigene" for Intervalle expands to three controls:

- Anzahl Wiederholungen (Runden) — stepper, min 1
- Intervall-Länge — Toggle `Meter` | `Minuten`, stepper (min 1)
- Pause zwischen Intervallen — stepper in min (min 0)

Stitch screen `Workout-Auswahl: Intervalle Konfiguration (3/4)` is authoritative for layout.

### Step 3 — Intensität
Four cards: `Locker · Moderat · Hart · All-out`. Selection maps to a target range for split + SPM (see table below). No collapsible override in v1.

### Confirm Screen
Shown for every non-Just-Row mode:

- Titel z.B. `5 km · Moderat`
- Warm-up toggle, default on, stepper 0–15 min (default 5 min)
- Cool-down toggle, default on, stepper 0–15 min (default 5 min)
- "Als Favorit speichern" toggle → if on, require a name
- Timeline strip: warmup (dashed) → work segments → cooldown (dashed)
- Geschätzte Gesamtdauer berechnet aus Mitte(Ziel-Split) · Distanz + Pausen + WU + CD
- Buttons: **Start** (primary), **Anpassen** (zurück Step 3), **Zurück** (Step 2)

## Intensity ranges (static v1)

> TODO: replace with per-user defaults derived from FEAT-0004 PBs once that feature lands.

| Stufe    | Ziel-Split            | Ziel-SPM |
|----------|-----------------------|----------|
| Locker   | 2:20 – 2:40 / 500 m   | 18 – 22  |
| Moderat  | 2:05 – 2:20 / 500 m   | 22 – 26  |
| Hart     | 1:50 – 2:05 / 500 m   | 26 – 30  |
| All-out  | < 1:50 / 500 m        | 30+      |

Intensität gilt nur für Work-Segmente. Warm-up / Cool-down / Pause → kein Range (grau).

## Rest semantics (Intervalle)

Fixe Zeit. Kein SPM- oder Distanz-Target während Pause. Live-View zeigt Countdown, Haptik beim Übergang. User kann während Pause rudern oder stehen — wird nicht bewertet.

## Live-View bei aktivem Workout

- Workout-Progress-Strip direkt unter Status-Bar — Segmente als colored blocks, 2 px Position-Marker
- Über Hero: `Intervall 3 / 8 · 500 m` + Segment-Time-Remaining (accent bei < 10 s)
- Ziel-Range-Indikator pro relevantem Tile (Split, SPM): **grüner Dot** in Range, **gelb** außerhalb. Keine Audio-Alerts, kein Blink.
- Segment-Übergänge lösen Haptik aus (Web Vibration API, wenn verfügbar). Audio-Cue per Setting (später).
- "Workout abbrechen" → fällt zurück auf Just-Row, Session läuft weiter (keine Daten verloren, `workout_id` bleibt gesetzt).

## Data model

Two tables. `workout` is transient (one row per session that used a workout). `workout_favorite` is the persistent user library.

```sql
CREATE TABLE workout (
  id            TEXT PRIMARY KEY,       -- ULID
  mode          TEXT NOT NULL,          -- 'just_row'|'distance'|'time'|'intervals'
  params_json   TEXT NOT NULL,          -- mode-specific, see below
  intensity     TEXT,                   -- 'locker'|'moderat'|'hart'|'allout'|NULL
  warmup_sec    INTEGER NOT NULL DEFAULT 0,
  cooldown_sec  INTEGER NOT NULL DEFAULT 0,
  created_at    DATETIME NOT NULL
);

CREATE TABLE workout_favorite (
  id            TEXT PRIMARY KEY,       -- ULID
  rower_id      TEXT NOT NULL REFERENCES rowers(id),
  name          TEXT NOT NULL,
  mode          TEXT NOT NULL,
  params_json   TEXT NOT NULL,
  intensity     TEXT,
  warmup_sec    INTEGER NOT NULL DEFAULT 0,
  cooldown_sec  INTEGER NOT NULL DEFAULT 0,
  created_at    DATETIME NOT NULL
);

ALTER TABLE sessions ADD COLUMN workout_id TEXT REFERENCES workout(id);
```

### params_json per mode

- `just_row`: `{}`
- `distance`: `{ "meters": 5000 }`
- `time`: `{ "seconds": 1800 }`
- `intervals`:
  ```json
  {
    "reps": 6,
    "length": { "unit": "m", "value": 500 },
    "rest_sec": 120
  }
  ```
  `length.unit` ∈ `"m" | "min"`. When `"min"`, `value` is minutes.

### Lifecycle

| Action | Effect |
|---|---|
| Start workout (any non-Just-Row mode) | insert `workout` row, set `session.workout_id` on session start |
| Start Just Row | no `workout` row, `session.workout_id = NULL` |
| "Letztes Workout" | look up most recent `workout` joined via active rower's sessions, create new `workout` row with identical params for this session |
| "Als Favorit speichern" (on confirm screen) | insert `workout_favorite` row with user-provided name |
| Start from favorite | copy favorite params into a fresh `workout` row |
| Abort workout mid-session | session continues as Just-Row, `workout_id` stays — the workout row exists but segment progression stops server-side |
| Cleanup | on startup or daily cron: `DELETE FROM workout WHERE id NOT IN (SELECT workout_id FROM sessions WHERE workout_id IS NOT NULL)` — i.e. orphan rows only. Cap is implicit via sessions retention. Favorites never deleted automatically. |

## Segment derivation (backend)

On session start, the backend expands `workout` into an ordered segment list:

```go
type Segment struct {
    Kind         string  // "warmup" | "work" | "rest" | "cooldown"
    DurationSec  int     // zero if distance-bounded
    DistanceM    int     // zero if time-bounded
    TargetSplit  *Range  // nil for warmup/rest/cooldown
    TargetSPM    *Range  // nil for warmup/rest/cooldown
}
```

Examples:

- `distance{5000m}, moderat, wu=5min, cd=5min` → `[warmup 5min] [work 5000m split 2:05-2:20 spm 22-26] [cooldown 5min]`
- `time{30min}, hart` → `[work 30min split 1:50-2:05 spm 26-30]` (no WU/CD if toggles off)
- `intervals{6×500m, rest 120s, locker}` → `[work 500m] [rest 120s] [work 500m] [rest 120s] ... ×6` — last rest elided

Backend broadcasts the current segment index and per-tick remaining (sec or meters) via SSE. Frontend overlays range status on live tiles.

## Presets

Hardcoded in frontend, not in DB. Changing a preset list = frontend edit. Custom favorites live in `workout_favorite`.

## Acceptance criteria

- [ ] "Nur rudern" startet in ≤ 2 Taps ab Live-View (Button → Karte).
- [ ] Preset-Workout (Typ → Preset → Intensität → Start) startet in ≤ 4 Taps.
- [ ] "Eigene" bei Intervalle zeigt Anzahl-, Länge- (Meter/Minuten-Toggle) und Pause-Stepper.
- [ ] Custom-Parameter validiert: `reps > 0`, `length.value > 0`, `rest_sec ≥ 0`, `meters > 0`, `seconds > 0`.
- [ ] Confirm-Screen zeigt WU/CD-Toggles nur für Nicht-Just-Row.
- [ ] WU/CD-Dauer editierbar in Schritten von 1 min, Range 0–15.
- [ ] "Als Favorit speichern" verlangt Namen und persistiert in `workout_favorite`.
- [ ] Favoriten tauchen in Step 1 als Sub-Liste auf, tap startet ohne Confirm (nutzt gespeicherte Intensität + WU/CD).
- [ ] "Letztes Workout" ist sichtbar wenn der aktive Rower eine vergangene `workout`-Session hat.
- [ ] Live-View bei aktivem Workout zeigt Progress-Strip, Segment-Label, Segment-Time/Distance-Remaining — synchron zur SSE-Uhr.
- [ ] Ziel-Range-Indikator auf Split- und SPM-Tiles: grün in Range, gelb außerhalb. Kein Audio, kein Blink.
- [ ] Haptik bei Segment-Übergängen, Audio-Cue hinter Setting-Flag (default off).
- [ ] "Workout abbrechen" → Segment-Progression stoppt, Session läuft als Just-Row weiter, keine DB-Änderungen an der Session.
- [ ] Backend-Cleanup entfernt `workout` rows ohne zugehörige Session.

## Non-goals (v1)

- Pyramide mode (deferred)
- Per-user PB-derived intensity defaults (needs FEAT-0004)
- Audio cues beyond optional segment-transition beep
- Workout library browsing, sharing, plan templates
- Workout editing after creation (user re-creates instead)

## Open questions

- Favorit-Start: confirm screen überspringen oder trotzdem zeigen? **Vorschlag**: überspringen, Edit führt zurück in Flow.
- Should "Letztes Workout" only appear if the last session was *completed* (>= some min distance/time), to avoid repeating aborted attempts? **Vorschlag**: no gating in v1, keep simple.
- Favorit-Limit pro User? **Vorschlag**: no hard cap v1, UI sortiert by `created_at DESC`.
