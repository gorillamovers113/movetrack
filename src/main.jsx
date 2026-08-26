import React from 'react'
import { createRoot } from 'react-dom/client'
import './styles.css'
import App from './App.jsx'

createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)

// Register the app-shell service worker for install-to-home-screen support.
// It's a minimal no-op worker (public/sw.js) — offline DATA is handled by
// Firestore's persistent local cache, not by this worker. Skip in dev so
// Vite's own module reloading isn't shadowed by a stale worker.
if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch((err) => {
      console.warn('Service worker registration failed:', err)
    })
  })
}
