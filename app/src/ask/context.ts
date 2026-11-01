import type { Filters, Scope } from '../data/store'
import type { Dataset } from '../data/types'
import { reviewAgents, VERDICTS } from '../metrics/lifecycle'
import { A, C, count, distinct, EXTERNAL_TYPES, groupBy, K, RISK_ORDER } from '../metrics/measures'

export interface AskPage {
  /** e.g. "Governance & risk › Lifecycle review" */
  label: string
}

export interface AskTurn {
  question: string
  answer: string
}

/** Upper bound on the grounding text, so the prompt stays well inside what Cowork accepts. */
export const CONTEXT_LIMIT = 9000

const FILTER_LABEL: Record<keyof Filters, string> = { env: 'Environment', platform: 'Platform', riskBand: 'Risk band', origin: 'Agent origin' }

const n = (v: number) => (Number.isFinite(v) ? Math.round(v).toLocaleString('en-GB') : 'n/a')
const top = <T,>(rows: T[], by: (r: T) => number, k: number) => [...rows].sort((a, b) => by(b) - by(a)).slice(0, k)
const counts = (values: string[], k = 8) =>
  top([...groupBy(values.filter(Boolean), (v) => v)].map(([v, rs]) => ({ v, c: rs.length })), (r) => r.c, k)
    .map((r) => `${r.v} ${n(r.c)}`)
    .join('; ')

/**
 * A compact, plain-text summary of what the app has loaded, for grounding a Cowork answer.
 * Every figure is one the app already shows; nothing here calls a connector.
 */
export function buildContext(ds: Dataset, scope: Scope, filters: Filters, page: AskPage): string {
  const out: string[] = []
  const line = (s: string) => out.push(s)
  const agents = scope.agents

  line(`Source: ${ds.mode === 'live' ? 'live tenant data' : 'the anonymised sample that ships with the app (fictional names)'}, as of ${ds.asOf.slice(0, 10)}. Last-used dates come from Power Platform usage records in Azure Resource Graph.`)
  line(`Page open: ${page.label}.`)
  const set = (Object.keys(FILTER_LABEL) as (keyof Filters)[]).filter((k) => filters[k])
  line(set.length ? `Filters: ${set.map((k) => `${FILTER_LABEL[k]} = ${filters[k]}`).join('; ')}. ${n(agents.length)} of ${n(ds.agents.length)} agents in view.` : `No filters: all ${n(agents.length)} agents.`)
  const gaps = ds.lanes.filter((l) => l.state !== 'ok' && l.state !== 'sample')
  if (gaps.length) line(`Data not loaded (treat these areas as unknown, not zero): ${gaps.map((l) => `${l.label} (${l.state}${l.detail ? `: ${l.detail.slice(0, 80)}` : ''})`).join('; ')}.`)

  line('')
  line('## Agents')
  line(`Platforms: ${counts(agents.map((a) => a.platform))}.`)
  line(`Published ${n(A.published(agents))}; active in 7 days ${n(A.active7(agents))}; active in 30 days ${n(A.active30(agents))}; idle ${n(A.idle(agents))}; dormant ${n(A.dormant(agents))}; never used ${n(A.neverUsed(agents))}; no usage signal (Agent Builder and Azure AI Foundry, not judged on use) ${n(A.noUsageSignal(agents))}.`)
  line(`Origin: ${counts(agents.map((a) => a.agentOrigin), 4)}. Creators ${n(A.distinctCreators(agents))}; environments ${n(A.envsWithAgents(agents))}.`)
  line(`Top environments: ${counts(agents.map((a) => a.envName), 6)}.`)

  line('')
  line('## Ownership')
  line(`Without an owner ${n(A.withoutOwners(agents))}; owner not resolved in Entra (often a leaver) ${n(A.ownersNotResolved(agents))}; distinct owners ${n(A.distinctOwners(agents))}.`)
  const ownerless = top(agents.filter((a) => !a.hasOwner || a.ownerPrincipalType === 'Not resolved in Entra'), (a) => a.riskScore, 6)
  if (ownerless.length) line(`Riskiest with an owner gap: ${ownerless.map((a) => `${a.name} (${a.riskBand} ${a.riskScore}${a.sharedTenantWide ? ', shared tenant-wide' : ''})`).join('; ')}.`)

  line('')
  line('## Risk')
  line(`Bands: ${RISK_ORDER.map((b) => `${b} ${n(agents.filter((a) => a.riskBand === b).length)}`).join('; ')}. Unauthenticated ${n(A.unauthenticated(agents))}; shared tenant-wide ${n(A.tenantWide(agents))}; tenant-wide with no sign-in ${n(count(agents, (a) => a.sharedTenantWide && (a.authentication === 'None' || !a.authentication)))}; tenant-wide and never used ${n(A.orphan(agents))}; web search on ${n(A.webSearch(agents))}; quarantined ${n(A.quarantined(agents))}.`)
  const factors = [...groupBy(scope.riskDetail, (r) => r.factor)].map(([f, rs]) => ({ f, agents: distinct(rs, (r) => r.agentKey) }))
  if (factors.length) line(`Risk factors (agents affected): ${top(factors, (r) => r.agents, 8).map((r) => `${r.f} ${n(r.agents)}`).join('; ')}.`)
  const risky = top(agents.filter((a) => a.riskBand !== 'Low'), (a) => a.riskScore, 8)
  if (risky.length) line(`Highest risk: ${risky.map((a) => `${a.name} (${a.riskBand} ${a.riskScore}: ${a.riskReasons || 'no reasons recorded'})`).join('; ')}.`)

  const reviews = reviewAgents(agents)
  line('')
  line('## Lifecycle review (from last-used dates)')
  line(`Idle ${n(A.idle(agents))}; dormant ${n(A.dormant(agents))}; never used ${n(A.neverUsed(agents))}; no usage signal (Agent Builder and Azure AI Foundry, not judged on use) ${n(A.noUsageSignal(agents))}. Verdicts: ${VERDICTS.map((v) => `${v} ${n(reviews.filter((r) => r.verdict === v).length)}`).join('; ')}.`)
  const act = reviews.filter((r) => r.verdict === 'Retire' || r.verdict === 'Review').slice(0, 10)
  if (act.length) line(`To act on: ${act.map((r) => `${r.agent.name} — ${r.verdict}: ${r.reason}`).join('; ')}.`)

  line('')
  line('## Integrations')
  line(`Agents with knowledge ${n(A.withKnowledge(agents))}; with tools ${n(A.withTools(agents))}; calling other agents ${n(A.callingAgents(agents))}. Connector links ${n(C.links(scope.connectors))} across ${n(C.distinct(scope.connectors))} connectors; MCP links ${n(C.mcpLinks(scope.connectors))} on ${n(C.mcpAgents(scope.connectors))} agents. Knowledge bindings: external ${n(K.external(scope.knowledge))}, in-tenant ${n(K.tenant(scope.knowledge))}; agents reaching outside the tenant ${n(distinct(scope.knowledge, (k) => (EXTERNAL_TYPES.has(k.type) ? k.agentKey : '')))}.`)
  if (scope.sources.length) line(`Named knowledge sources ${n(scope.sources.length)} on ${n(distinct(scope.sources, (s) => s.agentKey))} agents; hosts: ${counts(scope.sources.map((s) => s.locatorHost), 6)}.`)

  if (ds.aiResources.length) line(`Azure AI Foundry: ${n(ds.aiResources.length)} resources; ${counts(ds.aiResources.map((r) => r.category), 5)}.`)

  if (ds.shadowSignals.length) {
    line('')
    line('## Shadow AI (Defender)')
    line(`${n(ds.shadowSignals.length)} AI apps and tools seen. Posture: ${counts(ds.shadowSignals.map((s) => s.posture), 5)}.`)
    line(`Most widespread: ${top(ds.shadowSignals, (s) => s.deviceCount, 8).map((s) => `${s.appName} (${s.vendor}, ${s.posture}) ${n(s.deviceCount)} devices`).join('; ')}.`)
  }

  const text = out.join('\n')
  return text.length > CONTEXT_LIMIT ? `${text.slice(0, CONTEXT_LIMIT)}\n[summary truncated]` : text
}

