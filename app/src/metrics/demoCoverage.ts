import type { LaneId, LaneStatus } from '../data/types'
import type { TabId } from '../routes'

export type ProblemKind = 'failed' | 'absent' | 'empty'

export interface LaneProblem {
  lane: LaneStatus
  kind: ProblemKind
  short: string
  message: string
}

export function laneProblem(lane: LaneStatus | undefined): LaneProblem | null {
  if (!lane || lane.state === 'loading' || lane.state === 'ok' || lane.state === 'sample' && lane.rows > 0) return null
  return {
    lane,
    kind: lane.state === 'empty' ? 'empty' : 'absent',
    short: 'No synthetic rows',
    message: lane.detail || 'This synthetic fixture contains no rows for the selected lane.',
  }
}

export function laneProblems(lanes: LaneStatus[], ids: LaneId[]): LaneProblem[] {
  return ids.map((id) => laneProblem(lanes.find((lane) => lane.id === id))).filter((problem): problem is LaneProblem => problem !== null)
}

export const unknownFrom = (problem: LaneProblem | null | undefined) => (problem && problem.kind !== 'empty' ? problem.short : undefined)

export const TAB_LANES: Partial<Record<TabId, LaneId[]>> = {
  foundry: ['foundry', 'flows'],
  cost: ['credits', 'creditpool', 'aicost'],
  shadow: ['shadow'],
}
