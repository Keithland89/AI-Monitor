import { useCallback, useMemo, useState, type ReactNode } from 'react'
import { AgentDrawer } from '../ui/AgentDrawer'
import { syntheticDataset } from './demo'
import { DataContext, EMPTY_FILTERS, scopeOf, type DataState, type Filters } from './store'

export function DemoDataProvider({ children }: { children: ReactNode }) {
  const [ds] = useState(syntheticDataset)
  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS)
  const [agent, setAgent] = useState<string | null>(null)
  const scope = useMemo(() => scopeOf(ds, filters), [ds, filters])
  const agentByKey = useMemo(() => new Map(ds.agents.map((item) => [item.key, item])), [ds])
  const setFilter = useCallback(<K extends keyof Filters>(key: K, value: Filters[K]) => {
    setFilters((current) => ({ ...current, [key]: value }))
  }, [])
  const resetFilters = useCallback(() => setFilters(EMPTY_FILTERS), [])
  const unavailable = useCallback(() => {
    throw new Error('Live data operations are unavailable in the synthetic demo.')
  }, [])

  const value = useMemo<DataState>(
    () => ({
      ds,
      scope,
      filters,
      setFilter,
      resetFilters,
      agentByKey,
      openAgent: setAgent,
      hostAvailable: false,
      loading: false,
      progress: [],
      switchMode: unavailable,
      reload: unavailable,
      notice: '',
    }),
    [ds, scope, filters, setFilter, resetFilters, agentByKey, unavailable],
  )

  return (
    <DataContext.Provider value={value}>
      {children}
      <AgentDrawer agentKey={agent} onClose={() => setAgent(null)} />
    </DataContext.Provider>
  )
}
