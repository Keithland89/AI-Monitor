import { Fragment, useMemo } from 'react'
import { useData } from '../data/store'
import { LIFECYCLE, LIFECYCLE_HELP, REVIEW_CADENCE, reviewAgents, VERDICT_HELP, VERDICTS, type AgentReview, type Verdict } from '../metrics/lifecycle'
import { A } from '../metrics/measures'
import { href, useParam } from '../routes'
import { BarList, Distribution } from '../ui/charts'
import { DataTable } from '../ui/DataTable'
import { dateLabel, int } from '../ui/format'
import { Empty, Grid, Kpi, KpiRow, Panel, Select } from '../ui/primitives'
import { LIFECYCLE_COLOR, RISK_TEXT, VERDICT_COLOR, VERDICT_TEXT } from '../ui/theme'
import { agentCol, date, num, rowsOf, text } from './helpers'
import { useScrollOnParam } from '../ui/scroll'
import { PageIntro } from '../ui/PageFilters'

function Rules<K extends string>({ order, help, color }: { order: readonly K[]; help: Record<K, string>; color: Record<string, string> }) {
  return (
    <dl className="kv">
      {order.map((k) => (
        <Fragment key={k}>
          <dt>
            <span className="swatch" style={{ background: color[k], display: 'inline-block' }} /> {k}
          </dt>
          <dd>{help[k]}</dd>
        </Fragment>
      ))}
    </dl>
  )
}

/** Verdicts by how urgently they need someone to act; the table sorts by this by default. */
const SEVERITY: readonly Verdict[] = ['Retire', 'Review', 'Watch', 'Keep']
const VERDICT_FILTER = [
  { value: '', label: 'Needs action' },
  ...VERDICTS.map((v) => ({ value: v, label: v })),
  { value: 'all', label: 'All, including Keep' },
]

