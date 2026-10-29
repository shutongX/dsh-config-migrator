import { existsSync, readFileSync, readdirSync, realpathSync } from 'node:fs'
import { homedir } from 'node:os'
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { MigratorError } from './errors.js'

export const HOME_ENV = 'DSH_HOME'
export const PROFILE_ENV = 'DSH_PROFILE'
export const PROFILE_DIR_ENV = 'DSH_PROFILE_DIR'
export const DEFAULT_PROFILE = 'desktop'
export const DATA_DIR_NAME = 'config-migrator'

const WINDOWS = process.platform === 'win32'

/** Expand a leading ~ against the OS home, as DSH_HOME may be written either way. */
export function expandHome(input) {
  if (input === '~') return homedir()
  if (input.startsWith('~/') || input.startsWith('~\\')) return join(homedir(), input.slice(2))
  return input
}

/** $DSH_HOME when set and non-blank, otherwise ~/.dsh — the same precedence the host uses. */
export function resolveDshHome(env = process.env) {
  const raw = env[HOME_ENV]
  const chosen = typeof raw === 'string' && raw.trim() !== '' ? raw.trim() : join(homedir(), '.dsh')
  return resolve(expandHome(chosen))
}

/** Active profile name plus its directory: $DSH_PROFILE_DIR wins over $DSH_PROFILE. */
export function resolveProfile(env = process.env, home = resolveDshHome(env)) {
  const rawDir = env[PROFILE_DIR_ENV]
  if (typeof rawDir === 'string' && rawDir.trim() !== '') {
    const dir = resolve(expandHome(rawDir.trim()))
    const rawName = env[PROFILE_ENV]
    return { name: typeof rawName === 'string' && rawName.trim() !== '' ? rawName.trim() : basename(dir), dir }
  }
  const rawName = env[PROFILE_ENV]
  const name = typeof rawName === 'string' && rawName.trim() !== '' ? rawName.trim() : DEFAULT_PROFILE
  return { name, dir: join(home, 'profiles', name) }
}

export function dataDir(home) { return join(home, DATA_DIR_NAME) }
export function exportsDir(home) { return join(dataDir(home), 'exports') }
export function uploadsDir(home) { return join(dataDir(home), 'uploads') }
export function snapshotsDir(home) { return join(dataDir(home), 'snapshots') }

/**
 * Version recorded by the desktop runtime bundle (app.asar/dsh/desktop-runtime.json).
 * Readable only when the host runs inside Electron — plain node falls through.
 */
function readDesktopRuntimeVersion() {
  const candidates = []
  if (typeof process.resourcesPath === 'string' && process.resourcesPath !== '') {
    candidates.push(join(process.resourcesPath, 'app.asar', 'dsh', 'desktop-runtime.json'))
  }
  candidates.push(join(dirname(process.execPath), 'resources', 'app.asar', 'dsh', 'desktop-runtime.json'))
  for (const file of candidates) {
    try {
      const version = JSON.parse(readFileSync(file, 'utf8'))?.release?.version
      if (typeof version === 'string' && version !== '') return version
    } catch { /* not an Electron desktop layout: try the next source */ }
  }
  return undefined
}

/**
 * Best-effort DSH version: env override, desktop runtime bundle, then a DSH bundle
 * manifest inside the profile. Only dsh* packages count — help libraries such as
 * @deepseek-ai/schemastery carry unrelated versions and must never be mistaken for
 * the harness release.
 */
export function detectDshVersion(profileDir) {
  const override = process.env.DSH_VERSION
  if (typeof override === 'string' && override.trim() !== '') return override.trim()
  const runtimeVersion = readDesktopRuntimeVersion()
  if (runtimeVersion !== undefined) return runtimeVersion
  const modules = join(profileDir, 'node_modules', '@deepseek-ai')
  try {
    const names = readdirSync(modules)
      .filter((name) => name === 'dsh-base' || name === 'dsh-web-app' || name.startsWith('dsh-'))
      .sort((a, b) => Number(b === 'dsh-base') - Number(a === 'dsh-base'))
    for (const name of names) {
      try {
        const text = readFileSync(join(modules, name, 'package.json'), 'utf8')
        const version = JSON.parse(text).version
        if (typeof version === 'string' && version !== '') return version
      } catch { /* missing or unreadable manifest: try the next package */ }
    }
  } catch { /* no @deepseek-ai directory in this profile */ }
  return 'unknown'
}

