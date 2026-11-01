import { AGENT_GAPS, API_COVERAGE, TELEMETRY_COVERAGE, type AgentGap, type ApiCoverageRow, type TelemetryCoverageRow } from '../data/static'
import { useData } from '../data/store'
import type { LaneState, LaneStatus, RunInfo } from '../data/types'
import { bars } from '../metrics/measures'
import { Distribution } from '../ui/charts'
import { DataTable } from '../ui/DataTable'
import { dec1, int } from '../ui/format'
import { Grid, Kpi, KpiRow, Panel } from '../ui/primitives'
import { COLOR } from '../ui/theme'
import { date, num, rowsOf, text, toDistribution } from './helpers'
import { PageFilters, PageIntro } from '../ui/PageFilters'

const VERDICT_COLOR: Record<string, string> = { Working: COLOR.licensed, Blocked: COLOR.unlicensed }

export function DataSourcesGaps() {
  const { ds } = useData()
  const verdicts = bars(API_COVERAGE, (r) => r.verdict)
  return (
    <>
      <PageIntro>What the platform APIs expose, what they do not, and the gaps that still need a workaround.</PageIntro>
      <KpiRow>
        <Kpi label="Agent 365 extras" value={int(AGENT_GAPS.filter((g) => g.status === 'Open').length)} help="Capabilities Agent 365 adds that AI-Monitor does not cover. Agent 365 is optional." />
        <Kpi label="APIs tested" value={int(API_COVERAGE.length)} />
        <Kpi label="Working" value={int(API_COVERAGE.filter((r) => r.verdict === 'Working').length)} tone="licensed" />
        <Kpi label="Blocked" value={int(API_COVERAGE.filter((r) => r.verdict === 'Blocked').length)} />
        <Kpi label="Environments" value={int(ds.environments.length)} />
        <Kpi label="Total agent surface" value={int(ds.agents.length + ds.flows.length)} help="Agents plus agent flows." />
      </KpiRow>
      <Grid cols={3}>
        <Panel title="API verdicts">
          <Distribution label="APIs by verdict" items={toDistribution(verdicts, VERDICT_COLOR)} fmt={int} />
        </Panel>
        <Panel title="Telemetry per platform" span={2}>
          <DataTable
            label="Telemetry per platform"
            rows={rowsOf(TELEMETRY_COVERAGE, (r) => r.platform)}
            initialSort={{ key: 'order' }}
            columns={[
              { key: 'order', label: 'Platform', value: (r: TelemetryCoverageRow) => r.sortOrder, render: (r) => r.platform, width: '20%' },
              text('inventory', 'Inventory', (r: TelemetryCoverageRow) => r.inventory),
              text('usage', 'Last-used signal', (r: TelemetryCoverageRow) => r.usageSignal),
              text('why', 'Why', (r: TelemetryCoverageRow) => r.whyNot, '40%'),
            ]}
          />
        </Panel>
        <Panel title="API investigation results" span={3}>
          <DataTable
            label="API investigation results"
            rows={rowsOf(API_COVERAGE, (r) => String(r.sortOrder))}
            search={(r) => `${r.source} ${r.endpoint} ${r.result}`}
            initialSort={{ key: 'order' }}
            columns={[
              { key: 'order', label: 'Source', value: (r: ApiCoverageRow) => r.sortOrder, render: (r) => r.source, width: '16%' },
              text('endpoint', 'Endpoint', (r: ApiCoverageRow) => r.endpoint, '26%'),
              text('verdict', 'Verdict', (r: ApiCoverageRow) => r.verdict),
              text('result', 'Result', (r: ApiCoverageRow) => r.result),
              text('gives', 'What it gives', (r: ApiCoverageRow) => r.whatItGives),
            ]}
          />
        </Panel>
        <Panel title="What Agent 365 adds (optional)" span={3} note="AI-Monitor does not need Agent 365. This compares the two so you can judge whether the extras matter.">
          <DataTable
            label="What Agent 365 adds (optional)"
            rows={rowsOf(AGENT_GAPS, (r) => String(r.sortOrder))}
            initialSort={{ key: 'order' }}
            columns={[
              { key: 'order', label: 'Capability', value: (r: AgentGap) => r.sortOrder, render: (r) => r.capability, width: '22%' },
              text('status', 'Status', (r: AgentGap) => r.status),
              text('why', 'What Agent 365 does', (r: AgentGap) => r.whyMissing, '32%'),
              text('how', 'How AI-Monitor covers it', (r: AgentGap) => r.howToClose, '32%'),
            ]}
          />
        </Panel>
      </Grid>
    </>
  )
}

