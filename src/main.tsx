/**
 * App entry point. Picks how the live audio context buffers (playbackMode.ts) before anything
 * builds on it, then mounts the React app (the full studio, or Pocket, the phone version: see
 * pocketMode.ts; each loads only its own interface) and starts the installed-app support (pwa.ts)
 * and, in the phone app, its native pieces (nativeApp.ts, appLifecycle.ts).
 */
// First: picks the live audio context's buffering before anything builds on it
import './audio/playbackMode'
import { lazy, StrictMode, Suspense } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import { startPwa } from './pwa/pwa'
import { wantsPocket } from './pocket/pocketMode'
import { startNativeApp } from './native/nativeApp'
import { startAppLifecycle } from './native/appLifecycle'
import { StudioGuard } from './components/StudioGuard'

const Root = wantsPocket() ? lazy(() => import('./pocket/PocketApp')) : lazy(() => import('./App.tsx'))

// (StudioGuard: if drawing the app goes wrong, a plain recovery screen rather than a blank page)
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <StudioGuard>
      <Suspense fallback={null}>
        <Root />
      </Suspense>
    </StudioGuard>
  </StrictMode>,
)

startPwa()
startNativeApp()
startAppLifecycle()
