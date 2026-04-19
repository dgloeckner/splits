# /// script
# requires-python = ">=3.10"
# dependencies = ["pyserial>=3.5"]
# ///
"""Live-session capture for the FDF IPM console.

Opens the serial port, sends a C\r wake, then logs every received byte
with a monotonic timestamp to both stdout and a fixture file. Stops on
SIGINT (Ctrl-C) or SIGTERM and flushes cleanly so the fixture is always
well-formed even if killed.

Usage:
    uv run traces/probe_session.py [output_name]

The log lands at specs/int/fixtures/ipm/<output_name>.txt (default:
session-short).
"""

from __future__ import annotations

import signal
import sys
import time
from pathlib import Path

import serial  # type: ignore[import-not-found]

PORT = "/dev/cu.usbserial-AB0JKG07"
BAUD = 9600
DEFAULT_NAME = "session-short"
FIXTURE_DIR = Path(__file__).resolve().parents[1] / "specs" / "int" / "fixtures" / "ipm"


_stop = False


def _request_stop(signum, _frame):
    global _stop
    _stop = True


def hexdump(data: bytes) -> str:
    hx = " ".join(f"{b:02x}" for b in data)
    printable = "".join(chr(b) if 0x20 <= b < 0x7F else "." for b in data)
    return f"{hx}  |{printable}|"


def main() -> int:
    name = sys.argv[1] if len(sys.argv) > 1 else DEFAULT_NAME
    FIXTURE_DIR.mkdir(parents=True, exist_ok=True)
    out_path = FIXTURE_DIR / f"{name}.txt"

    signal.signal(signal.SIGINT, _request_stop)
    signal.signal(signal.SIGTERM, _request_stop)

    try:
        ser = serial.Serial(
            PORT, BAUD,
            bytesize=serial.EIGHTBITS, parity=serial.PARITY_NONE,
            stopbits=serial.STOPBITS_ONE,
            rtscts=False, dsrdtr=False, xonxoff=False,
            timeout=0.05,
        )
    except serial.SerialException as e:
        print(f"open failed: {e}", file=sys.stderr)
        return 1

    t0 = time.monotonic()
    def ts() -> float:
        return time.monotonic() - t0

    total_rx = 0
    chunk_count = 0

    with ser, out_path.open("w") as log:
        hdr = f"# probe_session.py @ {time.strftime('%Y-%m-%d %H:%M:%S')} on {PORT} @ {BAUD} 8N1\n"
        log.write(hdr)
        print(hdr.rstrip())

        # Wake
        line = f"[{ts():7.3f}] TX 'C\\r' wake\n"
        log.write(line); print(line.rstrip())
        ser.write(b"C\r"); ser.flush()
        time.sleep(0.25)

        # Initial state: resistance level
        rx = ser.read(256)
        if rx:
            line = f"[{ts():7.3f}] RX ({len(rx):>3} B) {hexdump(rx)}\n"
            log.write(line); print(line.rstrip()); total_rx += len(rx); chunk_count += 1

        line = f"[{ts():7.3f}] TX 'L\\r' level query\n"
        log.write(line); print(line.rstrip())
        ser.write(b"L\r"); ser.flush()
        time.sleep(0.25)
        rx = ser.read(256)
        if rx:
            line = f"[{ts():7.3f}] RX ({len(rx):>3} B) {hexdump(rx)}\n"
            log.write(line); print(line.rstrip()); total_rx += len(rx); chunk_count += 1

        line = f"[{ts():7.3f}] -- begin passive capture; row now. Ctrl-C or kill to stop.\n"
        log.write(line); print(line.rstrip())
        log.flush()

        while not _stop:
            rx = ser.read(256)
            if rx:
                line = f"[{ts():7.3f}] RX ({len(rx):>3} B) {hexdump(rx)}\n"
                log.write(line); print(line.rstrip())
                log.flush()
                total_rx += len(rx); chunk_count += 1

        line = f"[{ts():7.3f}] -- stop signal received; closing port\n"
        log.write(line); print(line.rstrip())
        summary = f"# total: {total_rx} bytes in {chunk_count} chunks over {ts():.2f}s\n"
        log.write(summary); print(summary.rstrip())

    print(f"\nfixture written: {out_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
