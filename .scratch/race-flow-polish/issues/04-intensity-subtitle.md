# 0015-04 — Step3Intensity mode-aware subtitle

Status: ready-for-agent

- **Type**: AFK
- **Parent**: [PRD-0015](../PRD.md)

## What to build

The Intensität picker title gives no explanation of what it actually
controls. The meaning is in fact mode-dependent: in distance/time mode
it sets the rower's own target Split/SPM bracket (rendered on the live
stat bar); in race mode it sets the **synthetic ghost's** target split
via `race.SynthGhost(meters, intensity)`.

Add a mode-aware subtitle under the "Intensität" title:

- **race** → *"Wie schnell dein synthetischer Geist rudert."*
- **non-race (distance / time)** → *"Dein Zieltempo — Split und Schlagzahl auf der Live-Anzeige."*

The per-card Split/SPM bracket numbers are unchanged — the subtitle
reframes their meaning by mode. The mode is already available via
`WorkoutFlowProvider`.

## Acceptance criteria

- [ ] A subtitle renders directly under the "Intensität" title on the picker screen.
- [ ] In race mode the subtitle text is *"Wie schnell dein synthetischer Geist rudert."*.
- [ ] In distance and time modes the subtitle text is *"Dein Zieltempo — Split und Schlagzahl auf der Live-Anzeige."*.
- [ ] The per-card Split/SPM bracket numbers are unchanged.
- [ ] Component test renders Step3Intensity in race mode → asserts the synth-ghost subtitle string.
- [ ] Component test renders Step3Intensity in distance/time mode → asserts the target-bracket subtitle string.

## Blocked by

None — can start immediately.
