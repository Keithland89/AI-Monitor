import { useMemo, useState } from 'react'
import { useData } from '../data/store'
import type { Agent } from '../data/types'
import { A, ACTIVITY_ORDER, bars, groupBy } from '../metrics/measures'
import { BarList, ColumnChart, Treemap } from '../ui/charts'
import { DataTable } from '../ui/DataTable'
import { dec1, int, knowledgeLabel, regionLabel } from '../ui/format'
import { Grid, Kpi, KpiRow, Panel, Select } from '../ui/primitives'
import { ACTIVITY_COLOR, COLOR, PALETTE } from '../ui/theme'
import { ATTENTION, attentionCheck } from '../metrics/attention'
import { useParam } from '../routes'
import { NamesNote } from './common'
import { agentCol, bool, date, num, rowsOf, text } from './helpers'
import { PageFilters, PageIntro } from '../ui/PageFilters'

const nameOf = (a: Agent) => ({ key: a.key, name: a.name })
const search = (a: Agent) => `${a.name} ${a.envName} ${a.platform} ${a.createdByName} ${a.ownerName}`

/** "Activity mix by platform": agent counts per platform, stacked by activity status. */
function activityMix(agents: Agent[]) {
  return [...groupBy(agents, (a) => a.platform)]
    .map(([key, rs]) => ({ key, values: ACTIVITY_ORDER.map((s) => rs.filter((a) => a.activityStatus === s).length) }))
    .sort((a, b) => b.values.reduce((x, y) => x + y, 0) - a.values.reduce((x, y) => x + y, 0))
}

export function AllAgents() {
  const { scope, openAgent } = useData()
  const [status, setStatus] = useState('')
  const [focus, setFocus] = useParam('focus')
  const check = attentionCheck(focus)
  const agents = useMemo(
    () => scope.agents.filter((a) => (!status || a.activityStatus === status) && (!check || check.test(a))),
    [scope.agents, status, check],
  )
  const mix = useMemo(() => activityMix(agents), [agents])
  const rows = useMemo(() => rowsOf(agents, (a) => a.key), [agents])

  return (
    <>
      <PageFilters label="Page filters">
        <Select label="Activity status" value={status} onChange={setStatus} options={ACTIVITY_ORDER.map((s) => ({ value: s, label: s }))} allLabel="All" />
        <Select label="Needs attention" value={check ? focus : ''} onChange={setFocus} options={ATTENTION.map((c) => ({ value: c.id, label: c.label }))} allLabel="Any" />
      </PageFilters>
      {check && <PageIntro>{check.help}</PageIntro>}
      <KpiRow>
        <Kpi label="Total agents" value={int(agents.length)} tone="agent" />
        <Kpi label="Agents at risk" value={int(A.atRisk(agents))} tone="unlicensed" help="Agents in the Medium or High risk band." />
        <Kpi label="Agents without owners" value={int(A.withoutOwners(agents))} />
        <Kpi label="Shared tenant-wide" value={int(A.tenantWide(agents))} />
      </KpiRow>
      <Grid cols={3}>
        <Panel title="Agent registry" note="Every agent, the way the registry lists them. Select an agent to see its details." span={3}>
          <DataTable
            label="Agent registry"
            rows={rows}
            search={search}
            onRowClick={(a) => openAgent(a.key)}
            initialSort={{ key: 'shared', desc: true }}
            columns={[
              agentCol(nameOf),
              text('status', 'Activity', (a: Agent) => a.activityStatus),
              date('quarantined', 'Quarantined', (a: Agent) => a.quarantinedAt),
              text('platform', 'Platform', (a: Agent) => a.platform),
              text('risk', 'Risk', (a: Agent) => a.riskBand),
              num('shared', 'Shared users', (a: Agent) => a.sharedUserCount, { bar: COLOR.agent }),
              date('used', 'Last used', (a: Agent) => a.lastUsed),
              date('published', 'Last published', (a: Agent) => a.lastPublishedAt),
            ]}
          />
        </Panel>
        <Panel title="Activity mix by platform" span={3}>
          <ColumnChart
            label="Agents by platform and activity status"
            data={mix}
            series={ACTIVITY_ORDER.map((s) => ({ name: s, color: ACTIVITY_COLOR[s], fmt: int }))}
            xFmt={(k) => k}
            stacked
          />
        </Panel>
        <Panel title="Data and tools" span={3}>
          <DataTable
            label="Data and tools per agent"
            rows={rows}
            search={search}
            initialSort={{ key: 'ktypes', desc: true }}
            columns={[
              agentCol(nameOf),
              text('kinds', 'Knowledge types', (a: Agent) => knowledgeLabel(a.knowledgeTypes), '20%'),
              num('ktypes', 'Types', (a: Agent) => a.knowledgeTypeCount),
              num('graph', 'Graph conn.', (a: Agent) => a.graphConnectorCount),
              num('sp', 'SharePoint sites', (a: Agent) => a.sharePointSiteCount),
              num('public', 'Public sites', (a: Agent) => a.publicSiteCount),
              num('files', 'Files', (a: Agent) => a.fileKnowledgeCount),
              num('dv', 'Dataverse', (a: Agent) => a.dataverseSourceCount),
              num('tools', 'Tools', (a: Agent) => a.toolCount),
              num('conn', 'Connectors', (a: Agent) => a.connectorCount),
              bool('web', 'Web search', (a: Agent) => a.webSearch),
            ]}
          />
        </Panel>
        <Panel title="Environment, ownership and sharing" span={3}>
          <NamesNote />
          <DataTable
            label="Environment, ownership and sharing per agent"
            rows={rows}
            search={search}
            initialSort={{ key: 'shared', desc: true }}
            columns={[
              agentCol(nameOf),
              text('env', 'Environment', (a: Agent) => a.envName),
              text('envType', 'Type', (a: Agent) => a.envType),
              text('region', 'Region', (a: Agent) => regionLabel(a.region)),
              text('owner', 'Owner', (a: Agent) => a.ownerName),
              text('ownerUpn', 'Owner UPN', (a: Agent) => a.ownerUpn),
              text('creator', 'Created by', (a: Agent) => a.createdByName),
              num('editors', 'Editors', (a: Agent) => a.editorUserCount),
              num('shared', 'Shared users', (a: Agent) => a.sharedUserCount),
              num('groups', 'Shared groups', (a: Agent) => a.sharedGroupCount),
              bool('tenant', 'Tenant-wide', (a: Agent) => a.sharedTenantWide),
            ]}
          />
        </Panel>
      </Grid>
    </>
  )
}

