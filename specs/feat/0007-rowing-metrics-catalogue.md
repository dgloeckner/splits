# FEAT-0007: Rowing Metrics Catalogue

- **Status**: Shipped
- **Depends on**: INT-0001 (IPM live-data stream)
- **Referenced by**: FEAT-0001 (live view), FEAT-0003 (session history),
  FEAT-0004 (user statistics), FEAT-0005 (training goals)

## Summary

Defines the full set of rowing-relevant metrics the system tracks or
derives: which come directly from the IPM live-data stream, which are
computed per stroke / per session / per user, and how each one is named,
unitised, and displayed. This is the **single source of truth** for metric
vocabulary so the live view, history view, stats page, and export
formats all agree.

## Metric taxonomy

Metrics fall into three tiers:

1. **Raw** — read directly from the IPM `A8` stream (or a derived field
   the console itself emits).
2. **Derived per sample** — computed from one `A8` message with session
   context (e.g. pace from Δdistance / Δtime between consecutive samples).
3. **Aggregated** — computed over a stroke, session, or longer window
   (averages, totals, PBs).

### Tier 1 — Raw from IPM stream

One A8 message arrives **per stroke** (verified 2026-04-19 across 120+
samples: Δt ≈ 60/SPM with mean ratio 0.99). So each message doubles as
a stroke event.

