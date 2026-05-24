# INT-0001: IPM Serial Protocol

- **Status**: Verified — handshake + command catalogue + live-stream
  field layout. Initial decode 2026-04-19 against four hardware captures
  left two fields tagged as "unknown"; a 2026-05-24 cross-check against
  Stefan Jenkner's reference parser (see References) resolved both,
  along with three field-width errors hiding in the leading zeros.
  All A8 positions are now accounted for; one single-digit position
  (`[10]` in the A8-stripped payload) is constant `1` on firmware V115
  and has no published interpretation.
- **External system**: First Degree Fitness IPM (Interactive Performance
  Monitor) — the console fitted to the Life Fitness Row GX Trainer

## Purpose

Read live stroke data and totals from the ergometer's console so the
backend can stream it to the PWA and persist sessions.

## Transport

- USB virtual serial port (micro-USB on the underside of the console)
- **9600 baud**, 8N1, no flow control
- ASCII, line-oriented
- **Line terminator, IPM → Host: `\r\n`** (0x0d 0x0a). Verified against a live
  unit 2026-04-19 — every response ended in CRLF, across C/V/T/O/L.
- **Line terminator, Host → IPM: tolerant.** The IPM responded identically to
  `C`, `C\r`, `C\n`, and `C\r\n`. Canonical form for the host side is `<cmd>\r`
  for symmetry with the IPM's outgoing CRLF, but bare commands work.

On the host side the device enumerates via an **FTDI FT232R** bridge —
USB VID:PID `0403:6001`, enumerates as `/dev/cu.usbserial-<SERIAL>` on macOS
with the native AppleUSBFTDI driver (no extra kext needed). Confirmed with
`system_profiler SPUSBDataType`. The FTDI chip is powered from USB VBUS and
enumerates even with the console turned off; protocol traffic of course
requires the console to be on.

Community reverse-engineering mentioned CP210x and CH340 as alternative
chips. Those may apply to other FDF IPM revisions; the unit verified here
is FT232R. Re-identify before assuming FTDI when working against an
unfamiliar console.

## Message catalogue

> **Status**: the command/response catalogue below was verified against a
> live unit on 2026-04-19 (firmware `V1150715`). Community reverse-engineering
> from the Golden Cheetah mailing list (~2016) provided the starting
> hypotheses; where reality diverged, this spec now reflects reality. The
> live-data stream during rowing is still unverified.

### Host → IPM (commands)

Single ASCII letter. `\r` terminator recommended (see Transport); the IPM
also accepts `\n`, `\r\n`, and no terminator for the commands tested.

| Cmd | Meaning                                                      | Verified |
|-----|--------------------------------------------------------------|----------|
| `C` | Connect / wake. Sent repeatedly until IPM responds.          | ✓ 2026-04-19 |
| `T` | Request display type.                                        | ✓ 2026-04-19 |
| `V` | Request firmware version.                                    | ✓ 2026-04-19 |
| `O` | Request odometer (lifetime distance + time).                 | ✓ 2026-04-19 |
| `L` | Request / report current resistance level (1–16).            | ✓ 2026-04-19 |
| `H` | Heart rate query. Silent when no belt is paired.             | partial — no belt available at verification time |
| `R` | Reset counters (distance, time, calories). Use with care.    | not tested (destructive) |
| `D` | Disconnect / end session.                                    | not tested |

**The IPM does not emit unsolicited data while idle.** A passive listener
on the open port (both before and after a command exchange) received
nothing for multiple seconds. Data emission during an active session is
the M0 live-stream capture goal; until then, don't assume unsolicited
bytes.

### IPM → Host (responses)

Each response starts with the command letter echoed back, followed by an
ASCII payload, terminated by `\r\n`. Verified examples from the reference
unit (firmware family `115`, see `V` below):

