# FEAT-0005a: Workout-Auswahl (kombinierter Builder/Library)

- **Status**: Shipped
- **Depends on**: FEAT-0001 (Live View), FEAT-0007 (Metrics), FEAT-0008 (Design System)

## Reference

Authoritative visual prototype: Stitch project `16112355480769913997`
screens **"Workout-Auswahl: Ziel (1/4) Refined Fix"**,
**"Workout-Auswahl: Distanz (2/3) Refined"**, **"Workout-Auswahl: Zeit
(2/3)"**, **"Workout-Auswahl: Pyramide (2/3)"**, **"Workout-Auswahl:
Intensität (3/4) Refined V2"**, **"Workout-Auswahl: Intervalle
Konfiguration (3/4)"**, **"Workout-Auswahl: Bereit? Refined"**, plus
**"Live-Ansicht: Workout Aktiv"** and the five **"Workout abgeschlossen"**
variants (Geschafft / Neue Bestzeit / Effizienz-Profi / Konstanz-Meister
/ Power-Peak).

## Summary

Ein einziger geführter Flow von maximal 4 Schritten, um vor einer Session ein
Workout zu wählen oder zu konfigurieren. Keine Trennung zwischen "Library" und
"Builder" — Presets und Custom-Konfiguration liegen im selben Flow. Einstieg:
"Workout starten"-Button in der Live-Ansicht (über "Session beenden").

## User stories

- Als Ruderer möchte ich **sofort losrudern** können, ohne ein Workout zu
  konfigurieren ("Nur rudern" / Just-Row-Mode).
- Als Ruderer möchte ich **das letzte Workout wiederholen**, ohne erneut
  durch den Flow zu gehen.
- Als Ruderer möchte ich aus **Standard-Workouts** (Distanz, Zeit, Intervall,
  Pyramide) mit Presets wählen, um in < 15 s eine Session zu starten.
- Als Ruderer möchte ich für jeden Workout-Typ auch **eigene Parameter**
  setzen, ohne den Flow zu wechseln.
- Während der Session möchte ich **sehen, wo ich im Workout bin** (Segment,
  Restzeit, Fortschritt), ohne die Live-Metriken aus den Augen zu verlieren.

## Flow

### Step 1 — Workout-Typ (immer)

Auswahl per Chips/Cards:

- **Nur rudern** → überspringt alle Steps, startet Just-Row-Mode
- **Letztes Workout wiederholen** (nur wenn vorhanden) → überspringt alle Steps
- **Distanz**
- **Zeit**
- **Intervalle**
- **Pyramide**

### Step 2 — Dimension / Preset (branch-abhängig)

Jeweils Preset-Chips plus "Eigene" als Ausgang zu Step 4.

- **Distanz**: 500 m / 1 km / 2 km / 5 km / 6 km / 10 km / HM / Marathon / Eigene
- **Zeit**: 10 / 20 / 30 / 45 / 60 min / Eigene
- **Intervalle**: 8×500 m / 5×1000 m / 4×2000 m / 6×1 min / 4×4 min / Eigene
- **Pyramide**: Zeit- / Distanz- / Endurance- / Schlag-Pyramide / Eigene

### Step 3 — Intensität (immer bei Nicht-Just-Row)

Vier Stufen:

- Locker / Moderat / Hart / All-out

Optional collapsible: Ziel-Split (`MM:SS.s`) und Ziel-SPM, mit sinnvollen
Defaults je Intensitätsstufe.

### Step 4 — Nur bei "Eigene"

- **Intervalle**: Anzahl, Länge (Meter/Minuten-Toggle), Pause
- **Pyramide**: Einheit (Minuten/Meter/Schläge), Stufen, Spitze, Pausen-Modus

### Confirmation-Screen (bei Nicht-Just-Row)

- Summary-Card: Workout-Titel, Intensität, Ziel-Split, Gesamtdauer
- Horizontale Timeline mit Segmenten (Work accent, Rest muted, Warm-up/Cool-down dashed)
- Optionale Toggles: Warm-up (5 min), Cool-down (5 min), "Als Favorit speichern"
- Buttons: **Workout starten** (primary), **Anpassen** (zurück zu Step 3), **Standard** (reset)

