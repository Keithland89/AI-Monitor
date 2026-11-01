// Contract test: AI-Monitor's semantic models read Analytics Hub's tables through one shared M
// expression per table. This checks both PBIP builds, and the sample data, against the Analytics Hub
// column lists in fixtures/analytics-hub-contract.json. Run with `npm test` or `node --test tests/`.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { inflateRawSync } from 'node:zlib'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const fixture = JSON.parse(readFileSync(join(ROOT, 'tests', 'fixtures', 'analytics-hub-contract.json'), 'utf8'))
const CONTRACT = { ...fixture.tables, ...fixture.aiMonitorTables }
const KIND_TO_SQL = { date: 'DATE', datetime: 'DATETIME2(6)', bool: 'BIT', int: 'BIGINT', text: 'NVARCHAR(4000)' }
const BUILDS = { 'pbip-cloud': ['Live', 'AnalyticsHub'], pbip: ['Csv', 'Live', 'AnalyticsHub'] }
// Model tables rebuilt on the contract layer: their M must be the same text in both builds.
const DERIVED = ['Agent', 'AgentConnector', 'AgentKnowledge', 'AgentFlow', 'Environment', 'AzureAIResource',
  'ShadowAiCatalog', 'ShadowAiSignal', 'ShadowAiDevice', 'RiskDetail']
// Helpers that may call FnArg / FnHunt on behalf of the contract expressions.
const SOURCE_HELPERS = ['FnArg', 'FnHunt', 'FnAgentConnectors']

const definition = (build) => join(ROOT, build, 'AI-Monitor.SemanticModel', 'definition')
const lines = (file) => readFileSync(file, 'utf8').split(/\r?\n/)

/** expression name -> its header line plus body lines, from expressions.tmdl. */
function expressions(build) {
  const out = {}
  let name = null
  for (const line of lines(join(definition(build), 'expressions.tmdl'))) {
    const m = line.match(/^expression (\w+) =(.*)$/)
    if (m) { name = m[1]; out[name] = [line]; continue }
    if (/^\S/.test(line)) name = null
    else if (name) out[name].push(line)
  }
  return out
}

/** The M source of a table's partition. */
function partition(build, table) {
  const all = lines(join(definition(build), 'tables', table + '.tmdl'))
  const start = all.findIndex((l) => /^\tpartition .+ = m$/.test(l))
  assert.ok(start >= 0, `${build} ${table}: no M partition`)
  const src = all.findIndex((l, i) => i > start && /^\t\tsource =/.test(l))
  const body = []
  for (let i = src + 1; i < all.length && (all[i].startsWith('\t\t\t') || all[i].trim() === ''); i++) body.push(all[i])
  while (body.length && body.at(-1).trim() === '') body.pop()
  return body.join('\n')
}

/** [[name, kind], ...] from an expression's `Contract = {{"Col", "kind"}, ...},` line. */
function contractOf(body, table) {
  const line = body.find((l) => /^\s*Contract = \{/.test(l))
  assert.ok(line, `${table}: no Contract literal`)
  return [...line.matchAll(/\{"(\w+)", "(\w+)"\}/g)].map((m) => [m[1], m[2]])
}

/** CSV header row of every entry in a zip, using only the central directory and zlib. */
function zipHeaders(file) {
  const buf = readFileSync(file)
  let eocd = buf.length - 22
  while (eocd >= 0 && buf.readUInt32LE(eocd) !== 0x06054b50) eocd--
  assert.ok(eocd >= 0, 'zip: no end of central directory')
  const count = buf.readUInt16LE(eocd + 10)
  let p = buf.readUInt32LE(eocd + 16)
  const out = {}
  for (let i = 0; i < count; i++) {
    assert.equal(buf.readUInt32LE(p), 0x02014b50, 'zip: bad central directory entry')
    const method = buf.readUInt16LE(p + 10), size = buf.readUInt32LE(p + 20)
    const nameLen = buf.readUInt16LE(p + 28), extraLen = buf.readUInt16LE(p + 30), commentLen = buf.readUInt16LE(p + 32)
    const local = buf.readUInt32LE(p + 42)
    const name = buf.toString('utf8', p + 46, p + 46 + nameLen)
    const dataAt = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28)
    const raw = buf.subarray(dataAt, dataAt + size)
    const data = method === 0 ? raw : inflateRawSync(raw)
    out[name] = data.toString('utf8').replace(/^\uFEFF/, '').split(/\r?\n/)[0]
    p += 46 + nameLen + extraLen + commentLen
  }
  return out
}

test('fixture records its Analytics Hub sources', () => {
  assert.equal(fixture.repository, 'microsoft/AnalyticsHub-Dashboard')
  assert.deepEqual(Object.keys(fixture.sources).sort(),
    ['azure/sql/migrations/V003__defender.sql', 'azure/sql/migrations/V004__resource_graph.sql'])
  assert.deepEqual(Object.values(fixture.sources).flat().sort(), Object.keys(fixture.tables).sort())
})

