/**
 * App entry point. Picks how the live audio context buffers (playbackMode.ts) before anything
 * builds on it, then mounts the React app.
 */
// First: picks the live audio context's buffering before anything builds on it
import './audio/playbackMode'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