| Response       | Example (verbatim)       | Notes                                                                    |
|----------------|--------------------------|--------------------------------------------------------------------------|
| `C<marker>`    | `C1154\r\n`              | Handshake. Marker appears to be a firmware family/build tag (see below). |
| `T<n>`         | `T8\r\n`                 | Display type code. Reference unit: 8. Community RE mentioned T5.         |
| `V<version>`   | `V1150715\r\n`           | Firmware version. 8 ASCII digits. Reference unit `1150715`.              |
| `O<dist>,<t>`  | `O0001301667,0000005296\r\n` | Odometer. Two comma-separated, **10-digit zero-padded** integers. Units TBD — see below. |
| `L<n>`         | `L3\r\n`                 | Current resistance level, 1–16. No zero-padding.                         |
| `H<bpm>`       | (no response when no belt) | Heart rate. Payload shape when a belt is present is not yet verified.    |

**Handshake marker ambiguity.** Community RE called out two responses:
`CFDF IPM` (alleged cold wake) and `C2135` (alleged warm). The reference
unit returned `C1154` — a numeric marker neither of those values. Sending
`C` repeatedly to the same awake console returned `C1154` every time, so
the marker is at minimum stable within a session. Whether a true cold
wake (console has been off long enough to drop state) produces a
different response is still unverified.

**Firmware version interpretation.** `V1150715` shares the leading `1150`
with the handshake marker `C1154`. A reasonable hypothesis is that the
handshake echoes the first four chars of the firmware version with a
single-digit suffix (`C` + `1150` + `4`?). Do not rely on this; treat
both as opaque strings until a second unit or firmware is observed.

**Odometer units.** Community RE described `O<km> <hours>` (space-separated,
no padding). The reference unit returned `O0001301667,0000005296` —
**comma-separated, 10-digit zero-padded**. Plausible reading: 1,301,667
(metres of lifetime distance → 1301.67 km) and 5,296 (minutes of lifetime
use → ~88 hours). Those numbers are consistent with a well-used ergo.
Confirm by resetting a test metric through the UI or by comparing against
the console's own on-screen totals — **don't implement persistence of this
field until the units are confirmed.**

### Continuous stream while rowing (A8 messages)

**Status**: Format **reverse-engineered and verified** 2026-04-19
against five captures (`session-short`, `session-m1`,
`session-m2-highpower`, `session-m3-long`, `session-m4-level-changes`),
then **revised 2026-05-24** after cross-checking against Stefan
Jenkner's `fdf-console-monitor` parser (see References). The original
local decode was correct on the values used by downstream consumers
(distance, SPM, watts, level) but mis-framed several fields by
splitting at the wrong character boundaries — which hid the device's
own **500 m split-pace** inside what we had called "marker" +
"unknown 3-digit field", lost the units digit of `cal/hr`, and
under-sized `SPM` and `distance` by one digit each. The corrected
layout below has zero unknown fields apart from a single constant
digit at `[10]`.

#### Message envelope

- Prefix: `A8` (two ASCII bytes, 0x41 0x38)
- Payload: **27 ASCII decimal digits**, fixed width
- Terminator: `\r\n` (CRLF)
- Total wire length: **31 bytes** (`A8` + 27 digits + CRLF)
- **Cadence: exactly one A8 message per detected stroke.** Verified
  against the 120-message M3-long capture: measured inter-message Δt /
  expected 60/SPM has mean 0.987, median 0.988, range 0.94–1.02 across
  SPMs from 25 to 37. This means:
  - Total strokes in a session = count of A8 messages where SPM > 0
    (exact, not an estimate).
  - Per-stroke metrics — distance per stroke (= Δdistance), stroke
    cycle time (= Δt), energy per stroke (= power × Δt) — are directly
    computable from consecutive messages.
  - Raising the "sampling frequency" is not possible with known
    commands: the IPM pushes on stroke detection, not on a timer. For
    within-stroke biomechanics (drive/recovery split, force curve) a
    different transport is required — possibly BLE FTMS (see ADR-0007).
  Messages arrive fragmented across multiple serial read chunks;
  reassemble on CRLF before parsing.
- Idle behaviour: no A8 messages at all while the handle is parked. First
  A8 arrives seconds after rowing begins.

