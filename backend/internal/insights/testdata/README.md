# Insights test data

Session-samples fixtures for the detector tests. Each file carries the
workout (`mode`, `params`) and the `summary_json.samples` object the
detectors run on, including the analysis `window` finalise would store.

| File | Source |
|------|--------|
| `2026-06-11-5000m-reconstructed.json` | **Reconstructed, not real data.** The 11.06.2026 5000 m session from #36 (524 strokes, 5006 m, Ø 1:48 / 378 W / 28.6 SPM / 9.55 DPS) rebuilt from the numbers and charts in the issue by `traces/reconstruct_2026_06_11_5000m.py`: a 2:45 start bucket, a 1:46–1:50 body, DPS drifting 10.0 → 9.4 while SPM rises 27 → 29, watts sagging around 10:00–16:00, a final sprint and a 4-stroke overrun bucket. To be replaced by the export from the maintainer's database (#46). |
