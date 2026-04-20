import { useTheme } from '../theme/useTheme'
import { Button } from '../components/Button/Button'

export function ProfilePage() {
  const [theme, setTheme] = useTheme()
  return (
    <div style={{ padding: 'var(--space-3)', display: 'grid', gap: 'var(--space-3)' }}>
      <h1 className="headline-sm">Profil</h1>
      <section>
        <h2 className="label-sm">Design</h2>
        <div style={{ display: 'flex', gap: 'var(--space-1)', marginTop: 'var(--space-1)' }}>
          <Button
            variant={theme === 'system' ? 'primary' : 'secondary'}
            onClick={() => setTheme('system')}
          >
            System
          </Button>
          <Button
            variant={theme === 'dark' ? 'primary' : 'secondary'}
            onClick={() => setTheme('dark')}
          >
            Dunkel
          </Button>
          <Button
            variant={theme === 'light' ? 'primary' : 'secondary'}
            onClick={() => setTheme('light')}
          >
            Hell
          </Button>
        </div>
      </section>
      <p className="body-lg">
        Weitere Profil-Inhalte (Rekorde, Ziele, Rower-Switcher) folgen in einem späteren Plan.
      </p>
    </div>
  )
}