#### Field layout (27-digit payload, A8 prefix stripped; indices are Python slice `[start:end)`)

```
A8 H MM SS DDDDD R MM SS SSS PPP CCCC LL
   │ ├┤ ├┤ ├───┤ │ ├┤ ├┤ ├─┤ ├─┤ ├──┤ ├┤
   [0]│  │  │   │  │  │  │   │   │    [25:27]
      │  │  │   │  │  │  │   │   [21:25]
      │  │  │   │  │  │  │   [18:21]
      │  │  │   │  │  │  [15:18]
      │  │  │   │  │  [13:15]
      │  │  │   │  [11:13]
      │  │  │   [10]
      │  │  [5:10]
      │  [3:5]
      [1:3]
```

| Slice     | Width | Meaning              | Units / format               | Status       |
|-----------|-------|----------------------|------------------------------|--------------|
| `[0]`     | 1     | High-order overflow digit for elapsed time | always `0` in captured sessions; would carry hundreds-of-minutes (or hours) on very long rows | ✓ inferred from reference parser, untested in practice |
| `[1:3]`   | 2     | Elapsed minutes      | integer 00–99                | ✓ verified   |
| `[3:5]`   | 2     | Elapsed seconds      | integer 00–59                | ✓ verified   |
| `[5:10]`  | 5     | Cumulative distance  | integer metres (0–99999); leading digit is `0` until 10 km | ✓ verified for 0–1035 m; >9999 m untested |
| `[10]`    | 1     | Device-class / rower-type byte | constant `1` on firmware V115; no published interpretation. Stefan Jenkner's parser ignores this position entirely. | ◑ constant in captures, meaning unverified |
| `[11:13]` | 2     | **500 m split-pace minutes** as computed by the console | integer 00–99 (observed 01–10) | ✓ verified |
| `[13:15]` | 2     | **500 m split-pace seconds** as computed by the console | integer 00–59 | ✓ verified |
| `[15:18]` | 3     | Stroke rate (SPM)    | integer 000–999 (observed 00–37); hundreds digit always `0` in practice | ✓ verified |
| `[18:21]` | 3     | Power                | integer watts (0–999 observed; 635 W peak) | ✓ verified |
| `[21:25]` | 4     | Calories per hour    | integer 0–9999; matches the linear fit `cal/hr ≈ 3.43·W + 295` at level 3 (MAE 2.6 cal/hr across 167 active-rowing messages) | ✓ verified |
| `[25:27]` | 2     | Resistance level     | integer 01–16, matches `L<n>` console response | ✓ verified |

**Time decoding.** `[1:3]` is integer minutes, `[3:5]` is integer
seconds. Seconds roll from `59` to `00` and increment the minute
field. The leading `[0]` digit is the high-order overflow nibble for
elapsed time — `0` in all captured sessions. The earlier draft of
this spec read `[0:6]` as `MMMSST` (three digits min, two sec, one
tenths); under that framing the "tenths" digit was always `0`, which
*looked* like a 1 Hz device tick but was actually the leading digit of
the distance field. **The IPM does not transmit sub-second elapsed
time.** Use host-side `ReceivedAt` if you need fractional resolution.

**500 m split decoding.** The console publishes its **own smoothed
500 m split-pace** in `[11:15]` (MM:SS) on every stroke. This is the
value rendered on the rower's LCD — already-smoothed, already-paused
correctly, identical to what the user sees on the hardware. Prefer
this over any host-side derivation when available; the device split
is `0:00` only before the first valid stroke and during long idle
periods.

Example decode of `004440103510222000249008303` (session-m3-long final message, level 3):

