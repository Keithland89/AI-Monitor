import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { DemoApp } from './DemoApp'
import { DemoDataProvider } from './data/DemoDataProvider'
import './index.css'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <DemoDataProvider>
      <DemoApp />
    </DemoDataProvider>
  </StrictMode>,
)
