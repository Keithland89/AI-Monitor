import { describe, expect, it } from 'vitest'
import {
  activityStatus, agentKeyOf, dayBoundaries, elapsedDays, finaliseAgents, isActive30, joinAgents, platformOf, projectAgent,
  projectConnectors, projectKnowledge, projectUsage, riskBand, riskFactors, toBool, toInt, toTime, ZERO_GUID, type ArgItem,
} from './transforms'
import type { AgentBase } from './types'

const base = (over: Partial<AgentBase> = {}): AgentBase => ({
  key: 'env1|a1', id: 'a1', name: 'Agent', authoringSurface: '', envId: 'env1', envName: 'Env', envType: 'Production', region: 'europe',
  schemaName: '', orchestration: '', model: '', authentication: 'Integrated', createdAt: '2026-01-01T00:00:00', lastPublishedAt: '',
  lastUsed: '', isQuarantined: false, isManaged: false, isGithubCopilotAgent: false, isCLIAgent: false, webSearch: false, channels: '',
  channelCount: 0, topicCount: 0, toolCount: 0, knowledgeCount: 0, connectedAgentCount: 0, connectorCount: 0, connectorOpsCount: 0,
  flowCount: 0, sharedUserCount: 0, sharedGroupCount: 0, sharedTenantWide: false, editorUserCount: 0, ownerId: '', createdBy: '',
  entraAppId: '', entraAgentId: '', blueprintId: '', harness: '', instructionsCharCount: 0, quarantinedAt: '', knowledgeTypes: '',
  graphConnectorCount: 0, sharePointSiteCount: 0, publicSiteCount: 0, fileKnowledgeCount: 0, dataverseSourceCount: 0, titleId: '',
  ...over,
})

const score = (a: AgentBase) => riskFactors(a).reduce((s, f) => s + f.points, 0)

describe('coercion', () => {
  it('normalises times to zone-less seconds', () => {
    expect(toTime('2026-03-01T10:00:00.123Z')).toBe('2026-03-01T10:00:00')
    expect(toTime('2026-03-01 10:00')).toBe('2026-03-01T10:00:00')
    expect(toTime('2026-03-01')).toBe('2026-03-01T00:00:00')
    expect(toTime(null)).toBe('')
  })

  it('counts whole days and day boundaries like Duration.Days and DATEDIFF', () => {
    expect(elapsedDays('2026-04-28T00:00:00', '2026-05-01T12:00:00')).toBe(3)
    expect(elapsedDays('2026-04-30T23:00:00', '2026-05-01T01:00:00')).toBe(0)
    expect(dayBoundaries('2026-04-30T23:00:00', '2026-05-01T01:00:00')).toBe(1)
    expect(elapsedDays('', '2026-05-01T01:00:00')).toBeNull()
  })

  it('reads booleans and integers loosely', () => {
    expect([true, 'True', '1', 'yes', 1].map(toBool)).toEqual([true, true, true, true, true])
    expect([false, 'false', '', null, 0].map(toBool)).toEqual([false, false, false, false, false])
    expect([3.7, '12', 'x', null].map(toInt)).toEqual([3, 12, 0, 0])
  })
})

describe('risk scoring', () => {
  it('fires no-authentication for None, No authentication and empty, but not for null', () => {
    expect(score(base({ authentication: 'None' }))).toBe(3)
    expect(score(base({ authentication: 'No authentication' }))).toBe(3)
    expect(score(base({ authentication: '' }))).toBe(3)
    expect(score(base({ authentication: null }))).toBe(0)
    expect(score(base({ authentication: 'none' }))).toBe(0)
  })

  it('weights every factor as the model does', () => {
    expect(score(base({ isQuarantined: true }))).toBe(3)
    expect(score(base({ sharedTenantWide: true, lastUsed: '2026-02-01T00:00:00' }))).toBe(2)
    expect(score(base({ sharedTenantWide: true }))).toBe(3)
    expect(score(base({ webSearch: true }))).toBe(1)
    expect(score(base({ connectorCount: 2 }))).toBe(1)
    expect(score(base({ connectedAgentCount: 1 }))).toBe(1)
    const all = base({ authentication: 'None', isQuarantined: true, sharedTenantWide: true, webSearch: true, connectorCount: 1, connectedAgentCount: 1 })
    expect(score(all)).toBe(12)
    expect(riskFactors(all)).toHaveLength(7)
  })

  it('bands at 5 and 3', () => {
    expect([0, 2, 3, 4, 5, 12].map(riskBand)).toEqual(['Low', 'Low', 'Medium', 'Medium', 'High', 'High'])
  })
})

