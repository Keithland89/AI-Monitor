import { useEffect, useState } from 'react'

export type TabId = 'overview' | 'inventory' | 'usage' | 'activity' | 'governance' | 'integrations' | 'foundry' | 'cost' | 'shadow' | 'setup'

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
    intro: 'How many agents exist, how many are used, and how many need attention.',
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
    id: 'usage',
    label: 'Usage',
    blurb: 'Which agents people use',
    intro: 'Which agents people use, how recently, how adoption grows, and which agents to promote or retire.',
    views: [
      { id: 'analytics', label: 'Agent analytics' },
      { id: 'popularity', label: 'Usage & popularity' },
      { id: 'adoption', label: 'Adoption & activity' },
      { id: 'lifecycle', label: 'Lifecycle & review' },
    ],
    agentFilters: true,
  },
  {
    id: 'activity',
    label: 'Copilot activity',
    blurb: 'Chat, Cowork and work patterns',
    intro: 'Audit-log interactions with agents, Copilot Chat, in-app Copilot and Cowork, and where Copilot fits the way people work.',
    views: [
      { id: 'interactions', label: 'Interactions' },
      { id: 'chat', label: 'Chat & Cowork' },
      { id: 'habits', label: 'Habit stages' },
      { id: 'patterns', label: 'Work patterns' },
    ],
    agentFilters: true,
  },
  {
    id: 'governance',
    label: 'Governance & risk',
    blurb: 'Risk scores and agents to review',
    intro: 'Risk scores, the factors behind them, and the agents to review first.',
    views: [],
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
    id: 'cost',
    label: 'Cost & consumption',
    blurb: 'Credits, capacity and Azure spend',
    intro: 'Copilot Credits that agents consume, the tenant capacity behind them, and Azure AI spend.',
    views: [
      { id: 'credits', label: 'Copilot Studio credits' },
      { id: 'azure', label: 'Azure AI spend' },
    ],
    agentFilters: true,
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
  { label: 'Agents', tabs: ['inventory', 'usage', 'governance', 'integrations'] },
  { label: 'Copilot', tabs: ['activity'] },
  { label: 'Spend & platforms', tabs: ['cost', 'foundry'] },
  { label: 'Security', tabs: ['shadow'] },
  { tabs: ['setup'] },
]

export interface Route {
  tab: TabDef
  view: string
  /** Page state carried in the hash query, such as `#/usage/lifecycle?verdict=Retire`, so a view can be linked and bookmarked. */
  params: Record<string, string>
}

/** Old links that moved, so bookmarks keep working. */
const MOVED: Record<string, [TabId, string]> = { sharepoint: ['inventory', 'sharepoint'] }

export function parse(hash: string): Route {
  const [path, query = ''] = hash.replace(/^#\/?/, '').split('?')
  const [t0, v0] = path.split('/')
  const [t, v] = MOVED[t0] ?? [t0, v0]
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
