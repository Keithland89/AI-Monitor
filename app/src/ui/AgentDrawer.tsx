import { useMemo } from 'react'
import { useData } from '../data/store'
import { LIFECYCLE_HELP, lifecycleOf, verdictOf } from '../metrics/lifecycle'
import { connectorLabel, dateLabel, int, DASH, regionLabel } from './format'
import { Sheet } from './Sheet'
import { LIFECYCLE_TEXT, RISK_TEXT, VERDICT_TEXT } from './theme'

const day = (iso: string) => (iso ? dateLabel(iso.slice(0, 10)) : DASH)

/** Everything known about one agent, opened from any agent name in the app. */
export function AgentDrawer({ agentKey, onClose }: { agentKey: string | null; onClose: () => void }) {
  const { ds, agentByKey } = useData()
  const agent = agentKey ? agentByKey.get(agentKey) : undefined
  const d = useMemo(() => {
    if (!agent) return null
    const stage = lifecycleOf(agent)
    return {
      stage,
      review: verdictOf(agent, stage),
      reasons: ds.riskDetail.filter((r) => r.agentKey === agent.key),
      knowledge: ds.knowledge.filter((k) => k.agentKey === agent.key),
      sources: ds.sources.filter((s) => s.agentKey === agent.key),
      connectors: ds.connectors.filter((c) => c.agentKey === agent.key),
    }
  }, [agent, ds])

  return (
    <Sheet open={!!agent} onClose={onClose} title={agent?.name || 'Agent'} side>
      {agent && d && (
        <div className="detail">
          <p className="detail-type">
            {agent.platform}
            {agent.authoringSurface && agent.authoringSurface !== agent.platform ? ` · ${agent.authoringSurface}` : ''}
          </p>
          <dl className="stat-grid">
            <div>
              <dt>Risk</dt>
              <dd style={{ color: RISK_TEXT[agent.riskBand] }}>
                {agent.riskBand} ({agent.riskScore})
              </dd>
            </div>
            <div>
              <dt>Activity</dt>
              <dd>{agent.activityStatus}</dd>
            </div>
            <div>
              <dt>Lifecycle</dt>
              <dd style={{ color: LIFECYCLE_TEXT[d.stage] }} title={LIFECYCLE_HELP[d.stage]}>
                {d.stage}
              </dd>
            </div>
            <div>
              <dt>Verdict</dt>
              <dd style={{ color: VERDICT_TEXT[d.review.verdict] }} title={d.review.reason}>
                {d.review.verdict}
              </dd>
            </div>
            <div>
              <dt>Days since use</dt>
              <dd>{agent.daysSinceLastUse !== null ? int(agent.daysSinceLastUse) : d.stage === 'No usage signal' ? 'No usage signal' : 'Never used'}</dd>
            </div>
            <div>
              <dt>Origin</dt>
              <dd>{agent.agentOrigin}</dd>
            </div>
          </dl>
          <h3>Details</h3>
          <dl className="kv">
            <dt>Environment</dt>
            <dd>
              {agent.envName || DASH}
              {agent.envType ? <small> · {agent.envType}</small> : null}
            </dd>
            <dt>Region</dt>
            <dd>{regionLabel(agent.region) || DASH}</dd>
            <dt>Created</dt>
            <dd>{day(agent.createdAt)}</dd>
            <dt>Last used</dt>
            <dd>{day(agent.lastUsed)}</dd>
            <dt>Published</dt>
            <dd>{agent.isPublished ? day(agent.lastPublishedAt) : 'Not published'}</dd>
            <dt>Owner</dt>
            <dd>{agent.ownerName || agent.ownerId || 'Unresolved'}</dd>
            <dt>Created by</dt>
            <dd>{agent.createdByName || agent.createdBy || 'Unresolved'}</dd>
            <dt>Authentication</dt>
            <dd>{agent.authentication || 'None'}</dd>
            <dt>Orchestration</dt>
            <dd>{agent.orchestration || DASH}</dd>
            <dt>Model</dt>
            <dd>{agent.model || DASH}</dd>
            <dt>Sharing</dt>
            <dd>{agent.sharedTenantWide ? 'Whole tenant' : `${int(agent.sharedUserCount)} users, ${int(agent.sharedGroupCount)} groups`}</dd>
            <dt>Components</dt>
            <dd>
              {int(agent.topicCount)} topics, {int(agent.toolCount)} tools, {int(agent.knowledgeCount)} knowledge
            </dd>
          </dl>
          {d.reasons.length > 0 && (
            <>
              <h3>Why it is risky</h3>
              <ul className="detail-list">
                {d.reasons.map((r) => (
                  <li key={r.factor}>
                    {r.factor} <small>+{r.points}</small>
                  </li>
                ))}
              </ul>
            </>
          )}
          {(d.knowledge.length > 0 || d.sources.length > 0) && (
            <>
              <h3>Knowledge</h3>
              <ul className="detail-list">
                {d.sources.length
                  ? d.sources.slice(0, 20).map((s, i) => (
                      <li key={`${s.sourceId}:${i}`}>
                        {s.sourceName || s.locator} <small>{s.knowledgeType}</small>
                      </li>
                    ))
                  : d.knowledge.map((k) => (
                      <li key={k.type}>
                        {k.type} <small>{int(k.count)}</small>
                      </li>
                    ))}
              </ul>
            </>
          )}
          {d.connectors.length > 0 && (
            <>
              <h3>Connectors</h3>
              <ul className="detail-list">
                {d.connectors.map((c) => (
                  <li key={c.connectorId}>
                    <span title={c.connectorId}>{connectorLabel(c.connectorId)}</span> {c.isMcp ? <small>MCP</small> : null}
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      )}
    </Sheet>
  )
}
