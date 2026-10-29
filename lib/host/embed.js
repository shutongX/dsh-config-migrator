import { readdir, readFile } from 'node:fs/promises'
import { dirname, join, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * Self-installer payload for the exported zip: the plugin source tree plus the
 * restore/ scripts, so a new machine can install the plugin without downloading it.
 */
export const PLUGIN_NAME = 'dsh-config-migrator'
export const PACKAGE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
export const INSTALLER_DIR = join(PACKAGE_ROOT, 'lib', 'host', 'installer')
export const INSTALLER_FILES = ['install.mjs', 'install.cmd', 'install.ps1', 'install.sh', 'README.txt']

/** Never ship build output, docs, editor temp files, backups or the exported zips themselves. */
const SKIP_DIRS = new Set(['node_modules', 'docs', 'mock', 'temp', '.git', '.cache', 'dist', 'out', '.turbo'])
const SKIP_FILE = /(^|\/)(package-lock\.json|pnpm-lock\.yaml|[^/]*\.zip|[^/]*\.bak[^/]*|[^/]*\.test\.(?:js|mjs|cjs)|test[-_][^/]*\.(?:js|mjs|cjs))$/i

async function walk(root, prefix = '', out = []) {
  let entries
  try { entries = await readdir(join(root, prefix), { withFileTypes: true }) } catch { return out }
  for (const entry of entries) {
    const rel = prefix === '' ? entry.name : prefix + '/' + entry.name
    if (entry.isSymbolicLink()) continue
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue
      await walk(root, rel, out)
      continue
    }
    if (!entry.isFile() || SKIP_FILE.test(rel)) continue
    out.push({ abs: join(root, ...rel.split('/')), rel })
  }
  return out
}

/**
 * Entries appended to the export archive: restore/<installer> and tool/dsh-config-migrator/**.
 * @param {{ packageRoot?: string }} options - override for tests.
 */
export async function collectInstallerEntries({ packageRoot = PACKAGE_ROOT } = {}) {
  const entries = []
  for (const name of INSTALLER_FILES) {
    const data = await readFile(join(INSTALLER_DIR, name))
    entries.push({ name: 'restore/' + name, data })
  }
  const files = await walk(packageRoot)
  files.sort((a, b) => a.rel.localeCompare(b.rel))
  for (const file of files) {
    entries.push({ name: 'tool/' + PLUGIN_NAME + '/' + file.rel.split(sep).join('/'), data: await readFile(file.abs) })
  }
  return entries
}