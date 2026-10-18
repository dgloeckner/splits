# Architectural Decision Records

| ID       | Title                              | Status    |
|----------|------------------------------------|-----------|
| ADR-0001 | Deployment Targets                      | Accepted  |
| ADR-0002 | PWA over Native Apps                    | Accepted  |
| ADR-0003 | Tech Stack — Go Backend, React Frontend | Accepted  |
| ADR-0004 | Local-First Persistence                 | Accepted  |
| ADR-0005 | Per-Rower QR-Code Pairing               | Proposed  |
| ADR-0006 | TLS Strategy                            | Proposed  |
| ADR-0007 | Lossless Event Ingestion Pipeline       | Accepted  |
| ADR-0009 | Race Mode Excludes Warmup and Cooldown  | Proposed  |
| ADR-0010 | Session Lifecycle and Resumability      | Accepted  |
| ADR-0011 | Replay-Grade Persistence + Windowed Split | Accepted |
| ADR-0012 | Race Mode Non-Resumable                 | Proposed  |
| ADR-0013 | Race Canvas Mounts at ATTENTION         | Accepted  |
| ADR-0014 | E2E Per-Slice Gate with LLM Critique    | Accepted  |
| ADR-0015 | Trends Group by Workout Intent          | Accepted  |
| ADR-0016 | Trends Charts Touch-Native Scrubber     | Accepted  |
| ADR-0017 | Deterministic Replay Harness as CI Seam | Accepted  |
| ADR-0018 | Offline History as Packed Snapshot      | Accepted (amended by 0019) |
| ADR-0019 | Offline Reads Served from SW Cache      | Accepted (amended by 0020, 0021) |
| ADR-0020 | Reachability is Self-Healing and Owns Connectivity Recovery | Accepted (amended by 0021) |
| ADR-0021 | Boot is Local-First; Network is a Background Upgrade | Accepted  |
| ADR-0022 | CI and Release Packaging                | Accepted  |

Future candidates:
- **ADR-0008** — Serial protocol vs BLE FTMS (depends on firmware check)

See [`template.md`](template.md) to add a new ADR.
