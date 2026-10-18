import { useNavigate } from 'react-router-dom'
import { useActiveRower } from '../hooks/useActiveRower'
import { startSession } from '../api/client'
import { handleStartFailure } from '../offline/offlinePrompt'
import { FavoritesList } from './home/FavoritesList'
import { StaleSessionCard } from './home/StaleSessionCard'
import { IconJustRow, IconDistance, IconTime, IconInterval, IconRace } from '../icons/workout'
import { ErgoStandNotice } from '../offline/ErgoStandNotice'
import { useErgoStatus } from '../offline/ergoStatus'
import styles from './HomePage.module.css'

export function HomePage() {
  const active = useActiveRower()
  const nav = useNavigate()
  const { reachable } = useErgoStatus()
  // Starts need the Ergo: held while unknown (ADR-0021) and while away.
  const canStart = reachable === true

  async function startJustRow() {
    try {
      await startSession()
    } catch (e) {
      handleStartFailure(e)
      return
    }
    nav('/live')
  }

  function pickMode(mode: 'distance' | 'time' | 'intervals' | 'race') {
    nav(`/workout/new/${mode}`)
  }

  return (
    <main className={styles.page}>
      <h1 className={styles.heading}>Home</h1>

      <ErgoStandNotice variant="hero" />
      {reachable === 'unknown' && (
        <p className={styles.searching} role="status" data-testid="ergo-searching">
          Suche Ergo…
        </p>
      )}

      <section
        className={canStart ? styles.start : `${styles.start} ${styles.startDimmed}`}
        aria-disabled={!canStart}
      >
        <button
          type="button"
          className={styles.hero}
          onClick={startJustRow}
          data-testid="picker-just-row"
          disabled={!canStart}
        >
          <span className={styles.heroIcon}>
            <IconJustRow size={32} />
          </span>
          <span className={styles.heroText}>
            <span className={styles.heroLabel}>Nur rudern</span>
            <span className={styles.heroHint}>Schnellstart ohne Ziel</span>
          </span>
          {/* F7: chevron signals "tap to act" so the teal-fill doesn't
            * read as "this mode is already selected" (it's a sibling
            * mode, not a current selection). */}
          <span className={styles.heroChevron} aria-hidden="true">›</span>
        </button>

        <div className={styles.modes}>
          <button
            type="button"
            className={styles.mode}
            onClick={() => pickMode('distance')}
            data-testid="picker-distance"
            disabled={!canStart}
          >
            <span className={styles.modeIcon}><IconDistance size={24} /></span>
            <span className={styles.modeLabel}>Distanz</span>
          </button>
          <button
            type="button"
            className={styles.mode}
            onClick={() => pickMode('time')}
            data-testid="picker-time"
            disabled={!canStart}
          >
            <span className={styles.modeIcon}><IconTime size={24} /></span>
            <span className={styles.modeLabel}>Zeit</span>
          </button>
          <button
            type="button"
            className={styles.mode}
            onClick={() => pickMode('intervals')}
            data-testid="picker-intervals"
            disabled={!canStart}
          >
            <span className={styles.modeIcon}><IconInterval size={24} /></span>
            <span className={styles.modeLabel}>Intervalle</span>
          </button>
        </div>

        <div className={styles.modes}>
          <button
            type="button"
            className={styles.mode}
            onClick={() => pickMode('race')}
            data-testid="picker-race"
            disabled={!canStart}
          >
            <span className={styles.modeIcon}><IconRace size={24} /></span>
            <span className={styles.modeLabel}>Rennen</span>
          </button>
        </div>
      </section>

      <StaleSessionCard rowerID={active.data?.id} />
      <FavoritesList rowerID={active.data?.id} disabled={!canStart} />
    </main>
  )
}