export function AgentInventory() {
  const { scope, openAgent } = useData()
  const { agents } = scope
  const m = useMemo(
    () => ({
      models: bars(agents, (a) => a.model),
      creators: bars(agents.filter((a) => a.createdByName), (a) => a.createdByName),
      noCreator: agents.filter((a) => !a.createdByName).length,
      regions: bars(agents, (a) => regionLabel(a.region)),
      rows: rowsOf(agents, (a) => a.key),
    }),
    [agents],
  )
  return (
    <>
      <KpiRow>
        <Kpi label="Agents in view" value={int(agents.length)} tone="agent" />
        <Kpi label="Distinct creators" value={int(A.distinctCreators(agents))} />
        <Kpi label="Human-built" value={int(A.humanBuilt(agents))} />
      </KpiRow>
      <NamesNote />
      <Grid cols={3}>
        <Panel title="Top agent creators" note={m.noCreator ? `${int(m.noCreator)} agents have no recorded creator, mostly ones the platform made.` : undefined}>
          <BarList label="Agents by creator" items={m.creators} color={COLOR.licensed} fmt={int} limit={8} />
        </Panel>
        <Panel title="Models in use">
          <Treemap label="Agents by model" items={m.models} color={COLOR.licensed} fmt={int} limit={9} height={240} />
        </Panel>
        <Panel title="Regions">
          <BarList label="Agents by region" items={m.regions} color={COLOR.licensed} fmt={int} limit={8} />
        </Panel>
        <Panel title="Agent register" note="Who built each agent, where it lives, and its component footprint." span={3}>
          <DataTable
            label="Agent register"
            rows={m.rows}
            search={search}
            onRowClick={(a) => openAgent(a.key)}
            initialSort={{ key: 'score', desc: true }}
            columns={[
              agentCol(nameOf),
              text('creator', 'Created by', (a: Agent) => a.createdByName),
              text('owner', 'Owner', (a: Agent) => a.ownerName),
              text('platform', 'Platform', (a: Agent) => a.platform),
              text('env', 'Environment', (a: Agent) => a.envName),
              text('orch', 'Orchestration', (a: Agent) => a.orchestration),
              text('model', 'Model', (a: Agent) => a.model),
              text('auth', 'Authentication', (a: Agent) => a.authentication),
              text('status', 'Activity', (a: Agent) => a.activityStatus),
              text('band', 'Risk', (a: Agent) => a.riskBand),
              num('score', 'Score', (a: Agent) => a.riskScore),
              num('topics', 'Topics', (a: Agent) => a.topicCount),
              num('tools', 'Tools', (a: Agent) => a.toolCount),
              num('knowledge', 'Knowledge', (a: Agent) => a.knowledgeCount),
              date('created', 'Created', (a: Agent) => a.createdAt),
              date('used', 'Last used', (a: Agent) => a.lastUsed),
            ]}
          />
        </Panel>
      </Grid>
    </>
  )
}

