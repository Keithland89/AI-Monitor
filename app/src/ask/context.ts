import type { Filters, Scope } from '../data/store'
import type { Agent, Dataset } from '../data/types'
import { appGroup, APP_GROUPS } from '../metrics/chat'
import { creditTotals, mainCurrency, poolRows } from '../metrics/cost'
import { agentTrends, reviewAgents, VERDICTS } from '../metrics/lifecycle'
import { A, C, distinct, groupBy, I, K, RISK_ORDER, sum } from '../metrics/measures'
import { lastDataDay, splitPeriods } from '../metrics/periods'

export interface AskPage {
  /** e.g. "Usage › Lifecycle & review" */
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
const pc = (v: number) => (Number.isFinite(v) ? `${Math.round(v * 100)}%` : 'n/a')
const top = <T,>(rows: T[], by: (r: T) => number, k: number) => [...rows].sort((a, b) => by(b) - by(a)).slice(0, k)
const counts = (values: string[], k = 8) =>
  top([...groupBy(values.filter(Boolean), (v) => v)].map(([v, rs]) => ({ v, c: rs.length })), (r) => r.c, k)
    .map((r) => `${r.v} ${n(r.c)}`)
    .join('; ')
const change = (cur: number, prev: number) => (prev ? `${cur >= prev ? '+' : '−'}${Math.round(Math.abs(cur / prev - 1) * 100)}% vs the 28 days before` : 'no earlier period')

/**
 * A compact, plain-text summary of what the app has loaded, for grounding a Cowork answer.
 * Every figure is one the app already shows; nothing here calls a connector.
 */
export function buildContext(ds: Dataset, scope: Scope, filters: Filters, page: AskPage): string {
  const out: string[] = []
  const line = (s: string) => out.push(s)
  const agents = scope.agents
  const end = lastDataDay(ds.interactions)

  line(`Source: ${ds.mode === 'live' ? 'live tenant data' : 'the anonymised sample that ships with the app (fictional names)'}, as of ${ds.asOf.slice(0, 10)}${end ? `; audit activity through ${end}` : ''}.`)
  line(`Page open: ${page.label}.`)
  const set = (Object.keys(FILTER_LABEL) as (keyof Filters)[]).filter((k) => filters[k])
  line(set.length ? `Filters: ${set.map((k) => `${FILTER_LABEL[k]} = ${filters[k]}`).join('; ')}. ${n(agents.length)} of ${n(ds.agents.length)} agents in view.` : `No filters: all ${n(agents.length)} agents.`)
  const gaps = ds.lanes.filter((l) => l.state !== 'ok' && l.state !== 'sample')
  if (gaps.length) line(`Data not loaded (treat these areas as unknown, not zero): ${gaps.map((l) => `${l.label} (${l.state}${l.detail ? `: ${l.detail.slice(0, 80)}` : ''})`).join('; ')}.`)

  line('')
  line('## Agents')
  line(`Platforms: ${counts(agents.map((a) => a.platform))}.`)
  line(`Published ${n(A.published(agents))}; active in 7 days ${n(A.active7(agents))}; active in 30 days ${n(A.active30(agents))} (${pc(A.adoptionRate(agents))}); idle ${n(A.idle(agents))}; dormant ${n(A.dormant(agents))}; never used ${n(A.neverUsed(agents))}.`)
  line(`Origin: ${counts(agents.map((a) => a.agentOrigin), 4)}. Creators ${n(A.distinctCreators(agents))}; without an owner ${n(A.withoutOwners(agents))}; environments ${n(A.envsWithAgents(agents))}.`)
  line(`Top environments: ${counts(agents.map((a) => a.envName), 6)}.`)

  line('')
  line('## Risk')
  line(`Bands: ${RISK_ORDER.map((b) => `${b} ${n(agents.filter((a) => a.riskBand === b).length)}`).join('; ')}. Unauthenticated ${n(A.unauthenticated(agents))}; shared tenant-wide ${n(A.tenantWide(agents))}; tenant-wide and never used ${n(A.orphan(agents))}; web search on ${n(A.webSearch(agents))}; quarantined ${n(A.quarantined(agents))}.`)
  const factors = [...groupBy(scope.riskDetail, (r) => r.factor)].map(([f, rs]) => ({ f, agents: distinct(rs, (r) => r.agentKey) }))
  if (factors.length) line(`Risk factors (agents affected): ${top(factors, (r) => r.agents, 8).map((r) => `${r.f} ${n(r.agents)}`).join('; ')}.`)
  const risky = top(agents.filter((a) => a.riskBand !== 'Low'), (a) => a.riskScore, 8)
  if (risky.length) line(`Highest risk: ${risky.map((a) => `${a.name} (${a.riskBand} ${a.riskScore}: ${a.riskReasons || 'no reasons recorded'})`).join('; ')}.`)

  const trends = agentTrends(scope.interactions, end)
  const reviews = reviewAgents(agents, trends)
  line('')
  line('## Lifecycle verdicts')
  line(`${VERDICTS.map((v) => `${v} ${n(reviews.filter((r) => r.verdict === v).length)}`).join('; ')}.`)
  const act = reviews.filter((r) => r.verdict === 'Retire' || r.verdict === 'Review').slice(0, 10)
  if (act.length) line(`To act on: ${act.map((r) => `${r.agent.name} — ${r.verdict}: ${r.reason}`).join('; ')}.`)

  const [cur, prev] = splitPeriods(scope.interactions, (r) => r.date, end, 28)
  line('')
  line('## Copilot activity, last 28 days')
  if (!ds.interactions.length) line('No audit-log activity loaded.')
  else {
    line(`Users ${n(I.users(cur))} (${change(I.users(cur), I.users(prev))}); sessions ${n(I.sessions(cur))}; interactions ${n(cur.length)} (${change(cur.length, prev.length)}).`)
    const byGroup = groupBy(cur, (r) => appGroup(r.appHost))
    line(`By surface (users / interactions): ${APP_GROUPS.filter((g) => byGroup.has(g)).map((g) => `${g} ${n(I.users(byGroup.get(g)!))} / ${n(byGroup.get(g)!.length)}`).join('; ')}.`)
    const busiest = top(
      [...trends].map(([key, t]) => ({ key, t })),
      (r) => r.t.users,
      12,
    )
    const byKey = new Map<string, Agent>(agents.map((a) => [a.key, a]))
    const named = busiest.filter((r) => byKey.has(r.key))
    if (named.length)
      line(
        `Most used agents (users now / 28 days before / return rate): ${named
          .map((r) => {
            const a = byKey.get(r.key)!
            return `${a.name} [${a.platform}, ${a.envName}${ds.namesResolved && a.ownerName ? `, owner ${a.ownerName}` : ''}] ${n(r.t.users)} / ${n(r.t.prevUsers)} / ${pc(r.t.returnRate)}`
          })
          .join('; ')}.`,
      )
  }

  line('')
  line('## Integrations')
  line(`Agents with knowledge ${n(A.withKnowledge(agents))}; with tools ${n(A.withTools(agents))}; calling other agents ${n(A.callingAgents(agents))}. Connector links ${n(C.links(scope.connectors))} across ${n(C.distinct(scope.connectors))} connectors; MCP links ${n(C.mcpLinks(scope.connectors))} on ${n(C.mcpAgents(scope.connectors))} agents. Knowledge bindings: external ${n(K.external(scope.knowledge))}, in-tenant ${n(K.tenant(scope.knowledge))}.`)

  if (scope.credits.length || ds.creditPool.length || ds.aiCostDaily.length) {
    line('')
    line('## Cost')
    if (scope.credits.length) {
      const t = creditTotals(scope.credits)
      const per = [...groupBy(scope.credits.filter((c) => c.agentKey), (c) => c.agentKey)].map(([k, rs]) => ({ k, v: sum(rs, (c) => c.billed + c.nonBilled) }))
      const names = new Map(ds.agents.map((a) => [a.key, a.name]))
      line(`Copilot Credits: ${n(t.total)} (billed ${n(t.billed)}, non-billed ${n(t.nonBilled)}) across ${n(t.agents)} agents; ${n(t.orphanedCredits)} credits from ${n(t.orphanedAgents)} agents no longer in the inventory.`)
      line(`Top consumers: ${top(per, (r) => r.v, 6).map((r) => `${names.get(r.k) ?? r.k} ${n(r.v)}`).join('; ')}.`)
    }
    for (const p of poolRows(ds.creditPool)) line(`${p.name} entitlement: purchased ${n(p.purchased)}, consumed ${n(p.consumed)} (${pc(p.used)}).`)
    if (ds.aiCostDaily.length) {
      const { currency } = mainCurrency(ds.aiCostDaily)
      const rows = ds.aiCostDaily.filter((r) => r.currency === currency)
      const resName = new Map(ds.aiResources.map((r) => [r.id.toLowerCase(), r.name]))
      const per = [...groupBy(rows, (r) => r.resourceId)].map(([id, rs]) => ({ id, v: sum(rs, (r) => r.cost) }))
      const dates = rows.map((r) => r.date).sort()
      line(`Azure AI spend ${dates[0]} to ${dates[dates.length - 1]}: ${n(sum(rows, (r) => r.cost))} ${currency}. Top resources: ${top(per, (r) => r.v, 4).map((r) => `${resName.get(r.id) ?? r.id.split('/').pop()} ${n(r.v)}`).join('; ')}.`)
    }
  }

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
    'You are answering a question from someone using AI-Monitor, an app that monitors the AI agents and Copilot use in their Microsoft 365 tenant.',
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
  overview: ['Summarise our agent estate for a leadership update', 'Which agents should we retire, and why?', 'What changed in the last 28 days?'],
  inventory: ['Which environments hold the most agents?', 'How many agents have no owner?', 'Which platforms are agents built on?'],
  usage: ['Which agents are growing fastest?', 'Which agents should we retire, and why?', 'Which popular agents are high risk?'],
  activity: ['How does Cowork use compare with Chat?', 'Is Copilot use growing?', 'Which surfaces have the most users?'],
  governance: ['What are our most common risk factors?', 'Which high-risk agents should we fix first?', 'How many agents are shared tenant-wide?'],
  integrations: ['Which agents use MCP servers?', 'How much knowledge comes from outside the tenant?', 'Which agents call other agents?'],
  foundry: ['What do we run in Azure AI Foundry?', 'Where is our Azure AI spend going?'],
  cost: ['Which agents use the most Copilot Credits?', 'Are credits concentrated in a few agents?', 'Where is our Azure AI spend going?'],
  shadow: ['Which unsanctioned AI apps are most widespread?', 'What should we block or sanction first?'],
  setup: ['Which data is missing, and what would it add?', 'What can I trust on this page today?'],
}
