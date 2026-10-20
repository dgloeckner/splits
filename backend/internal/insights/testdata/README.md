# Insights test data

Session-samples fixtures for the detector tests. Each file carries the
workout (`mode`, `params`) and the `summary_json.samples` object the
detectors run on, including the analysis `window` finalise would store.

| File | Source |
|------|--------|
| `2026-06-11-5000m.json` | **Real data** (#46). The 11.06.2026 21:27 5000 m distance session from #36 (524 work strokes, 5006 m, 18:07, Ø 1:48 / 378 W / 28.6 SPM / 9.55 DPS), exported from the production database on 20.10.2026. The samples are rebuilt from the session's stroke rows with `stats.ComputeSamples` and the window with `storage.BackfillAnalysisWindow` (v0.2.0), so they match what finalise stores today (decimal SPM buckets, #44). Metrics only: no rower name or id. It replaces an earlier reconstruction from the issue's screenshots that overstated the DPS drift (−5 % vs −2.4 %) and understated the split variation (CV 2,0 % vs 3,0 %). |
