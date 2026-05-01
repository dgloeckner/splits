import type { DistancePB, WindowPB } from '../../api/client'
import {
  pbTitleDistance,
  pbTitleWindow,
  pbHeroValue,
  pbDeltaText,
  pbIcon,
  type PBKind,
} from './pbCopy'
import styles from './PBCard.module.css'

type Props =
  | { kind: 'distance'; pb: DistancePB }
  | { kind: 'window'; pb: WindowPB }

export function PBCard(props: Props) {
  const title =
    props.kind === 'distance' ? pbTitleDistance(props.pb) : pbTitleWindow(props.pb)
  const value = pbHeroValue(props.kind, props.pb)
  const delta = pbDeltaText(props.kind, props.pb)
  const iconName = pbIcon(
    props.kind,
    props.kind === 'window' ? props.pb.metric : undefined,
  )
  const stamp = formatStamp(props.pb.achieved_at)

  return (
    <article className={styles.card} aria-label={`${title} ${value}`}>
      <header className={styles.head}>
        <Icon name={iconName} />
        <span className={styles.stamp}>{stamp}</span>
      </header>
      <h2 className={styles.title}>{title}</h2>
      <p className={styles.hero}>{value}</p>
      {delta && <p className={styles.delta}>{delta}</p>}
    </article>
  )
}

function Icon({ name }: { name: 'medal' | 'lightning' | 'stopwatch' | 'bolt' }) {
  const map: Record<string, string> = {
    medal: 'M12 2l3 6 6 .5-4.5 4 1.5 6.5L12 16l-6 3 1.5-6.5L3 8.5 9 8z',
    lightning: 'M13 2L3 14h7l-1 8 11-14h-7z',
    stopwatch: 'M12 8v5l3 2M12 22a8 8 0 100-16 8 8 0 000 16z M9 2h6',
    bolt: 'M11 21h-1l1-7H7.5L13 3h1l-1 7h3.5z',
  }
  return (
    <svg
      data-testid={`pb-icon-${name}`}
      className={styles.icon}
      viewBox="0 0 24 24"
      width="20"
      height="20"
      fill="currentColor"
      aria-hidden="true"
    >
      <path d={map[name]} />
    </svg>
  )
}

function formatStamp(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const dd = d.getDate().toString().padStart(2, '0')
  const mm = (d.getMonth() + 1).toString().padStart(2, '0')
  const yyyy = d.getFullYear()
  const hh = d.getHours().toString().padStart(2, '0')
  const mi = d.getMinutes().toString().padStart(2, '0')
  return `${dd}.${mm}.${yyyy} ${hh}:${mi}`
}

export type { PBKind }
