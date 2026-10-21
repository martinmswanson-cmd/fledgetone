/**
 * App entry point. Picks how the live audio context buffers (playbackMode.ts) before anything
 * builds on it, then mounts the React app (the full studio, or Pocket, the phone version: see
 * pocketMode.ts; each loads only its own interface) and starts the installed-app support (pwa.ts).
 */
// First: picks the live audio context's buffering before anything builds on it
import './audio/playbackMode'
import { lazy, StrictMode, Suspense } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import { startPwa } from './pwa/pwa'
import { wantsPocket } from './pocket/pocketMode'
import { startNativeApp } from './native/nativeApp'

const Root = wantsPocket() ? lazy(() => import('./pocket/PocketApp')) : lazy(() => import('./App.tsx'))

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Suspense fallback={null}>
      <Root />
    </Suspense>
  </StrictMode>,
)

startPwa()
startNativeApp()
