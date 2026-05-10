 # Domain glossary

Rowing is a German-speaking sport in our context (FRGS is in Frankfurt);
domain-facing strings in the UI may use German. Code identifiers are
English.

## Rowing vocabulary

| English (code)     | Deutsch (UI)          | Note                                                                |
|--------------------|-----------------------|---------------------------------------------------------------------|
| Session            | Trainingseinheit      | A single workout on the ergo.                                       |
| Stroke             | Schlag                | One full catch → drive → finish → recovery cycle.                   |
| Stroke rate (SPM)  | Schlagfrequenz        | Strokes per minute. Abbreviation `SPM` is standard in both.         |
| Split              | Split / 500-m-Zeit    | Time to cover 500 m at current pace, formatted `m:ss.t`. *Live* split is computed over a sliding window of distance covered (provisional 5 s in v1, value TBD pending replay-harness validation); per-stroke extrapolation `500/dps·cycleSec` is retired (ADR-0011). Holds previous value when the window has fewer than two strokes. |
| Pace               | Pace                  | Synonymous with split in casual use.                                |
| Power              | Leistung              | Displayed in watts (`W`).                                           |
| Heart rate (HR)    | Herzfrequenz          | In bpm. Requires a paired HR belt.                                  |
| Drive              | Zug / Durchzug        | The "work" phase of the stroke.                                     |
| Recovery           | Rollsitz / Auslage    | The return phase; longer than the drive in efficient rowing.        |
| Catch              | Auslage               | Start of the drive.                                                 |
| Finish             | Endzug                | End of the drive.                                                   |
| Resistance level   | Widerstandsstufe      | The IPM supports levels 1–16 (water-resistance adjuster).           |
| Ergometer / ergo   | Ergometer / Ergo      | The indoor rowing machine itself.                                   |
| Personal best (PB) | Persönliche Bestzeit  | Best time over a standard distance.                                 |

## Standard distances

These are the PB distances FEAT-0004 tracks:

- 500 m — sprint
- 1 000 m — middle distance
- 2 000 m — the "classic" competitive distance (= Olympic on-water length)
- 5 000 m — longer tempo
- 6 000 m — common training distance
- 10 000 m — long endurance

Standard times (5/10/30/60 minutes) are plausible future additions — not
in v1.

## Units

- Distance: metres (`m`) or kilometres (`km`) for long totals
- Time: `h:mm:ss` for session total, `m:ss.t` for splits
- Power: watts (`W`)
- HR: beats per minute (`bpm`)
- SPM: strokes per minute (bare number, "SPM" suffix optional)
