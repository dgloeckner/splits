import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useRowers } from '../hooks/useRowers'
import { mintPairing, type PairingMint } from '../api/pairing'
import { createRower } from '../api/rowers'
import styles from './PairingModal.module.css'

type Tab = 'create' | 'link'

type Props = {
  open: boolean
  onClose: () => void
  activeRowerID: string
}

export function PairingModal({ open, onClose, activeRowerID }: Props) {
  const [tab, setTab] = useState<Tab>('create')
  if (!open) return null
  return (
    <div className={styles.backdrop} role="dialog" aria-modal="true">
      <div className={styles.sheet}>
        <div className={styles.tabs}>
          <button
            type="button"
            className={tab === 'create' ? styles.tabActive : styles.tab}
            onClick={() => setTab('create')}
          >
            Neuer Ruderer auf diesem Gerät anlegen
          </button>
          <button
            type="button"
            className={tab === 'link' ? styles.tabActive : styles.tab}
            onClick={() => setTab('link')}
          >
            Pairing-Link für ein anderes Gerät erstellen
          </button>
        </div>
        {tab === 'create' ? (
          <CreateRowerForm onDone={onClose} />
        ) : (
          <MintLinkForm defaultRowerID={activeRowerID} />
        )}
        <button type="button" className={styles.closeBtn} onClick={onClose}>
          Schließen
        </button>
      </div>
    </div>
  )
}

function CreateRowerForm({ onDone }: { onDone: () => void }) {
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const qc = useQueryClient()
  async function submit() {
    if (!name.trim()) return
    setBusy(true)
    try {
      await createRower({ name: name.trim() })
      await qc.invalidateQueries({ queryKey: ['rowers'] })
      await qc.invalidateQueries({ queryKey: ['active-rower'] })
      onDone()
    } finally {
      setBusy(false)
    }
  }
  return (
    <div>
      <label className={styles.row}>
        <span className={styles.lbl}>Name</span>
        <input
          className={styles.input}
          aria-label="Name"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
      </label>
      <button type="button" className={styles.cta} disabled={busy || !name.trim()} onClick={submit}>
        {busy ? 'Anlegen…' : 'Anlegen'}
      </button>
    </div>
  )
}

function MintLinkForm({ defaultRowerID }: { defaultRowerID: string }) {
  const rowers = useRowers()
  const [pickID, setPickID] = useState(defaultRowerID)
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<PairingMint | null>(null)

  async function mint() {
    setBusy(true)
    try {
      const m = await mintPairing(pickID)
      setResult(m)
    } finally {
      setBusy(false)
    }
  }

  if (result) {
    return (
      <div>
        <p className={styles.urlLabel}>Pairing-URL (24h gültig, einmalig):</p>
        <code className={styles.urlBox}>{result.url}</code>
        <div className={styles.qrBox} dangerouslySetInnerHTML={{ __html: result.qr_svg }} />
        <button
          type="button"
          className={styles.cta}
          onClick={() => navigator.clipboard?.writeText(result.url)}
        >
          URL kopieren
        </button>
      </div>
    )
  }

  return (
    <div>
      <label className={styles.row}>
        <span className={styles.lbl}>Profil</span>
        <select
          className={styles.input}
          value={pickID}
          onChange={(e) => setPickID(e.target.value)}
          aria-label="Profil"
        >
          {(rowers.data ?? []).map((r) => (
            <option key={r.id} value={r.id}>{r.name}</option>
          ))}
        </select>
      </label>
      <button type="button" className={styles.cta} disabled={busy || !pickID} onClick={mint}>
        {busy ? 'Erzeuge…' : 'Link erzeugen'}
      </button>
    </div>
  )
}
