import { useMemo } from 'react'
import { RISK_FACTORS } from '../data/static'
import { useData } from '../data/store'
import type { Agent } from '../data/types'
import { A, R, RISK_ORDER, bars, div, groupBy } from '../metrics/measures'
import { href, useParam } from '../routes'
import { BarList, Donut } from '../ui/charts'
import { DataTable } from '../ui/DataTable'
import { dec2, int, pct } from '../ui/format'
import { Empty, Grid, Kpi, KpiRow, Panel, Select } from '../ui/primitives'
import { COLOR, RISK_COLOR } from '../ui/theme'
import { StatList } from './common'
import { useScrollOnParam } from '../ui/scroll'
import { agentCol, num, rowsOf, text, toDistribution } from './helpers'
import { PageIntro } from '../ui/PageFilters'

interface FactorRow {
  order: number
  factor: string
  rationale: string
  points: number
  agents: number
  total: number
  share: number
}

const BAND_FILTER = [
  { value: '', label: 'High and Medium' },
  ...RISK_ORDER.map((b) => ({ value: b, label: b })),
  { value: 'all', label: 'Any risk factor' },
]

export function Governance() {
  const { scope, openAgent } = useData()
  const { agents, riskDetail } = scope
  const [param, setBand] = useParam('band')
  const band = param === 'all' || RISK_ORDER.includes(param) ? param : ''
  useScrollOnParam('agents-to-review', param)
  const m = useMemo(() => {
    const total = riskDetail.length
    const fired = groupBy(riskDetail, (r) => r.factor)
    const factors: FactorRow[] = RISK_FACTORS.map((f) => {
      const rs = fired.get(f.factor) ?? []
      return { order: f.sortOrder, factor: f.factor, rationale: f.rationale, points: f.score, agents: R.agentsAffected(rs), total: R.points(rs), share: div(rs.length, total) }
    })
    return {
      factors,
      why: bars(riskDetail, (r) => r.factor),
      bands: bars(agents, (a) => a.riskBand),
      auth: bars(agents, (a) => a.authentication ?? '(Blank)'),
    }
  }, [agents, riskDetail])
  const risky = useMemo(() => {
    const keep = (a: Agent) =>
      band === 'all' ? a.riskScore > 0 : band ? a.riskBand === band : a.riskBand === 'High' || a.riskBand === 'Medium'
    return rowsOf(agents.filter(keep), (a) => a.key)
  }, [agents, band])

  return (
    <>
      <PageIntro>Exposure posture: sharing, authentication, quarantine and the heuristic risk score. Lifecycle review covers idle and dormant agents.</PageIntro>
      <KpiRow>
        <Kpi label="High risk" value={int(A.high(agents))} tone="unlicensed" help="Risk score of 5 or more." href={href('governance', 'risk', { band: 'High' })} />
        <Kpi label="Medium risk" value={int(A.medium(agents))} help="Risk score of 3 or 4." href={href('governance', 'risk', { band: 'Medium' })} />
        <Kpi label="No authentication" value={int(A.unauthenticated(agents))} help="Authentication is None or blank." />
        <Kpi label="Shared tenant-wide" value={int(A.tenantWide(agents))} />
        <Kpi label="Shared but unused" value={int(A.orphan(agents))} help="Shared with the whole tenant, with no last-used date in Power Platform." href={href('inventory', 'all', { focus: 'shared-unused' })} />
        <Kpi
          label="Idle or dormant"
          value={int(A.idle(agents) + A.dormant(agents))}
          help="Last used more than 30 days ago, from Power Platform usage records. See Lifecycle review."
          href={href('governance', 'lifecycle')}
        />
      </KpiRow>
      <Grid cols={3}>
        <Panel title="Risk bands">
          <Donut label="Agents by risk band" items={toDistribution(m.bands, RISK_COLOR, RISK_ORDER)} unit="agents" keepOrder />
        </Panel>
        <Panel title="Why agents are risky">
          <BarList label="Risk factor instances" items={m.why} color={RISK_COLOR.High} fmt={int} />
        </Panel>
        <StatList
          title="Exposure summary"
          items={[
            ['Web search enabled', int(A.webSearch(agents))],
            ['Agents calling agents', int(A.callingAgents(agents))],
            ['Quarantined', int(A.quarantined(agents))],
            ['No risk factors', int(A.noRiskFactors(agents))],
            ['Avg risk factors per agent', dec2(A.avgRiskFactors(agents))],
          ]}
        />
        <Panel title="Authentication modes">
          <BarList label="Agents by authentication mode" items={m.auth} color={COLOR.licensed} fmt={int} />
        </Panel>
        <Panel title="Risk factor breakdown" span={2} help="A heuristic, not a Microsoft score. An agent's score is the sum of the points of its factors: High is 5 points or more, Medium 3 or 4.">
          <DataTable
            label="Risk factor breakdown"
            rows={rowsOf(m.factors, (r) => r.factor)}
            initialSort={{ key: 'order' }}
            columns={[
              { key: 'order', label: 'Risk factor', value: (r: FactorRow) => r.order, render: (r: FactorRow) => <span title={r.rationale}>{r.factor}</span>, width: '34%', align: 'left' },
              num('points', 'Points', (r: FactorRow) => r.points),
              num('agents', 'Agents affected', (r: FactorRow) => r.agents, { bar: RISK_COLOR.Medium }),
              num('total', 'Risk points', (r: FactorRow) => r.total),
              num('share', 'Share', (r: FactorRow) => r.share, { fmt: pct }),
            ]}
          />
        </Panel>
        <Panel
          id="agents-to-review"
          title="Agents to review"
          span={3}
          note={band === '' ? 'High and Medium risk, highest score first.' : undefined}
          actions={<Select label="Show" value={band} onChange={setBand} options={BAND_FILTER} />}
        >
          {risky.length ? (
            <DataTable
              label="Agents to review"
              rows={risky}
              search={(a: Agent) => `${a.name} ${a.envName} ${a.riskReasons}`}
              onRowClick={(a) => openAgent(a.key)}
              initialSort={{ key: 'score', desc: true }}
              columns={[
                agentCol((a: Agent) => ({ key: a.key, name: a.name })),
                text('creator', 'Created by', (a: Agent) => a.createdByName),
                text('env', 'Environment', (a: Agent) => a.envName),
                num('score', 'Score', (a: Agent) => a.riskScore, { bar: RISK_COLOR.High }),
                text('band', 'Band', (a: Agent) => a.riskBand),
                text('reasons', 'Reasons', (a: Agent) => a.riskReasons, '30%'),
              ]}
            />
          ) : (
            <Empty>{band === '' ? 'No High or Medium risk agents for these filters.' : 'No agents in this band for these filters.'}</Empty>
          )}
        </Panel>
      </Grid>
    </>
  )
}
