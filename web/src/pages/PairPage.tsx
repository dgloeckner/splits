import { useEffect, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { pair } from '../api/pairing'
import { ApiError } from '../api/error'

type Status = 'pending' | 'malformed' | 'stale' | 'error' | 'success'

function readToken(hash: string): string | null {
  if (!hash.startsWith('#t=')) return null
  const token = hash.slice(3)
  return token || null
}

export function PairPage() {
  const nav = useNavigate()
  const qc = useQueryClient()
  const location = useLocation()
  const [status, setStatus] = useState<Status>('pending')

  useEffect(() => {
    const tok = readToken(location.hash)
    if (!tok) {
      setStatus('malformed')
      return
    }
    pair(tok)
      .then(async () => {
        // Clear the fragment from URL + history.
        window.history.replaceState(null, '', '/')
        await qc.invalidateQueries({ queryKey: ['rowers'] })
        await qc.invalidateQueries({ queryKey: ['active-rower'] })
        setStatus('success')
        nav('/', { replace: true })
      })
      .catch((e) => {
        if (e instanceof ApiError && e.status === 410) {
          setStatus('stale')
        } else {
          setStatus('error')
        }
      })
  }, [nav, qc, location.hash])

  if (status === 'pending') return <p>Wird verbunden …</p>
  if (status === 'malformed') return <p>Pairing-Link ungültig.</p>
  if (status === 'stale')
    return <p>Code abgelaufen oder nicht mehr gültig — frag den Haushalt nach einem neuen.</p>
  if (status === 'error') return <p>Verbindung fehlgeschlagen.</p>
  return null
}
