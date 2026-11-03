import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const appDir = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const repoDir = resolve(appDir, '..')
const bundleDir = resolve(repoDir, 'demo', 'agent-monitor')
const bundledPackages = ['react', 'react-dom', 'scheduler']

const sections = bundledPackages.map((name) => {
  const packageDir = resolve(appDir, 'node_modules', name)
  const metadata = JSON.parse(readFileSync(resolve(packageDir, 'package.json'), 'utf8'))
  if (metadata.license !== 'MIT') {
    throw new Error(`Expected ${name} to use MIT; found ${metadata.license ?? 'no declared license'}`)
  }

  const licensePath = ['LICENSE', 'LICENSE.md', 'LICENSE.txt']
    .map((file) => resolve(packageDir, file))
    .find(existsSync)
  if (!licensePath) {
    throw new Error(`No license text found for bundled dependency ${name}`)
  }

  return [
    `## ${metadata.name}@${metadata.version} (${metadata.license})`,
    '',
    readFileSync(licensePath, 'utf8').trim(),
  ].join('\n')
})

const notices = [
  '# Third-party notices',
  '',
  'The demo JavaScript bundle includes code from the following npm packages. Build-time-only tools are not included.',
  '',
  ...sections.flatMap((section) => [section, '']),
].join('\n')

mkdirSync(bundleDir, { recursive: true })
writeFileSync(resolve(bundleDir, 'THIRD-PARTY-NOTICES.md'), notices, 'utf8')
