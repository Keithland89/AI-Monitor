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
const sourceFiles = [
  'app/demo/',
  'app/src/DemoApp.tsx',
  'app/src/DashboardFrame.tsx',
  'app/src/demo-main.tsx',
  'app/src/data/DemoDataProvider.tsx',
  'app/src/data/demo.ts',
  'app/src/data/demoStatic.ts',
  'app/src/pages/DemoSetup.tsx',
  'app/src/pages/LaneStatus.tsx',
  'app/src/metrics/demoCoverage.ts',
  'app/vite.demo.config.ts',
]

const markdown = [
  '# Agent Monitor demo provenance',
  '',
  '- Canonical source repository: https://github.com/ai-datalab/Agent-Monitor (the configured repository redirects here).',
  `- Source revision: \`${revision}\`.`,
  `- Base revision: \`${baseRevision}\` (merge-base of \`HEAD\` and \`origin/main\`).`,
  `- Source directory/files: ${sourceFiles.map((path) => `\`${path}\``).join(', ')}.`,
  '- Static bundle: repository-root `demo/agent-monitor/`; deploy at `/demo/agent-monitor/`.',
  '- Build command (run from `app/`): `npm ci && npm run build:demo`.',
  `- Build runtime: Node.js ${process.version}; npm ${npmVersion}.`,
  '- Data provenance: deterministic, generated synthetic fixtures in `app/src/data/demo.ts`; no bundled tenant extract is read.',
  '- Runtime behavior: no sign-in, live source, API, telemetry, host bridge, collector, or admin action is used.',
  `- Working-tree provenance: ${changedPaths.length ? 'demo source changes were uncommitted when this bundle was built' : 'no uncommitted app source changes were present when this bundle was built'}.`,
  ...(changedPaths.length ? changedPaths.map((path) => `  - \`${path}\``) : []),
  `- Repository license: ${licenseFiles.length ? `repository-level license files are present: ${licenseFiles.map((path) => `\`${path}\``).join(', ')}.` : 'no repository-level LICENSE, COPYING, or NOTICE file was found; the repository grants no open-source redistribution license for this demo.'}`,
  '- Third-party licenses: dependencies are installed through npm and remain subject to their own upstream licenses; no third-party assets are vendored into the bundle.',
  '',
].join('\n')

mkdirSync(bundleDir, { recursive: true })
const indexPath = resolve(bundleDir, 'index.html')
writeFileSync(indexPath, readFileSync(indexPath, 'utf8').replace(/\r\n?/g, '\n'), 'utf8')
writeFileSync(resolve(bundleDir, 'PROVENANCE.md'), markdown, 'utf8')
