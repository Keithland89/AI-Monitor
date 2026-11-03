import { useData } from '../data/store'
import type { LaneState, LaneStatus, RunInfo } from '../data/types'
import { DataTable } from '../ui/DataTable'
import { dec1 } from '../ui/format'
import { Grid, Panel } from '../ui/primitives'
import { date, num, rowsOf, text } from './helpers'
import { PageFilters, PageIntro } from '../ui/PageFilters'

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

export function LaneStatusView({ demo = false }: { demo?: boolean }) {
  const { ds, hostAvailable, switchMode, reload, loading } = useData()
  const withData = ds.lanes.filter((l) => l.state === 'ok' || l.state === 'sample').length
  return (
    <>
      <PageIntro>
        {demo
          ? 'Every row below is a synthetic fixture marker. No data source was contacted and no collector ran.'
          : ds.mode === 'live'
          ? `Live data. ${withData} of ${ds.lanes.length} lanes returned rows. Each lane loads on its own, so one failing lane leaves the rest of the app working.`
          : 'Anonymised sample data. Live data needs the app to run inside the Copilot Managed Apps player.'}
      </PageIntro>
      {!demo && (
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
      )}
      <Grid cols={2}>
        <Panel title="Data lanes" span={2} note={demo ? 'Synthetic demo fixtures only; no live source was queried.' : ds.appEnvironment ? 'Dataverse lanes read the environment the app is deployed to.' : undefined}>
          <LaneTable lanes={ds.lanes} />
        </Panel>
        <Panel title="Collector runs" span={2} note={demo ? 'Synthetic sample records; no collector ran.' : 'The landing-environment flows record each run. A stale or failed run explains missing rows.'}>
          <RunTable runs={ds.runs} />
        </Panel>
      </Grid>
    </>
  )
}
