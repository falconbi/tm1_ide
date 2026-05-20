import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'

// Warn before closing with unsaved changes
window.addEventListener('beforeunload', (e) => {
  const { tabs } = window.__tm1store?.getState?.() ?? {}
  if (tabs?.some(t => t.dirty)) {
    e.preventDefault()
    e.returnValue = ''
  }
})

const saved = localStorage.getItem('tm1-theme')
const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches
if (saved === 'dark' || (!saved && prefersDark)) {
  document.documentElement.classList.add('dark')
}

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