| Metric              | Unit    | Source        | Notes |
|---------------------|---------|---------------|-------|
| Stroke event        | event   | A8 message arrival | Count of active A8 messages = exact total strokes. |
| Elapsed time        | seconds | A8 `[0:6]`    | Resolution 0.1 s. Session-local clock; resets when the console restarts a session. |
| Cumulative distance | metres  | A8 `[6:10]`   | 4-digit int, 0–9999 m observed. Behaviour above 9999 untested. |
| Stroke rate (SPM)   | strokes/min | A8 `[16:18]` | Instantaneous (console's own smoothing); not session average. |
| Power               | W       | A8 `[18:21]`  | Integer, updated per stroke. Observed peak 635 W. |
| Calories per hour   | kcal/h  | A8 `[21:24]`×10 | Derived by the IPM from power + resistance level (manual). |
| Resistance level    | 1–16    | A8 `[25:27]`  | Matches `L<n>` command response. |
| Lifetime distance   | metres  | `O<d>,<t>` response | Queried once per session for audit / context. |
| Lifetime time       | minutes | `O<d>,<t>` response | Same. |
| Heart rate          | bpm     | currently not measured | We do not read HR today. Experiment pending (see INT-0001 `heartrate-belt.txt` fixture): the IPM may expose HR via a polled `H<bpm>` response, as unsolicited lines in the A8 stream, in a currently-unknown A8 field, or not over serial at all — in which case HR would come from the belt directly (ANT+ / BLE). Leave as a gap until the capture decides. |

### Tier 2 — Derived per stroke

Because each A8 message is a stroke event, consecutive-message deltas
give per-stroke values directly (no smoothing required for correctness).

| Metric | Formula | Unit | Notes |
|--------|---------|------|-------|
| Distance per stroke (DPS) | `distance_m - prev_distance_m` | metres / stroke | **Exact.** How much distance each stroke pulled. Key efficiency metric. Typical 6–12 m on an ergo; elite 2k approaches 11–12 m. Smooth over 3–5 strokes for display to damp visual jitter, but per-stroke value is the truth. |
| Stroke cycle time | `time_sec - prev_time_sec` | seconds | **Exact.** Full drive + recovery. Equals 60/SPM when SPM is stable. |
| Energy per stroke | `power_W × stroke_cycle_time` | J | **Exact.** Mechanical work done per stroke. |
| Stroke count (cumulative) | `1-indexed message number` | strokes | **Exact**, no estimator needed. |
| Pace (per stroke) | `500 × stroke_cycle_time / DPS` | seconds / 500 m | **Exact.** Classic rowing split, computed from per-stroke deltas. Smooth over 3–5 strokes for display. |
| Speed (per stroke) | `DPS / stroke_cycle_time` | m/s | Alternative display for non-rowers. |
| Session cal total | `Σ cal_per_hr_i × stroke_cycle_time_i / 3600` | kcal | Trust the IPM's cal/hr (it already factors in resistance). |

### Tier 3 — Aggregated per session

**Session totals**
| Metric | Definition |
|--------|------------|
| Total distance | Last sample's `distance_m`. |
| Total time | Last sample's `time_sec`. |
| Total strokes | Count of active A8 messages (SPM > 0). Exact. |
| Session calories | Σ `cal_per_hr × stroke_cycle_time / 3600` (Tier 2 roll-up). |
| Session energy (mechanical) | Σ `power × stroke_cycle_time` in kJ. |
| Resistance profile | Sequence of (time, level) pairs when level changes. |

**Averages and peaks**
| Metric | Definition |
|--------|------------|
| Avg power | Mean `power_W` over active strokes. |
| Avg SPM | Mean `spm` over active strokes (and independently: `total_strokes × 60 / total_moving_time` as a cross-check). |
| Avg pace (overall) | `(total_time / total_distance) × 500`. |
| Avg pace (moving) | Same but excluding idle gaps between strokes longer than a threshold. |
| Avg DPS | `total_distance / total_strokes`. Exact. |
| Peak power | Max single-stroke `power_W`. |
| Peak SPM | Max instantaneous `spm`. |
| Peak DPS | Max single-stroke `Δdistance`. |
| Longest drive | Max single-stroke cycle time (for detecting missed strokes). |

**Derived / cycling-imported**
| Metric | Definition |
|--------|------------|
| Normalized power | `(Σ power^4 · Δt / total_time)^(1/4)`. Smooths surges; cycling-standard, translates well to rowing. |
| Power per kg | `avg_power / user_weight_kg`. Cross-user comparable (requires user profile from FEAT-0002). |
| Negative split | Second-half avg pace minus first-half avg pace. Negative value = accelerating. |
| Time in power zones | Minutes in Z1 / Z2 / Z3 / Z4 / Z5 (thresholds either user-set or derived from best-2k). |
| Time in SPM zones | Minutes at low (<20), steady (20–26), race (26–32), sprint (>32). |
| Best rolling segment | Fastest 500 m / 1000 m / 2000 m **within** the session. Input to FEAT-0004 PB tracking. |
| Work/rest intervals | Auto-detected bursts (sustained high power) vs rests (SPM = 0 or stroke gap > threshold). Enables interval-session analysis. |
| Sample cadence | Median `Δt` between A8 messages — equals 60/SPM when IPM is healthy; flags dropped strokes when the ratio deviates. |

### Tier 3b — Stroke-level analytics (newly unlocked by per-stroke events)

Because each A8 message IS a stroke event, we can treat the session as
a time series of **N strokes** and apply per-stroke statistics. These
are not derivable from time-based samples, so they were previously
out of reach.

**Consistency / technique**
| Metric | Definition | Why it matters |
|--------|------------|----------------|
| DPS coefficient of variation | `σ(DPS) / mean(DPS)` | Technique stability — smooth strokes cluster tight, ragged ones scatter. |
| Cycle-time CV | `σ(stroke_cycle_time) / mean(...)` | Rhythm stability — a metronomic rower scores low. |
| Stroke-power CV | `σ(stroke_power) / mean(stroke_power)` | Force application consistency. |
| DPS/SPM efficiency index | `mean(DPS × SPM)` in m/min, or equivalently mean instantaneous speed | Alternative framing of "how much boat speed you're making". |
| **Stroke Power Index (SPI)** | `power_W / SPM` per stroke | Watt per (stroke/min); displayed unitless. Live: 5-stroke moving average. Session: **median** over all strokes (robust against warm-up / cool-down). Measures force-per-stroke independent of cadence: rising SPI at constant SPM = real strength; constant SPI at rising SPM = volume without force loss; falling SPI at rising SPM = technique collapse under load. Rough bands: beginner 4–6, advanced 7–9, competitive 10–12+. **Edge cases**: `spm == 0` → undefined, hold last valid or render `—`, never `0`. `power_W < 20` (light roll-out) → render `—`, not `0.0`. |

**Pacing / fatigue over strokes**
| Metric | Definition | Why it matters |
|--------|------------|----------------|
| Power decay (slope) | Linear regression slope of `power_W` vs stroke index (W per stroke) | Negative slope = fading. Positive = building. |
| DPS decay (slope) | Same for `DPS` | Technique holds up or crumbles under fatigue. |
| First-10 / Last-10 comparison | Avg power and DPS over first N vs last N strokes | Race-specific pacing diagnostic (stand-alone pieces often planned as neg. splits). |
| Quartile profile | Avg power & DPS split into Q1 / Q2 / Q3 / Q4 of the session by stroke index | Visual pacing curve. |

**Best-segment / PB over strokes**
| Metric | Definition | Why it matters |
|--------|------------|----------------|
| Best N-stroke power | Max rolling average of stroke power over any consecutive N strokes (N ∈ {10, 20, 50, 100}) | Stroke-count analogue of "best 1 min / 5 min" in cycling. |
| Best N-stroke DPS | Same for DPS | Tracks technique peak, not just raw effort. |
| Best N-stroke pace | Fastest consecutive-stroke segment by total distance / total cycle time | Natural PB unit when SPM varies. |

**Distribution / histograms**
| Metric | Definition | Why it matters |
|--------|------------|----------------|
| Per-stroke power histogram | Distribution of `stroke_power` across the session | Reveals bimodal patterns (interval sets) vs unimodal (steady state). |
| Per-stroke DPS histogram | Distribution of `DPS` | Wide spread = mixed technique / effort; narrow = controlled. |
| Stroke cycle-time histogram | Distribution of Δt | Flags pauses and missed strokes as outliers. |

**Session phases**
| Metric | Definition | Why it matters |
|--------|------------|----------------|
| Warm-up detection | Strokes until `stroke_power` reaches and stays within ±10 % of session-avg for M consecutive strokes | Separates warm-up from working effort. |
| Cool-down detection | Mirror of warm-up at session end. | |
| Piece boundaries | Segment runs where SPM stays within band X and power within band Y; break at deviations | Auto-splits a mixed session into distinct pieces/intervals without user markup. |

### Tier 4 — Cross-session / lifetime (per user)

| Metric | Definition |
|--------|------------|
| Personal best per standard distance | Fastest time over 500 / 1000 / 2000 / 5000 / 6000 / 10000 m computed as a rolling window **across stroke series**, not only complete sessions of that distance. |
| Personal best per standard duration | Furthest distance over 4 / 30 / 60 minutes. |
| Best N-stroke power (lifetime) | Across all sessions. |
| Best N-stroke DPS (lifetime) | Across all sessions. |
| Lifetime distance | Σ session totals. |
| Lifetime time (active) | Σ session `total_time`. |
| Lifetime strokes | Σ session `total_strokes`. Now exact, enabling meaningful "stroke mileage" displays. |
| Lifetime energy | Σ session mechanical energy (kJ). |
| Lifetime calories | Σ session calories. |
| Weekly / monthly roll-ups | Sessions, distance, time, strokes, avg pace, median SPM, calories. |
| DPS trend | Rolling-4-week median DPS at matched intensity bin (proxy for technique improvement). |
| Power-at-SPM trend | Rolling-4-week avg power bucketed by SPM band — shows if you're getting stronger at the same rate. |

## Calories: live vs session

Two distinct metrics share the "Kalorien" label:

- **Live view**: `cal_per_hr` — the instantaneous rate from the IPM
  stream (Tier 1). This is what the `kalorien` tile shows during a
  session. Unit: kcal/h.
- **Session summary / history**: `session_calories` — the aggregated
  total (Tier 3). Unit: kcal.

They are **different tiles / fields** and must not be swapped. UI
surfaces that need both (e.g. live view + end-of-session ribbon) use
both tokens.

## Units, names, language

- Internal identifiers are English (`power_w`, `distance_m`, `pace_sec_per_500m`).
- User-facing strings may be German (per
  [`docs/domain-glossary.md`](../../docs/domain-glossary.md)) or
  i18n'd — e.g. **Schlagzahl** for SPM, **Schlagfrequenz** for cadence,
  **Split** for 500 m pace.
- Pace rendered as `M:SS` with no leading zero on minutes (`2:08`, not
  `02:08`).
- Calories shown with no decimal (`1,140 kcal/h`).

## User stories

- As a rower, I want the live view to show **pace, SPM, watts, level,
  time, distance, calories/hour** simultaneously so I can steer the
  effort.
- As a rower, I want **per-session aggregates** after each session
  (avg pace, avg W, total kcal, peak W) so I can compare efforts.
- As a rower, I want **PBs** across standard distances and durations so I
  can chase them.
- As a rower, I want every metric to use the **same definition** between
  the live view, session detail, and stats page — no surprises.

## Acceptance criteria

- [ ] Every metric name in the spec has exactly one code identifier,
      reused verbatim across backend, API, and frontend.
- [ ] Parser emits Tier 1 fields as a typed record; Tier 2/3 derivations
      operate on the record stream.
- [ ] Unit tests cover derived pace, session totals, and PB rolling-window
      computation against recorded fixture CSVs under
      `specs/int/fixtures/ipm/`.
- [ ] Live view renders at least: time, distance, pace, SPM, watts,
      calories/hour, level.
- [ ] Session detail renders aggregates and a stroke-rate / power /
      pace chart over time.
- [ ] Unknown A8 fields (`[10:13]`, `[13:16]`, `[24:25]`) are kept in the
      raw sample record and exported to CSV so future decoding can
      reinterpret historical data.

## Non-goals (v1)

- **No per-stroke biomechanics.** The IPM's 2–3 s message cadence
  cannot resolve drive time, recovery time, drive/recovery ratio,
  stroke length, or force-curve shape. These would require either
  faster sampling from the console (unknown if possible) or an added
  handle-position / load-cell sensor.
- **HR-derived metrics are deferred** until an HR belt is paired and the
  transport (standalone `H<bpm>` response vs. embedded in an A8 field)
  is confirmed — see INT-0001 open questions. When that's nailed down,
  the following move into scope: HR zones (time in Z1–Z5), avg / max /
  min HR per session, HR recovery (drop from peak in the first 60 s
  post-session), HR vs power relationship, stroke-level HR trajectory,
  HR-calibrated training load.
- **No training-load stack** (TRIMP, TSS, CTL/ATL/TSB) in v1 — these
  need a long session history and user-specific thresholds to be
  meaningful.
- **No VO2max estimation** in v1. Formula-based estimates have ±10 %
  error without lab testing; better to add once users have enough
  best-effort sessions to calibrate.
- **No drag-factor estimation.** Unlike air-resistance ergos
  (Concept2), the IPM uses a closed water tank with a discrete 1–16
  resistance level. We record the level instead.
- **No age/weight-adjusted scoring.**
- **No comparison between users.**

## Open questions

- ~~Stroke count estimator~~ — **resolved**. Each A8 message IS a
  stroke event (verified across 120+ samples, inter-message Δt = 60/SPM
  with ratio 0.99 ± 0.04). Total stroke count is exactly the number of
  active A8 messages. The `[24:25]` single-digit field remains of
  unknown purpose but is not the stroke counter we thought we needed.
- **Session boundaries**: rely on idle-timeout (INT-0001 state machine)
  or offer an explicit "end session" button in the UI? Both probably.
- **Negative splits / pacing zones**: worth exposing as a visualisation
  later (not v1).
- **Calorie formula per resistance level**: we have a clean L3 fit and
  indicative per-level coefficients; revisit once we have >20 samples at
  each level, so goal-setting against calorie targets is accurate.
- **Units conversion**: offer imperial (mi, lbs) as a display preference,
  or stay SI-only? Probably stay SI for v1.
