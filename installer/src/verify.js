// @ts-check
/**
 * After the flows are on: the newest row in each lane's run table, and lane F's check. No row yet
 * means the first run is still pending, which isn't a failure; a missing table means the lane isn't
 * set up.
 */

/**
 * @typedef {'ok' | 'pending' | 'warn' | 'failed' | 'missing'} LaneState
 * @typedef {{ lane: string, name: string, state: LaneState, detail: string }} LaneResult
 */

/** The run tables, by lane: entity set and the columns read. */
export const RUN_TABLES = [
  {
    lane: 'E',
    name: 'SharePoint agents',
    set: 'poc_sharepointagentloggingruns',
    columns: ['poc_status', 'poc_recordsretrieved'],
    /** @param {any} row @returns {[LaneState, string]} */
    judge: (row) => {
      const status = String(row.poc_status ?? '');
      if (status === 'Completed') return ['ok', `Last run completed, ${Number(row.poc_recordsretrieved ?? 0)} records read.`];
      if (/fail|error/i.test(status)) return ['failed', `Last run: ${status}. Open the flow's run history for why.`];
      return ['pending', `Last run: ${status || 'still running'}.`];
    },
  },
  {
    lane: 'D',
    name: 'Knowledge sources',
    set: 'poc_knowledgesweepruns',
    columns: ['poc_status', 'poc_environmentsswept', 'poc_environmentsfailed', 'poc_rowsfound'],
    /** @param {any} row @returns {[LaneState, string]} */
    judge: (row) => {
      const status = String(row.poc_status ?? '');
      const counts = `${Number(row.poc_environmentsswept ?? 0)} environments swept, ${Number(row.poc_environmentsfailed ?? 0)} failed, ${Number(row.poc_rowsfound ?? 0)} sources found`;
      if (/^failed/i.test(status)) return ['failed', `Last run failed (${counts}). See poc_knowledgesweeperror.`];
      if (/error/i.test(status)) return ['warn', `Last run: ${status} (${counts}). See poc_knowledgesweeperror.`];
      if (/^completed/i.test(status)) return ['ok', `Last run completed: ${counts}.`];
      return ['pending', `Last run: ${status || 'still running'}.`];
    },
  },
];

/**
 * @param {import('./dataverse.js').Dataverse} dv
 * @param {{ sharePoint?: boolean }} [o]  Leave lane E out when it isn't included.
 * @returns {Promise<LaneResult[]>}
 */
export async function verifyLanes(dv, { sharePoint = true } = {}) {
  /** @type {LaneResult[]} */
  const out = [];
  for (const t of RUN_TABLES) {
    if (t.lane === 'E' && !sharePoint) continue;
    try {
      const row = await dv.latestRow(t.set, t.columns);
      if (row === undefined) out.push({ lane: t.lane, name: t.name, state: 'missing', detail: 'Not set up: its run table isn\'t in the environment.' });
      else if (row === null) out.push({ lane: t.lane, name: t.name, state: 'pending', detail: 'First run pending: no run has written its row yet.' });
      else {
        const [state, detail] = t.judge(row);
        out.push({ lane: t.lane, name: t.name, state, detail: `${detail} (${String(row.createdon ?? '').slice(0, 16).replace('T', ' ')})` });
      }
    } catch (err) {
      out.push({ lane: t.lane, name: t.name, state: 'warn', detail: `Couldn't read ${t.set}: ${/** @type {Error} */ (err).message.split('\n')[0]}` });
    }
  }
  return out;
}

/**
 * Lane F has nothing to install: the app reads Defender advanced hunting when it's opened.
 * @param {import('./prereqs.js').Prereq[]} prereqs
 * @returns {LaneResult}
 */
export function laneF(prereqs) {
  const role = prereqs.find((p) => p.id === 'security-reader');
  const defender = prereqs.find((p) => p.id === 'defender');
  if (defender?.status === 'missing') return { lane: 'F', name: 'Shadow AI (Defender)', state: 'missing', detail: 'No Defender for Endpoint in the tenant, so the Shadow AI tab stays empty. Nothing to install.' };
  if (role && role.status !== 'met') return { lane: 'F', name: 'Shadow AI (Defender)', state: 'warn', detail: 'Nothing to install. You have no Security Reader active, so the Shadow AI tab will be empty for you; each viewer needs it.' };
  if (defender?.status === 'unknown' || role?.status === 'unknown') return { lane: 'F', name: 'Shadow AI (Defender)', state: 'pending', detail: 'Nothing to install. Couldn\'t confirm Defender for Endpoint or your role from here.' };
  return { lane: 'F', name: 'Shadow AI (Defender)', state: 'ok', detail: 'Nothing to install. Defender for Endpoint is there and you can read advanced hunting.' };
}

/** @param {LaneState} s */
export const laneOk = (s) => s === 'ok' || s === 'pending';
