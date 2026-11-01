import { useMemo, useState } from 'react'
import { useData } from '../data/store'
import { A, EXTERNAL_TYPES, count, cumulative, distinct, div, monthly } from '../metrics/measures'
import { periodChange } from '../metrics/periods'
import { ATTENTION, attentionCounts } from '../metrics/attention'
import { laneProblem, unknownFrom } from '../metrics/coverage'
import { reviewAgents } from '../metrics/lifecycle'
import { href } from '../routes'
import { ColumnChart, LineChart, Sparkline } from '../ui/charts'
import { dateLabel, int, monthLabel, monthTick, pct, pct0 } from '../ui/format'
import { Grid, InfoTip, Kpi, KpiRow, Panel, Segmented } from '../ui/primitives'
import { COLOR, PALETTE, RISK_COLOR } from '../ui/theme'
import { CoverageBanner } from './common'

const ANALYTICS_HUB = 'https://github.com/microsoft/AnalyticsHub-Dashboard'

/** Who made each agent: people, the platform itself, or nobody on record. */
const ORIGINS = [
  { key: 'Human-built', label: 'Human-built', color: COLOR.licensed },
  { key: 'Platform-provisioned', label: 'Platform-provisioned', color: COLOR.agent },
  { key: 'Creator unknown', label: 'Creator unknown', color: PALETTE[6] },
]

