import { useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import {
  getRowerAchievements,
  getRowerPBs,
  type Achievement,
  type RowerPBs,
} from '../../api/client'
import { useActiveRower } from '../../hooks/useActiveRower'
import { mmssWhole } from '../../util/format'
import styles from './RekordeTab.module.css'

export function RekordeTab() {
  const active = useActiveRower()
  const rowerID = active.data?.id
  const nav = useNavigate()

  const pbsQ = useQuery<RowerPBs>({
    queryKey: ['rower-pbs', rowerID],
    queryFn: () => getRowerPBs(rowerID!),
    enabled: !!rowerID,
  })
  const achievementsQ = useQuery<Achievement[]>({
    queryKey: ['rower-achievements', rowerID],
    queryFn: () => getRowerAchievements(rowerID!),
    enabled: !!rowerID,
  })

  // Deep-link from PBOverlay: scroll the matching PB row into view and flash it.
  // Re-runs when PB data resolves, so the lookup happens after rows are mounted.
  // The DOM lookup is idempotent (no-op when no match), so multiple runs are safe.
  const pbsReady = pbsQ.data ? pbsQ.data.distance.length + pbsQ.data.window.length : 0
  useEffect(() => {
    if (typeof window === 'undefined') return
    const hash = window.location.hash
    if (!hash) return
    const id = hash.slice(1)
    const raf =
      typeof window.requestAnimationFrame === 'function'
        ? window.requestAnimationFrame(() => flashRow(id))
        : (window.setTimeout(() => flashRow(id), 0) as unknown as number)
    return () => {
      if (typeof window.cancelAnimationFrame === 'function') {
        window.cancelAnimationFrame(raf)
      } else {
        window.clearTimeout(raf)
      }
    }
  }, [pbsReady])

  if (!rowerID || pbsQ.isPending) {
    return <p className={styles.empty}>Bestleistungen werden geladen …</p>
  }
  const pbs = pbsQ.data
  if (!pbs) return null

  const distanceByM = new Map(pbs.distance.map((d) => [d.distance_m, d]))
  const milestones = (achievementsQ.data ?? []).filter((a) => a.type === 'volume')

  const isEmpty =
    pbs.distance.length === 0 &&
    pbs.window.length === 0 &&
    pbs.workout.length === 0 &&
    milestones.length === 0

  if (isEmpty) {
    // F8: match the Trends empty-state pattern — copy + tappable
    // next-action pill. The bare-text version below had no affordance
    // and read as a dead end.
    return (
      <div className={styles.empty} data-testid="rekorde-empty">
        <p className={styles.emptyText}>Noch keine Bestleistungen.</p>
        <button
          type="button"
          className={styles.startBtn}
          onClick={() => nav('/')}
        >
          Workout starten
        </button>
      </div>
    )
  }

  const newest = pickNewest(pbs, achievementsQ.data ?? [])
  const timeline = buildTimeline(pbs, achievementsQ.data ?? [])

  return (
    <>
      {newest && <HeroCard item={newest} />}
      <DistanceGrid byM={distanceByM} />
      {pbs.window.length > 0 && <WindowSection items={pbs.window} />}
      {pbs.workout.length > 0 && <WorkoutSection items={pbs.workout} />}
      {milestones.length > 0 && <MilestonesStrip items={milestones} />}
      {timeline.length > 0 && <Timeline items={timeline} />}
    </>
  )
}

function flashRow(id: string): void {
  const el = document.getElementById(id)
  if (!el) return
  if (typeof el.scrollIntoView === 'function') {
    el.scrollIntoView({ behavior: 'smooth', block: 'center' })
  }
  el.classList.add(styles.flash)
  window.setTimeout(() => el.classList.remove(styles.flash), 2000)
}

type TimelineItem = {
  id: string
  emoji: string
  label: string
  achievedAt: string
}

type HeroItem = TimelineItem & {
  eyebrow: string
  chip: string
  value: string
  unit?: string
  delta?: string
}

function pickNewest(pbs: RowerPBs, achievements: Achievement[]): HeroItem | null {
  let best: HeroItem | null = null
  const consider = (h: HeroItem) => {
    if (!best || h.achievedAt > best.achievedAt) best = h
  }
  for (const d of pbs.distance) {
    consider({
      id: `dist-${d.distance_m}`,
      emoji: '🏆',
      label: `Neue Bestzeit · ${distanceLabel(d.distance_m)}`,
      achievedAt: d.source_session_started_at || d.achieved_at,
      eyebrow: 'NEUESTER ERFOLG',
      chip: `🏆 NEUE BESTZEIT · ${distanceLabel(d.distance_m).toUpperCase()}`,
      value: mmssWhole(d.time_sec),
      unit: 'min',
      delta: deltaSeconds(d.time_sec, d.previous_time_sec),
    })
  }
  for (const w of pbs.window) {
    consider({
      id: `win-${w.metric}-${w.window_size}`,
      emoji: '🏆',
      label: `Bestleistung · ${windowLabel(w)}`,
      achievedAt: w.source_session_started_at || w.achieved_at,
      eyebrow: 'NEUESTER ERFOLG',
      chip: `🏆 ${windowLabel(w).toUpperCase()}`,
      value: windowValue(w).split(' ')[0],
      unit: windowValue(w).split(' ').slice(1).join(' ') || undefined,
      delta: deltaWindow(w),
    })
  }
  for (const w of pbs.workout) {
    consider({
      id: `wo-${w.shape_hash}`,
      emoji: '🏆',
      label: `Workout-PB · ${workoutPBLabel(w)}`,
      achievedAt: w.source_session_started_at || w.achieved_at,
      eyebrow: 'NEUESTER ERFOLG',
      chip: `🏆 ${workoutPBLabel(w).toUpperCase()}`,
      value: Math.round(w.value).toLocaleString('de-DE'),
      unit: 'm',
      delta: w.previous_value !== undefined && Math.round(w.value - w.previous_value) !== 0
        ? `${w.value > w.previous_value ? '+' : '−'}${Math.abs(Math.round(w.value - w.previous_value)).toLocaleString('de-DE')} m`
        : undefined,
    })
  }
  for (const a of achievements) {
    consider({
      id: `ach-${a.key}`,
      emoji: '🏆',
      label: achievementLabel(a),
      achievedAt: a.source_session_started_at || a.achieved_at,
      eyebrow: 'NEUESTER ERFOLG',
      chip: `🏆 ${achievementLabel(a).toUpperCase()}`,
      value: achievementValueText(a),
    })
  }
  return best
}

function buildTimeline(pbs: RowerPBs, achievements: Achievement[]): TimelineItem[] {
  const items: TimelineItem[] = []
  for (const d of pbs.distance) {
    items.push({
      id: `dist-${d.distance_m}`,
      emoji: '🏆',
      label: `Neue Bestzeit · ${distanceLabel(d.distance_m)} · ${mmssWhole(d.time_sec)}`,
      achievedAt: d.source_session_started_at || d.achieved_at,
    })
  }
  for (const w of pbs.window) {
    items.push({
      id: `win-${w.metric}-${w.window_size}`,
      emoji: '🏆',
      label: `Bestleistung · ${windowLabel(w)} · ${windowValue(w)}`,
      achievedAt: w.source_session_started_at || w.achieved_at,
    })
  }
  for (const w of pbs.workout) {
    items.push({
      id: `wo-${w.shape_hash}`,
      emoji: '🏆',
      label: `Workout-PB · ${workoutPBLabel(w)} · ${Math.round(w.value).toLocaleString('de-DE')} m`,
      achievedAt: w.source_session_started_at || w.achieved_at,
    })
  }
  for (const a of achievements) {
    items.push({
      id: `ach-${a.key}`,
      emoji: '🏆',
      label: achievementLabel(a),
      achievedAt: a.source_session_started_at || a.achieved_at,
    })
  }
  items.sort((x, y) => (x.achievedAt < y.achievedAt ? 1 : -1))
  return items
}

function HeroCard({ item }: { item: HeroItem }) {
  return (
    <section className={styles.heroCard}>
      <span className={styles.heroEyebrow}>{item.eyebrow}</span>
      <span className={styles.heroChip}>{item.chip}</span>
      <div className={styles.heroValueRow}>
        <span className={styles.heroValue}>{item.value}</span>
        {item.unit && <span className={styles.heroUnit}>{item.unit}</span>}
      </div>
      <div className={styles.heroFooter}>
        <span className={styles.heroDate}>{formatRelative(item.achievedAt)}</span>
        {item.delta && <span className={styles.heroDelta}>{item.delta} vs. vorher</span>}
      </div>
    </section>
  )
}

function Timeline({ items }: { items: TimelineItem[] }) {
  return (
    <section className={styles.section}>
      <h2 className={styles.sectionLabel}>Achievement-Verlauf</h2>
      <div className={styles.timeline}>
        {items.slice(0, 8).map((it) => (
          <div key={it.id} className={styles.timelineRow}>
            <div className={styles.timelineMain}>
              <span className={styles.timelineLabel}>
                {it.emoji} {it.label}
              </span>
              <span className={styles.timelineWhen}>{formatRelative(it.achievedAt)}</span>
            </div>
          </div>
        ))}
      </div>
    </section>
  )
}

function deltaSeconds(current: number, previous: number | undefined): string | undefined {
  if (previous === undefined || !Number.isFinite(previous)) return undefined
  const diff = Math.round(current - previous)
  if (diff === 0) return undefined
  return `${diff > 0 ? '+' : '-'}${Math.abs(diff)}s`
}

function deltaWindow(w: RowerPBs['window'][number]): string | undefined {
  if (w.previous_value === undefined) return undefined
  const diff = w.value - w.previous_value
  if (Math.abs(diff) < 1e-9) return undefined
  if (w.metric === 'power') return `${diff > 0 ? '+' : ''}${Math.round(diff)} W`
  return undefined
}

function achievementLabel(a: Achievement): string {
  if (a.type === 'volume') return milestoneLabel(a.key)
  return a.key
}

function achievementValueText(a: Achievement): string {
  if (a.type === 'volume') return milestoneLabel(a.key)
  return ''
}

function formatRelative(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const ms = Date.now() - d.getTime()
  const day = 86_400_000
  if (ms < day) return 'Heute'
  if (ms < 2 * day) return 'Gestern'
  const days = Math.floor(ms / day)
  if (days < 7) return `vor ${days} Tagen`
  if (days < 14) return 'vor 1 Woche'
  if (days < 30) return `vor ${Math.floor(days / 7)} Wochen`
  return d.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: '2-digit' })
}