describe('activity', () => {
  it('buckets days since activity', () => {
    expect(activityStatus(null)).toBe('No usage signal')
    expect(activityStatus(0)).toBe('Active (7d)')
    expect(activityStatus(7)).toBe('Active (7d)')
    expect(activityStatus(8)).toBe('Active (30d)')
    expect(activityStatus(30)).toBe('Active (30d)')
    expect(activityStatus(90)).toBe('Idle (90d)')
    expect(activityStatus(91)).toBe('Dormant (90d+)')
  })

  it('counts both active buckets as active in 30 days', () => {
    expect(isActive30('Active (7d)')).toBe(true)
    expect(isActive30('Active (30d)')).toBe(true)
    expect(isActive30('Idle (90d)')).toBe(false)
  })

})

describe('platform', () => {
  it('maps authoring surfaces to platforms', () => {
    expect(platformOf(base({ authoringSurface: 'Copilot Studio Lite' }))).toBe('M365 Copilot Agent Builder')
    expect(platformOf(base({ authoringSurface: '' }))).toBe('Copilot Studio')
    expect(platformOf(base({ authoringSurface: 'Copilot Studio' }))).toBe('Copilot Studio')
    expect(platformOf(base({ platform: 'Azure AI Foundry', authoringSurface: 'x' }))).toBe('Azure AI Foundry')
  })
})

const item: ArgItem = {
  id: '/providers/x/agents/bot1',
  name: 'bot1',
  type: 'microsoft.copilotstudio/agents',
  location: 'europe',
  properties: {
    environmentId: 'env1',
    displayName: 'Helpdesk',
    createdIn: 'Copilot Studio Lite',
    authentication: 'None',
    createdAt: '2026-03-01T10:00:00Z',
    lastPublishedAt: '2026-03-02T10:00:00Z',
    isQuarantined: false,
    isWebSearchEnabledForKnowledge: true,
    channels: ['msteams', 'webchat'],
    componentsCounts: { topics: 4, tools: 2, knowledge: 3, connectedAgents: 1, knowledgeByType: { sharepointSites: 2, publicSites: 1 } },
    capabilitiesCounts: { distinctPowerPlatformConnectors: 2, distinctPowerPlatformConnectorsOperations: 5, distinctFlows: 1 },
    sharedWithViewers: { userCount: 7, groupCount: 1, entireTenant: true },
    sharedWithEditors: { userCount: 2 },
    ownerId: 'owner-1',
    createdBy: 'creator-1',
  },
}

describe('lane A projections', () => {
  it('projects a Power Platform agent the way the KQL does', () => {
    const a = projectAgent(item)
    expect(agentKeyOf(item)).toBe('env1|bot1')
    expect(a.key).toBe('env1|bot1')
    expect(a.name).toBe('Helpdesk')
    expect(a.authoringSurface).toBe('Copilot Studio Lite')
    expect(a.authentication).toBe('None')
    expect(a.webSearch).toBe(true)
    expect(a.channels).toBe('msteams; webchat')
    expect(a.channelCount).toBe(2)
    expect([a.topicCount, a.toolCount, a.knowledgeCount, a.connectedAgentCount]).toEqual([4, 2, 3, 1])
    expect([a.connectorCount, a.connectorOpsCount, a.flowCount]).toEqual([2, 5, 1])
    expect([a.sharedUserCount, a.sharedGroupCount, a.sharedTenantWide, a.editorUserCount]).toEqual([7, 1, true, 2])
    expect(a.sharePointSiteCount).toBe(2)
    expect(a.knowledgeTypes.split('; ').sort()).toEqual(['publicSites', 'sharepointSites'])
  })

  it('keeps an absent authentication property as null so it does not score', () => {
    const a = projectAgent({ ...item, properties: { ...item.properties, authentication: undefined } })
    expect(a.authentication).toBeNull()
  })

  it('projects connectors and knowledge without throwing on sparse items', () => {
    expect(() => projectConnectors({ name: 'x', properties: {} })).not.toThrow()
    expect(() => projectKnowledge({ name: 'x', properties: {} })).not.toThrow()
    const k = projectKnowledge(item)
    expect(k.map((r) => r.type).sort()).toEqual(['Public websites', 'SharePoint sites', 'Web search'])
    expect(k.reduce((s, r) => s + r.count, 0)).toBe(4)
    expect(new Set(k.map((r) => r.agentKey))).toEqual(new Set(['env1|bot1']))
  })

  it('joins usage and environment names', () => {
    const usage = projectUsage([])
    const joined = joinAgents([base({ id: 'A1', envName: '', envType: '', model: '', envId: 'missing' })], usage, [])
    expect(joined[0].envName).toBe('Unlisted: missing')
    expect(joined[0].envType).toBe('Unknown')
    expect(joined[0].model).toBe('Not specified')
    const named = joinAgents([base({ envName: '', envType: '' })], new Map([['a1', '2026-04-01T00:00:00']]), [
      { id: 'env1', name: 'Sales', region: '', type: 'Sandbox', isManaged: false, groupId: '', createdAt: '', lastModifiedAt: '', createdBy: '' },
    ])
    expect(named[0]).toMatchObject({ envName: 'Sales', envType: 'Sandbox', lastUsed: '2026-04-01T00:00:00' })
    const cased = joinAgents([base({ envName: '', envType: '', envId: 'ENV1' })], usage, [
      { id: 'env1', name: 'Sales', region: '', type: 'Sandbox', isManaged: false, groupId: '', createdAt: '', lastModifiedAt: '', createdBy: '' },
    ])
    expect(cased[0].envName).toBe('Sales')
  })
})

