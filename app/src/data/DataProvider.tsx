import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { DataContext, EMPTY_FILTERS, scopeOf, type DataState, type Filters } from './store'
import type { DataMode, Dataset, LaneStatus } from './types'
import { loadSample } from './sample'
import { AgentDrawer } from '../ui/AgentDrawer'

const HOST_TIMEOUT_MS = 3000
const MODE_KEY = 'ai-monitor-mode'

/** Bumped on every load so a slower, superseded load cannot overwrite a newer one. */
let latestLoad = 0

/** The player hosts the app in a frame and answers getContext(); a plain `vite` dev server does neither. */
async function detectHost(): Promise<boolean> {
  if (typeof window === 'undefined' || window.parent === window) return false
  try {
    const { getContext } = await import('@microsoft/managed-apps/app')
    await Promise.race([getContext(), new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), HOST_TIMEOUT_MS))])
    return true
  } catch {
    return false
  }
}

function requestedMode(): DataMode | null {
  let m: string | null = new URLSearchParams(location.search).get('mode')
  try {
    m ??= sessionStorage.getItem(MODE_KEY)
  } catch {
    /* storage can be blocked inside the player frame */
  }
  return m === 'live' || m === 'sample' ? m : null
}

export function DataProvider({ children }: { children: ReactNode }) {
  const [ds, setDs] = useState<Dataset | null>(null)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [loading, setLoading] = useState(true)
  const [progress, setProgress] = useState<LaneStatus[]>([])
  const [host, setHost] = useState(false)
  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS)
  const [agent, setAgent] = useState<string | null>(null)

  const load = useCallback(async (mode: DataMode, hostAvailable: boolean) => {
    const id = ++latestLoad
    setLoading(true)
    setError('')
    setNotice('')
    setProgress([])
    try {
      if (mode === 'live' && hostAvailable) {
        try {
          const { loadLive } = await import('./live')
          const live = await loadLive((s) => {
            if (id === latestLoad) setProgress((p) => [...p.filter((x) => x.id !== s.id), s])
          })
          if (id !== latestLoad) return
          setDs(live)
          if (!live.lanes.some((l) => l.rows > 0)) setNotice('No live lane returned data. Check the lane status, or switch to the sample to explore the app.')
        } catch (e) {
          if (id !== latestLoad) return
          setDs(await loadSample())
          setNotice(`Live data could not be loaded (${e instanceof Error ? e.message : String(e)}), so the sample is shown.`)
        }
      } else {
        const sample = await loadSample()
        if (id !== latestLoad) return
        setDs(sample)
        if (mode === 'live') setNotice('Live data needs the Managed Apps player, so the sample is shown.')
      }
      setFilters(EMPTY_FILTERS)
    } catch (e) {
      if (id === latestLoad) setError(e instanceof Error ? e.message : String(e))
    } finally {
      if (id === latestLoad) setLoading(false)
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    void detectHost().then((h) => {
      if (cancelled) return
      setHost(h)
      void load(h ? (requestedMode() ?? 'live') : 'sample', h)
    })
    return () => {
      cancelled = true
    }
  }, [load])

  const switchMode = useCallback(
    (mode: DataMode) => {
      try {
        sessionStorage.setItem(MODE_KEY, mode)
      } catch {
        /* ignore */
      }
      void load(mode, host)
    },
    [load, host],
  )
  const mode = ds?.mode ?? 'sample'
  const reload = useCallback(() => void load(mode, host), [load, mode, host])

  const scope = useMemo(() => (ds ? scopeOf(ds, filters) : null), [ds, filters])
  const agentByKey = useMemo(() => new Map((ds?.agents ?? []).map((a) => [a.key, a])), [ds])
  const setFilter = useCallback(<K extends keyof Filters>(k: K, v: Filters[K]) => setFilters((f) => ({ ...f, [k]: v })), [])
  const resetFilters = useCallback(() => setFilters(EMPTY_FILTERS), [])

  const value = useMemo<DataState | null>(
    () =>
      ds && scope
        ? { ds, scope, filters, setFilter, resetFilters, agentByKey, openAgent: setAgent, hostAvailable: host, loading, progress, switchMode, reload, notice }
        : null,
    [ds, scope, filters, setFilter, resetFilters, agentByKey, host, loading, progress, switchMode, reload, notice],
  )

  if (!value)
    return (
      <div className="boot" role="status">
        {error ? (
          <>
            <h1>Couldn't load the data</h1>
            <p>{error}</p>
            <button type="button" className="btn" onClick={() => void load('sample', host)}>
              Load the sample
            </button>
          </>
        ) : (
          <>
            <span className="spinner" aria-hidden="true" />
            <p>Loading the agent inventory…</p>
            {progress.length > 0 && (
              <ul className="boot-lanes">
                {progress.map((p) => (
                  <li key={p.id}>
                    {p.label}: {p.state === 'loading' ? 'loading…' : p.state === 'ok' ? `${p.rows.toLocaleString()} rows` : p.state}
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </div>
    )

  return (
    <DataContext.Provider value={value}>
      {children}
      <AgentDrawer agentKey={agent} onClose={() => setAgent(null)} />
    </DataContext.Provider>
  )
}
