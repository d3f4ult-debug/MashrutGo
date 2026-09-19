import React from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import 'remixicon/fonts/remixicon.css'
import './index.css'
import { registerServiceWorker } from './sw/registerServiceWorker'

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)

registerServiceWorker()
