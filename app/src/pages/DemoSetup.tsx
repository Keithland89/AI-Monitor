import { useData } from '../data/store'
import { int } from '../ui/format'
import { Grid, Kpi, KpiRow, Panel } from '../ui/primitives'
import { PageIntro } from '../ui/PageFilters'
import { LaneTable, LaneStatusView } from './LaneStatus'

export { LaneStatusView }

export function DataSourcesGaps({ demo = true }: { demo?: boolean }) {
  const { ds } = useData()
  const intro = demo
    ? 'Generated synthetic fixture coverage only. No API results or live operations are shown.'
    : 'This synthetic-only view does not report API results or live operations.'
  return (
    <>
      <PageIntro>{intro}</PageIntro>
      <KpiRow>
        <Kpi label="Synthetic lanes" value={int(ds.lanes.length)} tone="agent" />
        <Kpi label="Agent fixtures" value={int(ds.agents.length)} tone="agent" />
        <Kpi label="Interaction fixtures" value={int(ds.interactions.length)} />
        <Kpi label="Live operations" value="0" sub="No source was queried." />
      </KpiRow>
      <Grid cols={2}>
        <Panel title="Synthetic fixture coverage" span={2} note="Every row describes generated local sample data; status does not represent live access.">
          <LaneTable lanes={ds.lanes} />
        </Panel>
      </Grid>
    </>
  )
}
