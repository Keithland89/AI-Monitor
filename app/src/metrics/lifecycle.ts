import type { Agent } from '../data/types'

/** Where an agent sits in its life, from its age and the Power Platform last-used date. */
export const LIFECYCLE = ['New', 'Active', 'Idle', 'Dormant', 'Never used', 'No usage signal'] as const
export type Lifecycle = (typeof LIFECYCLE)[number]

export const LIFECYCLE_HELP: Record<Lifecycle, string> = {
  New: 'Created in the last 30 days.',
  Active: 'Used in the last 30 days.',
  Idle: 'Last used 31 to 90 days ago.',
  Dormant: 'Not used for more than 90 days.',
  'Never used': 'No last-used date at all, 30 or more days after it was created, on a platform that records one.',
  'No usage signal': 'Built on a platform that records no last-used date (Agent Builder or Azure AI Foundry), so it is not judged on use.',
}

/** Platforms whose agents never get a Power Platform last-used date, as in the report's TelemetryCoverage table. */
export const NO_USAGE_SIGNAL_PLATFORMS: readonly string[] = ['M365 Copilot Agent Builder', 'Azure AI Foundry']

export const hasUsageSignal = (a: Pick<Agent, 'platform'>) => !NO_USAGE_SIGNAL_PLATFORMS.includes(a.platform)

export const VERDICTS = ['Keep', 'Watch', 'Review', 'Retire'] as const
export type Verdict = (typeof VERDICTS)[number]

export const VERDICT_HELP: Record<Verdict, string> = {
  Keep: 'In use, or with no usage signal to judge, and no flags.',
  Watch: 'Too new to judge, not used yet, or idle.',
  Review: 'High risk, or no owner. Check it before anything else.',
  Retire: 'Dormant for more than 90 days, or never used 60 days after it was created.',
}

/** How often each verdict should come back for review. */
export const REVIEW_CADENCE: Record<Verdict, string> = {
  Retire: 'Now: confirm with the owner, then remove or quarantine.',
  Review: 'This month: fix the risk or find an owner.',
  Watch: 'Every quarter: check again when the next review runs.',
  Keep: 'Twice a year, with the full inventory.',
}

export function lifecycleOf(a: Agent): Lifecycle {
  if (!hasUsageSignal(a)) return 'No usage signal'
  if (a.ageDays !== null && a.ageDays < 30) return 'New'
  switch (a.activityStatus) {
    case 'Active (7d)':
    case 'Active (30d)':
      return 'Active'
    case 'Idle (90d)':
      return 'Idle'
    case 'Dormant (90d+)':
      return 'Dormant'
    default:
      return 'Never used'
  }
}

export function verdictOf(a: Agent, stage: Lifecycle): { verdict: Verdict; reason: string } {
  if (stage === 'Dormant') return { verdict: 'Retire', reason: `Not used for ${a.daysSinceLastUse ?? 'over 90'} days` }
  if (stage === 'Never used' && (a.ageDays ?? 0) >= 60) return { verdict: 'Retire', reason: `Never used, created ${a.ageDays} days ago` }
  if (a.riskBand === 'High') return { verdict: 'Review', reason: `High risk (score ${a.riskScore})` }
  if (!a.hasOwner) return { verdict: 'Review', reason: 'No owner' }
  if (stage === 'New') return { verdict: 'Watch', reason: 'Created in the last 30 days' }
  if (stage === 'Never used') return { verdict: 'Watch', reason: 'Not used yet' }
  if (stage === 'Idle') return { verdict: 'Watch', reason: `Last used ${a.daysSinceLastUse ?? 'over 30'} days ago` }
  if (stage === 'No usage signal') return { verdict: 'Keep', reason: 'No usage signal on this platform' }
  return { verdict: 'Keep', reason: 'Used in the last 30 days' }
}

export interface AgentReview {
  agent: Agent
  stage: Lifecycle
  verdict: Verdict
  reason: string
}

export function reviewAgents(agents: readonly Agent[]): AgentReview[] {
  return agents.map((agent) => {
    const stage = lifecycleOf(agent)
    return { agent, stage, ...verdictOf(agent, stage) }
  })
}