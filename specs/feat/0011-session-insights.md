# FEAT-0011: Session Insights

- **Status**: Draft
- **Owner**: @gloeckner-daniel
- **Depends on**: FEAT-0003 (session history), FEAT-0007 (metrics
  catalogue), FEAT-0009 (cleanup — consumes `on_session_change`),
  FEAT-0005a (workout selection — mode + intensity), ADR-0008
  (cleanup & derived stats)
- **Referenced by**: —

## Summary

Eine regelbasierte Auswertung pro Session, die kurze, deutsche
Beobachtungen ("Findings") über Pacing, Leistungsabfall und
Tempokonstanz erzeugt und sie auf der Session-Detail-Seite als
Karten plus eine Synthese-Zusammenfassung darstellt. Findings werden
einmalig bei `session_end` aus den vor-aggregierten
`summary_json.samples` (5-Schlag-Buckets) berechnet, in einer
eigenen Tabelle persistiert und über `on_session_change` invalidiert
und neu berechnet, wenn sich die Session ändert. Self-sufficient
rows mit Snapshot-Werten in `evidence_json` — keine Stroke-Daten
nötig nach session_end.

## User stories

- Als Ruderer möchte ich nach jeder Einheit in 1-2 Sätzen verstehen,
  *wie* ich gerudert bin (gleichmäßig, eingebrochen, positiver Split),
  ohne Charts selbst interpretieren zu müssen.
- Als Ruderer möchte ich Karten sehen, die genau eine Beobachtung
  enthalten (Pacing, Leistungsabfall, Tempokonstanz), damit ich
  Schwächen gezielt erkennen kann.
- Als Ruderer möchte ich, dass Insights nach dem Löschen oder Ändern
  einer Session konsistent bleiben (analog zu PBs).

## Architecture

### Detector-Pipeline

Drei Detectors für v1, jeder als reine Funktion über
`summary_json.samples` plus Session-Metadaten (workout, intensity).
Alle drei werten nur das **Analysefenster** aus (siehe unten):

- `PacingDetector` — Mittelwert der Splits in erster vs zweiter
  Hälfte des Fensters. Delta `> +2s` → POSITIVE_SPLIT (NOTABLE),
  `< -2s` → NEGATIVE_SPLIT (INFO), sonst EVEN_SPLIT (INFO).
- `FadeDetector` — Watt-Mittel im letzten 20%-Segment des Fensters
  vs Fenster-Mittel. Drop `> 5%` → FADE (ATTENTION).
- `ConsistencyDetector` — Variationskoeffizient (CV) der Splits im
  Fenster. `< 2%` → "sehr gleichmäßig" (INFO), `< 5%` →
  "gleichmäßig" (INFO), `≥ 5%` → "ungleichmäßig" (NOTABLE).

### Analysefenster

Zwei Teile jeder Session zeigen nicht, wie gerudert wurde, und
bleiben deshalb per Domänenregel (nicht per statistischem Trimmen)
außen vor:

- **Anrudern.** Der erste Bucket bringt das Boot (das
  Wasser-Schwungrad) auf Tempo; die Konsole meldet den Split aus dem
  Stand. Auf der 5000-m-Session vom 11.06.2026 liegt er bei ~2:40
  gegen 1:48 im Rest und trägt allein ~4,5 der gemeldeten 6,0 % CV.
- **Auslaufen.** Bei Distanz- und Zeit-Workouts zieht der Ruderer
  nach dem Ziel noch ein paar Schläge (5000 m Ziel, 5006 m geloggt).

Das Fenster ist ein halboffener Bucket-Bereich `[from, to)`:

