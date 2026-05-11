import { useNavigate } from 'react-router-dom'
import { useActiveRower } from '../hooks/useActiveRower'
import { startSession } from '../api/client'
import { FavoritesList } from './home/FavoritesList'
import { StaleSessionCard } from './home/StaleSessionCard'
import { IconJustRow, IconDistance, IconTime, IconInterval, IconRace } from '../icons/workout'
import styles from './HomePage.module.css'

export function HomePage() {
  const active = useActiveRower()
  const nav = useNavigate()

  async function startJustRow() {
    await startSession()
    nav('/live')
  }

  function pickMode(mode: 'distance' | 'time' | 'intervals' | 'race') {
    nav(`/workout/new/${mode}`)
  }

  return (
    <main className={styles.page}>
      <h1 className={styles.heading}>Home</h1>

      <section className={styles.start}>
        <button
          type="button"
          className={styles.hero}
          onClick={startJustRow}
          data-testid="picker-just-row"
        >
          <span className={styles.heroIcon}>
            <IconJustRow size={32} />
          </span>
          <span className={styles.heroText}>
            <span className={styles.heroLabel}>Nur rudern</span>
            <span className={styles.heroHint}>Schnellstart ohne Ziel</span>
          </span>
        </button>

        <div className={styles.modes}>
          <button
            type="button"
            className={styles.mode}
            onClick={() => pickMode('distance')}
            data-testid="picker-distance"
          >
            <span className={styles.modeIcon}><IconDistance size={24} /></span>
            <span className={styles.modeLabel}>Distanz</span>
          </button>
          <button
            type="button"
            className={styles.mode}
            onClick={() => pickMode('time')}
            data-testid="picker-time"
          >
            <span className={styles.modeIcon}><IconTime size={24} /></span>
            <span className={styles.modeLabel}>Zeit</span>
          </button>
          <button
            type="button"
            className={styles.mode}
            onClick={() => pickMode('intervals')}
            data-testid="picker-intervals"
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
          >
            <span className={styles.modeIcon}><IconRace size={24} /></span>
            <span className={styles.modeLabel}>Rennen</span>
          </button>
        </div>
      </section>

      <StaleSessionCard rowerID={active.data?.id} />
      <FavoritesList rowerID={active.data?.id} />
    </main>
  )
}