for (const [build, modes] of Object.entries(BUILDS)) {
  const exprs = expressions(build)

  test(`${build}: parameters`, () => {
    const mode = exprs.SourceMode?.[0] ?? ''
    assert.match(mode, /IsParameterQuery = true/)
    const allowed = mode.match(/List = \{([^}]*)\}/)
    assert.ok(allowed, 'SourceMode has a list of allowed values')
    assert.deepEqual([...allowed[1].matchAll(/"(\w+)"/g)].map((m) => m[1]), modes)
    assert.match(mode, new RegExp(`^expression SourceMode = "${modes[0]}" meta`))
    for (const p of ['SqlServer', 'SqlDatabase']) {
      assert.match(exprs[p]?.[0] ?? '', new RegExp(`^expression ${p} = "[^"]+" meta \\[IsParameterQuery = true, Type = "Text", IsParameterQueryRequired = true\\]$`))
    }
  })

  test(`${build}: Sql.Database takes the parameters directly`, () => {
    const text = readFileSync(join(definition(build), 'expressions.tmdl'), 'utf8')
    const calls = [...text.matchAll(/Sql\.Database\(([^)]*)\)/g)].map((m) => m[1])
    assert.ok(calls.length > 0, 'Sql.Database is used')
    for (const args of calls) assert.equal(args, 'SqlServer, SqlDatabase')
  })

  for (const [table, columns] of Object.entries(CONTRACT)) {
    test(`${build}: ${table} matches the contract`, () => {
      const body = exprs[table]
      assert.ok(body, `expression ${table} exists`)
      const contract = contractOf(body, table)
      assert.deepEqual(contract.map((c) => c[0]), columns.map((c) => c[0]), 'column names and order')
      assert.deepEqual(contract.map((c) => KIND_TO_SQL[c[1]]), columns.map((c) => c[1]), 'column types')
      const text = body.join('\n')
      assert.match(text, /Shaped = FnContract\(Raw, Contract\)/)
      if (table !== 'defender_shadow_ai_device') {
        assert.match(text, /Sql\.Database\(SqlServer, SqlDatabase\)/)
        assert.ok(text.includes(`Item = "${table}"`) || text.includes(`[Item] = "${table}"`), 'reads its own Analytics Hub table')
      }
      if (modes.includes('Csv')) assert.ok(text.includes(`FnCsv("${table}.csv"`), 'Csv mode reads <table>.csv')
      else assert.ok(!text.includes('FnCsv('), 'no Csv branch in this build')
    })
  }

  test(`${build}: arg_agent_detail is keyed on SnapshotDate and AgentResourceId`, () => {
    const names = contractOf(exprs.arg_agent_detail, 'arg_agent_detail').map((c) => c[0])
    assert.deepEqual(names.slice(0, 2), ['SnapshotDate', 'AgentResourceId'])
  })

  test(`${build}: only contract expressions reach Resource Graph and Defender`, () => {
    const dir = join(definition(build), 'tables')
    for (const f of readdirSync(dir).filter((n) => n.endsWith('.tmdl'))) {
      const text = readFileSync(join(dir, f), 'utf8')
      assert.ok(!/\bFnArg\(|\bFnHunt\(/.test(text), `${f} calls FnArg/FnHunt`)
    }
    const allowed = new Set([...Object.keys(CONTRACT), ...SOURCE_HELPERS])
    for (const [name, body] of Object.entries(exprs)) {
      if (/\bFnArg\(|\bFnHunt\(/.test(body.slice(1).join('\n'))) assert.ok(allowed.has(name), `${name} calls FnArg/FnHunt`)
    }
  })
}

test('contract expressions have identical Live and AnalyticsHub branches in both builds', () => {
  const cloud = expressions('pbip-cloud'), local = expressions('pbip')
  const norm = (body) => body.filter((l) => !l.includes('SourceMode = "Csv"')).join('\n').replace(/^(\s*)else if SourceMode = "AnalyticsHub"/m, '$1if SourceMode = "AnalyticsHub"')
  for (const name of [...Object.keys(CONTRACT), 'AgentContract']) {
    const body = (exprs) => exprs[name].filter((l) => !/^\tlineageTag:/.test(l))
    assert.equal(norm(body(local)), norm(body(cloud)), name)
  }
})

test('derived model tables have identical M in both builds', () => {
  for (const table of DERIVED) assert.equal(partition('pbip', table), partition('pbip-cloud', table), table)
})

test('sample zip carries every contract table with the contract header', () => {
  const headers = zipHeaders(join(ROOT, 'sample-data', 'ai-monitor-sample-data.zip'))
  for (const [table, columns] of Object.entries(CONTRACT)) {
    const entry = `data/${table}.csv`
    assert.ok(entry in headers, `${entry} is in the zip`)
    assert.equal(headers[entry], columns.map((c) => c[0]).join(','), entry)
  }
})