| Field     | Raw     | Decoded                                |
|-----------|---------|----------------------------------------|
| `[0]`     | `0`     | (overflow nibble, unused)              |
| `[1:3]`   | `04`    | 4 minutes elapsed                      |
| `[3:5]`   | `44`    | 44 seconds elapsed → 4:44              |
| `[5:10]`  | `01035` | 1035 m                                 |
| `[10]`    | `1`     | device-class byte (constant)           |
| `[11:13]` | `02`    | split-pace minutes = 2                 |
| `[13:15]` | `22`    | split-pace seconds = 22 → **2:22 /500m** |
| `[15:18]` | `000`   | 0 SPM (handle parked at end)           |
| `[18:21]` | `249`   | 249 W                                  |
| `[21:25]` | `0083`  | 83 cal/hr (handle parked; minimal burn) |
| `[25:27]` | `03`    | Resistance level 3                     |

#### Verification evidence

Cross-referenced against four captures in `specs/int/fixtures/ipm/`:

| Capture | User-reported | Parser output (last message) | Match |
|---------|---------------|------------------------------|-------|
| `session-m1` | 48 s, 163 m, ~170 W avg, ~23 SPM, L3 | 48.0 s, 163 m, 190 W, 27 SPM, L3 | ✓ |
| `session-m2-highpower` | 19 s, 635 W peak, L3 | 19.0 s, 68 m, 635 W peak, L3 | ✓ |
| `session-m3-long` | 4:44, 1035 m, ~270 W avg, ~25 SPM avg, L3 | 4:44.0, 1035 m, 259 W avg, 26 SPM avg, L3 | ✓ |
| `session-short` | 21 strokes @ ~20 SPM, L3 | 23.7 SPM middle-average, L3 | ≈ |
| `session-m4-level-changes` | Stepped L1→L2→L3→L4 up to 40s | Level field transitions 01→02→03→04 at correct timestamps | ✓ |

Two captures are decisive:

- **`session-m3-long`**: distance crossed 999 m (final value 1035 m)
  **without** the message length or field offsets changing, confirming
  that distance is a fixed 4-digit field, not variable-length.
- **`session-m4-level-changes`**: the user stepped the resistance level
  up from 1 to 4 during a single row. The last two digits of every A8
  message transitioned `01 → 02 → 03 → 04` in lockstep, confirming that
  `[25:27]` encodes the current resistance level — and disproving the
  earlier hypothesis that those two digits were a constant `03` terminator
  (they looked constant only because all earlier captures were at L3).

#### Parser and CSV outputs

Reference parser: [`traces/ipm_parser.py`](../../traces/ipm_parser.py). Run
`uv run traces/ipm_parser.py` to regenerate `session-*.csv` alongside each
fixture; each CSV has one row per decoded A8 message with columns
`capture_ts,time_sec,distance_m,spm,power_w,cal_per_hr,level,marker,unknown_13_16,footer_24_25,raw_payload`.

#### How earlier "unknowns" were resolved

The original 2026-04-19 decode left three positions tagged uncertain
(`[10:13]` marker, `[13:16]` unknown 3-digit, `[24:25]` unknown single
digit) and gave `cal/hr` a `÷ 10` factor. Cross-checking against Stefan
Jenkner's `fdf-console-monitor` parser in May 2026 showed the local
decode had split several adjacent fields at the wrong boundary. Once
re-aligned, three independent observations from the original analysis
fall out as predictions of the corrected layout:

1. **"`[13:16]` last digit is always 0"** — under the corrected
   layout this position straddles `[13:15]` (split-pace seconds, 00–59)
   and `[15:18]` (SPM, 000–999). The "trailing zero" we observed is
   simply the hundreds digit of SPM, which is `0` for any human
   stroke rate. The "47 distinct values 000–460 in multiples of 10"
   is exactly what `split_seconds × 10 + 0` produces over the 60-value
   range, minus values the rower never hit.
2. **"`[24:25]` near-uniform 0-9 distribution"** — this is the units
   digit of the 4-digit `cal/hr` field (0–9999). A slowly-varying
   integer's LSB is by definition uniformly distributed across samples.