describe('finaliseAgents', () => {
  const opt = { asOf: '2026-05-01T12:00:00', users: [{ key: 'u1', name: 'Ada', upn: 'ada@contoso.example', type: 'User' }], namesResolved: true }

  it('derives risk, reasons, recency and origin', () => {
    const { agents, riskDetail } = finaliseAgents(
      [base({ authentication: 'None', sharedTenantWide: true, createdBy: 'U1', ownerId: 'u1', lastUsed: '2026-04-28T00:00:00' })],
      opt,
    )
    const a = agents[0]
    expect(a.riskScore).toBe(5)
    expect(a.riskBand).toBe('High')
    expect(a.riskReasons).toBe('No authentication configured (+3); Shared with the entire tenant (+2)')
    expect(riskDetail).toHaveLength(2)
    expect(a.createdByName).toBe('Ada')
    expect(a.ownerUpn).toBe('ada@contoso.example')
    expect(a.agentOrigin).toBe('Human-built')
    expect(a.daysSinceLastUse).toBe(3)
    expect(a.activityStatus).toBe('Active (7d)')
  })

  it('measures activity from the Power Platform last-used date only', () => {
    const never = finaliseAgents([base({ lastUsed: '' })], opt).agents[0]
    expect(never.activityStatus).toBe('No usage signal')
    expect(never.daysSinceLastUse).toBeNull()
    const idle = finaliseAgents([base({ lastUsed: '2026-03-01T00:00:00' })], opt).agents[0]
    expect(idle.activityStatus).toBe('Idle (90d)')
    expect(idle.daysSinceLastUse).toBe(61)
    const dormant = finaliseAgents([base({ lastUsed: '2026-01-01T00:00:00' })], opt).agents[0]
    expect(dormant.activityStatus).toBe('Dormant (90d+)')
  })

  it('flags tenant-wide agents with no last-used date', () => {
    const { agents } = finaliseAgents([base({ sharedTenantWide: true, lastUsed: '' })], opt)
    expect(agents[0].riskReasons).toContain('Shared tenant-wide and never used (+1)')
  })

  it('does not judge never-used on platforms with no usage signal (docs/risk-rubric.md)', () => {
    const { agents } = finaliseAgents(
      [
        base({ key: 'b', authoringSurface: 'Copilot Studio Lite', sharedTenantWide: true, lastUsed: '' }),
        base({ key: 'f', platform: 'Azure AI Foundry', sharedTenantWide: true, lastUsed: '' }),
      ],
      opt,
    )
    for (const a of agents) {
      expect(a.riskReasons).toBe('Shared with the entire tenant (+2)')
      expect(a.riskScore).toBe(2)
    }
  })

  it('scores every rubric factor and bands the total', () => {
    const all = finaliseAgents(
      [base({ authentication: 'None', isQuarantined: true, sharedTenantWide: true, webSearch: true, connectorCount: 2, connectedAgentCount: 1 })],
      opt,
    ).agents[0]
    expect(all.riskScore).toBe(3 + 3 + 2 + 1 + 1 + 1 + 1)
    expect(all.riskFactorCount).toBe(7)
    expect(all.riskBand).toBe('High')
    expect(finaliseAgents([base({ sharedTenantWide: true, webSearch: true })], opt).agents[0].riskBand).toBe('Medium')
    expect(finaliseAgents([base({ sharedTenantWide: true, webSearch: true, lastUsed: '2026-04-01T00:00:00' })], opt).agents[0].riskBand).toBe('Medium')
    expect(finaliseAgents([base({ connectorCount: 1, connectedAgentCount: 1, lastUsed: '2026-04-01T00:00:00' })], opt).agents[0].riskBand).toBe('Low')
  })

  it('labels platform-provisioned agents and shows ids when names cannot be resolved', () => {
    const sys = finaliseAgents([base({ createdBy: ZERO_GUID, isManaged: true })], opt).agents[0]
    expect(sys.agentOrigin).toBe('Platform-provisioned')
    expect(sys.creatorCategory).toBe('Microsoft')
    const ids = finaliseAgents([base({ createdBy: 'abc', ownerId: 'def' })], { ...opt, namesResolved: false }).agents[0]
    expect(ids.createdByName).toBe('abc')
    expect(ids.ownerName).toBe('def')
  })

  it('drops duplicate agent keys', () => {
    expect(finaliseAgents([base(), base()], opt).agents).toHaveLength(1)
  })
})