/** The full prompt: instructions, the grounding summary, up to two earlier turns, then the question. */
export function buildPrompt(question: string, context: string, history: AskTurn[] = []): string {
  const earlier = history
    .slice(-2)
    .map((t) => `Q: ${t.question}\nA: ${t.answer.slice(0, 1200)}`)
    .join('\n\n')
  return [
    'You are answering a question from someone using AI-Monitor, an app that inventories the AI agents in their Microsoft 365 tenant: who owns them, what they can reach and which to fix first. It does not hold usage, value or cost data; for those, point to Analytics Hub.',
    'Answer from the summary below first. If it does not cover the question, say what is missing before using anything else. Areas listed as not loaded are unknown, not zero.',
    'Lead with the answer in one or two sentences, then at most five short bullets. Use the agent names exactly as written. Do not invent figures.',
    '',
    '--- App summary ---',
    context,
    '--- End of summary ---',
    earlier && `\nEarlier in this conversation:\n${earlier}`,
    '',
    `Question: ${question.trim()}`,
  ]
    .filter((s) => s !== '')
    .join('\n')
}

/** Starter questions that the summary can answer, per section. */
export const SUGGESTIONS: Record<string, string[]> = {
  overview: ['Which are our riskiest agents, and why?', 'Which agents are shared tenant-wide with no sign-in?', 'Which agents have an owner who has left?', 'How far does agent knowledge reach outside the tenant?', 'What Shadow AI do we have?'],
  inventory: ['Which environments hold the most agents?', 'How many agents have no owner?', 'How many agents were provisioned by the platform rather than built by people?'],
  governance: ['What are our most common risk factors?', 'Which high-risk agents should we fix first?', 'Which agents should we retire, and why?'],
  integrations: ['Which agents use MCP servers?', 'How much knowledge comes from outside the tenant?', 'Which agents call other agents?'],
  foundry: ['What do we run in Azure AI Foundry?', 'Which Foundry resources are not covered by the agent inventory?'],
  shadow: ['Which unsanctioned AI apps are most widespread?', 'What should we block or sanction first?'],
  setup: ['Which data is missing, and what would it add?', 'What can I trust on this page today?'],
}