3. **"Marker values `101 / 102 / 103 / 104 / 110`"** — the device-class
   byte at `[10]` is constant `1`, and `[11:13]` holds split-pace
   minutes. The five observed markers decompose as `1` + split-minutes
   `01 / 02 / 03 / 04 / 10` — and the context the spec recorded for
   each value matches: `101` (split-min 1) appeared in the M2 sprint
   capture; `103` / `104` (split-min 3 / 4) appeared on session
   openings; `110` (split-min 10) appeared on the first stroke of an
   idle handle.

The earlier `cal/hr ≈ 3.43·W + 295` linear fit (MAE 2.56 cal/hr)
still holds — that work measured cal/hr accurately up to a factor-of-10
ambiguity that the corrected 4-digit width pins down.

#### Remaining open questions

- **`[10]` device-class byte** — constant `1` on firmware V115. Stefan
  Jenkner's parser ignores this position; the value's interpretation is
  not published anywhere we found. Possibly a rower-class flag
  (analogous to `5` in the older `A5` message family used on E316-era
  consoles — see References). Safe to ignore unless a different unit
  produces a different value.
- **Session-end semantics** — in all captures the final A8 message has
  `SPM=00` and the level-trailing digits change. Whether the IPM emits
  an explicit "session over" marker or simply stops is still unclear.
  Idle-timeout detection in the host state machine is the safe default
  regardless.
- **Distance > 9999 m** — the field is now known to be 5 digits wide
  (`[5:10]`), so the wraparound risk is past 100 km rather than 10 km;
  still untested in practice.
- **Sub-second timing** — confirmed *not* in the wire format. The
  device clock is exposed only at 1 Hz. Host-side `ReceivedAt`
  microsecond timestamps are the only way to recover finer resolution.

## State machine

```
             [Closed]
                │
        open serial port
                │
                ▼
          [Disconnected] ◄───────────┐
                │                    │
     send 'C' every N ms             │
                │                    │
      receive 'C...' line            │
                │                    │
                ▼                    │ read timeout
         [Connected/Idle] ───────────┤
                │                    │
       handle arrives,               │
       stream begins                 │
                │                    │
                ▼                    │
        [Session Active]             │
                │                    │
       idle > N seconds              │
                │                    │
         session closed ─────────────┘
```

Transitions from any state on fatal I/O error → `[Closed]`, retry after
backoff.

## Error handling

- **Read timeout** during `[Session Active]`: hold state for an idle-grace
  window, then close the session and return to `[Connected/Idle]`.
- **Malformed line**: log (with raw bytes) and drop. Do not crash the
  session — a single corrupted stroke must not lose the whole workout.
- **Device disconnected** (port gone): flush pending session to storage,
  back off, poll for reappearance.
- **Unknown response prefix**: log and ignore. Forward-compatible with
  firmware variants.

## Test fixtures

Directory `specs/int/fixtures/ipm/`. Fixtures use `.txt` to avoid the
repo-global `*.log` ignore rule; the format inside is still a plain-text,
timestamped hex + ASCII dump.

- `handshake-warm.txt` — ✓ captured 2026-04-19. `C`/`V`/`T`/`O`/`L`/`H`
  probe against an already-awake console, produced by
  `traces/probe_handshake.py`.
- `session-short.txt` — ✓ captured 2026-04-19. ~21 strokes, ~58 s, reached
  197 m. Used for initial A8 reverse-engineering.
- `session-m1.txt` — ✓ captured 2026-04-19. 20 strokes in 48 s, 163 m,
  ~170 W avg, ~23 SPM. First capture with user-reported reference metrics.
- `session-m2-highpower.txt` — ✓ captured 2026-04-19. 19 s all-out sprint,
  635 W peak. Pinned down the power field via high-value signal.
- `session-m3-long.txt` — ✓ captured 2026-04-19. 4:44, 1035 m, ~270 W avg,
  ~25 SPM avg. First capture with distance > 999 m; confirmed the
  distance field is a fixed 4-digit slot, not variable-length.
- `session-m4-level-changes.txt` — ✓ captured 2026-04-19. User stepped
  resistance level L1 → L2 → L3 → L4 during a single row. Revealed that
  `[25:27]` encodes the current level (not a constant `03` terminator as
  first assumed from L3-only captures).
