# INT-0001: IPM Serial Protocol

- **Status**: Draft — handshake + command catalogue + live-stream field
  layout verified 2026-04-19 against four hardware captures. Two fields in
  the A8 stream are still of unknown purpose but their positions/widths
  are locked.
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

**Status**: Format **reverse-engineered and verified** 2026-04-19 against
five captures (`session-short`, `session-m1`, `session-m2-highpower`,
`session-m3-long`, `session-m4-level-changes`). Six of the nine fields are
verified by cross-referencing the console display and a resistance-level
sweep (L1 → L4); three fields are still of unknown meaning but their
positions and widths are fixed.

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

#### Field layout (27-digit payload, indices are Python slice `[start:end)`)

```
A8 MMMSST DDDD KKK UUU SS PPP CCC X LL
   ├────┤ ├──┤ ├─┤ ├─┤ ├┤ ├─┤ ├─┤ │ ├┤
   [0:6] [6:10] [10:13] [13:16] [16:18] [18:21] [21:24] [24:25] [25:27]
    time   dist  marker  ???    SPM   power  derived ? level
```

| Slice     | Width | Meaning              | Units / format               | Status       |
|-----------|-------|----------------------|------------------------------|--------------|
| `[0:6]`   | 6     | Elapsed rowing time  | `MMMSST` = min·100 + sec·10 + tenths | ✓ verified |
| `[6:10]`  | 4     | Cumulative distance  | integer metres (0–9999)      | ✓ verified   |
| `[10:13]` | 3     | Marker / mode        | typically `102`, seen `101`/`103`/`104`/`110` | ✓ position, purpose not fully understood |
| `[13:16]` | 3     | Unknown              | 3-digit integer, range 000–460 observed | ✗ unknown |
| `[16:18]` | 2     | Stroke rate (SPM)    | integer strokes/min (0–99)   | ✓ verified   |
| `[18:21]` | 3     | Power                | integer watts (0–999 observed; 635 W peak) | ✓ verified |
| `[21:24]` | 3     | Calories per hour ÷ 10 | integer; cal/hr = value × 10, computed from power and resistance level (L3 fit: cal/hr ≈ 3.43·W + 295, MAE 2.6 cal/hr) | ✓ verified |
| `[24:25]` | 1     | Unknown single digit | 0–9, purpose unknown         | ✗ unknown |
| `[25:27]` | 2     | Resistance level     | integer 01–16, matches `L<n>` console response | ✓ verified |

**Time decoding.** `MMMSST` is three digits of minutes, two digits of
seconds, one digit of tenths-of-a-second. Seconds roll from `59` to `00`
and increment the minute field — do **not** read the whole field as an
integer counter. A naive integer read produces a gap at every minute
rollover (e.g. `000570` → `001000`), which drove the initial misanalysis.

Example decode of `004440103510222000249008303` (session-m3-long final message, level 3):

| Field     | Raw     | Decoded   |
|-----------|---------|-----------|
| `[0:6]`   | `004440`| `4:44.0` (minutes) |
| `[6:10]`  | `1035`  | `1035 m`  |
| `[10:13]` | `102`   | marker    |
| `[13:16]` | `220`   | unknown   |
| `[16:18]` | `00`    | `0` SPM (handle parked at end) |
| `[18:21]` | `249`   | `249 W`   |
| `[21:24]` | `008`   | 80 cal/hr (handle parked; minimal burn) |
| `[24:25]` | `3`     | unknown   |
| `[25:27]` | `03`    | **Resistance level 3** |

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

#### Outstanding questions

- **[10:13] marker** — almost always `102`. Observed deviations: `101`
  (M2 high-power rows), `103` (first message of some sessions, plus a
  few scattered), `104` (first message of M4). Not a stroke counter in
  any slicing (full value nearly constant; last digit mostly `2`).
  Purpose unknown; possibly a stroke-phase indicator, firmware-mode
  flag, or state byte. Safe to pass through unchanged for now.
- **[13:16] unknown 3-digit field** — not 500 m split time in `M:SS`
  encoding (observed values like `380`, `460` have invalid seconds digit).
  Not per-stroke drive time in centiseconds either (values too large in
  M2). Not a stroke counter in any interpretation (full value, first
  digit, or last two digits) — tested against the 171-message corpus.
  **Side-finding**: across all 171 captured messages, the **last digit
  is always 0** — i.e. values come in multiples of 10 (observed 000,
  020, 030, 050, 060, 070, 080, 090, 100, 110, … 460). So the field
  effectively encodes only 2 information-bearing digits plus a trailing
  zero. Real meaning still open.
- **[21:24] derived metric — calories per hour, divided by 10.** The
  owner's manual lists cal/hr as a display field, and the value
  reconstructs cleanly from power: a linear fit over all 167 active-rowing
  messages gives `cal/hr ≈ 3.43·W + 294.5` (at the captured resistance
  level 3) with mean absolute error **2.56 cal/hr**, essentially matching
  perfectly. Example map: 41 W → 043 (430 cal/hr), 77 W → 056 (560), 131
  W → 074 (740), 190 W → 095 (950), 290 W → 129 (1290), 404 W → 168
  (1680), 635 W → 247 (2470). Per-level fits show the formula depends on
  resistance level as the manual states — L1 slope 2.75, L2 3.41, L3
  3.43, L4 3.61 (L1/L2/L4 each have ≤5 samples, so those coefficients
  are indicative, not final). NOT a checksum: simple sum, XOR, weighted
  sum, CRC-8 CCITT, and CRC-8 Maxim all failed to reproduce `[21:24]`
  from the preceding bytes (0/171 or 1/171 matches).
- **[24:25] single digit** — ruled out as a stroke counter (neither
  strokes-per-interval nor cumulative-mod-10 match ΣSPM·Δt/60 across the
  171-message corpus; see the stroke-count validation run documented in
  FEAT-0007). Distribution is near-uniform over 0-9 across the large
  M3-long sample. Likely a fractional part of an internal high-precision
  metric (e.g. calories or a pace calculation) that the display rounds
  off, or an unrelated state byte. Purpose remains unknown.
- **Distance > 9999 m** — would require a 5-digit field. Untested; the
  longest capture so far reached 1035 m.
- **Session-end semantics** — in all captures the final A8 message has
  `SPM=00` and the footer changes shape (more zeros). Whether the IPM
  emits an explicit "session over" marker or simply stops is still
  unclear. Idle-timeout detection in the host state machine is the safe
  default regardless.

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

- Golden Cheetah mailing list thread, "E316 Fluid Rower", 2016 — primary
  source for the command catalogue above
- First Degree Fitness FirstCoach (Windows) — behavioural reference; can
  be USB-sniffed on Windows if the protocol capture on macOS is
  inconclusive
- Life Fitness Row GX / Row HX owner's manuals on manualslib