const greetingFor = (hour: number) => (hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening')

type GrowthView = 'total' | 'monthly'
const GROWTH_VIEWS: { id: GrowthView; label: string }[] = [
  { id: 'total', label: 'Running total' },
  { id: 'monthly', label: 'Per month' },
]

/** The headline card: every agent, split by who made it. */
function EstateCard({ total, newIn7, parts }: { total: number; newIn7: number; parts: { label: string; value: number; color: string }[] }) {
  return (
    <div className="kpi kpi-hero kpi-link tone-agent">
      <div className="kpi-label">
        <span>Agent estate</span>
        <InfoTip label="Agent estate" text="Every agent in the inventory across Copilot Studio, Microsoft 365 Copilot Agent Builder and Azure AI Foundry projects, split by origin. Platform-provisioned agents are created by Microsoft services, not by a person." />
      </div>
      <div className="kpi-figure">
        <a className="kpi-value" href={href('inventory', 'all')} aria-label={`${int(total)} agents: show the list`}>
          {int(total)}
        </a>
      </div>
      <div className="kpi-sub">
        <b>{int(newIn7)}</b> new in the last 7 days
      </div>
      <ul className="hero-parts">
        {parts.map((p) => {
          const share = div(p.value, total)
          return (
            <li key={p.label}>
              <span className="hero-track" aria-hidden="true">
                <span style={{ width: `${Number.isFinite(share) ? share * 100 : 0}%`, background: p.color }} />
              </span>
              <span className="hp-label">{p.label}</span>
              <span className="hp-value">
                {int(p.value)}
                <small>{pct0(share)}</small>
              </span>
            </li>
          )
        })}
      </ul>
    </div>
  )
}

interface AttentionItem {
  id: string
  count: number
  label: string
  help: string
  to: string
  /** Security exposure to fix first, or housekeeping that can wait for a review cycle. */
  urgent?: boolean
}

const ATTENTION_GROUPS = [
  { urgent: true, title: 'Fix first' },
  { urgent: false, title: 'Tidy up' },
] as const

/** The briefing's second half: the few counts worth acting on, worst first, each linking to the agents behind it. */
function AttentionList({ items }: { items: AttentionItem[] }) {
  const shown = items.filter((i) => i.count > 0)
  return (
    <Panel title="What needs attention" note="Security exposure first, then housekeeping. Select a line to see the agents behind it.">
      {shown.length ? (
        ATTENTION_GROUPS.map((g) => {
          const rows = shown.filter((i) => !!i.urgent === g.urgent)
          if (!rows.length) return null
          return (
            <section key={g.title} className={`at-group${g.urgent ? ' urgent' : ''}`} aria-label={g.title}>
              <h4>{g.title}</h4>
              <ul className="attention">
                {rows.map((i) => (
                  <li key={i.id}>
                    <a href={i.to} title={i.help}>
                      <span className="at-count">{int(i.count)}</span>
                      <span className="at-label">{i.label}</span>
                      <span className="at-go" aria-hidden="true">›</span>
                    </a>
                  </li>
                ))}
              </ul>
            </section>
          )
        })
      ) : (
        <p className="panel-note">Nothing stands out: no agent fails a check.</p>
      )}
    </Panel>
  )
}

export function Overview() {
  const { ds, scope } = useData()
  const { agents, knowledge } = scope
  const [greeting] = useState(() => greetingFor(new Date().getHours()))
  const [growth, setGrowth] = useState<GrowthView>('total')
  const shadowUnknown = unknownFrom(laneProblem(ds.lanes.find((l) => l.id === 'shadow')))
  const m = useMemo(() => {
    const created = monthly(agents, (a) => a.createdMonth)
    return {
      created,
      cumulative: cumulative(created),
      origins: ORIGINS.map((o) => ({ ...o, value: count(agents, (a) => a.agentOrigin === o.key) })),
      checks: attentionCounts(agents),
      retire: reviewAgents(agents).filter((r) => r.verdict === 'Retire').length,
      noOwner: A.withoutOwners(agents),
      unresolved: A.ownersNotResolved(agents),
      ownerGaps: count(agents, (a) => !a.hasOwner || a.ownerPrincipalType === 'Not resolved in Entra'),
      noSignIn: count(agents, (a) => a.sharedTenantWide && (a.authentication === 'None' || !a.authentication)),
      grounded: A.withKnowledge(agents),
      reachOut: distinct(knowledge, (k) => (EXTERNAL_TYPES.has(k.type) ? k.agentKey : '')),
      shadowTools: distinct(ds.shadowSignals, (s) => (s.posture === 'Unsanctioned' && s.deviceCount > 0 ? s.appName : '')),
      shadowDevices: distinct(ds.shadowDevices, (d) => d.deviceName),
      newAgents: periodChange(agents, (a) => a.createdAt, ds.asOf, (rs) => rs.length),
      highTrend: cumulative(monthly(agents.filter((a) => a.riskBand === 'High'), (a) => a.createdMonth))
        .slice(-12)
        .map((p) => p.values[0]),
    }
  }, [agents, knowledge, ds.shadowSignals, ds.shadowDevices, ds.asOf])
  const high = A.high(agents)
  const shared = A.tenantWide(agents)
  const sharedUnused = A.orphan(agents)
  const idle = A.idle(agents) + A.dormant(agents)
  const origin = (k: string) => m.origins.find((o) => o.key === k)?.value ?? 0
  const trendLabel = (what: string, v: number[], fmt: (n: number) => string, span: string) =>
    v.length > 1 ? `${what}, ${span}: from ${fmt(v[0])} to ${fmt(v[v.length - 1])}` : what
  const check = (id: string) => m.checks.find((c) => c.check.id === id)
  const fromCheck = (id: string): AttentionItem => {
    const c = check(id)!
    return { id, count: c.count, label: c.check.label, help: c.check.help, to: href('inventory', 'all', { focus: id }), urgent: id === 'high-no-owner' || id === 'shared-no-auth' }
  }
  const attention: AttentionItem[] = [
    fromCheck('high-no-owner'),
    fromCheck('shared-no-auth'),
    {
      id: 'retire',
      count: m.retire,
      label: 'Due to retire',
      help: 'Not used for more than 90 days, or never used 60 days after it was created.',
      to: href('governance', 'lifecycle', { verdict: 'Retire' }),
    },
    ...ATTENTION.slice(2).map((c) => fromCheck(c.id)),
  ]

  return (
    <>
      <div className="greeting">
        <h3>{greeting}</h3>
        <p>Here's the agent estate as of {dateLabel(ds.asOf.slice(0, 10))}.</p>
      </div>
      <p className="headline">
        <b>{int(agents.length)}</b> agents: <b>{int(origin('Human-built'))}</b> built by people, <b>{int(origin('Platform-provisioned'))}</b> provisioned by the platform and{' '}
        <b>{int(origin('Creator unknown'))}</b> with no known creator. <b>{int(high)}</b> {high === 1 ? 'is' : 'are'} high risk
        {shared ? (
          <>
            , and <b>{int(sharedUnused)}</b> of the {int(shared)} shared tenant-wide {sharedUnused === 1 ? 'has' : 'have'} never been used
          </>
        ) : null}
        .
      </p>
      <CoverageBanner />
      <KpiRow>
        <EstateCard total={agents.length} newIn7={m.newAgents.current} parts={m.origins} />
        <Kpi
          label="Shared tenant-wide"
          value={int(shared)}
          tone="unlicensed"
          progress={{ value: shared, total: agents.length }}
          sub={
            <>
              <b>{int(m.noSignIn)}</b> with no sign-in
            </>
          }
          help="Agents anyone in the tenant can reach. No sign-in means authentication is None or blank, so the agent does not ask who people are."
        />
        <Kpi
          label="Owner gaps"
          value={int(m.ownerGaps)}
          sub={`${int(m.noOwner)} no owner · ${int(m.unresolved)} not in Entra`}
          href={href('inventory', 'creators')}
          help="Agents with no owner on record, or whose owner does not resolve to a user in Microsoft Entra ID, often because they left."
        />
        <Kpi
          label="Knowledge reach"
          value={int(m.grounded)}
          tone="agent"
          href={href('integrations', 'knowledge')}
          sub={`${int(m.reachOut)} reach outside the tenant`}
          help="Agents grounded on at least one knowledge source. Outside the tenant means public websites, web search or Bing custom search."
        />
        <Kpi
          label="Idle or dormant"
          value={int(idle)}
          href={href('governance', 'lifecycle')}
          sub={`${int(A.neverUsed(agents))} never used`}
          help="Last used more than 30 days ago. Last use comes from Power Platform usage records in Azure Resource Graph."
        />
        <Kpi
          label="High risk"
          value={int(high)}
          tone="unlicensed"
          href={href('governance', 'risk', { band: 'High' })}
          sub={`${pct(div(high, agents.length))} of all agents`}
          spark={<Sparkline values={m.highTrend} color={RISK_COLOR.High} label={trendLabel('High-risk agents', m.highTrend, int, 'cumulative over the last 12 months')} />}
          help="Agents scoring 5 or more on the heuristic risk model. See Governance & risk. The line is the running total of high-risk agents by the month they were created."
        />
        <Kpi
          label="Shadow AI"
          value={int(m.shadowTools)}
          href={href('shadow')}
          unknown={shadowUnknown}
          sub={`Unsanctioned tools on ${int(m.shadowDevices)} devices`}
          help="Unsanctioned AI tools that Microsoft Defender found on managed devices. Agent filters don't apply."
        />
      </KpiRow>
      <Grid cols={3}>
        <Panel
          title={growth === 'total' ? 'Agents created over time' : 'New agents per month'}
          span={2}
          actions={<Segmented label="Agent growth view" value={growth} options={GROWTH_VIEWS} onChange={setGrowth} />}
        >
          {growth === 'total' ? (
            <LineChart label="Cumulative agents by month" data={m.cumulative} series={[{ name: 'Agents', color: COLOR.agent, fmt: int }]} xFmt={monthLabel} tickFmt={monthTick} height={340} area />
          ) : (
            <ColumnChart label="New agents per month" data={m.created} series={[{ name: 'Agents created', color: COLOR.licensed, fmt: int }]} xFmt={monthLabel} tickFmt={monthTick} height={340} />
          )}
        </Panel>
        <AttentionList items={attention} />
      </Grid>
      <p className="sibling-note">
        Usage, value and cost: see{' '}
        <a href={ANALYTICS_HUB} target="_blank" rel="noreferrer">
          Analytics Hub
        </a>
        .
      </p>
    </>
  )
}