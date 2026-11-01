// @ts-check
/**
 * After the flows are on: the newest row in each lane's run table, lane G's report rows, and lane F's check. No row yet
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
    lane: 'C',
    name: 'Copilot interactions',
    set: 'poc_copilotinteractionflowrunses',
    columns: ['poc_recordsretrieved', 'poc_recordscreated'],
    /** @param {any} row @returns {[LaneState, string]} */
    judge: (row) => {
      const n = Number(row.poc_recordsretrieved ?? 0);
      return n > 0 ? ['ok', `Last run read ${n} audit records.`] : ['warn', 'Last run read no audit records. Check the audit log is on and the audit collector has consent; a new tenant can take a day to have any.'];
    },
  },
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

/** Lane G keeps one row a report, updated in place, so every row is read rather than the newest. */
export const WORK_PATTERNS = { lane: 'G', name: 'Work patterns', set: 'poc_m365usagereports', columns: ['poc_name', 'poc_status', 'poc_collectedat'] };

/**
 * @param {any[]} rows
 * @returns {[LaneState, string]}
 */
export function judgeWorkPatterns(rows) {
  const bad = rows.filter((r) => !/^2\d\d$/.test(String(r.poc_status ?? '').trim()));
  const when = rows.map((r) => String(r.poc_collectedat ?? '')).sort().pop()?.slice(0, 16).replace('T', ' ');
  const stamp = when ? ` (${when})` : '';
  if (!bad.length) return ['ok', `Last run read all ${rows.length} reports.${stamp}`];
  const names = bad.map((r) => `${r.poc_name} (${String(r.poc_status ?? '').trim() || 'no status'})`).join(', ');
  const hint = bad.some((r) => /^40[13]$/.test(String(r.poc_status ?? '').trim())) ? ' The audit collector needs Reports.Read.All with admin consent.' : '';
  return [bad.length === rows.length ? 'failed' : 'warn', `${bad.length} of ${rows.length} reports couldn't be read: ${names}.${hint}${stamp}`];
}

/**
 * @param {import('./dataverse.js').Dataverse} dv
 * @returns {Promise<LaneResult[]>}
 */
export async function verifyLanes(dv) {
  /** @type {LaneResult[]} */
  const out = [];
  for (const t of RUN_TABLES) {
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
  const g = WORK_PATTERNS;
  try {
    const rows = await dv.allRows(g.set, g.columns);
    if (rows === undefined) out.push({ lane: g.lane, name: g.name, state: 'missing', detail: 'Not set up: its table isn\'t in the environment.' });
    else if (!rows.length) out.push({ lane: g.lane, name: g.name, state: 'pending', detail: 'First run pending: no report has been written yet.' });
    else {
      const [state, detail] = judgeWorkPatterns(rows);
      out.push({ lane: g.lane, name: g.name, state, detail });
    }
  } catch (err) {
    out.push({ lane: g.lane, name: g.name, state: 'warn', detail: `Couldn't read ${g.set}: ${/** @type {Error} */ (err).message.split('\n')[0]}` });
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

/**
 * The cost lanes have nothing to install either: the app reads the Power Platform licensing API and
 * Azure Cost Management with each viewer's own connections when it's opened.
 * @param {import('./prereqs.js').Prereq[]} prereqs
 * @returns {LaneResult}
 */
export function laneCost(prereqs) {
  const name = 'Cost & consumption';
  const cost = prereqs.find((p) => p.id === 'cost-reader');
  const admin = prereqs.find((p) => p.id === 'pp-admin');
  const gaps = [
    admin && admin.status !== 'met' && admin.status !== 'unknown' ? 'you have no Power Platform Administrator active, so Copilot Credits may be empty for you' : '',
    cost && cost.status === 'missing' ? 'Cost Management refused you, so Azure AI spend will be empty for you until you have Cost Management Reader' : '',
  ].filter(Boolean);
  if (gaps.length) return { lane: 'Cost', name, state: 'warn', detail: `Nothing to install, but ${gaps.join('; and ')}. Each viewer needs the same.` };
  if (cost?.status === 'unknown' || admin?.status === 'unknown') return { lane: 'Cost', name, state: 'pending', detail: `Nothing to install. Couldn't confirm all your access from here.${cost?.status === 'unknown' ? ` ${cost.detail}` : ''}` };
  return { lane: 'Cost', name, state: 'ok', detail: 'Nothing to install. You can read Copilot Credits and Azure Cost Management.' };
}
