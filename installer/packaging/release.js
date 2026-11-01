// @ts-check
/**
 * The release: ai-monitor-installer.zip and the install.ps1 that downloads it. build-release.js
 * writes them; this module holds the parts that can be tested.
 * The zip unpacks to the repo's own layout, so the installer finds the rest at its usual paths:
 *   installer/            the installer, without node_modules (install.ps1 runs npm ci)
 *   installer/managed-cli the pinned managed apps CLI's package files
 *   solution/             the three managed solutions
 *   app/dist/             the app, built
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { crc32, deflateRawSync } from 'node:zlib';
import { SOLUTIONS } from '../src/solutions.js';

export const ZIP_NAME = 'ai-monitor-installer.zip';
export const SCRIPT_NAME = 'install.ps1';
export const REPO = 'Keithland89/AI-Monitor';

/**
 * @param {string} repo
 * @param {string} version
 */
export const releaseBase = (repo, version) => `https://github.com/${repo}/releases/download/installer-v${version}`;

/** @param {string} p */
const slash = (p) => p.replaceAll('\\', '/');

/**
 * Every file under dir, as paths relative to root.
 * @param {string} root
 * @param {string} dir
 * @returns {string[]}
 */
function walk(root, dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const full = join(dir, e.name);
    if (e.isDirectory()) return walk(root, full);
    return e.isFile() ? [slash(relative(root, full))] : [];
  });
}

/**
 * The files that go into the zip, relative to the repo root.
 * @param {string} root  The repo root.
 * @returns {string[]}
 */
export function releaseFiles(root) {
  const installer = ['installer/package.json', 'installer/package-lock.json', 'installer/README.md', 'installer/managed-cli/package.json', 'installer/managed-cli/package-lock.json'];
  const code = ['installer/bin', 'installer/src'].flatMap((d) => walk(root, join(root, d)));
  const solutions = SOLUTIONS.map((s) => `solution/${s.file}`);
  const distDir = join(root, 'app', 'dist');
  let dist = /** @type {string[]} */ ([]);
  try {
    if (statSync(join(distDir, 'index.html')).isFile()) dist = walk(root, distDir);
  } catch {
    // Reported below.
  }
  if (!dist.length) throw new Error('app/dist has no build. Run npm ci and npm run build in app/ first.');
  const licence = ['LICENSE', 'LICENSE.md'].filter((f) => {
    try {
      return statSync(join(root, f)).isFile();
    } catch {
      return false;
    }
  });
  const all = [...installer, ...code, ...solutions, ...dist, ...licence];
  for (const f of all) {
    if (!statSync(join(root, f), { throwIfNoEntry: false })?.isFile()) throw new Error(`${f} is missing.`);
  }
  return [...new Set(all)].sort();
}

/**
 * A zip of the given files, deflated, that Expand-Archive and every unzip tool read.
 * @param {{ name: string, data: Buffer }[]} files
 * @param {Date} [date]  The time stamped on every entry, so the same files make the same zip.
 */
export function makeZip(files, date = new Date('2020-01-01T00:00:00Z')) {
  const time = ((date.getUTCHours() << 11) | (date.getUTCMinutes() << 5) | (date.getUTCSeconds() >> 1)) & 0xffff;
  const day = (((date.getUTCFullYear() - 1980) << 9) | ((date.getUTCMonth() + 1) << 5) | date.getUTCDate()) & 0xffff;
  /** @type {Buffer[]} */
  const parts = [];
  /** @type {Buffer[]} */
  const central = [];
  let offset = 0;
  for (const f of files) {
    const name = Buffer.from(f.name, 'utf8');
    const packed = deflateRawSync(f.data, { level: 9 });
    const crc = crc32(f.data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6);
    local.writeUInt16LE(8, 8);
    local.writeUInt16LE(time, 10);
    local.writeUInt16LE(day, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(packed.length, 18);
    local.writeUInt32LE(f.data.length, 22);
    local.writeUInt16LE(name.length, 26);
    const entry = Buffer.alloc(46);
    entry.writeUInt32LE(0x02014b50, 0);
    entry.writeUInt16LE(20, 4);
    entry.writeUInt16LE(20, 6);
    entry.writeUInt16LE(0x0800, 8);
    entry.writeUInt16LE(8, 10);
    entry.writeUInt16LE(time, 12);
    entry.writeUInt16LE(day, 14);
    entry.writeUInt32LE(crc, 16);
    entry.writeUInt32LE(packed.length, 20);
    entry.writeUInt32LE(f.data.length, 24);
    entry.writeUInt16LE(name.length, 28);
    entry.writeUInt32LE(offset, 42);
    parts.push(local, name, packed);
    central.push(entry, name);
    offset += local.length + name.length + packed.length;
  }
  const size = central.reduce((n, b) => n + b.length, 0);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(size, 12);
  end.writeUInt32LE(offset, 16);
  if (offset > 0xffffffff || files.length > 0xffff) throw new Error('The release is too big for a plain zip.');
  return Buffer.concat([...parts, ...central, end]);
}

/**
 * The zip for the given repo root.
 * @param {string} root
 */
export function releaseZip(root) {
  return makeZip(releaseFiles(root).map((name) => ({ name, data: readFileSync(join(root, name)) })));
}

/**
 * Fills in the launcher template: plain ASCII with CRLF line ends, which Windows PowerShell 5.1
 * reads the same whether it's run as a file or through irm | iex.
 * @param {string} template
 * @param {{ version: string, sha256: string }} v
 */
export function installScript(template, v) {
  if (!/^[0-9a-f]{64}$/i.test(v.sha256)) throw new Error(`"${v.sha256}" isn't a SHA-256.`);
  if (!/^\d+\.\d+\.\d+([-+][\w.]+)?$/.test(v.version)) throw new Error(`"${v.version}" isn't a version such as 1.2.3.`);
  /** @type {Record<string, string>} */
  const values = { VERSION: v.version, SHA256: v.sha256.toLowerCase() };
  const text = template.replace(/\{\{([A-Z0-9_]+)\}\}/g, (m, k) => {
    if (!(k in values)) throw new Error(`install.ps1 has an unknown placeholder ${m}.`);
    return values[k];
  });
  const odd = [...text].find((ch) => ch.charCodeAt(0) > 0x7e || (ch.charCodeAt(0) < 0x20 && !'\r\n\t'.includes(ch)));
  if (odd) throw new Error(`install.ps1 must be plain ASCII; it holds U+${odd.charCodeAt(0).toString(16).padStart(4, '0')}.`);
  return text.replace(/\r?\n/g, '\r\n');
}
