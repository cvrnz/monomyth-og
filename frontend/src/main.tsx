import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'

// Makes the page installable as an app (see public/sw.js).
if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {})

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
