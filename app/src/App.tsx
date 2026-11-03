import { useState } from 'react'
import { AskPanel } from './ask/AskPanel'
import { DashboardFrame } from './DashboardFrame'
import { useRoute } from './routes'
import { DataSourceDialog } from './ui/DataSourceDialog'

export default function App() {
  const [route, go] = useRoute()
  const [sourceOpen, setSourceOpen] = useState(false)
  const [askOpen, setAskOpen] = useState(false)
  return (
    <>
      <DashboardFrame
        route={route}
        go={go}
        onAskClick={() => setAskOpen(true)}
        onSourceClick={() => setSourceOpen(true)}
      />
      <DataSourceDialog open={sourceOpen} onClose={() => setSourceOpen(false)} />
      <AskPanel open={askOpen} onClose={() => setAskOpen(false)} route={route} />
    </>
  )
}
