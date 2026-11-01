// Builds the trimmed, internally consistent sample the app ships in public/sample.
// Usage: node scripts/prepare-sample.mjs [folder-of-csvs | sample.zip]
// Default source: ../sample-data/agent-monitor-sample-data.zip (the anonymised sample in this repo).
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { basename, dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { inflateRawSync } from 'node:zlib'
import Papa from 'papaparse'

const here = dirname(fileURLToPath(import.meta.url))
const appDir = resolve(here, '..')
const source = resolve(process.argv[2] ?? join(appDir, '..', 'sample-data', 'agent-monitor-sample-data.zip'))
const outDir = join(appDir, 'public', 'sample')
const TARGET_AGENTS = 1500
const BUDGET_BYTES = 6 * 1024 * 1024

function readZip(file) {
  const buf = readFileSync(file)
  let eocd = -1
  for (let i = buf.length - 22; i >= 0; i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break }
  }
  if (eocd < 0) throw new Error('Not a zip file: ' + file)
  const count = buf.readUInt16LE(eocd + 10)
  let p = buf.readUInt32LE(eocd + 16)
  const files = new Map()
  for (let n = 0; n < count; n++) {
    const method = buf.readUInt16LE(p + 10)
    const size = buf.readUInt32LE(p + 20)
    const nameLen = buf.readUInt16LE(p + 28)
    const extraLen = buf.readUInt16LE(p + 30)
    const commentLen = buf.readUInt16LE(p + 32)
    const local = buf.readUInt32LE(p + 42)
    const name = buf.toString('utf8', p + 46, p + 46 + nameLen)
    p += 46 + nameLen + extraLen + commentLen
    if (!name.toLowerCase().endsWith('.csv')) continue
    const start = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28)
    const data = buf.subarray(start, start + size)
    files.set(basename(name), (method === 8 ? inflateRawSync(data) : data).toString('utf8'))
  }
  return files
}

function readSource(path) {
  if (!existsSync(path)) throw new Error('Sample source not found: ' + path)
  if (statSync(path).isFile()) return readZip(path)
  const files = new Map()
  for (const f of readdirSync(path)) if (f.toLowerCase().endsWith('.csv')) files.set(f, readFileSync(join(path, f), 'utf8'))
  return files
}

const files = readSource(source)
const table = (name) => {
  const text = files.get(name)
  if (text === undefined) throw new Error(`Missing ${name} in ${source}`)
  const parsed = Papa.parse(text.replace(/^\uFEFF/, ''), { header: true, skipEmptyLines: true })
  return { rows: parsed.data, fields: parsed.meta.fields ?? [] }
}

const agentsT = table('DimAgent.csv')
const sourcesT = table('FactAgentKnowledgeSource.csv')

// 1. Choose the agents: every non-Copilot Studio agent, agents with named knowledge sources,
//    then an even stride over the rest.
const keep = new Set()
for (const a of agentsT.rows) if (a.Platform !== 'Copilot Studio') keep.add(a.AgentKey)
const withSources = [...new Set(sourcesT.rows.map((r) => r.AgentKey))].filter((k) => k)
for (const k of withSources.slice(0, 250)) keep.add(k)
const rest = agentsT.rows.filter((a) => !keep.has(a.AgentKey))
const room = Math.max(0, TARGET_AGENTS - keep.size)
const stride = rest.length / Math.max(1, room)
for (let i = 0; i < room && Math.floor(i * stride) < rest.length; i++) keep.add(rest[Math.floor(i * stride)].AgentKey)
const agentKeys = new Set(agentsT.rows.filter((a) => keep.has(a.AgentKey)).map((a) => a.AgentKey))

const DERIVED = new Set(['IsPublished', 'HasInstructions', 'KnowledgeTypeCount', 'CreatedByName', 'OwnerName', 'OwnerUpn', 'DaysSinceLastUse', 'AgeDays', 'CreatedMonth', 'ActivityStatus', 'RiskFactorCount'])

const outputs = []
const write = (name, rows, fields) => {
  const csv = Papa.unparse({ fields, data: rows.map((r) => fields.map((f) => r[f] ?? '')) }, { newline: '\n' })
  writeFileSync(join(outDir, name), csv + '\n')
  outputs.push({ name, rows: rows.length })
}

rmSync(outDir, { recursive: true, force: true })
mkdirSync(outDir, { recursive: true })

write('agents.csv', agentsT.rows.filter((a) => agentKeys.has(a.AgentKey)), agentsT.fields.filter((f) => !DERIVED.has(f)))

for (const [src, out] of [
  ['DimEnvironment.csv', 'environments.csv'],
  ['FactAgentFlow.csv', 'flows.csv'],
  ['DimAzureAIResource.csv', 'ai-resources.csv'],
  ['DimSharePointAgent.csv', 'sharepoint-agents.csv'],
  ['DimUser.csv', 'users.csv'],
  ['FactShadowAiSignal.csv', 'shadow-signals.csv'],
  ['FactShadowAiDevice.csv', 'shadow-devices.csv'],
]) {
  const t = table(src)
  write(out, t.rows, t.fields)
}

for (const [src, out] of [
  ['FactAgentConnector.csv', 'connectors.csv'],
  ['FactAgentKnowledge.csv', 'knowledge.csv'],
  ['FactAgentKnowledgeSource.csv', 'knowledge-sources.csv'],
]) {
  const t = table(src)
  write(out, t.rows.filter((r) => agentKeys.has(r.AgentKey)), t.fields)
}

// 2. "Today" for the sample: the latest collection timestamp in the source.
const collected = [...table('DimSharePointAgent.csv').rows, ...sourcesT.rows].map((r) => r.CollectedAt ?? '').filter(Boolean).sort()
const asOf = (collected.at(-1) ?? new Date().toISOString()).slice(0, 19).replace(' ', 'T')
const manifest = { asOf, sourceAgents: agentsT.rows.length, files: outputs }
writeFileSync(join(outDir, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n')

const total = readdirSync(outDir).reduce((s, f) => s + statSync(join(outDir, f)).size, 0)
for (const o of outputs) console.log(`${o.name.padEnd(24)} ${String(o.rows).padStart(7)} rows`)
console.log(`agents kept ${agentKeys.size} of ${agentsT.rows.length}`)
console.log(`asOf ${asOf}; total ${(total / 1024 / 1024).toFixed(2)} MB`)
if (total > BUDGET_BYTES) {
  console.error(`Sample exceeds the ${BUDGET_BYTES / 1024 / 1024} MB budget.`)
  process.exitCode = 1
}
