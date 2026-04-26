import { useQuery } from '@tanstack/react-query'
import {
  getRowerAchievements,
  getRowerPBs,
  type Achievement,
  type RowerPBs,
} from '../../api/client'
import { useActiveRower } from '../../hooks/useActiveRower'
import { fmtMeters, mmssWhole, pace500m } from '../../util/format'
import styles from './RekordeTab.module.css'

export function RekordeTab() {
  const active = useActiveRower()
  const rowerID = active.data?.id

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

  if (!rowerID || pbsQ.isPending) {
    return <p className={styles.empty}>Bestleistungen werden geladen …</p>
  }
  const pbs = pbsQ.data
  if (!pbs) return null

  const distanceByM = new Map(pbs.distance.map((d) => [d.distance_m, d]))
  const milestones = (achievementsQ.data ?? []).filter((a) => a.type === 'volume')
  const consistency = (achievementsQ.data ?? []).filter(
    (a) => a.type === 'consistency_intra',
  )

  const isEmpty =
    pbs.distance.length === 0 &&
    pbs.window.length === 0 &&
    pbs.workout.length === 0 &&
    milestones.length === 0 &&
    consistency.length === 0

  if (isEmpty) {
    return (
      <p className={styles.empty}>Noch keine Bestleistungen. Starte ein Workout.</p>
    )
  }

  return (
    <>
      <DistanceGrid byM={distanceByM} />
      {pbs.window.length > 0 && <WindowSection items={pbs.window} />}
      {pbs.workout.length > 0 && <WorkoutSection items={pbs.workout} />}
      {consistency.length > 0 && <ConsistencyCards items={consistency} />}
      {milestones.length > 0 && <MilestonesStrip items={milestones} />}
    </>
  )
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
            <div key={m} className={styles.distanceCard}>
              <span className={styles.distanceLabel}>{distanceLabel(m)}</span>
              <span className={styles.distanceValue}>
                {pb ? mmssWhole(pb.time_sec) : '—'}
              </span>
              {pb && (
                <span className={styles.distanceDate}>
                  {formatShortDate(pb.achieved_at)}
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
          <div key={`${w.metric}-${w.window_size}`} className={styles.windowCard}>
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
          <div key={w.shape_hash} className={styles.workoutCard}>
            <span className={styles.workoutMode}>{modeLabel(w.mode)}</span>
            <span className={styles.workoutValue}>
              {w.value_kind === 'time_sec'
                ? mmssWhole(w.value)
                : `${fmtMeters(w.value)} m`}
            </span>
          </div>
        ))}
      </div>
    </section>
  )
}

function ConsistencyCards({ items }: { items: Achievement[] }) {
  const byKey = new Map(items.map((a) => [a.key, a]))
  const cards: { key: string; label: string }[] = [
    { key: 'consistency_power_cv', label: 'Power-Konstanz' },
    { key: 'consistency_pace_split_cv', label: 'Split-Konstanz' },
    { key: 'consistency_spm_cv', label: 'SPM-Konstanz' },
  ]
  return (
    <section className={styles.section}>
      <h2 className={styles.sectionLabel}>Konstanz-Bestleistungen</h2>
      <div className={styles.consistencyGrid}>
        {cards.map((c) => {
          const a = byKey.get(c.key)
          return (
            <div key={c.key} className={styles.consistencyCard}>
              <span className={styles.consistencyLabel}>{c.label}</span>
              <span className={styles.consistencyValue}>
                {a && typeof a.value === 'number'
                  ? `CV ${(a.value * 100).toFixed(1)} %`
                  : '—'}
              </span>
            </div>
          )
        })}
      </div>
    </section>
  )
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
  switch (w.metric) {
    case 'power':
      return `Beste ${win} Power`
    case 'pace':
      return `Bester ${win} Split`
    case 'dps':
      return `Beste ${win} DPS`
    case 'spi':
      return `Beste ${win} SPI`
  }
  return `${w.metric} ${win}`
}

function windowValue(w: { metric: string; value: number }): string {
  switch (w.metric) {
    case 'power':
      return `${Math.round(w.value)} W`
    case 'pace':
      return pace500m(Math.round(w.value))
    case 'dps':
      return `${w.value.toFixed(2)} m`
    case 'spi':
      return `${w.value.toFixed(1)} J`
  }
  return String(w.value)
}

function modeLabel(mode: string): string {
  switch (mode) {
    case 'distance':
      return 'Distanz'
    case 'time':
      return 'Zeit'
    case 'intervals':
      return 'Intervalle'
    case 'just_row':
      return 'Just Row'
  }
  return mode
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
