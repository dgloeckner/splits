import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { createRower, setActiveRower } from '../api/rowers'
import styles from './OnboardingPage.module.css'

const palette = ['#ff6b6b', '#4ecdc4', '#ffe66d', '#a78bfa', '#f97316', '#60a5fa', '#34d399', '#f472b6']

export function OnboardingPage() {
  const [name, setName] = useState('')
  const [weight, setWeight] = useState('')
  const [height, setHeight] = useState('')
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
        weight_kg: weight ? Number(weight) : undefined,
        height_cm: height ? Number(height) : undefined,
        dob: dob || undefined,
        color,
      }
      const row = await createRower(input)
      const active = await setActiveRower(row.id)
      // Seed caches synchronously so RowerGate sees non-null active
      // immediately after navigation instead of waiting for a refetch.
      qc.setQueryData(['rowers'], [row])
      qc.setQueryData(['active-rower'], active)
      await qc.invalidateQueries({ queryKey: ['rowers'] })
      await qc.invalidateQueries({ queryKey: ['active-rower'] })
      nav('/', { replace: true })
    } catch (e2) {
      setErr(String(e2))
    } finally {
      setBusy(false)
    }
  }

  return (
    <form className={styles.root} onSubmit={submit}>
      <h1>Willkommen</h1>
      <p>Leg dein Profil an, um Sessions zu speichern.</p>
      <div className={styles.field}>
        <label htmlFor="name">Name*</label>
        <input id="name" value={name} onChange={(e) => setName(e.target.value)} autoFocus />
      </div>
      <div className={styles.field}>
        <label htmlFor="weight">Gewicht (kg)</label>
        <input id="weight" type="number" step="0.1" value={weight} onChange={(e) => setWeight(e.target.value)} />
      </div>
      <div className={styles.field}>
        <label htmlFor="height">Größe (cm)</label>
        <input id="height" type="number" step="1" value={height} onChange={(e) => setHeight(e.target.value)} />
      </div>
      <div className={styles.field}>
        <label htmlFor="dob">Geburtsdatum</label>
        <input id="dob" type="date" value={dob} onChange={(e) => setDob(e.target.value)} />
      </div>
      <div className={styles.field}>
        <label>Farbe</label>
        <div className={styles.palette}>
          {palette.map((c) => (
            <button
              key={c}
              type="button"
              aria-label={`colour ${c}`}
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
        Weiter
      </button>
    </form>
  )
}
