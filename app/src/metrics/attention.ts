import type { Agent } from '../data/types'

/** A per-agent condition the Overview counts and Inventory › All agents can filter to with `?focus=<id>`. */
export interface AttentionCheck {
  id: string
  label: string
  help: string
  test: (a: Agent) => boolean
}

const noAuth = (a: Agent) => a.authentication === 'None' || !a.authentication

/** In order of severity: the first checks are the ones to act on first. */
export const ATTENTION: AttentionCheck[] = [
  {
    id: 'high-no-owner',
    label: 'High risk with no owner',
    help: 'Scores 5 or more on the risk model and has no owner on record, so nobody is accountable for it.',
    test: (a) => a.riskBand === 'High' && !a.hasOwner,
  },
  {
    id: 'shared-no-auth',
    label: 'Shared tenant-wide with no authentication',
    help: 'Anyone in the tenant can reach it, and it does not ask who they are.',
    test: (a) => a.sharedTenantWide && noAuth(a),
  },
  {
    id: 'shared-unused',
    label: 'Shared tenant-wide but never used',
    help: 'Published to everyone, with no last-used date in Power Platform: retire it, or tell people it exists.',
    test: (a) => a.sharedTenantWide && !a.lastUsed,
  },
  {
    id: 'owner-unresolved',
    label: 'Owner no longer in Entra',
    help: 'The owner on record does not resolve to a user in Microsoft Entra ID, often because they left.',
    test: (a) => a.ownerPrincipalType === 'Not resolved in Entra',
  },
]

export const attentionCheck = (id: string) => ATTENTION.find((c) => c.id === id)

/** How many agents fail each check, in the order of `ATTENTION`. */
export function attentionCounts(agents: readonly Agent[]): { check: AttentionCheck; count: number }[] {
  return ATTENTION.map((check) => ({ check, count: agents.reduce((n, a) => n + (check.test(a) ? 1 : 0), 0) }))
}
