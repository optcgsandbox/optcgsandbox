import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { useGameStore } from './store/game'
import { getLegalActions } from '@shared/engine-v2/rules/legality'
import { applyAction } from '@shared/engine-v2/reducers/applyAction'

// Dev/test-only state hook for Playwright assertions. Disabled in production
// builds; gated on `?test=1` so it never leaks to live users either.
if (
  import.meta.env.DEV ||
  (typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('test') === '1')
) {
  ;(window as unknown as { __store: typeof useGameStore; __getLegalActions: typeof getLegalActions; __applyAction: typeof applyAction }).__store = useGameStore
  ;(window as unknown as { __store: typeof useGameStore; __getLegalActions: typeof getLegalActions; __applyAction: typeof applyAction }).__getLegalActions = getLegalActions
  // Stage D harness escape hatch: lets golden specs bypass the
  // src/store/game.ts AI-mode wrapper (which auto-dismisses trigger windows
  // for the human defender when B is AI). Test-mode only. Does not affect
  // engine behavior in any way — applyAction is a pure function.
  ;(window as unknown as { __store: typeof useGameStore; __getLegalActions: typeof getLegalActions; __applyAction: typeof applyAction }).__applyAction = applyAction
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
