# /// script
# requires-python = ">=3.10"
# ///
"""IPM A8 live-data stream parser.

Parses the continuous 27-digit A8 messages emitted by the FDF IPM console
while rowing. Field layout verified against captures on 2026-04-19:

    A8 MMMSST DDDD KKK UUU SS PPP CCC X LL
       ├────┤ ├──┤ ├─┤ ├─┤ ├┤ ├─┤ ├─┤ ├┤ ├┤
       [0:6] [6:10] [10:13] [13:16] [16:18] [18:21] [21:24] [24:25] [25:27]

Verified fields (cross-referenced against console display and a level-change
capture where the user stepped L1→L2→L3→L4 during rowing):
    [0:6]    Time (MMM:SS.T) — 3-digit minutes, 2-digit seconds, 1-digit tenths
    [6:10]   Distance (meters, 4 digits, supports up to 9999m)
    [16:18]  Stroke rate (SPM, 2 digits)
    [18:21]  Power (watts, 3 digits, 0-999 observed)
    [21:24]  Calories per hour ÷ 10 (integer; cal/hr ≈ 3.43·W + 295 at L3,
             MAE 2.6 cal/hr; resistance level shifts the coefficients per the manual)
    [25:27]  Resistance level (2 digits, 01-16). Matches `L<n>` response.

Unverified fields (pass through as raw strings):
    [10:13] Marker (mostly '102'; variants '101','103','104','110')
    [13:16] Unknown 3-digit field (varies 000-460)
    [24:25] Single digit in footer, purpose unknown
"""

from __future__ import annotations

import csv
import re
import sys
from dataclasses import dataclass, asdict
from pathlib import Path


@dataclass
class A8Message:
    """One decoded A8 live-data message."""
    capture_ts: float        # wall-clock timestamp from fixture (seconds since capture start)
    raw_payload: str         # full 27-digit payload (without leading "A8")
    time_sec: float          # elapsed rowing time in seconds (from [0:6])
    distance_m: int          # cumulative distance in meters (from [6:10])
    spm: int                 # stroke rate, strokes per minute (from [16:18])
    power_w: int             # power in watts (from [18:21])
    cal_per_hr: int          # calories per hour (from [21:24] × 10)
    level: int               # resistance level 1-16 (from [25:27])
    marker: str              # [10:13] — pass-through (mostly '102')
    unknown_13_16: str       # [13:16] — pass-through
    footer_24_25: str        # [24:25] — single digit, purpose unknown


def hex_to_ascii(hex_bytes_str: str) -> str:
    """Convert space-separated hex bytes to an ASCII string."""
    return "".join(chr(int(b, 16)) for b in hex_bytes_str.split())


def parse_fixture(fixture_path: Path) -> list[dict]:
    """Read a probe_session fixture and reassemble fragmented A8 messages.

    Returns a list of {"timestamp": float, "payload": str} dicts. Payload
    is the full message after the "A8" prefix, with CRLF stripped. Partial
    messages (no trailing CRLF at EOF) are dropped.
    """
    raw_lines = []
    with fixture_path.open() as f:
        for line in f:
            match = re.match(
                r"\[\s*(\d+\.\d+)\]\s+RX\s+\(\s*(\d+)\s+B\)\s+([0-9a-f ]+)",
                line,
            )
            if not match:
                continue
            raw_lines.append({
                "timestamp": float(match.group(1)),
                "ascii": hex_to_ascii(match.group(3).strip()),
            })

    messages = []
    current = None
    for item in raw_lines:
        text = item["ascii"]
        if text.startswith("A8") and current is None:
            current = {"timestamp": item["timestamp"], "ascii": text}
        elif current is not None:
            current["ascii"] += text

        if current and current["ascii"].endswith("\r\n"):
            clean = current["ascii"].rstrip("\r\n")
            if clean.startswith("A8") and len(clean) > 2:
                messages.append({
                    "timestamp": current["timestamp"],
                    "payload": clean[2:],
                })
            current = None
    return messages


def decode_a8(payload: str, capture_ts: float) -> A8Message | None:
    """Decode a single 27-digit A8 payload. Returns None if not decodable."""
    if len(payload) != 27 or not payload.isdigit():
        return None

    # [0:6] Time: MMM SS T (minutes, seconds, tenths)
    minutes = int(payload[0:3])
    seconds = int(payload[3:5])
    tenths = int(payload[5:6])
    time_sec = minutes * 60 + seconds + tenths / 10

    return A8Message(
        capture_ts=capture_ts,
        raw_payload=payload,
        time_sec=time_sec,
        distance_m=int(payload[6:10]),
        marker=payload[10:13],
        unknown_13_16=payload[13:16],
        spm=int(payload[16:18]),
        power_w=int(payload[18:21]),
        cal_per_hr=int(payload[21:24]) * 10,
        footer_24_25=payload[24:25],
        level=int(payload[25:27]),
    )


def fixture_to_csv(fixture_path: Path, csv_path: Path) -> int:
    """Parse a fixture and write decoded messages to CSV. Returns row count."""
    raw = parse_fixture(fixture_path)
    decoded = []
    for item in raw:
        msg = decode_a8(item["payload"], item["timestamp"])
        if msg is not None:
            decoded.append(msg)

    with csv_path.open("w", newline="") as f:
        writer = csv.DictWriter(
            f,
            fieldnames=[
                "capture_ts",
                "time_sec",
                "distance_m",
                "spm",
                "power_w",
                "cal_per_hr",
                "level",
                "marker",
                "unknown_13_16",
                "footer_24_25",
                "raw_payload",
            ],
        )
        writer.writeheader()
        for msg in decoded:
            writer.writerow(asdict(msg))

    return len(decoded)


def main() -> int:
    fixture_dir = Path(__file__).resolve().parents[1] / "specs" / "int" / "fixtures" / "ipm"
    if len(sys.argv) > 1:
        fixtures = [Path(p) for p in sys.argv[1:]]
    else:
        fixtures = sorted(p for p in fixture_dir.glob("session-*.txt"))

    if not fixtures:
        print("no fixtures found", file=sys.stderr)
        return 1

    for fixture in fixtures:
        csv_path = fixture.with_suffix(".csv")
        count = fixture_to_csv(fixture, csv_path)
        print(f"{fixture.name:40s} → {csv_path.name} ({count} rows)")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
