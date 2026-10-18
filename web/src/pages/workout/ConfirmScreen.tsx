import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useActiveRower } from '../../hooks/useActiveRower'
import { startSession } from '../../api/client'
import { showStartFailedToast } from '../../offline/offlinePrompt'
import {
  createWorkout,
  type CreateWorkoutInput,
  type WorkoutMode,
  type WorkoutParams,
} from '../../api/workouts'
import { createFavorite } from '../../api/favorites'
import { formatDistanceLabel } from '../../util/format'
import { useWorkoutFlow, type FlowState } from './WorkoutFlowProvider'
import styles from './ConfirmScreen.module.css'

function intensityLabelFor(i: string): string {
  return (
    ({ locker: 'Locker', moderat: 'Moderat', hart: 'Hart', allout: 'All-out' } as Record<string, string>)[i] ?? i
  )
}

// ── Stepper ───────────────────────────────────────────────────────────────────

interface StepperProps {
  value: number
  min: number
  max: number
  step: number
  unit?: string
  disabled?: boolean
  onChange: (v: number) => void
  ariaLabel?: string
}

function Stepper({ value, min, max, step, unit, disabled, onChange, ariaLabel }: StepperProps) {
  const dec = () => onChange(Math.max(min, value - step))
  const inc = () => onChange(Math.min(max, value + step))
  return (
    <div className={styles.stepperControls} aria-label={ariaLabel}>
      <button
        type="button"
        className={styles.stepperBtn}
        onClick={dec}
        disabled={disabled}
        aria-label="−"
      >
        −
      </button>
      <span className={styles.stepperValue}>{value}</span>
      {unit && <span className={styles.stepperUnit}>{unit}</span>}
      <button
        type="button"
        className={styles.stepperBtn}
        onClick={inc}
        disabled={disabled}
        aria-label="+"
      >
        +
      </button>
    </div>
  )
}

// ── Timeline ──────────────────────────────────────────────────────────────────

