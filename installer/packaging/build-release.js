#!/usr/bin/env node
// @ts-check
/**
 * Builds a release into installer/release/: ai-monitor-installer.zip, the install.ps1 that
 * downloads it (with its version and SHA-256 filled in) and SHA256SUMS. Upload all three to a
 * GitHub release tagged installer-v<version>.
 *   node packaging/build-release.js [--version 1.2.3]
 * The version defaults to the installer's package.json. Build the app (app/dist) first.
 */
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { installScript, releaseBase, releaseZip, REPO, SCRIPT_NAME, ZIP_NAME } from './release.js';

const here = dirname(fileURLToPath(import.meta.url));
const installerDir = join(here, '..');
const root = join(installerDir, '..');
const { values } = parseArgs({ options: { version: { type: 'string' }, out: { type: 'string' } } });
const version = values.version ?? JSON.parse(readFileSync(join(installerDir, 'package.json'), 'utf8')).version;
const out = values.out ?? join(installerDir, 'release');

const zip = releaseZip(root);
const sha256 = createHash('sha256').update(zip).digest('hex');
const script = installScript(readFileSync(join(here, 'launcher', SCRIPT_NAME), 'utf8'), { version, sha256 });
mkdirSync(out, { recursive: true });
writeFileSync(join(out, ZIP_NAME), zip);
writeFileSync(join(out, SCRIPT_NAME), script, 'ascii');
const scriptSha = createHash('sha256').update(script).digest('hex');
writeFileSync(join(out, 'SHA256SUMS'), `${sha256}  ${ZIP_NAME}\n${scriptSha}  ${SCRIPT_NAME}\n`);
process.stdout.write(`Built installer ${version} in ${out}
  ${ZIP_NAME}  ${(zip.length / 1024 / 1024).toFixed(1)} MB  sha256 ${sha256}
Tag the release installer-v${version} and upload the three files. Then:
  irm ${releaseBase(REPO, version)}/${SCRIPT_NAME} | iex
`);
