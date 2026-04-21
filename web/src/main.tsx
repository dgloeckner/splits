import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { registerSW } from 'virtual:pwa-register'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

import '@fontsource-variable/space-grotesk/index.css'
import '@fontsource-variable/inter/index.css'
import './styles/tokens.css'
import './styles/reset.css'
import './styles/base.css'

import { AppRouter } from './app/AppRouter'

registerSW({ immediate: true })

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      refetchOnWindowFocus: false,
    },
  },
})

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <AppRouter />
    </QueryClientProvider>
  </StrictMode>,
)
