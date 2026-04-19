# Protocol notes

Working notes from the reverse-engineering discussion. The authoritative
wire-format document is [`../specs/int/0001-ipm-serial-protocol.md`](../specs/int/0001-ipm-serial-protocol.md)
— **update that when reality contradicts it during M0**.

## 2026-04-19 — M0 complete; A8 live-data stream decoded

Hardware captures (in [`../specs/int/fixtures/ipm/`](../specs/int/fixtures/ipm/))
resolved M0. INT-0001 is now canonical for the wire format. Summary of
what the live unit (firmware `V1150715`) did that this notes file
previously listed as unknown or wrong:

- **Bridge chip**: FTDI FT232R (VID:PID `0403:6001`). Native macOS driver.
- **Line terminator, IPM → host**: CRLF (`\r\n`). The notes' `\r` guess
  was incomplete.
- **Line terminator, host → IPM**: any of none / `\r` / `\n` / `\r\n`
  works. Pick `\r` for the canonical host form.
- **Idle-state emission**: none — the IPM is command/response only when
  no-one is rowing. Do not build any auto-discovery that expects bytes
  to arrive unbidden on port open.
- **`C` handshake response**: this unit returns `C1154`, not the
  community-documented `CFDF IPM` or `C2135`. Treat the marker as an
  opaque firmware tag.
- **`O` odometer format**: `O<10-digit>,<10-digit>` zero-padded,
  comma-separated — NOT the space-separated `O<km> <h>` the notes listed.
- **`H` heart-rate with no belt**: silence, not `H000`.
- **Live-data stream**: single fixed-width 27-digit ASCII message family
  prefixed with `A8` and terminated with CRLF, emitted every 2–3 s while
  rowing (NOT strictly per stroke). Fields decoded: elapsed time
  (mmm:ss.t), distance (m), stroke rate (SPM), power (W), calories/hour
  (value×10), resistance level (01–16). See INT-0001 for the full field
  table and [`ipm_parser.py`](../traces/ipm_parser.py) for a reference
  decoder. Sample visualisations under
  [`visualizations/`](visualizations/).

See INT-0001 for the canonical details and remaining open questions. The
notes below are the pre-verification snapshot; kept for context.

## Hardware identification

The Life Fitness Row GX Trainer is rebadged First Degree Fitness hardware.
The console is an **FDF IPM** (Interactive Performance Monitor). The micro-USB
port on the underside of the monitor (visible in the project's source imagery)
exposes a USB-to-serial bridge.

The USB-to-serial bridge chip inside the console is one of the common suspects
(CP210x / FTDI / CH340). Identify on first connect via:

```bash
system_profiler SPUSBDataType | grep -A 10 -i "serial\|fitness\|FDF\|IPM"
```

macOS has CDC-ACM and FTDI drivers natively; CP210x usually works but may
need the Silicon Labs driver on older releases; CH340 occasionally needs a
driver.

## Transport

- 9600 baud, 8N1, no flow control
- ASCII, line-based
- Line terminator: **unverified** — try `\r`, fall back to `\r\n`

## Command catalogue (from community RE, ~2016)

Source: Golden Cheetah mailing list thread "E316 Fluid Rower". Treat these
as hypotheses until verified.

Host → IPM (single letters, possibly terminated):

```
C   Connect / wake (send repeatedly until response)
T   Display type
V   Firmware version
O   Odometer (lifetime)
L   Resistance level (1–16)
H   Heart rate
R   Reset counters
D   Disconnect
```

IPM → Host (command letter echoed, then payload):

```
CFDF IPM   First response after cold wake
C2135      Response if already awake (firmware marker?)
T5         Display type
V2135014   Firmware version
O871 72    Odometer: 871 km, 72 hours
L7         Resistance level 7 of 16
H076       Heart rate 76 bpm (H000 = no belt)
```

## Continuous stream (unknown — capture in M0)

While the user is rowing, the IPM emits a continuous data stream. Exact
format to be captured and documented. Likely fields:

- Distance (m, integer)
- Elapsed time (s or tenths)
- Stroke rate (SPM, integer)
- Power (W, integer)
- 500 m split (format TBD)

## M0 capture recipe

```bash
# 1. Find the device
ls /dev/tty.* /dev/cu.*
# (plug in cable)
ls /dev/tty.* /dev/cu.*
# Diff the two lists → that's your device node

# 2. Identify the bridge chip
system_profiler SPUSBDataType | grep -A 10 -i "serial\|fitness\|FDF\|IPM"

# 3. Interactive session with tio
brew install tio
tio -b 9600 --log --log-file traces/handshake.log /dev/tty.usbmodemXXXX
# Then type 'C' + Enter. Expect CFDF IPM or C2135.
# Then pull the handle a few times. Capture the live stream.

# 4. Row a short session for a real capture
tio -b 9600 --log --log-file traces/session-500m.log /dev/tty.usbmodemXXXX

# 5. Raw byte capture for terminator analysis
socat -v /dev/tty.usbmodemXXXX,raw,echo=0,b9600 - | tee traces/raw.log
```

Minimal Python sandbox for format exploration:

```python
import serial, time
ser = serial.Serial('/dev/tty.usbmodemXXXX', 9600, timeout=1)
ser.write(b'C\r')
time.sleep(0.2)
while True:
    line = ser.readline().decode(errors='replace').rstrip('\r\n')
    if line:
        print(f"{time.time():.3f}  {line!r}")
```

## Alternative path: BLE FTMS

Newer IPM firmware, updated via the **FDF "Fluid Connect"** app
(iOS / Android), supports the standard **Fitness Machine Service (FTMS)**
BLE profile. If the target console's firmware supports this, the whole
serial protocol becomes unnecessary:

- FTMS is a BLE GATT standard with well-documented libraries
  (openrowingmonitor, WebBluetooth, etc.)
- Works on any BLE-capable host (Pi, Mac, Linux with bluez)
- Survives future firmware changes

**Check firmware support before committing to the serial path.** If FTMS is
available, it's the better technical foundation. An ADR (ADR-0007) will
record the decision once verified.

## References

- Owner's manual — Life Fitness Row GX Trainer (search manualslib.com)
- Owner's manual — Life Fitness Row HX (Section 9 "USB Connectivity"
  describes the FirstCoach PC software)
- Golden Cheetah mailing list — "E316 Fluid Rower" thread, 2016
  (`https://groups.google.com/g/golden-cheetah-users/c/d1xGZZ68X1s`)
- First Degree Fitness Fluid Connect (app stores) — for firmware update
  check
