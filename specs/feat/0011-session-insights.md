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
- `EfficiencyDriftDetector` (v1.1, #39) — Schlaglänge sinkt, Schlagzahl
  steigt, Tempo hält. Siehe nächster Abschnitt.

### Effizienzdrift (v1.1)

Das Muster "Schlag wird kürzer, Frequenz gleicht aus": DPS fällt über
das Stück, SPM steigt, der Split bleibt stehen. Pacing (EVEN_SPLIT)
und Fade (der Schlussspurt hebt die letzten 20 % über den Schnitt)
schweigen dazu, weil keiner von beiden auf Schlaglänge und Frequenz
schaut.

**Messung.** Über das Analysefenster wird das Mittel des ersten
Viertels der Buckets mit dem Mittel des letzten Viertels verglichen
(Viertel = `⌊n/4⌋` Buckets, mindestens 2; Fenster < 8 Buckets → kein
Finding):

| Größe | Definition |
|-------|------------|
| `dps1`, `dps2` | DPS-Mittel erstes / letztes Viertel |
| `dps_pct` | `(dps2 − dps1) / dps1 · 100` |
| `spm1`, `spm2` | SPM-Mittel erstes / letztes Viertel |
| `split1`, `split2` | Split-Mittel erstes / letztes Viertel |

Viertel-Mittel statt Regressions-Steigung: robust gegen die
Bucket-zu-Bucket-Streuung (±0,2 m DPS auf der synthetischen Fixture), ohne
Ausreißer-Sonderfälle, und direkt in der Nachricht vorlesbar
("von 9,97 auf 9,47 m"). Eine Steigung müsste erst in Anfangs- und
Endwert zurückübersetzt werden.

**Auslöser (alle drei):**

| Bedingung | Schwelle v1 | Warum |
|-----------|-------------|-------|
| Schlaglänge sinkt | `dps_pct ≤ −4 %` | Vorsichtig gewählt: liegt unter allen gemessenen Sessions (Sweep, siehe unten) |
| Frequenz gleicht aus | `spm2 − spm1 ≥ +1,0` | Ohne SPM-Anstieg ist sinkende DPS ein Leistungsverlust, kein Drift |
| Tempo hält | `\|split2 − split1\| ≤ 2 s` (= Pacing-Schwelle) | Wird der Split langsamer, erzählen POSITIVE_SPLIT bzw. FADE die Geschichte schon. Wird er schneller, ist der kürzere Schlag Folge einer gewollten Temposteigerung, kein Drift |

Zusätzlich: hat `FadeDetector` gefeuert, unterdrückt `Run` den Drift —
der Wattabfall ist dann bereits erklärt, kein Doppel-Finding.

**Sweep (20.10.2026, `cmd/insights-sweep`, alle gespeicherten
Sessions, Analysefenster aus den Stroke-Rows nachberechnet).**
8 Sessions, 6 messbar, **keine feuert**:

| Session | `dps_pct` | SPM-Anstieg | Split-Änderung | Fade |
|---------|-----------|-------------|----------------|------|
| 09.05.¹ | −2,7 % | +2,6 | −6,5 s | |
| 15.05. | −4,0 % | +2,4 | −5,2 s | |
| 17.05. | −2,3 % | +0,9 | ±0,0 s | |
| 23.05. | −2,2 % | +0,7 | −0,4 s | |
| 31.05. | +0,4 % | −3,8 | +16,1 s | ja |
| 11.06. | −2,4 % | +0,7 | +0,2 s | |

¹ ohne Stroke-Rows, daher ohne Fenster (volle Reihe).

Die 11.06.2026-Session, an der der Detector ursprünglich motiviert
wurde, misst auf den gespeicherten Daten −2,4 % / +0,7 — die früher
genannten −5,1 % / +2,1 stammten aus einer Rekonstruktion, die die
echten Daten nicht trifft. Die beiden Sessions mit dem stärksten
DPS-Abfall (09.05., 15.05.) sind gewollte Temposteigerungen; deshalb
ist die Tempo-Bedingung zweiseitig. Bei gehaltenem Tempo (17.05.,
23.05., 11.06.) liegt der Drift eng beieinander bei −2,2 bis −2,4 %
DPS und +0,7 bis +0,9 SPM — ein reales, wiederkehrendes Muster, aber
bei n = 3 und einem Ruderer noch keine Grundlage für eine Schwelle.

Die Schwellen sind daher **vorläufig (v1)**: vorsichtig, ohne
Fehlalarm, die Karte erscheint auf den bisherigen Daten nie. Neu
justieren, sobald ≥ 20 Sessions gespeichert sind (Sweep erneut
laufen lassen).

**Finding.** `detector_id: "drift"`, Code `EFFICIENCY_DRIFT`,
Severity NOTABLE, Kategorie EFFICIENCY. `evidence`: `dps1`, `dps2`,
`dps_pct`, `spm1`, `spm2`, `split1`, `split2`, `window_from`,
`window_to`.

**Synthese.** NOTABLE sortiert vor die INFO-Findings von Pacing und
Tempokonstanz; kein Gedankenstrich-Paar (" " als Konnektiv). Kein
Widerspruchs-Paar: Drift neben EVEN_SPLIT ist genau das Muster.

**Karte.** Label "Effizienz", Headline Schlaglänge in Prozent
(Beispiel mit Fixture-Werten: `DPS −5,0%`, gerechnet aus den zweistelligen DPS-Werten, die der
Synthese-Satz zeigt — sonst stünde `9,97 → 9,47` neben `−5,1%`), Stichwort die Kompensation (`SPM 27,5 → 29,6`) — die
absoluten DPS-Werte stehen im Synthese-Satz, die Karte bleibt bei zwei
Zeilen. Sparkline DPS und SPM über das Fenster (je eigene Skala).

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
haben keins. `cmd/insights-backfill` berechnet es für sie aus den
Stroke-Rows nach (gleiche Bucket-Größe wie die gespeicherten Samples),
schreibt es nach `summary_json.samples.window` und rechnet die
Insights neu; `cmd/insights-sweep` tut dasselbe nur lesend. Ohne
Stroke-Rows (kompaktiert) oder wenn die Arbeitsschläge nicht mehr in
die gespeicherte Reihe passen, bleibt die Session ohne Fenster und die
Detectors werten die volle Reihe aus.

Jedes Finding trägt die verwendeten Grenzen als `window_from` /
`window_to` in `evidence`.

Die CV-Schwellen 2 % / 5 % bleiben. Nachgeprüft auf der echten
11.06.2026-Session (Fixture aus #46): volle Reihe 6,0 % "ungleichmäßig",
im Fenster 3,0 % "gleichmäßig" — das passt zur EVEN_SPLIT-Pacing-Aussage
derselben Session.

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

**Widersprüche.** Manche Finding-Paare dürfen nicht gleichrangig
nebeneinanderstehen. Feuern beide, wird das zweite auf INFO
herabgestuft und direkt hinter das erste gestellt — in der Synthese
und in der Karten-Reihe (`insights.Reconcile`, tabellengetrieben wie
die Konnektiv-Map; läuft in `Run` und beim Lesen über die API, damit
auch vor dem Guard gespeicherte Rows ihn bekommen):

| Behalten     | Herabstufen  | Warum |
|--------------|--------------|-------|
| EVEN_SPLIT   | INCONSISTENT | Der CV ist dann fast immer randgetrieben (Anrudern, s. Analysefenster); die Hälften sind die robustere Aussage. |

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

- **Synthese-Absatz** als Lead-Text (1-2 Sätze) — die **einzige
  Prosa** der Sektion.
- **Karten-Reihe** darunter, die **Evidenz-Ebene**: eine Karte pro
  Finding mit Severity-Streifen (INFO grau, NOTABLE primär, ATTENTION
  tertiär), Kategorie-Label, der Schlüsselzahl als Headline und einem
  kurzen Stichwort — nie `message_de`, damit kein Satz doppelt auf der
  Seite steht (#40):

  | Code | Headline | Stichwort | Sparkline |
  |------|----------|-----------|-----------|
  | EVEN/POSITIVE/NEGATIVE_SPLIT | `1:48,3 / 1:47,8` bzw. `h1 → h2` | gleichmäßig / positiver / negativer Split | Split-Reihe, zweite Hälfte schattiert, h1/h2 als flache Linien |
  | CONSISTENT_HIGH/MID, INCONSISTENT | `Variation 2,0%` (wie „Split-Variation" im Template) | sehr gleichmäßig / gleichmäßig / ungleichmäßig | Split-Reihe mit Band Mittel ± 1 Std |
  | FADE | `−6,8%` | `378 → 352 W` | Watt-Reihe, letzte 20 % schattiert, Schnitt und Schlusswert als Linien |

- **Sparkline** (SVG, `components/charts/path.ts`) aus den Samples,
  die die Detail-Seite ohnehin lädt — kein Backend-Change, `evidence`
  bleibt skalar. Die Reihe ist auf das Analysefenster geschnitten
  (`window_from`/`window_to` aus `evidence`, sonst `samples.window`,
  sonst volle Reihe). Ohne Samples: Karte ohne Sparkline.
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
| EFFICIENCY_DRIFT | `Effizienzdrift: Schlaglänge von {dps1} auf {dps2} m gesunken, Schlagzahl von {spm1} auf {spm2} gestiegen.` (DPS zwei, SPM eine Nachkommastelle) |

## Non-goals

- **Coaching-Empfehlungen / Suggestion-Engine** — der
  Empfehlungs-Block aus dem Brainstorming (POSITIVE_SPLIT+FADE →
  Cue) ist FEAT-0011a, nicht v1.
- ~~**EfficiencyDriftDetector** (Watt/SZ-Trend) — später, sobald
  Schwellen mit echten Daten getunt sind.~~ Mit v1.1 drin (#39), siehe
  §Effizienzdrift; Schwellen vorläufig bis ≥ 20 Sessions.
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
- ~~Sparkline pro Karte aus `evidence` — Stretch oder Cut?~~
  Entschieden (#40): drin. Karten sind die Evidenz-Ebene (Label,
  Schlüsselzahl, Sparkline aus den Session-Samples), die Synthese ist
  die einzige Prosa.
- Soll die Synthese die Session-Distanz erwähnen ("über 2480 m")
  oder rein qualitativ bleiben?
- ATTENTION-Schwelle bei Fade evtl. zweistufig (5% NOTABLE,
  10% ATTENTION) — nach erstem Daten-Sweep entscheiden.