/** Everything the sections and the router need to know about this machine. */
export function describeEnvironment(env = process.env) {
  const home = resolveDshHome(env)
  const profile = resolveProfile(env, home)
  return {
    home,
    profile: profile.name,
    profileDir: profile.dir,
    dshVersion: detectDshVersion(profile.dir),
    platform: process.platform,
    node: process.version,
  }
}

/**
 * Mask the OS user name out of a path before it lands in a shared manifest:
 * "C:/Users/alice/.dsh" → "C:/Users/<user>/.dsh", "/home/alice/.dsh" → "/home/<user>/.dsh".
 */
export function maskHomePath(value) {
  const text = String(value ?? '')
  return text
    .replace(/^([A-Za-z]:[\\/])Users[\\/][^\\/]+/i, '$1Users/<user>')
    .replace(/^(\/home\/|\/Users\/)[^/]+/i, '$1<user>')
}

/** Symbolic home label for copy; never leaks the absolute user path into the panel. */
export function displayPath(home, target) {
  const rel = relative(home, target)
  const inHome = rel === '' || (!rel.startsWith('..') && !isAbsolute(rel))
  return inHome ? '~/.dsh' + (rel === '' ? '' : '/' + rel.split(sep).join('/')) : target
}

/** True when target is root itself or sits under it (case-insensitive on Windows). */
export function isInside(root, target) {
  const base = resolve(root)
  const abs = resolve(target)
  const a = WINDOWS ? base.toLowerCase() : base
  const b = WINDOWS ? abs.toLowerCase() : abs
  return b === a || b.startsWith(a + sep)
}

/**
 * Real path of the deepest existing ancestor, with the missing tail re-appended.
 * Guards against symlinks/junctions that point outside the allowed root.
 */
export function realTarget(target) {
  const abs = resolve(target)
  let current = abs
  const tail = []
  for (let guard = 0; guard < 64; guard += 1) {
    try {
      const real = realpathSync(current)
      return tail.length === 0 ? real : join(real, ...tail.reverse())
    } catch {
      const parent = dirname(current)
      if (parent === current) return abs
      tail.push(basename(current))
      current = parent
    }
  }
  return abs
}

/** One relative path expressed with forward slashes, or null when it escapes. */
export function toSafeRelative(relPath) {
  if (typeof relPath !== 'string') return null
  const normalized = relPath.replace(/\\/g, '/').replace(/^\/+/, '')
  if (normalized === '' || /^[A-Za-z]:/.test(normalized)) return null
  const parts = normalized.split('/')
  if (parts.some((part) => part === '..' || part === '.' || part === '')) return null
  return parts.join('/')
}

/** Absolute writable roots the importer may touch (contract §5.3). */
export function writableRoots(home, profile) {
  return [
    join(home, 'profiles', profile),
    join(home, 'sessions'),
    join(home, 'storages'),
    join(home, 'attachments'),
    join(home, 'skills'),
    join(home, DATA_DIR_NAME),
  ]
}

/**
 * Assert a resolved absolute path may be written by an import.
 * @param home - $DSH_HOME.
 * @param profile - active profile name.
 * @param target - absolute path to write.
 * @param pluginDataDirs - extra top-level plugin data dir names already verified.
 */
export function assertWritableTarget(home, profile, target, pluginDataDirs = []) {
  const abs = resolve(target)
  if (!isInside(home, abs)) throw new MigratorError('forbidden', '目标路径不在 $DSH_HOME 内：' + abs, 403)
  if (abs === resolve(join(home, 'AGENTS.md'))) return abs
  const roots = writableRoots(home, profile)
  for (const name of pluginDataDirs) {
    const dir = toSafeRelative(name)
    if (dir !== null) roots.push(join(home, dir))
  }
  const real = realTarget(abs)
  const realHome = realTarget(home)
  if (!isInside(realHome, real)) throw new MigratorError('forbidden', '目标路径经符号链接逃出 $DSH_HOME：' + abs, 403)
  for (const root of roots) {
    if (isInside(root, abs) && isInside(realTarget(root), real)) return abs
  }
  throw new MigratorError('forbidden', '目标路径不在可写白名单内：' + abs, 403)
}

/** Existence helper shared by sections (never throws). */
export function fileExists(path) { return existsSync(path) }