## Live-View mit aktivem Workout

- Dünner **Workout-Progress-Strip** direkt unter der Status-Bar
  (Segmente als colored blocks, 2 px Position-Marker)
- Über dem Hero eine Status-Zeile: `Intervall 3 / 8 · 500 m` +
  Segment-Time-Remaining (accent-Farbe wenn < 10 s)
- Segment-Übergänge mit Haptik + optional Audio-Cue
- Workout-Abschluss: Full-Screen "Geschafft!"-State mit Stats-Übersicht,
  Buttons **Session beenden** / **Weiter rudern**

## Acceptance criteria

- [ ] Der Flow ist ab Live-View in ≤ 2 Taps für "Nur rudern" oder
      "Letztes Workout wiederholen" durchlaufbar.
- [ ] Ein Preset-Workout (z. B. 2 km, moderat) ist in ≤ 4 Taps ab Live-View
      gestartet (Typ → Preset → Intensität → Start).
- [ ] "Eigene" führt zu Step 4 pro Branch; Presets überspringen Step 4.
- [ ] Custom-Parameter werden auf sinnvolle Wertebereiche validiert
      (Anzahl > 0, Länge > 0, Pause ≥ 0).
- [ ] Confirmation-Screen zeigt die Timeline nur bei Nicht-Just-Row;
      Just-Row startet ohne Confirmation.
- [ ] "Als Favorit speichern" persistiert das Workout mit benutzerdefiniertem
      Namen und taucht in Step 1 als zusätzliche Option ("Favoriten") auf.
- [ ] Live-View bei aktivem Workout zeigt Progress-Strip, Segment-Label und
      Segment-Time-Remaining durchgehend synchron zur SSE-Uhr.
- [ ] Segment-Übergänge lösen Haptik aus (Web Vibration API, wenn verfügbar);
      Audio-Cue ist per Setting aktivierbar.
- [ ] "Workout abbrechen" in der Live-View fällt zurück auf Just-Row,
      behält aber die Session — der Benutzer rudert ohne Struktur weiter.
- [ ] Abschluss-Screen zeigt Soll-vs-Ist pro Segment (Split, Zeit, Distanz).

## UX notes

- Schritt-Indikator (z. B. `2 / 4`) ist sichtbar, aber dezent.
- Back-Button / Swipe-Geste auf jedem Step.
- Presets sind als Chips — Tap startet Auswahl, Doppeltap springt direkt in
  die Confirmation (Default-Intensität "Moderat").
- Defaults je Intensitätsstufe für Split/SPM stammen aus FEAT-0004 (User
  Statistics), wenn vorhanden, sonst aus einer konservativen Tabelle.
- Farben für Work/Rest/Warm-up/Cool-down kommen aus dem Design System
  (FEAT-0008), nicht hardcoded.

## Non-goals

- Trainingspläne über mehrere Sessions ("Prepare for a 5k")
- Coach-prescribed Workouts / externe Plan-Importe
- Social-Features (geteilte Workouts, Challenges)
- Automatische Workout-Vorschläge auf Basis der Ziele aus FEAT-0005
  (das gehört dort hin, nicht hier)

## Open questions

- Wie tief darf "Anpassen" zurückspringen — Step 3 (Intensität) oder Step 2
  (Preset)? Vorschlag oben: Step 3.
- Pause bei Intervallen: nur Zeit oder auch "rudern mit niedriger SPM"?
- Pyramiden-Defaults: reichen vier Presets oder brauchen wir einen
  parametrischen Generator (z. B. 1-2-3-4-3-2-1 min) ohne Custom?
- Workout-History: brauchen wir bereits in M-?? eine "Letzte 5 Workouts"-Liste
  in Step 1, oder reicht "Letztes wiederholen" + "Favoriten"?
- Abschluss-Screen bei abgebrochenem Workout — Stats bis Abbruch zeigen oder
  nur "abgebrochen"?
