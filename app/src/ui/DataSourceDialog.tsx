import { useData } from '../data/store'
import { LaneTable } from '../pages/Setup'
import { dateLabel, int } from './format'
import { Sheet } from './Sheet'

export function DataSourceDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { ds, hostAvailable, switchMode, reload, loading } = useData()
  const live = ds.mode === 'live'
  return (
    <Sheet open={open} onClose={onClose} title="Data source">
      <div className="source">
        <dl className="kv">
          <dt>Now showing</dt>
          <dd>{live ? 'Live tenant data' : 'Anonymised sample data'}</dd>
          <dt>As of</dt>
          <dd>{dateLabel(ds.asOf.slice(0, 10))}</dd>
          <dt>Agents</dt>
          <dd>{int(ds.agents.length)}</dd>
          <dt>Knowledge sources</dt>
          <dd>{int(ds.sources.length)}</dd>
        </dl>
        <p>
          {hostAvailable
            ? 'Live data is read through the connections the app was deployed with. Each lane loads on its own; a lane without permission or setup shows no rows rather than breaking the app.'
            : 'The app is running outside the Copilot Managed Apps player, so only the anonymised sample is available. Deploy the app to read live data.'}
        </p>
        <div className="source-action">
          <button type="button" className="btn btn-primary" disabled={!hostAvailable || loading || live} onClick={() => switchMode('live')}>
            Use live data
          </button>
          <button type="button" className="btn" disabled={loading || !live} onClick={() => switchMode('sample')}>
            Use sample data
          </button>
          <button type="button" className="btn" disabled={loading} onClick={reload}>
            Reload
          </button>
        </div>
        <h3>Data lanes</h3>
        <LaneTable lanes={ds.lanes} />
      </div>
    </Sheet>
  )
}
