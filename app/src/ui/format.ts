const nf0 = new Intl.NumberFormat('en-GB', { maximumFractionDigits: 0 })
const nf1 = new Intl.NumberFormat('en-GB', { minimumFractionDigits: 1, maximumFractionDigits: 1 })
const nf2 = new Intl.NumberFormat('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

export type Fmt = (n: number) => string

const ok = (n: number) => typeof n === 'number' && Number.isFinite(n)
export const DASH = '–'

export const int: Fmt = (n) => (ok(n) ? nf0.format(n) : DASH)
export const dec1: Fmt = (n) => (ok(n) ? nf1.format(n) : DASH)
export const dec2: Fmt = (n) => (ok(n) ? nf2.format(n) : DASH)
export const pct: Fmt = (n) => (ok(n) ? `${nf1.format(n * 100)}%` : DASH)
export const pct0: Fmt = (n) => (ok(n) ? `${nf0.format(n * 100)}%` : DASH)
export const signedPct: Fmt = (n) => (ok(n) ? `${n > 0 ? '+' : n < 0 ? '−' : ''}${nf1.format(Math.abs(n) * 100)}%` : DASH)

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
export const monthLabel = (iso: string) => (iso ? `${MONTHS[Number(iso.slice(5, 7)) - 1]} ${iso.slice(0, 4)}` : DASH)
/** Axis tick for a month: "Jan 26". */
export const monthTick = (iso: string) => (iso ? `${MONTHS[Number(iso.slice(5, 7)) - 1]} ${iso.slice(2, 4)}` : DASH)
export const monthShort = (iso: string) => (iso ? MONTHS[Number(iso.slice(5, 7)) - 1] : DASH)
export const dayLabel = (iso: string) => (iso ? `${Number(iso.slice(8, 10))} ${MONTHS[Number(iso.slice(5, 7)) - 1]}` : DASH)
export const dateLabel = (iso: string) => (iso ? `${dayLabel(iso)} ${iso.slice(0, 4)}` : DASH)

/** "Nice" axis maximum and ticks. */
export function niceTicks(max: number, count = 4): number[] {
  if (!(max > 0)) return [0, 1]
  const raw = max / count
  const mag = 10 ** Math.floor(Math.log10(raw))
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) ?? raw
  const ticks: number[] = []
  for (let v = 0; v <= max + step * 0.001; v += step) ticks.push(Number(v.toPrecision(10)))
  if (ticks[ticks.length - 1] < max) ticks.push(Number((ticks[ticks.length - 1] + step).toPrecision(10)))
  return ticks
}

export const compact: Fmt = (n) => {
  if (!ok(n)) return DASH
  if (Math.abs(n) >= 1000) return `${nf1.format(n / 1000)}k`
  return Number.isInteger(n) ? nf0.format(n) : nf1.format(n)
}

const REGION_WORDS = [
  'southeast', 'united', 'states', 'kingdom', 'central', 'south', 'north', 'east', 'west', 'europe', 'asia', 'pacific',
  'australia', 'japan', 'india', 'germany', 'switzerland', 'norway', 'sweden', 'france', 'canada', 'brazil', 'africa',
  'korea', 'singapore', 'italy', 'poland', 'spain', 'israel', 'qatar', 'mexico', 'new', 'zealand', 'taiwan',
  'indonesia', 'malaysia', 'chile', 'austria', 'belgium', 'denmark', 'finland', 'greece', 'ireland', 'uae', 'gov', 'us', 'uk',
].sort((a, b) => b.length - a.length)
const REGION_UPPER = new Set(['us', 'uk', 'uae'])

/** Readable Azure or Power Platform region names: "eastus2" becomes "East US 2", "unitedkingdom" becomes "United Kingdom". */
export function regionLabel(code: string | null | undefined): string {
  const raw = (code ?? '').trim()
  if (!raw || /[\sA-Z]/.test(raw)) return raw
  const words: string[] = []
  let rest = raw
  while (rest) {
    const digits = /^\d+/.exec(rest)
    const word = digits?.[0] ?? REGION_WORDS.find((w) => rest.startsWith(w))
    if (!word) return raw
    words.push(REGION_UPPER.has(word) ? word.toUpperCase() : word[0].toUpperCase() + word.slice(1))
    rest = rest.slice(word.length)
  }
  return words.join(' ')
}
const CONNECTOR_NAMES: Record<string, string> = {
  commondataserviceforapps: 'Dataverse',
  office365: 'Office 365 Outlook',
  office365users: 'Office 365 Users',
  sharepointonline: 'SharePoint',
  teams: 'Microsoft Teams',
  msnweather: 'MSN Weather',
  dynamicsax: 'Dynamics 365 Finance and Operations',
  excelonlinebusiness: 'Excel Online (Business)',
  planner: 'Planner',
  azureaisearch: 'Azure AI Search',
  'service-now': 'ServiceNow',
  powerplatformadminv2: 'Power Platform for Admins V2',
  computeroperator: 'Computer use',
  processmining: 'Process mining',
  microsoftlearndocsmcpserver: 'Microsoft Learn Docs MCP',
  d365erpmcpserver: 'Dynamics 365 ERP MCP',
  d365contactcenteradminmcpserver: 'Dynamics 365 Contact Center admin MCP',
  a365copilotchatmcp: 'Agent 365 Copilot Chat MCP',
  a365memcp: 'Agent 365 Me MCP',
  a365outlookmailmcp: 'Agent 365 Outlook Mail MCP',
  a365mcpservers: 'Agent 365 MCP servers',
  workiqsharepoint: 'Work IQ SharePoint',
  workiqmcp: 'Work IQ MCP',
}

/** A readable name for a Power Platform connector id such as `shared_office365`; unknown ids lose only the `shared_` prefix. */
export function connectorLabel(id: string): string {
  const key = id.replace(/^shared_/, '')
  return CONNECTOR_NAMES[key] ?? (key || DASH)
}

const KNOWLEDGE_NAMES: Record<string, string> = {
  publicSites: 'Public websites',
  sharepointSites: 'SharePoint',
  dataverseSources: 'Dataverse',
  files: 'Files',
  fileGroups: 'File groups',
  graphConnectors: 'Graph connectors',
  powerPlatformConnectors: 'Connectors',
  bingCustomSearch: 'Bing custom search',
  teamsMessages: 'Teams messages',
}

/** Turns the API's `sharepointSites; publicSites` list into `SharePoint, Public websites`. */
export function knowledgeLabel(list: string): string {
  return list
    .split(';')
    .map((k) => k.trim())
    .filter(Boolean)
    .map((k) => KNOWLEDGE_NAMES[k] ?? k)
    .join(', ')
}