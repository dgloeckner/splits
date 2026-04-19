# /// script
# requires-python = ">=3.10"
# dependencies = ["pyserial>=3.5"]
# ///
"""One-shot handshake probe for the FDF IPM console.

Run via:
    uv run traces/probe_handshake.py

Tries the `C` wake command with each plausible terminator, then a few
read-only follow-ups (V, T, O, L, H). Logs every received byte with a
monotonic timestamp, hex, and printable ASCII to stdout and to
traces/handshake.log.

Does NOT send R (reset) or D (disconnect).
"""

from __future__ import annotations

import sys
import time
from pathlib import Path

import serial  # type: ignore[import-not-found]

PORT = "/dev/cu.usbserial-AB0JKG07"
BAUD = 9600
LOG_PATH = Path(__file__).with_name("handshake.log")


def hexdump(data: bytes) -> str:
    hx = " ".join(f"{b:02x}" for b in data)
    printable = "".join(chr(b) if 0x20 <= b < 0x7F else "." for b in data)
    return f"{hx}  |{printable}|"


def drain(ser: serial.Serial, window_s: float) -> bytes:
    end = time.monotonic() + window_s
    buf = bytearray()
    while time.monotonic() < end:
        chunk = ser.read(256)
        if chunk:
            buf.extend(chunk)
            end = time.monotonic() + 0.15
    return bytes(buf)


def step(log, ser, label: str, payload: bytes | None, window_s: float = 0.8) -> None:
    t = time.monotonic()
    if payload is not None:
        ser.write(payload)
        ser.flush()
        msg = f"[{t:9.3f}] TX {label!r:<14} bytes={hexdump(payload)}"
    else:
        msg = f"[{t:9.3f}] -- {label}"
    print(msg)
    log.write(msg + "\n")
    rx = drain(ser, window_s)
    t = time.monotonic()
    if rx:
        msg = f"[{t:9.3f}] RX ({len(rx):>3} B)   {hexdump(rx)}"
    else:
        msg = f"[{t:9.3f}] RX  (silent)"
    print(msg)
    log.write(msg + "\n")
    log.flush()


def main() -> int:
    try:
        ser = serial.Serial(
            PORT, BAUD,
            bytesize=serial.EIGHTBITS,
            parity=serial.PARITY_NONE,
            stopbits=serial.STOPBITS_ONE,
            rtscts=False, dsrdtr=False, xonxoff=False,
            timeout=0.05,
        )
    except serial.SerialException as e:
        print(f"open failed: {e}", file=sys.stderr)
        return 1

    with ser, LOG_PATH.open("w") as log:
        header = f"# probe_handshake.py @ {time.strftime('%Y-%m-%d %H:%M:%S')} on {PORT} @ {BAUD} 8N1\n"
        print(header.rstrip())
        log.write(header)

        step(log, ser, "passive listen",       None,          window_s=2.0)
        step(log, ser, "C bare",               b"C",          window_s=0.8)
        step(log, ser, "C + CR",               b"C\r",        window_s=0.8)
        step(log, ser, "C + LF",               b"C\n",        window_s=0.8)
        step(log, ser, "C + CRLF",             b"C\r\n",      window_s=0.8)
        step(log, ser, "repeat C+CR x5",       b"C\r" * 5,    window_s=1.5)
        step(log, ser, "V + CR",               b"V\r",        window_s=0.8)
        step(log, ser, "T + CR",               b"T\r",        window_s=0.8)
        step(log, ser, "O + CR",               b"O\r",        window_s=0.8)
        step(log, ser, "L + CR",               b"L\r",        window_s=0.8)
        step(log, ser, "H + CR",               b"H\r",        window_s=0.8)
        step(log, ser, "final passive listen", None,          window_s=2.0)

    print(f"\nlog written: {LOG_PATH}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
