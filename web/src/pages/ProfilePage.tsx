import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useRowers } from '../hooks/useRowers'
import { useActiveRower } from '../hooks/useActiveRower'
import { updateRower, type Rower } from '../api/rowers'
import { computeBMI } from '../util/bmi'
import { RowerStrip } from '../app/RowerStrip'
import { PairingModal } from '../app/PairingModal'
import { ThemeSwitcher } from './profile/ThemeSwitcher'
import { Wartung } from './profile/Wartung'
import { UpdateStatusCard } from './profile/UpdateStatusCard'
import { useErgoStatus } from '../offline/ergoStatus'
import { formatStand } from '../util/dates'
import styles from './ProfilePage.module.css'

function formatSince(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const months = ['Jan', 'Feb', 'Mär', 'Apr', 'Mai', 'Jun', 'Jul', 'Aug', 'Sep', 'Okt', 'Nov', 'Dez']
  return `Seit ${months[d.getMonth()]} ${d.getFullYear()}`
}

function HeroCard({ rower }: { rower: Rower }) {
  return (
    <section className={styles.heroCard}>
      <div className={styles.heroAvatar} style={{ background: rower.color }}>
        {rower.name.slice(0, 1).toUpperCase()}
      </div>
      <div className={styles.heroText}>
        <h2 className={styles.heroName}>{rower.name}</h2>
        <div className={styles.heroMeta}>
          <span className={styles.badge}>Aktiv</span>
          <span className={styles.metaText}>{formatSince(rower.created_at)}</span>
        </div>
      </div>
    </section>
  )
}

function RowerEditor({ r }: { r: Rower }) {
  const [name, setName] = useState(r.name)
  const [weight, setWeight] = useState(r.weight_kg?.toString() ?? '')
  const [height, setHeight] = useState(r.height_cm?.toString() ?? '')
  const [dob, setDob] = useState(r.dob ?? '')
  const [color, setColor] = useState(r.color)
  const [busy, setBusy] = useState(false)
  const qc = useQueryClient()

  const dirty =
    name !== r.name ||
    weight !== (r.weight_kg?.toString() ?? '') ||
    height !== (r.height_cm?.toString() ?? '') ||
    dob !== (r.dob ?? '') ||
    color !== r.color

  const parseNum = (v: string): number | undefined => {
    const s = v.trim().replace(',', '.')
    if (!s) return undefined
    const n = Number(s)
    return Number.isFinite(n) ? n : undefined
  }

  const bmi = computeBMI(parseNum(weight), parseNum(height))

  async function save() {
    setBusy(true)
    try {
      await updateRower(r.id, {
        name: name || undefined,
        weight_kg: parseNum(weight),
        height_cm: parseNum(height),
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
    <div className={styles.card}>
      <label className={styles.row}>
        <div className={styles.rowMain}>
          <span className={styles.rowLabel}>Name</span>
        </div>
        <input
          className={styles.input}
          value={name}
          onChange={(e) => setName(e.target.value)}
          aria-label={`Name ${r.name}`}
        />
      </label>
      <label className={styles.row}>
        <div className={styles.rowMain}>
          <span className={styles.rowLabel}>Gewicht (kg)</span>
        </div>
        <input
          className={styles.input}
          type="text"
          inputMode="decimal"
          autoComplete="off"
          value={weight}
          placeholder="—"
          onChange={(e) => {
            // Allow digits + one separator (. or ,). Strip everything else.
            const raw = e.target.value.replace(/[^\d.,]/g, '')
            setWeight(raw)
          }}
          aria-label={`Gewicht ${r.name}`}
        />
      </label>
      <label className={styles.row}>
        <div className={styles.rowMain}>
          <span className={styles.rowLabel}>Größe (cm)</span>
        </div>
        <input
          className={styles.input}
          type="text"
          inputMode="numeric"
          autoComplete="off"
          value={height}
          placeholder="—"
          onChange={(e) => {
            const raw = e.target.value.replace(/[^\d]/g, '')
            setHeight(raw)
          }}
          aria-label={`Größe ${r.name}`}
        />
      </label>
      <label className={styles.row}>
        <div className={styles.rowMain}>
          <span className={styles.rowLabel}>Geburtsdatum</span>
        </div>
        <input
          className={styles.input}
          type="date"
          value={dob}
          onChange={(e) => setDob(e.target.value)}
          aria-label={`Geburtsdatum ${r.name}`}
        />
      </label>
      <label className={styles.row}>
        <div className={styles.rowMain}>
          <span className={styles.rowLabel}>Farbe</span>
        </div>
        <input
          className={styles.colorInput}
          type="color"
          value={color}
          onChange={(e) => setColor(e.target.value)}
          aria-label={`Farbe ${r.name}`}
        />
      </label>
      {bmi != null && (
        <div className={styles.row}>
          <div className={styles.rowMain}>
            <span className={styles.rowLabel}>BMI</span>
          </div>
          <span className={styles.bmiBadge}>{bmi}</span>
        </div>
      )}
      <button
        type="button"
        className={styles.saveBtn}
        disabled={busy || !dirty}
        onClick={save}
      >
        {busy ? 'Speichern…' : 'Speichern'}
      </button>
    </div>
  )
}

export function ProfilePage() {
  const rowers = useRowers()
  const active = useActiveRower()
  const ergo = useErgoStatus()
  const [pairingOpen, setPairingOpen] = useState(false)

  const activeRower = active.data
  const others = (rowers.data ?? []).filter((r) => r.id !== activeRower?.id)

  return (
    <main className={styles.page}>
      <h1 className={styles.pageTitle}>Einstellungen</h1>

      <RowerStrip />

      {activeRower && (
        <section className={styles.section}>
          <h2 className={styles.sectionLabel}>Aktiver Rudernde</h2>
          <HeroCard rower={activeRower} />
          <RowerEditor r={activeRower} />
          <Wartung rowerID={activeRower.id} />
        </section>
      )}

      {others.length > 0 && (
        <section className={styles.section}>
          <h2 className={styles.sectionLabel}>Weitere Profile</h2>
          {others.map((r) => (
            <RowerEditor key={r.id} r={r} />
          ))}
        </section>
      )}

      <section className={styles.section}>
        <h2 className={styles.sectionLabel}>Erscheinungsbild</h2>
        <ThemeSwitcher />
      </section>

      <section className={styles.section}>
        <h2 className={styles.sectionLabel}>Updates</h2>
        <UpdateStatusCard />
      </section>

      <section className={styles.section}>
        <h2 className={styles.sectionLabel}>Konto</h2>
        <button
          type="button"
          className={styles.addBtn}
          onClick={() => setPairingOpen(true)}
        >
          Rudernde/n hinzufügen
        </button>
      </section>

      {activeRower && (
        <PairingModal
          open={pairingOpen}
          onClose={() => setPairingOpen(false)}
          activeRowerID={activeRower.id}
        />
      )}

      <footer className={styles.footer}>
        {ergo.packedAt && (
          <p className={styles.footerLine} data-testid="offline-stand">
            Unterwegs-Daten: Stand {formatStand(ergo.packedAt)} · {ergo.packedSessions} Sessions
          </p>
        )}
        <p
          className={styles.footerLine}
          data-testid="build-version"
          title={new Date(__BUILD_TIME__).toLocaleString('de-DE')}
        >
          splits {__BUILD_VERSION__} · Build {__BUILD_SHA__}
        </p>
      </footer>
    </main>
  )
}