function Timeline({ state }: { state: FlowState }) {
  const blocks: { kind: 'warmup' | 'work' | 'rest' | 'cooldown' }[] = []
  if (state.warmupEnabled && state.warmupSec > 0) blocks.push({ kind: 'warmup' })
  if (state.mode === 'intervals' && state.intervals) {
    for (let i = 0; i < state.intervals.reps; i++) {
      blocks.push({ kind: 'work' })
      if (i < state.intervals.reps - 1) blocks.push({ kind: 'rest' })
    }
  } else {
    blocks.push({ kind: 'work' })
  }
  if (state.cooldownEnabled && state.cooldownSec > 0) blocks.push({ kind: 'cooldown' })

  const KIND_LABEL: Record<typeof blocks[number]['kind'], string> = {
    warmup: 'Aufwärmen',
    work: 'Workout',
    rest: 'Pause',
    cooldown: 'Cool-down',
  }
  // F10: legend turns the (otherwise mute) coloured bar into something
  // a first-time user can read. Distinct kinds only, in the order they
  // appear, so 4×500m intervals collapse to "Aufwärmen · Workout ·
  // Pause · Cool-down" rather than repeating Workout/Pause.
  const legend: string[] = []
  for (const b of blocks) {
    const label = KIND_LABEL[b.kind]
    if (legend[legend.length - 1] !== label) legend.push(label)
  }

  return (
    <div className={styles.timelineWrap}>
      <div className={styles.timeline} data-testid="timeline">
        {blocks.map((b, idx) => (
          <span
            key={idx}
            className={`${styles.block} ${styles[`block_${b.kind}` as keyof typeof styles]}`}
            title={KIND_LABEL[b.kind]}
          />
        ))}
      </div>
      <div className={styles.timelineLegend} data-testid="timeline-legend">
        {legend.join(' · ')}
      </div>
    </div>
  )
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function buildParams(state: FlowState): WorkoutParams | null {
  if (state.mode === 'distance' && state.distanceMeters) return { meters: state.distanceMeters }
  if (state.mode === 'time' && state.timeSeconds) return { seconds: state.timeSeconds }
  if (state.mode === 'intervals' && state.intervals) return state.intervals
  if (state.mode === 'race' && state.distanceMeters) return { meters: state.distanceMeters }
  return null
}

function titleFor(state: FlowState, params: WorkoutParams): string {
  let base = ''
  if (state.mode === 'distance') {
    const m = (params as { meters: number }).meters
    base = formatDistanceLabel(m)
  } else if (state.mode === 'time') {
    const s = (params as { seconds: number }).seconds
    base = `${Math.round(s / 60)} min`
  } else if (state.mode === 'intervals') {
    const iv = params as { reps: number; length: { unit: string; value: number } }
    base = `${iv.reps}×${iv.length.value} ${iv.length.unit}`
  } else if (state.mode === 'race') {
    const m = (params as { meters: number }).meters
    base = `${formatDistanceLabel(m)} Rennen`
  }
  const label = state.intensity ? intensityLabelFor(state.intensity) : ''
  return label ? `${base} · ${label}` : base
}

// ── ConfirmScreen ─────────────────────────────────────────────────────────────

export function ConfirmScreen() {
  const { state, dispatch } = useWorkoutFlow()
  const nav = useNavigate()
  const active = useActiveRower()
  const rowerID = active.data?.id
  const [starting, setStarting] = useState(false)
  // 0015-05: opponent toggles live inline on the Übersicht (race mode).
  // Defaults match the prior OpponentPickerSheet behaviour.
  const [ghostOn, setGhostOn] = useState(true)
  const [pbOn, setPbOn] = useState(true)

  const params: WorkoutParams | null = buildParams(state)
  if (!state.mode || !params) return null

  async function maybeCreateFavorite(input: CreateWorkoutInput, warmup: number, cooldown: number) {
    if (state.mode === 'race') return
    if (state.saveAsFavorite && state.favoriteName.trim() !== '' && rowerID) {
      try {
        await createFavorite({
          rower_id: rowerID,
          name: state.favoriteName.trim(),
          mode: input.mode,
          params: input.params,
          intensity: input.intensity,
          warmup_sec: warmup,
          cooldown_sec: cooldown,
        })
      } catch (e) {
        console.error('createFavorite failed (non-fatal)', e)
      }
    }
  }

  // ADR-0009: race mode excludes warmup and cooldown.
  const isRace = state.mode === 'race'

  async function start() {
    if (starting) return
    setStarting(true)
    try {
      const warmup = isRace ? 0 : state.warmupEnabled ? state.warmupSec : 0
      const cooldown = isRace ? 0 : state.cooldownEnabled ? state.cooldownSec : 0
      const input: CreateWorkoutInput = {
        mode: state.mode as WorkoutMode,
        params: params!,
        intensity: state.intensity,
        warmup_sec: warmup,
        cooldown_sec: cooldown,
      }
      const created = await createWorkout(input)
      if (state.mode === 'race') {
        // 0015-05: opponent selection is taken from the inline toggles
        // and persisted to sessionStorage; LivePage / BereitScreen read
        // it back to render the opponents summary. No modal sheet is
        // opened — Start commits the toggles and proceeds directly.
        sessionStorage.setItem(
          'race-opp-selection',
          JSON.stringify({ ghost: ghostOn, pb: pbOn }),
        )
      }
      await startSession(created.id)
      await maybeCreateFavorite(input, warmup, cooldown)
      nav('/live')
    } catch (e) {
      console.error('start workout failed', e)
      showStartFailedToast()
      setStarting(false)
    }
  }

  return (
    <div className={styles.wrap}>
      <header className={styles.header}>
        {/* Back-navigation moved up to WorkoutFlowPage's unified flow header. */}
        {isRace && <h1 className={styles.title}>Übersicht</h1>}
        <h2 className={isRace ? styles.subtitle : styles.title}>
          {titleFor(state, params)}
        </h2>
      </header>

      <Timeline state={state} />

      {isRace && (
        <section className={styles.toggleRow} aria-label="Gegner">
          <div className={styles.opponentList}>
            <label className={styles.toggle}>
              <input
                type="checkbox"
                checked={ghostOn}
                onChange={(e) => setGhostOn(e.target.checked)}
              />
              Synthetischer Geist nach Härte
            </label>
            <label className={styles.toggle}>
              <input
                type="checkbox"
                checked={pbOn}
                onChange={(e) => setPbOn(e.target.checked)}
              />
              Bestzeit
            </label>
            {!ghostOn && (
              <p className={styles.opponentNote}>
                Intensität wirkt sich nicht aus.
              </p>
            )}
          </div>
        </section>
      )}

      {!isRace && (
        <section className={styles.toggleRow} aria-label="Warm-up">
          <label className={styles.toggle}>
            <input
              type="checkbox"
              checked={state.warmupEnabled}
              onChange={() => dispatch({ type: 'TOGGLE_WARMUP' })}
            />
            Warm-up
          </label>
          <Stepper
            disabled={!state.warmupEnabled}
            value={Math.round(state.warmupSec / 60)}
            min={0}
            max={15}
            step={1}
            unit="min"
            onChange={(m) => dispatch({ type: 'SET_WARMUP_SEC', seconds: m * 60 })}
            ariaLabel="Warm-up Dauer"
          />
        </section>
      )}

      {!isRace && (
        <section className={styles.toggleRow} aria-label="Cool-down">
          <label className={styles.toggle}>
            <input
              type="checkbox"
              checked={state.cooldownEnabled}
              onChange={() => dispatch({ type: 'TOGGLE_COOLDOWN' })}
            />
            Cool-down
          </label>
          <Stepper
            disabled={!state.cooldownEnabled}
            value={Math.round(state.cooldownSec / 60)}
            min={0}
            max={15}
            step={1}
            unit="min"
            onChange={(m) => dispatch({ type: 'SET_COOLDOWN_SEC', seconds: m * 60 })}
            ariaLabel="Cool-down Dauer"
          />
        </section>
      )}

      <section className={styles.favRow}>
        <label className={styles.toggle}>
          <input
            type="checkbox"
            checked={state.saveAsFavorite}
            onChange={() => dispatch({ type: 'TOGGLE_SAVE_FAVORITE' })}
          />
          Als Favorit speichern
        </label>
        {state.saveAsFavorite && (
          <input
            type="text"
            placeholder="Name"
            className={styles.nameInput}
            value={state.favoriteName}
            onChange={(e) => dispatch({ type: 'SET_FAVORITE_NAME', name: e.target.value })}
            aria-label="Favoritenname"
          />
        )}
      </section>

      <button type="button" className={styles.start} onClick={start} disabled={starting}>
        {starting ? 'Wird gestartet…' : 'Start'}
      </button>
    </div>
  )
}
