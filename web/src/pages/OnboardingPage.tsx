import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { createRower, setActiveRower } from '../api/rowers'
import { ApiError, NetworkError } from '../api/error'
import styles from './OnboardingPage.module.css'

const palette = [
  '#5dd7e4',
  '#ffb786',
  '#a4ced3',
  '#ffb4ab',
  '#bcc9ca',
  '#e4e2e1',
  '#3d494a',
]

function formatErr(e: unknown): string {
  if (e instanceof NetworkError) {
    const c = e.cause instanceof Error ? `${e.cause.name}: ${e.cause.message}` : String(e.cause)
    return `Backend nicht erreichbar — ${c} (${e.url})`
  }
  if (e instanceof ApiError) {
    return `${e.status} ${e.message}${e.url ? ` [${e.url}]` : ''}`
  }
  return String(e)
}

function clampInt(v: string | number, min: number, max: number): number {
  const n = typeof v === 'string' ? Number(v) : v
  if (Number.isNaN(n)) return min
  return Math.min(max, Math.max(min, Math.round(n)))
}

export function OnboardingPage() {
  const [name, setName] = useState('')
  const [weight, setWeight] = useState('75')
  const [height, setHeight] = useState('180')
  const [dob, setDob] = useState('')
  const [color, setColor] = useState(palette[0])
  const [err, setErr] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const nav = useNavigate()
  const qc = useQueryClient()

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setErr(null)
    if (!name.trim()) {
      setErr('Name erforderlich')
      return
    }
    setBusy(true)
    try {
      const input = {
        name: name.trim(),
        weight_kg: clampInt(weight, 20, 250),
        height_cm: clampInt(height, 100, 230),
        dob: dob || undefined,
        color,
      }
      const row = await createRower(input)
      const active = await setActiveRower(row.id)
      qc.setQueryData(['rowers'], [row])
      qc.setQueryData(['active-rower'], active)
      await qc.invalidateQueries({ queryKey: ['rowers'] })
      await qc.invalidateQueries({ queryKey: ['active-rower'] })
      nav('/', { replace: true })
    } catch (e2) {
      setErr(formatErr(e2))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <span className={styles.dot} aria-hidden />
        <span className={styles.brand}>SPLITS</span>
      </header>
      <main className={styles.root}>
        <section className={styles.intro}>
          <h1>Willkommen</h1>
          <p>Leg dein Profil an, um Sessions zu speichern.</p>
        </section>
        <form className={styles.form} onSubmit={submit}>
          <div className={styles.field}>
            <label htmlFor="name" className={styles.label}>
              Name*
            </label>
            <input
              id="name"
              className={styles.input}
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Vorname"
              autoFocus
            />
          </div>

          <div className={styles.grid}>
            <div className={styles.field}>
              <label htmlFor="weight" className={styles.label}>
                Gewicht (kg)
              </label>
              <div className={styles.stepper}>
                <button
                  type="button"
                  className={styles.stepBtn}
                  aria-label="Gewicht verringern"
                  onClick={() =>
                    setWeight(String(clampInt(clampInt(weight, 20, 250) - 1, 20, 250)))
                  }
                >
                  −
                </button>
                <input
                  id="weight"
                  type="text"
                  inputMode="numeric"
                  autoComplete="off"
                  className={styles.stepInput}
                  value={weight}
                  onChange={(e) => setWeight(e.target.value.replace(/[^\d]/g, ''))}
                  onBlur={() => setWeight(String(clampInt(weight, 20, 250)))}
                />
                <button
                  type="button"
                  className={styles.stepBtn}
                  aria-label="Gewicht erhöhen"
                  onClick={() =>
                    setWeight(String(clampInt(clampInt(weight, 20, 250) + 1, 20, 250)))
                  }
                >
                  +
                </button>
              </div>
            </div>

            <div className={styles.field}>
              <label htmlFor="height" className={styles.label}>
                Größe (cm)
              </label>
              <div className={styles.stepper}>
                <button
                  type="button"
                  className={styles.stepBtn}
                  aria-label="Größe verringern"
                  onClick={() =>
                    setHeight(String(clampInt(clampInt(height, 100, 230) - 1, 100, 230)))
                  }
                >
                  −
                </button>
                <input
                  id="height"
                  type="text"
                  inputMode="numeric"
                  autoComplete="off"
                  className={styles.stepInput}
                  value={height}
                  onChange={(e) => setHeight(e.target.value.replace(/[^\d]/g, ''))}
                  onBlur={() => setHeight(String(clampInt(height, 100, 230)))}
                />
                <button
                  type="button"
                  className={styles.stepBtn}
                  aria-label="Größe erhöhen"
                  onClick={() =>
                    setHeight(String(clampInt(clampInt(height, 100, 230) + 1, 100, 230)))
                  }
                >
                  +
                </button>
              </div>
            </div>
          </div>

          <div className={styles.field}>
            <label htmlFor="dob" className={styles.label}>
              Geburtsdatum
            </label>
            <input
              id="dob"
              type="date"
              className={styles.input}
              value={dob}
              onChange={(e) => setDob(e.target.value)}
            />
          </div>

          <div className={styles.field}>
            <span className={styles.label}>Farbe</span>
            <div className={styles.palette} role="radiogroup" aria-label="Farbe wählen">
              {palette.map((c) => (
                <button
                  key={c}
                  type="button"
                  role="radio"
                  aria-checked={color === c}
                  aria-label={`Farbe ${c}`}
                  data-active={color === c}
                  className={styles.swatch}
                  style={{ background: c }}
                  onClick={() => setColor(c)}
                />
              ))}
            </div>
          </div>

          {err && <div className={styles.err}>{err}</div>}

          <button type="submit" className={styles.submit} disabled={busy}>
            <span>Weiter</span>
            <span className={styles.chevron} aria-hidden>
              ›
            </span>
          </button>
        </form>
      </main>
    </div>
  )
}