/** Governance › Lifecycle review: idle and dormant agents from the Power Platform last-used date, with a verdict and a review cadence. */
export function LifecycleReview() {
  const { ds, scope, openAgent } = useData()
  const [param, setParam] = useParam('verdict')
  const verdict: Verdict | '' | 'all' = param === 'all' || (VERDICTS as readonly string[]).includes(param) ? (param as Verdict | 'all') : ''
  const setVerdict = (v: string) => setParam(v)
  useScrollOnParam('lifecycle-agents', param)
  const m = useMemo(() => {
    const reviews = reviewAgents(scope.agents)
    const tally = <K extends string>(order: readonly K[], get: (r: AgentReview) => K) => {
      const n = new Map<K, number>()
      for (const r of reviews) n.set(get(r), (n.get(get(r)) ?? 0) + 1)
      return order.map((k) => ({ key: k, label: k, value: n.get(k) ?? 0 }))
    }
    return {
      reviews: [...reviews].sort((a, b) => (b.agent.daysSinceLastUse ?? -1) - (a.agent.daysSinceLastUse ?? -1)),
      stages: tally(LIFECYCLE, (r) => r.stage),
      verdicts: tally(VERDICTS, (r) => r.verdict),
      avgDays: A.avgDaysSinceUse(scope.agents),
    }
  }, [scope.agents])
  const n = (k: string, list: { key: string; value: number }[]) => list.find((x) => x.key === k)?.value ?? 0
  const rows = verdict === 'all' ? m.reviews : verdict ? m.reviews.filter((r) => r.verdict === verdict) : m.reviews.filter((r) => r.verdict !== 'Keep')
  const kept = n('Keep', m.verdicts)
  const link = (v: Verdict) => href('governance', 'lifecycle', { verdict: v })

  return (
    <>
      <PageIntro>
        Which agents are idle, dormant or never used, and what to do about them. Last use comes from Power Platform usage records, read through Azure Resource
        Graph, as of {dateLabel(ds.asOf.slice(0, 10))}. Agent Builder and Azure AI Foundry agents emit no usage record, so they show as No usage signal and are never marked idle, dormant or due to retire. Rules are simple and visible, so treat a verdict as a prompt to look, not a decision.
      </PageIntro>
      <KpiRow>
        <Kpi label="Active" value={int(n('Active', m.stages))} tone="licensed" help={LIFECYCLE_HELP.Active} />
        <Kpi label="Idle" value={int(n('Idle', m.stages))} help={LIFECYCLE_HELP.Idle} />
        <Kpi label="Dormant" value={int(n('Dormant', m.stages))} help={LIFECYCLE_HELP.Dormant} />
        <Kpi
          label="Never used"
          value={int(n('Never used', m.stages))}
          sub={`Plus ${int(n('No usage signal', m.stages))} with no usage signal`}
          help={`Never used: ${LIFECYCLE_HELP['Never used']} No usage signal: ${LIFECYCLE_HELP['No usage signal']}`}
        />
        <Kpi label="To review" value={int(n('Review', m.verdicts))} tone="unlicensed" help={VERDICT_HELP.Review} href={link('Review')} />
        <Kpi label="To retire" value={int(n('Retire', m.verdicts))} help={VERDICT_HELP.Retire} href={link('Retire')} />
        <Kpi
          label="Days since last use"
          value={int(m.avgDays)}
          help="The average number of days since each agent was last used, across agents with a last-used date."
        />
      </KpiRow>
      <Grid cols={3}>
        <Panel title="Lifecycle stages">
          <Distribution label="Agents by lifecycle stage" items={m.stages.map((s) => ({ label: s.label, value: s.value, color: LIFECYCLE_COLOR[s.key] }))} fmt={int} />
        </Panel>
        <Panel title="Review verdicts" note="Select a verdict to filter the table.">
          <BarList
            label="Agents by review verdict"
            items={m.verdicts.map((v) => ({ ...v, color: VERDICT_COLOR[v.key] }))}
            color={VERDICT_COLOR.Keep}
            fmt={int}
            keepOrder
            selected={verdict === 'all' ? '' : verdict}
            onSelect={(k) => setVerdict(verdict === k ? '' : k)}
          />
        </Panel>
        <Panel title="How verdicts work" help="Checked in this order: Retire, Review, Watch, then Keep.">
          <Rules order={VERDICTS} help={VERDICT_HELP} color={VERDICT_COLOR} />
        </Panel>
        <Panel title="Review cadence" span={3} note="A suggested rhythm. Agree your own with the agent owners.">
          <Rules order={SEVERITY} help={REVIEW_CADENCE} color={VERDICT_COLOR} />
        </Panel>
        <Panel
          id="lifecycle-agents"
          title="Agents to act on"
          span={3}
          note={
            verdict === ''
              ? `Most urgent first. ${kept ? `${int(kept)} agents marked Keep are hidden.` : ''}`.trim()
              : undefined
          }
          actions={<Select label="Verdict" value={verdict} onChange={setVerdict} options={VERDICT_FILTER} />}
        >
          {rows.length ? (
            <DataTable
              label="Agents with lifecycle stage and review verdict"
              rows={rowsOf(rows, (r) => r.agent.key)}
              search={(r) => `${r.agent.name} ${r.agent.envName} ${r.agent.ownerName} ${r.reason}`}
              onRowClick={(r) => openAgent(r.agent.key)}
              initialSort={{ key: 'verdict' }}
              columns={[
                agentCol((r: AgentReview) => r.agent),
                {
                  key: 'verdict',
                  label: 'Verdict',
                  value: (r: AgentReview) => SEVERITY.indexOf(r.verdict),
                  render: (r: AgentReview) => <b style={{ color: VERDICT_TEXT[r.verdict] }}>{r.verdict}</b>,
                  align: 'left',
                  nowrap: true,
                  help: 'Sorted by urgency: Retire, Review, Watch, then Keep.',
                },
                text('reason', 'Why', (r: AgentReview) => r.reason, '20%'),
                text('stage', 'Stage', (r: AgentReview) => r.stage),
                num('days', 'Days since use', (r: AgentReview) => r.agent.daysSinceLastUse ?? NaN, { bar: LIFECYCLE_COLOR.Idle }),
                {
                  key: 'risk',
                  label: 'Risk',
                  value: (r: AgentReview) => r.agent.riskScore,
                  render: (r: AgentReview) => <span style={{ color: RISK_TEXT[r.agent.riskBand] }}>{r.agent.riskBand}</span>,
                },
                text('owner', 'Owner', (r: AgentReview) => r.agent.ownerName),
                date('last', 'Last used', (r: AgentReview) => r.agent.lastUsed),
              ]}
            />
          ) : (
            <Empty>{verdict === '' ? 'No agent needs action: every agent in view is marked Keep.' : 'No agents with this verdict for these filters.'}</Empty>
          )}
        </Panel>
      </Grid>
    </>
  )
}