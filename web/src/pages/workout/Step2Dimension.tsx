import { useState } from 'react'
import { useWorkoutFlow } from './WorkoutFlowProvider'
import { distancePresets, timePresets, intervalPresets } from './presets'
import styles from './Step2Dimension.module.css'

// ── Shared stepper ────────────────────────────────────────────────────────────

interface StepperProps {
  value: number
  onChange: (v: number) => void
  step: number
  min: number
  max?: number
  formatValue?: (v: number) => string
  unit?: string
  label?: string
}

function Stepper({ value, onChange, step, min, max, formatValue, unit, label }: StepperProps) {
  const dec = () => onChange(Math.max(min, value - step))
  const inc = () => onChange(max !== undefined ? Math.min(max, value + step) : value + step)
  const display = formatValue ? formatValue(value) : String(value)
  return (
    <div className={styles.stepperRow}>
      {label && <span className={styles.stepperLabel}>{label}</span>}
      <div className={styles.stepperControls}>
        <button type="button" className={styles.stepperBtn} onClick={dec} aria-label="−">−</button>
        <span className={styles.stepperValue}>{display}</span>
        {unit && <span className={styles.stepperUnit}>{unit}</span>}
        <button type="button" className={styles.stepperBtn} onClick={inc} aria-label="+">+</button>
      </div>
    </div>
  )
}

// ── Distance panel ────────────────────────────────────────────────────────────

function DistancePanel() {
  const { dispatch } = useWorkoutFlow()
  const [eigene, setEigene] = useState(false)
  const [meters, setMeters] = useState(3000)

  function pick(m: number) {
    dispatch({ type: 'SET_DISTANCE', meters: m })
    dispatch({ type: 'GO_TO_STEP3' })
  }

  function submit() {
    dispatch({ type: 'SET_DISTANCE', meters })
    dispatch({ type: 'GO_TO_STEP3' })
  }

  function formatMeters(m: number) {
    if (m >= 1000) return `${m / 1000} km`
    return `${m} m`
  }

  return (
    <div className={styles.panel}>
      <h2 className={styles.panelTitle}>Distanz wählen</h2>
      <div className={styles.chips}>
        {distancePresets.map((p) => (
          <button key={p.label} type="button" className={styles.chip} onClick={() => pick(p.meters)}>
            {p.label}
          </button>
        ))}
        <button
          type="button"
          className={`${styles.chip} ${eigene ? styles.chipSelected : ''}`}
          onClick={() => setEigene((e) => !e)}
        >
          Eigene
        </button>
      </div>

      {eigene && (
        <div className={styles.customPanel}>
          <Stepper
            value={meters}
            onChange={setMeters}
            step={500}
            min={500}
            formatValue={formatMeters}
          />
          <button type="button" className={styles.submitBtn} onClick={submit}>
            Übernehmen
          </button>
        </div>
      )}
    </div>
  )
}

// ── Time panel ────────────────────────────────────────────────────────────────

function TimePanel() {
  const { dispatch } = useWorkoutFlow()
  const [eigene, setEigene] = useState(false)
  const [seconds, setSeconds] = useState(900) // 15 min default

  function pick(s: number) {
    dispatch({ type: 'SET_TIME', seconds: s })
    dispatch({ type: 'GO_TO_STEP3' })
  }

  function submit() {
    dispatch({ type: 'SET_TIME', seconds })
    dispatch({ type: 'GO_TO_STEP3' })
  }

  function formatSeconds(s: number) {
    return `${s / 60} min`
  }

  return (
    <div className={styles.panel}>
      <h2 className={styles.panelTitle}>Zeit wählen</h2>
      <div className={styles.chips}>
        {timePresets.map((p) => (
          <button key={p.label} type="button" className={styles.chip} onClick={() => pick(p.seconds)}>
            {p.label}
          </button>
        ))}
        <button
          type="button"
          className={`${styles.chip} ${eigene ? styles.chipSelected : ''}`}
          onClick={() => setEigene((e) => !e)}
        >
          Eigene
        </button>
      </div>

      {eigene && (
        <div className={styles.customPanel}>
          <Stepper
            value={seconds}
            onChange={setSeconds}
            step={300} // ±5 min
            min={60}   // 1 min minimum
            formatValue={formatSeconds}
          />
          <button type="button" className={styles.submitBtn} onClick={submit}>
            Übernehmen
          </button>
        </div>
      )}
    </div>
  )
}