interface CreatorRow {
  creator: string
  agents: number
  active: number
  never: number
  high: number
  tenant: number
  avgRisk: number
}

export function Creators() {
  const { scope } = useData()
  const { agents } = scope
  const m = useMemo(() => {
    const human = agents.filter((a) => a.agentOrigin === 'Human-built')
    const byCreator: CreatorRow[] = [...groupBy(agents, (a) => a.createdByName || '(Blank)')].map(([creator, rs]) => ({
      creator,
      agents: rs.length,
      active: A.active30(rs),
      never: A.neverUsed(rs),
      high: A.high(rs),
      tenant: A.tenantWide(rs),
      avgRisk: A.avgRisk(rs),
    }))
    const named = human.filter((a) => a.createdByName)
    const topCreators = bars(named, (a) => a.createdByName).slice(0, 8)
    const platforms = [...new Set(human.map((a) => a.platform))].sort()
    const byPlatform = topCreators.map((c) => ({ key: c.key, values: platforms.map((p) => human.filter((a) => a.createdByName === c.key && a.platform === p).length) }))
    return {
      human,
      byCreator,
      topCreators: bars(named, (a) => a.createdByName),
      owners: bars(agents.filter((a) => a.ownerName), (a) => a.ownerName),
      noOwner: agents.filter((a) => !a.ownerName).length,
      resolution: bars(agents, (a) => a.ownerPrincipalType),
      platforms,
      byPlatform,
    }
  }, [agents])

  return (
    <>
      <KpiRow>
        <Kpi label="Distinct creators" value={int(A.distinctCreators(agents))} />
        <Kpi label="Human-built agents" value={int(m.human.length)} tone="licensed" />
        <Kpi label="Platform-built" value={int(A.platformBuilt(agents))} help="Agents the platform created on a user's behalf, such as system and default agents." />
        <Kpi label="Owner not resolved" value={int(A.ownersNotResolved(agents))} tone="unlicensed" help="Owners that could not be matched to a user record, often because the account was deleted." />
      </KpiRow>
      <NamesNote />
      <Grid cols={3}>
        <Panel title="Top creators">
          <BarList label="Human-built agents by creator" items={m.topCreators} color={COLOR.licensed} fmt={int} limit={7} />
        </Panel>
        <Panel title="Top owners" note={m.noOwner ? `${int(m.noOwner)} agents have no recorded owner.` : undefined}>
          <BarList label="Agents by owner" items={m.owners} color={COLOR.licensed} fmt={int} limit={7} />
        </Panel>
        <Panel title="Owner identity resolution">
          <BarList label="Agents by owner identity type" items={m.resolution} color={COLOR.licensed} fmt={int} />
        </Panel>
        <Panel title="Creator activity by platform" span={3}>
          <ColumnChart
            label="Human-built agents per top creator, by platform"
            data={m.byPlatform}
            series={m.platforms.map((p, i) => ({ name: p, color: PALETTE[i % PALETTE.length], fmt: int }))}
            xFmt={(k) => (k.length > 18 ? k.slice(0, 17) + '…' : k)}
            stacked
          />
        </Panel>
        <Panel title="Creator league table" span={3}>
          <DataTable
            label="Creator league table"
            rows={rowsOf(m.byCreator, (r) => r.creator)}
            search={(r) => r.creator}
            initialSort={{ key: 'agents', desc: true }}
            columns={[
              text('creator', 'Creator', (r: CreatorRow) => r.creator, '28%'),
              num('agents', 'Agents', (r: CreatorRow) => r.agents, { bar: COLOR.agent }),
              num('active', 'Active (30d)', (r: CreatorRow) => r.active),
              num('never', 'Never used', (r: CreatorRow) => r.never),
              num('high', 'High risk', (r: CreatorRow) => r.high),
              num('tenant', 'Tenant-wide', (r: CreatorRow) => r.tenant),
              num('avg', 'Avg risk score', (r: CreatorRow) => r.avgRisk, { fmt: dec1 }),
            ]}
          />
        </Panel>
      </Grid>
    </>
  )
}
