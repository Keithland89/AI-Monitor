import { useMemo, useState } from 'react'
import { useData } from '../data/store'
import type { M365Usage } from '../data/types'
import { hourGrid } from '../metrics/chat'
import { laneProblem, unknownFrom } from '../metrics/coverage'
import { copilotFit, outOfHours, type FitRow } from '../metrics/patterns'
import { BarList, LineChart } from '../ui/charts'
import { DataTable } from '../ui/DataTable'
import { dateLabel, dayLabel, int, pct0 } from '../ui/format'
import { PageIntro } from '../ui/PageFilters'
import { Grid, Kpi, KpiRow, Panel, Segmented } from '../ui/primitives'
import { COLOR } from '../ui/theme'
import { href } from '../routes'
import { LaneNotice } from './common'
import { num, rowsOf, text } from './helpers'

type Rhythm = 'email' | 'chat' | 'meetings'
const RHYTHMS: { id: Rhythm; label: string }[] = [
  { id: 'email', label: 'Email' },
  { id: 'chat', label: 'Chat' },
  { id: 'meetings', label: 'Meetings' },
]

function rhythmSeries(u: M365Usage, view: Rhythm) {
  switch (view) {
    case 'email':
      return {
        data: u.emailDaily.map((d) => ({ key: d.date, values: [d.sent, d.read] })),
        series: [{ name: 'Sent', color: COLOR.licensed, fmt: int }, { name: 'Read', color: COLOR.neutral, fmt: int }],
      }
    case 'chat':
      return {
        data: u.teamsDaily.map((d) => ({ key: d.date, values: [d.chat, d.channel] })),
        series: [{ name: 'Chat messages', color: COLOR.licensed, fmt: int }, { name: 'Channel messages', color: COLOR.agent, fmt: int }],
      }
    default:
      return {
        data: u.teamsDaily.map((d) => ({ key: d.date, values: [d.meetings, d.calls] })),
        series: [{ name: 'Teams meetings', color: COLOR.licensed, fmt: int }, { name: 'Calls', color: COLOR.agent, fmt: int }],
      }
  }
}

export function WorkPatterns() {
  const { ds } = useData()
  const [rhythm, setRhythm] = useState<Rhythm>('email')
  const u = ds.m365
  const problem = laneProblem(ds.lanes.find((l) => l.id === 'm365usage'))
  const unknown = unknownFrom(problem) ?? (u ? undefined : 'No data yet')
  const m = useMemo(() => {
    const any = u?.copilot.find((c) => c.product === 'anyApp')
    return {
      any,
      fit: u ? copilotFit(u) : [],
      offHours: outOfHours(hourGrid(ds.interactions)),
      services: (u?.services ?? []).map((s) => ({ key: s.key, label: s.label, value: s.active })),
    }
  }, [u, ds.interactions])
  const rhythmData = u ? rhythmSeries(u, rhythm) : null
  const top = m.fit.find((f) => Number.isFinite(f.without))

  return (
    <>
      {problem && problem.kind !== 'empty' ? (
        <LaneNotice problems={[problem]} />
      ) : (
        <PageIntro>
          {u
            ? `How people work across Microsoft 365, and where Copilot could fit that work.${top ? ` The biggest gap is ${top.label}: about ${int(top.without)} people use it on a typical weekday without Copilot there.` : ''} Counts only, from Microsoft's usage reports${u.refreshed ? `, refreshed ${dateLabel(u.refreshed)}` : ''}.`
            : 'The Microsoft 365 usage reports have not been collected yet. Run the installer to add the daily usage flow, then refresh tomorrow.'}
          {u && u.failed.length > 0 && ` ${u.failed.length} report${u.failed.length === 1 ? '' : 's'} failed on the last run, so some figures may be missing.`}
        </PageIntro>
      )}
      <KpiRow>
        <Kpi label="Active on Microsoft 365" value={int(u?.active ?? NaN)} sub="Last 30 days" unknown={unknown} help="People who used any Microsoft 365 service in the last 30 days." />
        <Kpi
          label="Using Copilot"
          value={int(m.any?.active ?? NaN)}
          tone="licensed"
          unknown={m.any ? undefined : unknown}
          progress={m.any ? { value: m.any.active, total: m.any.enabled } : undefined}
          sub={m.any ? `${pct0(m.any.enabled ? m.any.active / m.any.enabled : NaN)} of ${int(m.any.enabled)} licensed` : undefined}
          help="Licensed people who used Microsoft 365 Copilot in any app in the last 30 days."
        />
        <Kpi
          label="Licences unused"
          value={int(m.any ? Math.max(0, m.any.enabled - m.any.active) : NaN)}
          tone="unlicensed"
          unknown={m.any ? undefined : unknown}
          sub="No Copilot use in 30 days"
          help="Licensed for Microsoft 365 Copilot, with no use in any app in the last 30 days."
        />
        <Kpi
          label="Copilot out of hours"
          value={pct0(m.offHours)}
          sub="Outside weekdays 08–18 UTC"
          href={href('activity', 'interactions')}
          help="The share of Copilot turns in the audit log outside Monday to Friday, 08:00 to 18:00 UTC. Open Interactions for the full heatmap."
        />
      </KpiRow>
      {u && (
        <Grid cols={3}>
          <Panel
            title="Where Copilot could help"
            note="Apps people use most, ranked by how many work there without Copilot."
            help="Weekday users is the average daily users of the app on weekdays. Copilot users counts licensed people who used Copilot in that app in the last 30 days. Gap is the difference: an estimate, since one is daily and the other monthly."
            span={3}
          >
            <DataTable
              label="Where Copilot could help"
              rows={rowsOf(m.fit, (f) => f.label)}
              initialSort={{ key: 'without', desc: true }}
              pageSize={8}
              minWidth={760}
              columns={[
                text('app', 'App', (f: FitRow) => f.label, '13%'),
                num('typical', 'Weekday users', (f: FitRow) => f.typical),
                num('active', 'Copilot users', (f: FitRow) => f.active),
                num('reach', 'Reach', (f: FitRow) => f.reach, { fmt: pct0, bar: COLOR.licensed, help: 'Share of licensed people using Copilot in this app.' }),
                num('without', 'Gap', (f: FitRow) => f.without, { help: 'Weekday users minus Copilot users in this app. An estimate.' }),
                text('idea', 'Try this', (f: FitRow) => f.idea, '34%'),
              ]}
            />
          </Panel>
          {rhythmData && (
            <Panel
              title="Collaboration rhythm"
              note="Tenant-wide daily volumes. Weekend dips show the working week."
              span={2}
              actions={<Segmented label="Collaboration type" value={rhythm} options={RHYTHMS} onChange={setRhythm} />}
            >
              <LineChart label={`${RHYTHMS.find((r) => r.id === rhythm)!.label} per day`} data={rhythmData.data} series={rhythmData.series} xFmt={dayLabel} height={240} />
            </Panel>
          )}
          <Panel title="Where people work" note="Active people per service, last 30 days.">
            <BarList label="Active people per Microsoft 365 service" items={m.services} color={COLOR.neutral} fmt={int} />
          </Panel>
        </Grid>
      )}
    </>
  )
}
