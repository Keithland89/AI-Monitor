// Whether a data lane can be trusted for a page, so a lane that failed never reads as a confident zero.
import type { LaneId, LaneStatus } from '../data/types'
import type { TabId } from '../routes'

/**
 * - `failed`: the lane could not be read, so its numbers are unknown.
 * - `absent`: the sample ships no rows for this lane, so its numbers are unknown.
 * - `empty`: the lane was read and returned nothing, so zero is the honest answer, with a caveat.
 */
export type ProblemKind = 'failed' | 'absent' | 'empty'

export interface LaneProblem {
  lane: LaneStatus
  kind: ProblemKind
  /** A few words for a KPI that cannot be shown, such as "Access denied". */
  short: string
  /** What happened and how to recover. */
  message: string
}

/** How to fix each lane, in words a tenant admin can act on. */
const FIX: Partial<Record<LaneId, string>> = {
  shadow: 'Advanced hunting needs Security Reader and the AdvancedQuery.Read permission on the Defender connection.',
  foundry: 'Foundry needs Reader on each subscription that holds Azure AI resources.',
}
const SETUP = 'Run the installer, or add the connection in the app settings.'

export function laneProblem(lane: LaneStatus | undefined): LaneProblem | null {
  if (!lane || lane.state === 'loading' || lane.state === 'ok') return null
  const fix = FIX[lane.id] ?? 'Check the connection on Setup & coverage.'
  const detail = lane.detail ? ` ${lane.detail}` : ''
  switch (lane.state) {
    case 'sample':
      return lane.rows > 0 ? null : { lane, kind: 'absent', short: 'Not in the sample', message: `${lane.detail ?? 'The sample ships no rows for this lane.'} With live data: ${fix}` }
    case 'denied':
      return { lane, kind: 'failed', short: 'Access denied', message: `Access was denied. ${fix}` }
    case 'not-set-up':
      return { lane, kind: 'failed', short: 'Not set up', message: `The connection is not set up. ${SETUP}` }
    case 'empty':
      return { lane, kind: 'empty', short: 'No rows', message: `The lane was read and returned no rows.${detail}` }
    default:
      return { lane, kind: 'failed', short: 'Could not load', message: `The lane could not be read.${detail} ${fix}` }
  }
}

/** Problems for the given lanes, in the order asked. */
export function laneProblems(lanes: LaneStatus[], ids: LaneId[]): LaneProblem[] {
  return ids.map((id) => laneProblem(lanes.find((l) => l.id === id))).filter((p): p is LaneProblem => p !== null)
}

/** A KPI's unknown reason when its lane has no trustworthy data, or undefined when its number can be shown. */
export const unknownFrom = (p: LaneProblem | null | undefined) => (p && p.kind !== 'empty' ? p.short : undefined)

/** The lanes each section depends on beyond the core inventory, so the nav can flag a section whose data did not load. */
export const TAB_LANES: Partial<Record<TabId, LaneId[]>> = {
  foundry: ['foundry', 'flows'],
  shadow: ['shadow'],
}