const LANE_STATE_LABEL: Record<LaneState, string> = {
  ok: 'Returned data',
  empty: 'No rows',
  'not-set-up': 'Not set up',
  denied: 'Access denied',
  error: 'Error',
  sample: 'Sample',
  loading: 'Loading',
}

export function LaneState({ state }: { state: LaneState }) {
  return <span className={`lane-state lane-${state}`}>{LANE_STATE_LABEL[state]}</span>
}

export function LaneTable({ lanes }: { lanes: LaneStatus[] }) {
  return (
    <DataTable
      label="Data lanes"
      rows={rowsOf(lanes, (l) => l.id)}
      pageSize={20}
      columns={[
        text('label', 'Lane', (l: LaneStatus) => l.label, '22%'),
        text('connector', 'Connector', (l: LaneStatus) => l.connector),
        { key: 'state', label: 'State', value: (l: LaneStatus) => LANE_STATE_LABEL[l.state], render: (l) => <LaneState state={l.state} /> },
        num('rows', 'Rows', (l: LaneStatus) => l.rows),
        num('secs', 'Seconds', (l: LaneStatus) => (l.ms ?? 0) / 1000, { fmt: dec1 }),
        text('detail', 'Detail', (l: LaneStatus) => l.detail, '30%'),
      ]}
    />
  )
}

export function RunTable({ runs }: { runs: RunInfo[] }) {
  return (
    <DataTable
      label="Collector runs"
      rows={rowsOf(runs, (r) => r.table)}
      columns={[
        text('lane', 'Collector', (r: RunInfo) => r.lane, '22%'),
        text('table', 'Run table', (r: RunInfo) => r.table),
        { key: 'state', label: 'State', value: (r: RunInfo) => r.state, render: (r) => <LaneState state={r.state} /> },
        date('last', 'Last run', (r: RunInfo) => r.lastRun),
        text('status', 'Status', (r: RunInfo) => r.status),
        text('detail', 'Detail', (r: RunInfo) => r.detail, '26%'),
      ]}
    />
  )
}

export function LaneStatusView() {
  const { ds, hostAvailable, switchMode, reload, loading } = useData()
  const withData = ds.lanes.filter((l) => l.state === 'ok' || l.state === 'sample').length
  return (
    <>
      <PageIntro>
        {ds.mode === 'live'
          ? `Live data. ${withData} of ${ds.lanes.length} lanes returned rows. Each lane loads on its own, so one failing lane leaves the rest of the app working.`
          : 'Anonymised sample data. Live data needs the app to run inside the Copilot Managed Apps player.'}
      </PageIntro>
      <PageFilters label="Data mode">
        <button type="button" className="btn" disabled={!hostAvailable || loading || ds.mode === 'live'} onClick={() => switchMode('live')}>
          Use live data
        </button>
        <button type="button" className="btn" disabled={loading || ds.mode === 'sample'} onClick={() => switchMode('sample')}>
          Use sample data
        </button>
        <button type="button" className="btn" disabled={loading} onClick={reload}>
          Reload
        </button>
      </PageFilters>
      <Grid cols={2}>
        <Panel title="Data lanes" span={2} note={ds.appEnvironment ? 'Dataverse lanes read the environment the app is deployed to.' : undefined}>
          <LaneTable lanes={ds.lanes} />
        </Panel>
        <Panel title="Collector runs" span={2} note="The landing-environment flows record each run. A stale or failed run explains missing rows.">
          <RunTable runs={ds.runs} />
        </Panel>
      </Grid>
    </>
  )
}
