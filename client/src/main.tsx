import React from 'react'
import ReactDOM from 'react-dom/client'
import { App } from './App.tsx'
import { ArcanaDefs } from './components/Arcana.tsx'
import { trackViewportHeight } from './viewport.ts'
import './styles.css'

// Before first paint: the game screen sizes itself from --app-h (see viewport.ts).
trackViewportHeight()

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ArcanaDefs />
    <App />
  </React.StrictMode>,
)
