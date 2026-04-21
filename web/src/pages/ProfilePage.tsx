import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { useRowers } from '../hooks/useRowers'
import { updateRower, type Rower } from '../api/rowers'
import { computeBMI } from '../util/bmi'

function RowerCard({ r }: { r: Rower }) {
  const [name, setName] = useState(r.name)
  const [weight, setWeight] = useState(r.weight_kg?.toString() ?? '')
  const [height, setHeight] = useState(r.height_cm?.toString() ?? '')
  const [dob, setDob] = useState(r.dob ?? '')
  const [color, setColor] = useState(r.color)
  const [busy, setBusy] = useState(false)
  const qc = useQueryClient()

  const bmi = computeBMI(
    weight ? Number(weight) : undefined,
    height ? Number(height) : undefined,
  )

  async function save() {
    setBusy(true)
    try {
      await updateRower(r.id, {
        name: name || undefined,
        weight_kg: weight ? Number(weight) : undefined,
        height_cm: height ? Number(height) : undefined,
        dob: dob || undefined,
        color,
      })
      await qc.invalidateQueries({ queryKey: ['rowers'] })
      await qc.invalidateQueries({ queryKey: ['active-rower'] })
    } finally {
      setBusy(false)
    }
  }

  return (
    <section style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: 12, border: '1px solid #333', borderRadius: 8 }}>
      <label>Name <input value={name} onChange={(e) => setName(e.target.value)} /></label>
      <label>Gewicht (kg) <input type="number" step="0.1" value={weight} onChange={(e) => setWeight(e.target.value)} /></label>
      <label>Größe (cm) <input type="number" step="1" value={height} onChange={(e) => setHeight(e.target.value)} /></label>
      <label>Geburtsdatum <input type="date" value={dob} onChange={(e) => setDob(e.target.value)} /></label>
      <label>Farbe <input type="color" value={color} onChange={(e) => setColor(e.target.value)} /></label>
      {bmi != null && <div>BMI: {bmi}</div>}
      <button disabled={busy} onClick={save}>Speichern</button>
    </section>
  )
}

export function ProfilePage() {
  const rowers = useRowers()
  const nav = useNavigate()
  return (
    <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 16 }}>
      <h1>Einstellungen</h1>
      {rowers.data?.map((r) => <RowerCard key={r.id} r={r} />)}
      <button onClick={() => nav('/onboarding')}>Rudernde/n hinzufügen</button>
    </div>
  )
}
