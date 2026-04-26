import { useActiveRower } from '../hooks/useActiveRower'
import { FavoritesList } from './home/FavoritesList'
import styles from './HomePage.module.css'

export function HomePage() {
  const active = useActiveRower()
  return (
    <main className={styles.page}>
      <h1 className={styles.heading}>Home</h1>
      <FavoritesList rowerID={active.data?.id} />
    </main>
  )
}