const STANDARD_DISTANCES = [500, 1000, 2000, 5000, 6000, 10000]

function DistanceGrid({ byM }: { byM: Map<number, RowerPBs['distance'][number]> }) {
  return (
    <section className={styles.section}>
      <h2 className={styles.sectionLabel}>Persönliche Bestzeiten · Distanzen</h2>
      <div className={styles.distanceGrid}>
        {STANDARD_DISTANCES.map((m) => {
          const pb = byM.get(m)
          return (
            <div key={m} id={`pb-distance-${m}`} className={styles.distanceCard}>
              <span className={styles.distanceLabel}>{distanceLabel(m)}</span>
              <span className={styles.distanceValue}>
                {pb ? mmssWhole(pb.time_sec) : '—'}
              </span>
              {pb && (
                <span className={styles.distanceDate}>
                  {formatShortDate(pb.source_session_started_at || pb.achieved_at)}
                </span>
              )}
            </div>
          )
        })}
      </div>
    </section>
  )
}

function WindowSection({ items }: { items: RowerPBs['window'] }) {
  return (
    <section className={styles.section}>
      <h2 className={styles.sectionLabel}>Bestleistungen · Fenster</h2>
      <div className={styles.windowList}>
        {items.map((w) => (
          <div
            key={`${w.metric}-${w.window_size}`}
            id={`pb-window-${w.metric}-${w.window_size}`}
            className={styles.windowCard}
          >
            <span className={styles.windowLabel}>{windowLabel(w)}</span>
            <span className={styles.windowValue}>{windowValue(w)}</span>
          </div>
        ))}
      </div>
    </section>
  )
}

