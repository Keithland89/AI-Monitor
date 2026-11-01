import { useMemo, useState } from 'react'
import { useData } from '../data/store'
import type { SharePointAgent } from '../data/types'
import { distinct, groupBy } from '../metrics/measures'
import { BarList } from '../ui/charts'
import { DataTable } from '../ui/DataTable'
import { int } from '../ui/format'
import { Empty, Grid, Kpi, KpiRow, Panel, Select, Stack } from '../ui/primitives'
import { COLOR } from '../ui/theme'
import { bool, date, num, rowsOf, shortHost, text } from './helpers'
import { PageFilters, PageIntro } from '../ui/PageFilters'

const uniq = (v: string[]) => [...new Set(v.filter(Boolean))].sort()
const options = (v: string[]) => v.map((x) => ({ value: x, label: x }))

interface SiteRow {
  site: string
  current: number
  deleted: number
}

export function SharePointAgents() {
  const { ds } = useData()
  const [site, setSite] = useState('')
  const [deleted, setDeleted] = useState('')
  const [app, setApp] = useState('')
  const [op, setOp] = useState('')
  const agents = useMemo(
    () =>
      ds.spAgents.filter(
        (a) => (!site || a.siteUrl === site) && (!deleted || String(a.isDeleted) === deleted) && (!app || a.applicationName === app) && (!op || a.lastOperation === op),
      ),
    [ds.spAgents, site, deleted, app, op],
  )
  const m = useMemo(() => {
    const sites: SiteRow[] = [...groupBy(agents, (a) => a.siteUrl)].map(([s, rs]) => ({
      site: s,
      current: rs.filter((a) => !a.isDeleted).length,
      deleted: rs.filter((a) => a.isDeleted).length,
    }))
    const collected = agents.reduce((mx, a) => (a.collectedAt > mx ? a.collectedAt : mx), '')
    const age = collected ? Math.floor((Date.parse(ds.asOf + 'Z') - Date.parse(collected + 'Z')) / 86_400_000) : NaN
    const count = (key: (a: SharePointAgent) => string) =>
      [...groupBy(agents, (a) => key(a) || '(Blank)')].map(([k, rs]) => ({ key: k, label: k, value: rs.length })).sort((a, b) => b.value - a.value)
    return {
      sites,
      age,
      current: agents.filter((a) => !a.isDeleted),
      bySite: count((a) => (a.isDeleted ? '' : a.siteUrl)).filter((b) => b.key !== '(Blank)').map((b) => ({ ...b, label: shortHost(b.label) })),
      ops: count((a) => a.lastOperation),
      apps: count((a) => a.applicationName),
    }
  }, [ds.asOf, agents])

  return (
    <>
      <PageFilters label="Page filters">
        <Select label="Site" value={site} onChange={setSite} options={uniq(ds.spAgents.map((a) => a.siteUrl)).map((s) => ({ value: s, label: shortHost(s) }))} allLabel="All" />
        <Select
          label="Deleted"
          value={deleted}
          onChange={setDeleted}
          options={[
            { value: 'false', label: 'Current' },
            { value: 'true', label: 'Deleted' },
          ]}
          allLabel="All"
        />
        <Select label="Source application" value={app} onChange={setApp} options={options(uniq(ds.spAgents.map((a) => a.applicationName)))} allLabel="All" />
        <Select label="Last operation" value={op} onChange={setOp} options={options(uniq(ds.spAgents.map((a) => a.lastOperation)))} allLabel="All" />
      </PageFilters>
      <PageIntro>.agent files observed through Purview file operations. Each file is one agent, keyed by its list item id.</PageIntro>
      {ds.spAgents.length === 0 ? (
        <Empty>No SharePoint agents were collected. The SharePoint agent logging flow writes this table; see Setup & coverage.</Empty>
      ) : (
        <>
          <KpiRow>
            <Kpi label="Observed agents" value={int(agents.length)} tone="agent" />
            <Kpi label="Current agents" value={int(m.current.length)} />
            <Kpi label="Sites" value={int(distinct(m.current, (a) => a.siteUrl))} />
            <Kpi label="Deleted agents" value={int(agents.length - m.current.length)} help="Agent files that were deleted after they were observed." />
          </KpiRow>
          <Grid cols={3}>
            <Panel title="Current agents by site" span={2}>
              <BarList label="Current SharePoint agents by site" items={m.bySite} color={COLOR.licensed} fmt={int} limit={8} />
            </Panel>
            <Stack>
              <Panel title="Latest observed operation">
                <BarList label="SharePoint agents by last operation" items={m.ops} color={COLOR.licensed} fmt={int} />
              </Panel>
              <Panel title="Source application">
                <BarList label="SharePoint agents by source application" items={m.apps} color={COLOR.licensed} fmt={int} />
              </Panel>
            </Stack>
            <Panel title="Inventory by site" span={3}>
              <DataTable
                label="Inventory by site"
                rows={rowsOf(m.sites, (r) => r.site)}
                search={(r) => r.site}
                initialSort={{ key: 'current', desc: true }}
                columns={[
                  text('site', 'Site', (r: SiteRow) => shortHost(r.site), '40%'),
                  num('current', 'Current agents', (r: SiteRow) => r.current, { bar: COLOR.licensed }),
                  num('deleted', 'Deleted agents', (r: SiteRow) => r.deleted),
                ]}
              />
            </Panel>
            <Panel title="Every observed SharePoint agent" span={3}>
              <DataTable
                label="Every observed SharePoint agent"
                rows={rowsOf(agents, (a) => a.key)}
                search={(a) => `${a.name} ${a.siteUrl} ${a.libraryPath}`}
                initialSort={{ key: 'seen', desc: true }}
                columns={[
                  text('name', 'Agent', (a: SharePointAgent) => a.name, '20%'),
                  text('site', 'Site', (a: SharePointAgent) => shortHost(a.siteUrl)),
                  text('lib', 'Library path', (a: SharePointAgent) => a.libraryPath),
                  text('op', 'Last operation', (a: SharePointAgent) => a.lastOperation),
                  date('seen', 'Last seen', (a: SharePointAgent) => a.lastSeenAt),
                  num('events', 'Events', (a: SharePointAgent) => a.eventCount),
                  bool('deleted', 'Deleted', (a: SharePointAgent) => a.isDeleted),
                ]}
              />
            </Panel>
            <Panel title="Latest audit provenance" span={3}>
              <DataTable
                label="Latest audit provenance"
                rows={rowsOf(agents, (a) => a.key)}
                search={(a) => `${a.name} ${a.lastActor} ${a.applicationName}`}
                initialSort={{ key: 'seen', desc: true }}
                columns={[
                  text('name', 'Agent', (a: SharePointAgent) => a.name, '20%'),
                  text('app', 'Application', (a: SharePointAgent) => a.applicationName),
                  text('actor', 'Last actor', (a: SharePointAgent) => a.lastActor),
                  date('seen', 'Last seen', (a: SharePointAgent) => a.lastSeenAt),
                  num('events', 'Events', (a: SharePointAgent) => a.eventCount),
                  bool('deleted', 'Deleted', (a: SharePointAgent) => a.isDeleted),
                ]}
              />
            </Panel>
          </Grid>
        </>
      )}
    </>
  )
}
