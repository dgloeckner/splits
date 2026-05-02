import { useTheme, type ThemeKind } from '../../theme/useTheme'
import styles from './ThemeSwitcher.module.css'

const OPTIONS: { value: ThemeKind; label: string }[] = [
  { value: 'system', label: 'System' },
  { value: 'dark', label: 'Dunkel' },
  { value: 'light', label: 'Hell' },
]

/**
 * 3-segment control for the theme preference. Wires the existing
 * `useTheme` hook (storage + matchMedia + data-theme attribute) to a
 * user-facing button group on the Profile page.
 */
export function ThemeSwitcher() {
  const [theme, setTheme] = useTheme()
  return (
    <fieldset className={styles.fieldset}>
      <legend className={styles.legend}>Erscheinungsbild</legend>
      <div className={styles.segments} role="radiogroup" aria-label="Theme">
        {OPTIONS.map((opt) => {
          const active = theme === opt.value
          return (
            <button
              key={opt.value}
              type="button"
              role="radio"
              aria-checked={active}
              className={active ? styles.segActive : styles.seg}
              onClick={() => setTheme(opt.value)}
            >
              {opt.label}
            </button>
          )
        })}
      </div>
    </fieldset>
  )
}
