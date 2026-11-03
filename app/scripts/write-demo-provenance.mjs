import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const appDir = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const repoDir = resolve(appDir, '..')
const bundleDir = resolve(repoDir, 'demo', 'agent-monitor')

function git(args) {
  return execFileSync('git', args, { cwd: repoDir, encoding: 'utf8' }).trim()
}

const revision = git(['rev-parse', 'HEAD'])
const baseRevision = git(['merge-base', 'HEAD', 'origin/main'])
const changedPaths = git(['status', '--porcelain', '--untracked-files=all', '--', 'app'])
  .split(/\r?\n/)
  .filter(Boolean)
  .map((line) => line.slice(2).trimStart())
const licenseFiles = ['LICENSE', 'LICENSE.md', 'LICENSE.txt', 'COPYING', 'NOTICE'].filter((name) => existsSync(resolve(repoDir, name)))
const npmVersion = process.env.npm_config_user_agent?.match(/(?:^| )npm\/([^\s]+)/)?.[1] ?? 'unknown'
const sourceFiles = git(['diff', '--name-only', `${baseRevision}...${revision}`, '--', 'app'])
  .split(/\r?\n/)
  .filter(Boolean)

const markdown = [
  '# Agent Monitor demo provenance',
  '',
  '- Canonical source repository: https://github.com/ai-datalab/Agent-Monitor (the configured repository redirects here).',
  `- Source revision: \`${revision}\`.`,
  `- Base revision: \`${baseRevision}\` (merge-base of \`HEAD\` and \`origin/main\`).`,
  `- Source directory: \`app/\`; source files changed from the base revision: ${sourceFiles.map((path) => `\`${path}\``).join(', ')}.`,
  '- Static bundle: repository-root `demo/agent-monitor/`; deploy at `/demo/agent-monitor/`.',
  '- Build command (run from `app/`): `npm ci && npm run build:demo`.',
  `- Build runtime: Node.js ${process.version}; npm ${npmVersion}.`,
  '- Data provenance: deterministic, generated synthetic fixtures in `app/src/data/demo.ts`; no bundled tenant extract is read.',
  '- Runtime behavior: no sign-in, live source, API, telemetry, host bridge, collector, or admin action is used.',
  '- Public distribution permission: an authorized source copyright holder granted permission on 2026-11-03 to copy, host, publicly display, and redistribute this demo bundle and its required source-derived assets at `/demo/agent-monitor/`; this does not license unrelated repository content.',
  `- Working-tree provenance: ${changedPaths.length ? 'demo source changes were uncommitted when this bundle was built' : 'the app source working tree was clean when this bundle was built; all demo source files are committed at the source revision above'}.`,
  ...(changedPaths.length ? changedPaths.map((path) => `  - \`${path}\``) : []),
  `- Repository license: ${licenseFiles.length ? `repository-level license files are present: ${licenseFiles.map((path) => `\`${path}\``).join(', ')}.` : 'no repository-level LICENSE, COPYING, or NOTICE file was found; the repository provides no general open-source license.'}`,
  '- Third-party licenses: bundled npm dependency license texts and versions are listed in `THIRD-PARTY-NOTICES.md`; no third-party assets are vendored into the bundle.',
  '',
].join('\n')

mkdirSync(bundleDir, { recursive: true })
const indexPath = resolve(bundleDir, 'index.html')
writeFileSync(indexPath, readFileSync(indexPath, 'utf8').replace(/\r\n?/g, '\n'), 'utf8')
writeFileSync(resolve(bundleDir, 'PROVENANCE.md'), markdown, 'utf8')