- Each `session-*.txt` fixture has a companion `session-*.csv` (decoded
  by `traces/ipm_parser.py`) for regression testing.

Still pending:
- `handshake-cold.txt` — needs a true cold boot (console off long enough
  to drop wake state).
- `session-long.txt` with distance > 9999 m — to test whether the
  distance field expands further or wraps.
- `idle-timeout.txt` — rowing stops mid-session, stream idles, resumes.
- `heartrate-belt.txt` — capture with an ANT+/Bluetooth HR belt paired.
  We currently do **not** read HR from the IPM at all; this capture is
  the first step to find out whether HR is exposed via serial in any
  form. Open questions, in priority order:
  1. Does `H\r` return a numeric payload (e.g. `H076`) instead of
     silence once a belt is paired?
  2. Do unsolicited `H<bpm>` lines appear in the A8 stream while rowing?
  3. Does any A8 field content change in a belt-dependent way? (No
     a-priori candidate; we'd look for fields whose value distribution
     shifts into the 60–200 bpm range only when the belt is active.)
  4. If none of the above — the IPM may not surface HR over serial at
     all, and we'd need to read the belt directly (ANT+ USB stick,
     Bluetooth LE) as a parallel input.
  Procedure: pair the belt, confirm on-screen HR readout, then run
  `probe_session.py heartrate-belt` and row steadily. Cross-reference
  the captured values against the on-screen HR.

## Alternative path

Newer IPM firmware supports **Bluetooth FTMS** (Fitness Machine Service)
after a firmware update via the "Fluid Connect" app. If the target console
supports this, FTMS is a standardised protocol with existing libraries on
every platform, and this entire INT spec becomes obsolete.

**Verify firmware capability before committing to the serial protocol.**
Decision ADR to be written: ADR-0007 (Serial vs BLE FTMS).

## Open questions

- Exact format of the live-data stream during rowing (primary remaining
  M0 capture goal).
- Does the IPM push unsolicited data *while rowing*, or does the host
  still need to poll? Idle-state pushing is ruled out (verified).
- Does a true cold wake (console powered off, then booted) yield a
  different `C`-response marker than the warm `C1154` seen so far?
- `O<dist>,<time>`: confirm units. Current guess is metres + minutes.
- `H<bpm>`: payload format when a belt is paired — does it match
  `H<ddd>` (three digit, zero-padded), or some other form? `H000` for
  "no belt" is not used by this firmware; the IPM stays silent instead.
- `R` reset semantics — which counters exactly, and does it confirm?
- `D` disconnect — does the console actually go back to sleep, or is the
  command ignored on currently-shipping firmware?

## References

- **Stefan Jenkner, `fdf-console-monitor`** —
  <https://github.com/stefanjenkner/fdf-console-monitor>. Go parser for
  the A8 message family, with field offsets verified against a
  shipping FDF console. The 2026-05-24 revision of this spec adopts
  its layout for `[5:10]` distance, `[11:15]` split-pace, `[15:18]`
  SPM, and `[21:25]` cal/hr. The companion recorder
  (<https://github.com/stefanjenkner/fdf-console-recorder>) captures
  raw frames suitable for replay.
- **`unrzn0/fdf`** — <https://github.com/unrzn0/fdf>. ESP32-based
  alternative console. Less complete than Jenkner's but a useful
  second opinion on field meanings.
- **Golden Cheetah users list, "E316 Fluid Rower" thread (2016)** —
  <https://groups.google.com/g/golden-cheetah-users/c/d1xGZZ68X1s>.
  Primary source for the command catalogue and the older `A5`
  message-family decode, where the device-class byte at `[10]` was
  observed as `5` (16-level rower).
- **First Degree Fitness FirstCoach (Windows)** — behavioural
  reference; can be USB-sniffed on Windows if a future protocol
  question can't be answered from captures.
- **Life Fitness Row GX / Row HX owner's manuals** on manualslib —
  product-level docs (no protocol detail).