function WorkoutSection({ items }: { items: RowerPBs['workout'] }) {
  return (
    <section className={styles.section}>
      <h2 className={styles.sectionLabel}>Bestleistungen · Workouts</h2>
      <div className={styles.workoutList}>
        {items.map((w) => (
          <div key={w.shape_hash} id={`pb-workout-${w.shape_hash}`} className={styles.workoutCard}>
            <span className={styles.workoutMode}>{workoutPBLabel(w)}</span>
            <span className={styles.workoutValue}>
              {Math.round(w.value).toLocaleString('de-DE')} m
            </span>
          </div>
        ))}
      </div>
    </section>
  )
}

// Time-mode cards name the duration: "Beste Distanz · 20 min".
// Only time-mode workout-PBs exist (CONTEXT.md §PB-leader).
function workoutPBLabel(w: RowerPBs['workout'][number]): string {
  const sec = typeof w.params?.seconds === 'number' ? (w.params.seconds as number) : null
  return sec ? `Beste Distanz · ${Math.round(sec / 60)} min` : 'Beste Distanz'
}


function MilestonesStrip({ items }: { items: Achievement[] }) {
  return (
    <section className={styles.section}>
      <h2 className={styles.sectionLabel}>Meilensteine</h2>
      <div className={styles.milestones}>
        {items.map((a) => (
          <span key={a.key} className={styles.milestone}>
            🏆 {milestoneLabel(a.key)}
          </span>
        ))}
      </div>
    </section>
  )
}

function distanceLabel(m: number): string {
  if (m >= 1000) return `${m / 1000} k`
  return `${m} m`
}

function windowLabel(w: { metric: string; window_kind: string; window_size: number }): string {
  const win = w.window_kind === 'seconds' ? `${w.window_size} s` : `${w.window_size} Schläge`
  if (w.metric === 'power') return `Beste ${win} Ø Power`
  return `${w.metric} ${win}`
}

function windowValue(w: { metric: string; value: number }): string {
  if (w.metric === 'power') return `${Math.round(w.value)} W`
  return String(w.value)
}


function milestoneLabel(key: string): string {
  if (key.startsWith('distance_') && key.endsWith('m')) {
    const meters = parseInt(key.slice(9, -1), 10)
    return `${meters / 1000} km Gesamt`
  }
  if (key.startsWith('strokes_')) {
    const n = parseInt(key.slice(8), 10)
    return `${n.toLocaleString('de-DE')} Schläge`
  }
  if (key.startsWith('active_seconds_')) {
    const sec = parseInt(key.slice(15), 10)
    return `${Math.round(sec / 3600)} h aktiv`
  }
  return key
}

function formatShortDate(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: '2-digit' })
}