| Grenze | Regel |
|--------|-------|
| `from` | immer `1` — der erste Bucket (`bucket_strokes` Schläge) fällt weg. Kein Tuning-Parameter (Entscheidung auf #37). |
| `to`   | `distance`: nach dem Bucket mit dem ersten Schlag, dessen Arbeitsdistanz ≥ Ziel ist. `time`: dito mit der Arbeitszeit. `just_row`, `race` (Schläge nach dem Zielhorn sind bereits Cooldown) und eine Session, die vor dem Ziel endet: letzter Bucket. Der Bucket, der das Ziel erreicht, gehört dazu. |

Ziel-Distanz und -Zeit zählen ab Ende des Warmups. Bliebe ein
Fenster mit weniger als zwei Buckets, gilt die volle Reihe.

Berechnet bei Finalise aus den Arbeitsschlägen und gespeichert als
`summary_json.samples.window = {"from": 1, "to": 104}`; der
Samples-Endpoint liefert es mit aus. Die volle Reihe bleibt für die
Charts erhalten. Sessions, die vor dem Fenster finalisiert wurden,
haben keins — die Detectors werten dann wie bisher die volle Reihe
aus. Bestehende `session_insights`-Rows werden nicht migriert; ein
erneutes Finalise berechnet sie neu, solange die Stroke-Rows noch
existieren.

Jedes Finding trägt die verwendeten Grenzen als `window_from` /
`window_to` in `evidence`.

Die CV-Schwellen 2 % / 5 % bleiben. Nachgeprüft auf der (bis zum
Export aus #46 rekonstruierten) 11.06.2026-Session: volle Reihe
5,7 % "ungleichmäßig", im Fenster 2,0 % — das passt zur
EVEN_SPLIT-Pacing-Aussage derselben Session.

Jeder Detector emittiert ein `Finding`:

```go
type Finding struct {
    DetectorID string             // "pacing" | "fade" | "consistency"
    Severity   Severity           // INFO | NOTABLE | ATTENTION
    Category   Category           // PACING | EFFICIENCY | CONSISTENCY
    Code       string             // "POSITIVE_SPLIT", "FADE", ...
    MessageDE  string             // gerendertes Template
    Evidence   map[string]float64 // h1, h2, delta, cv, ...
}
```

### Eligibility-Gate

Detectors laufen nur wenn:

- `workout.mode != "intervals"` (Sägezahn-Profil ungeeignet)
- Session-Dauer `≥ 5 min` UND Distanz `≥ 1000 m`

Bei Intervalls oder zu kurzen Sessions: keine Findings, UI-Sektion
zeigt deutschsprachigen Hinweis ("Insights für Intervalle in
Vorbereitung" / "Session zu kurz für Auswertung").

### Synthese-Absatz

Findings werden nach Severity (ATTENTION > NOTABLE > INFO) sortiert,
die Top 2-3 über eine deterministische Konnektiv-Map verbunden:

| Kombination                | Konnektiv |
|----------------------------|-----------|
| POSITIVE_SPLIT + FADE      | " — "     |
| FADE + INCONSISTENT        | " — "     |
| sonst                      | " "       |

Komplett hardcoded in `splits/insights/synthesis.go`. Kein LLM.

### Storage

Neue Tabelle `session_insights` (Migration 0013):

```sql
CREATE TABLE session_insights (
  id           INTEGER PRIMARY KEY,
  rower_id     TEXT NOT NULL REFERENCES rowers(id),
  session_id   INTEGER NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  detector_id  TEXT NOT NULL,
  code         TEXT NOT NULL,
  severity     TEXT NOT NULL,
  category     TEXT NOT NULL,
  message_de   TEXT NOT NULL,
  evidence_json TEXT NOT NULL,
  computed_at  TEXT NOT NULL,
  UNIQUE(session_id, detector_id)
);
CREATE INDEX idx_session_insights_rower ON session_insights(rower_id, computed_at DESC);
```

Self-sufficient rows: alle Werte für die Karte stecken in
`message_de` + `evidence_json`. Keine Joins zur Stroke-Tabelle nötig.

### Recompute

Hängt an `stats.OnSessionChange`:

- `SessionEnd` → Detectors laufen, Rows einfügen.
- `SessionUpdate` / `SessionDelete` → bestehende Rows für
  `session_id` löschen, bei Update neu berechnen.

Recompute läuft im bestehenden `RecomputeScheduler` (kein
HTTP-Blocking). Failing Detector loggt Warnung und überspringt sich
selbst — andere Detectors laufen weiter.

**Backfill für Bestands-Sessions**: einmaliger Migration-Job nach
0013 iteriert über alle Sessions mit verfügbarem `summary_json` und
ruft die Insights-Pipeline auf. Sessions ohne `samples` (zu alt,
fehlerhaft) werden übersprungen — kein Hard-Fail.

Templates werden server-seitig in `message_de` gerendert (inkl.
Komma-Dezimal, Split-Format `m:ss,t`). UI rendert nur den String.

### API

`GET /api/sessions/:id/insights` →

```json
{
  "findings": [
    {
      "detector_id": "pacing",
      "code": "POSITIVE_SPLIT",
      "severity": "NOTABLE",
      "category": "PACING",
      "message_de": "Positiver Split: …",
      "evidence": {"h1": 119.6, "h2": 123.2, "delta": 3.6,
                   "window_from": 1, "window_to": 104}
    }
  ],
  "synthesis_de": "Konstanter Schlagrhythmus zu Beginn, aber Tempoabfall …"
}
```

Bei nicht-eligibler Session: `findings: []`, `synthesis_de: ""`,
`reason: "intervals" | "too_short"`.

## UX

Auf Session-Detail-Page neue Sektion "Auswertung" zwischen Header
und Charts:

- **Synthese-Absatz** als Lead-Text (1-2 Sätze).
- **Karten-Reihe** darunter: eine Karte pro Finding. Karte zeigt
  Severity-Farbe (INFO grau, NOTABLE blau, ATTENTION orange),
  Detector-Icon, `message_de` als Body. Optional kleines Sparkline
  aus `evidence` (Stretch).
- Bei nicht-eligibler Session: stattdessen ein Hinweis-Block.

Synthese und Karten teilen sich dieselbe `findings`-Liste — eine
einzige API-Antwort speist beide.

## Acceptance criteria

- [ ] Migration 0013 erstellt Tabelle `session_insights` mit
      Foreign-Key-Cascade.
- [ ] Drei Detectors (`pacing`, `fade`, `consistency`) als reine
      Funktionen mit Tabellen-Tests gegen synthetische Sample-Reihen.
- [ ] `OnSessionChange` triggert Insights-Recompute beim
      `SessionEnd`/`SessionUpdate` und Cleanup beim
      `SessionDelete`.
- [ ] Eligibility-Gate korrekt: Sessions mit
      `workout.mode == "intervals"` oder `<5min` oder `<1000m`
      erzeugen keine Findings.
- [ ] `GET /api/sessions/:id/insights` liefert Findings + Synthese,
      bei nicht-eligibler Session leere Liste mit `reason`.
- [ ] Session-Detail-UI zeigt Synthese-Absatz und Karten in der
      vereinbarten Reihenfolge (Severity-sortiert).
- [ ] Session löschen entfernt zugehörige Insight-Rows
      (Cascade-Test).
- [ ] Recompute idempotent: zweimaliger Aufruf ergibt identische
      Rows (UNIQUE-Constraint hält).
- [ ] Deutsche Templates (Komma-Dezimal, "SZ", "Tempoabfall",
      "Leistungsabfall") wie in Spec-Anhang.

## Templates (de_DE)

Alle Zahlen mit Komma-Dezimal, Splits als `m:ss,t`.

| Code            | Template |
|-----------------|----------|
| POSITIVE_SPLIT  | `Positiver Split: Zweite Hälfte im Schnitt {delta}s langsamer als die erste ({h1} → {h2}).` |
| NEGATIVE_SPLIT  | `Negativer Split: Steigerung um {delta}s in der zweiten Hälfte ({h1} → {h2}).` |
| EVEN_SPLIT      | `Gleichmäßiges Tempo über beide Hälften ({h1} / {h2}).` |
| FADE            | `Leistungsabfall von {pct}% im Schlussabschnitt ({avg}W Schnitt → {final}W).` |
| CONSISTENT_HIGH | `Tempokonstanz: sehr gleichmäßig (Split-Variation {cv}%).` |
| CONSISTENT_MID  | `Tempokonstanz: gleichmäßig (Split-Variation {cv}%).` |
| INCONSISTENT    | `Tempokonstanz: ungleichmäßig (Split-Variation {cv}%).` |

## Non-goals

- **Coaching-Empfehlungen / Suggestion-Engine** — der
  Empfehlungs-Block aus dem Brainstorming (POSITIVE_SPLIT+FADE →
  Cue) ist FEAT-0011a, nicht v1.
- **EfficiencyDriftDetector** (Watt/SZ-Trend) — später, sobald
  Schwellen mit echten Daten getunt sind.
- **BaselineComparisonDetector** (30-Tage-Schnitt) — später als
  FEAT-0011b.
- **Intervall-spezifische Insights** (per-Intervall Pacing/Fade) —
  separater Scope.
- **Workout-Type-aware Schwellen** — Schwellen v1 hardcoded; pro
  Intensity erst wenn Datenmenge das rechtfertigt.
- **History-List Badges** — Sessions-Liste bleibt unverändert; Badges
  optional als FEAT-0011a.
- **LLM-generierte Texte** — Templates komplett deterministisch.
- **Cross-Session-Aggregate** ("Wie oft hatte ich Fade?") — Tabelle
  ist auf Cross-Session-Queries vorbereitet, UI dafür nicht v1.

## Open questions

- ~~Anrudern und Auslaufen verfälschen Pacing, Fade und CV — trimmen
  oder per Regel ausschließen?~~ Entschieden (#37): Analysefenster,
  erster Bucket fällt weg, Ende am Ziel. Kein statistisches Trimmen,
  keine neuen Schwellen.
- Sparkline pro Karte aus `evidence` — Stretch oder Cut?
- Soll die Synthese die Session-Distanz erwähnen ("über 2480 m")
  oder rein qualitativ bleiben?
- ATTENTION-Schwelle bei Fade evtl. zweistufig (5% NOTABLE,
  10% ATTENTION) — nach erstem Daten-Sweep entscheiden.
