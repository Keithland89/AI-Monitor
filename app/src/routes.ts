import { useEffect, useState } from 'react'

export type TabId = 'overview' | 'inventory' | 'governance' | 'integrations' | 'foundry' | 'shadow' | 'setup'

export interface TabDef {
  id: TabId
  label: string
  /** The one-line description under the label in the side navigation. */
  blurb: string
  intro: string
  views: { id: string; label: string }[]
  /** Whether the agent slicers (Environment, Platform, Risk band, Agent origin) apply here. */
  agentFilters: boolean
}

export const TABS: TabDef[] = [
  {
    id: 'overview',
    label: 'Overview',
    blurb: 'The agent estate at a glance',
    intro: 'How many agents exist, who built them, what they can reach, and which need attention.',
    views: [],
    agentFilters: true,
  },
  {
    id: 'inventory',
    label: 'Inventory',
    blurb: 'Every agent and who owns it',
    intro: 'Every agent across Copilot Studio, Agent Builder, Azure AI Foundry and SharePoint, and who builds and owns them.',
    views: [
      { id: 'all', label: 'All agents' },
      { id: 'inventory', label: 'Agent inventory' },
      { id: 'creators', label: 'Creators & ownership' },
      { id: 'sharepoint', label: 'SharePoint agents' },
    ],
    agentFilters: true,
  },
  {
    id: 'governance',
    label: 'Governance & risk',
    blurb: 'Risk, lifecycle and agents to review',
    intro: 'Risk scores, the factors behind them, idle and dormant agents, and the agents to review first.',
    views: [
      { id: 'risk', label: 'Risk & review' },
      { id: 'lifecycle', label: 'Lifecycle review' },
    ],
    agentFilters: true,
  },
  {
    id: 'integrations',
    label: 'Integrations',
    blurb: 'Connectors, tools and knowledge',
    intro: 'The connectors, MCP servers and knowledge that agents reach.',
    views: [
      { id: 'tools', label: 'Tools' },
      { id: 'knowledge', label: 'Knowledge & grounding' },
      { id: 'sources', label: 'Knowledge sources' },
    ],
    agentFilters: true,
  },
  {
    id: 'foundry',
    label: 'Azure AI Foundry',
    blurb: 'Projects and model deployments',
    intro: 'Foundry accounts, projects and model deployments across your subscriptions.',
    views: [],
    agentFilters: false,
  },
  {
    id: 'shadow',
    label: 'Shadow AI',
    blurb: 'Unsanctioned AI tools in use',
    intro: 'Unsanctioned AI tooling that Microsoft Defender sees on devices and the network.',
    views: [],
    agentFilters: false,
  },
  {
    id: 'setup',
    label: 'Setup & coverage',
    blurb: 'Data sources and lane status',
    intro: 'Where each number comes from, what the APIs cannot see, and how each data lane loaded.',
    views: [
      { id: 'sources', label: 'Data sources & gaps' },
      { id: 'lanes', label: 'Live lane status' },
    ],
    agentFilters: false,
  },
]

/** The side navigation: sections grouped by the job they serve. A group without a label is a single top-level link. */
export const NAV_GROUPS: { label?: string; tabs: TabId[] }[] = [
  { tabs: ['overview'] },
  { label: 'Agents', tabs: ['inventory', 'governance', 'integrations', 'foundry'] },
  { label: 'Security', tabs: ['shadow'] },
  { tabs: ['setup'] },
]

export interface Route {
  tab: TabDef
  view: string
  /** Page state carried in the hash query, such as `#/governance/lifecycle?verdict=Retire`, so a view can be linked and bookmarked. */
  params: Record<string, string>
}

/** Old links that moved, so bookmarks keep working. Views that were removed go to the Overview. */
const MOVED: Record<string, [TabId, string]> = {
  sharepoint: ['inventory', 'sharepoint'],
  'usage/lifecycle': ['governance', 'lifecycle'],
  usage: ['overview', ''],
  activity: ['overview', ''],
  cost: ['overview', ''],
}

export function parse(hash: string): Route {
  const [path, query = ''] = hash.replace(/^#\/?/, '').split('?')
  const [t0, v0] = path.split('/')
  const [t, v] = MOVED[`${t0}/${v0}`] ?? MOVED[t0] ?? [t0, v0]
  const tab = TABS.find((x) => x.id === t) ?? TABS[0]
  const view = tab.views.find((x) => x.id === v)?.id ?? tab.views[0]?.id ?? ''
  return { tab, view, params: Object.fromEntries(new URLSearchParams(query)) }
}

export function useRoute(): [Route, (tab: TabId, view?: string) => void] {
  const [route, setRoute] = useState(() => parse(location.hash))
  useEffect(() => {
    const on = () => setRoute(parse(location.hash))
    addEventListener('hashchange', on)
    return () => removeEventListener('hashchange', on)
  }, [])
  const go = (tab: TabId, view?: string) => {
    location.hash = href(tab, view).slice(1)
  }
  return [route, go]
}

/** One page parameter from the hash query. Setting it replaces the history entry, so filtering does not fill the back button. */
export function useParam(key: string): [string, (value: string) => void] {
  const [route] = useRoute()
  const set = (value: string) => location.replace(href(route.tab.id, route.view, { ...route.params, [key]: value }))
  return [route.params[key] ?? '', set]
}

export function href(tab: TabId, view?: string, params?: Record<string, string>) {
  const q = new URLSearchParams(Object.entries(params ?? {}).filter(([, v]) => v)).toString()
  return `#/${tab}${view ? `/${view}` : ''}${q ? `?${q}` : ''}`
}