// ── Intervals panel ───────────────────────────────────────────────────────────

function IntervalsPanel() {
  const { dispatch } = useWorkoutFlow()
  const [eigene, setEigene] = useState(false)

  // Intervals custom state
  const [reps, setReps] = useState(4)
  const [lengthUnit, setLengthUnit] = useState<'m' | 'min'>('m')
  const [lengthValue, setLengthValue] = useState(500)
  const [restSec, setRestSec] = useState(120)

  function pick(preset: (typeof intervalPresets)[number]) {
    dispatch({
      type: 'SET_INTERVALS',
      intervals: { reps: preset.reps, length: preset.length, rest_sec: preset.rest_sec },
    })
    dispatch({ type: 'GO_TO_STEP3' })
  }

  function submit() {
    dispatch({
      type: 'SET_INTERVALS',
      intervals: { reps, length: { unit: lengthUnit, value: lengthValue }, rest_sec: restSec },
    })
    dispatch({ type: 'GO_TO_STEP3' })
  }

  function switchUnit(unit: 'm' | 'min') {
    setLengthUnit(unit)
    setLengthValue(unit === 'm' ? 500 : 2)
  }

  function formatRest(s: number) {
    if (s === 0) return '0'
    if (s < 60) return `${s} s`
    if (s % 60 === 0) return `${s / 60} min`
    return `${Math.floor(s / 60)} min ${s % 60} s`
  }

  return (
    <div className={styles.panel}>
      <h2 className={styles.panelTitle}>Intervalle wählen</h2>
      <div className={styles.chips}>
        {intervalPresets.map((p) => (
          <button key={p.label} type="button" className={styles.chip} onClick={() => pick(p)}>
            {p.label}
          </button>
        ))}
        <button
          type="button"
          className={`${styles.chip} ${eigene ? styles.chipSelected : ''}`}
          onClick={() => setEigene((e) => !e)}
        >
          Eigene
        </button>
      </div>

      {eigene && (
        <div className={styles.customPanel}>
          <div className={styles.configSection}>
            <span className={styles.configLabel}>Runden</span>
            <Stepper value={reps} onChange={setReps} step={1} min={1} />
          </div>

          <div className={styles.configSection}>
            <span className={styles.configLabel}>Intervall-Länge</span>
            <div
              className={styles.unitToggle}
              role="group"
              aria-label="Einheit für Intervall-Länge"
            >
              <button
                type="button"
                className={`${styles.unitBtn} ${lengthUnit === 'm' ? styles.unitBtnActive : ''}`}
                onClick={() => switchUnit('m')}
                aria-label="Meter"
                aria-pressed={lengthUnit === 'm'}
              >
                Meter
              </button>
              <button
                type="button"
                className={`${styles.unitBtn} ${lengthUnit === 'min' ? styles.unitBtnActive : ''}`}
                onClick={() => switchUnit('min')}
                aria-label="Minuten"
                aria-pressed={lengthUnit === 'min'}
              >
                Minuten
              </button>
            </div>
            <Stepper
              value={lengthValue}
              onChange={setLengthValue}
              step={lengthUnit === 'm' ? 100 : 1}
              min={1}
              unit={lengthUnit}
            />
          </div>

          <div className={styles.configSection}>
            <span className={styles.configLabel}>Pause</span>
            <Stepper
              value={restSec}
              onChange={setRestSec}
              step={30}
              min={0}
              formatValue={formatRest}
            />
          </div>

          <button type="button" className={styles.submitBtn} onClick={submit}>
            Übernehmen
          </button>
        </div>
      )}
    </div>
  )
}

// ── Root component ────────────────────────────────────────────────────────────

export function Step2Dimension() {
  const { state, dispatch } = useWorkoutFlow()

  if (!state.mode) return null

  return (
    <div className={styles.wrap}>
      <header className={styles.header}>
        <button
          type="button"
          className={styles.back}
          onClick={() => dispatch({ type: 'GO_BACK' })}
          aria-label="Zurück"
        >
          ← Zurück
        </button>
      </header>

      {state.mode === 'distance' && <DistancePanel />}
      {state.mode === 'time' && <TimePanel />}
      {state.mode === 'intervals' && <IntervalsPanel />}
    </div>
  )
}
