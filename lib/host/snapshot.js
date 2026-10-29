import { readdir } from 'node:fs/promises'
import { join, relative, sep } from 'node:path'
import { randomBytes } from 'node:crypto'
import { copyFileSafe, lstatOrNull, readOrNull, removeEmptyDir, statOrNull, unlinkFileOnly, writeFileSafe } from './fsutil.js'
import { MigratorError } from './errors.js'
import { assertWritableTarget, isInside, snapshotsDir } from './paths.js'
import { isForbiddenWriteRelPath } from './secret-files.js'
import { pruneSnapshots } from './retention.js'

const SNAPSHOT_ID = /^[A-Za-z0-9][A-Za-z0-9._-]*$/

function newId(date) {
  const pad = (value) => String(value).padStart(2, '0')
  const stamp = String(date.getFullYear()) + pad(date.getMonth() + 1) + pad(date.getDate()) + '-' + pad(date.getHours()) + pad(date.getMinutes()) + pad(date.getSeconds())
  return stamp + '-' + randomBytes(2).toString('hex')
}

/** Relative home path in POSIX form; null when the target sits outside $DSH_HOME. */
function relOf(home, abs) {
  if (!isInside(home, abs)) return null
  return relative(home, abs).split(sep).join('/')
}

/** lstat state of one target: file / dir / other (symlink, device…) / absent. */
async function stateOf(abs) {
  const info = await lstatOrNull(abs)
  if (info === null) return 'absent'
  if (info.isFile()) return 'file'
  if (info.isDirectory()) return 'dir'
  return 'other'
}

/**
 * Copy the files an import is about to touch so a failure (or a user) can undo it.
 * Directories are recorded but never copied and never deleted on restore.
 * @param context - environment context.
 * @param {{ label?: string, targets?: string[], createdDirs?: string[], pluginDataDirs?: string[] }} input
 */
export async function createSnapshot(context, { label = 'import', targets = [], createdDirs = [], pluginDataDirs = [] } = {}) {
  const root = join(snapshotsDir(context.home), newId(new Date()))
  const entries = []
  let bytes = 0
  for (const abs of [...new Set(targets)]) {
    const rel = relOf(context.home, abs)
    if (rel === null) continue
    const state = await stateOf(abs)
    if (state !== 'file') {
      // 'dir' is a hard stop for restore (never recursive), 'other' is never touched.
      entries.push({ rel, state })
      continue
    }
    const info = await statOrNull(abs)
    await copyFileSafe(abs, join(root, 'files', ...rel.split('/')))
    entries.push({ rel, state, bytes: info === null ? 0 : info.size })
    bytes += info === null ? 0 : info.size
  }
  const created = [...new Set(createdDirs.map((abs) => relOf(context.home, abs)).filter((rel) => rel !== null))]
  const meta = {
    id: root.slice(root.lastIndexOf(sep) + 1),
    at: new Date().toISOString(),
    label,
    profile: context.profile,
    pluginDataDirs: [...new Set(pluginDataDirs)],
    bytes,
    files: entries.filter((entry) => entry.state === 'file').length,
    dirs: entries.filter((entry) => entry.state === 'dir').length,
    entries,
    createdDirs: created,
    // Legacy field kept so older snapshots stay listable.
    existed: entries.filter((entry) => entry.state === 'file').length,
  }
  await writeFileSafe(join(root, 'meta.json'), Buffer.from(JSON.stringify(meta, null, 2) + '\n', 'utf8'))
  await pruneSnapshots(context.home, 5).catch(() => 0)
  return meta
}

/** Snapshot rows for GET /api/snapshots and the overview. */
export async function listSnapshots(home) {
  const dir = snapshotsDir(home)
  let entries
  try { entries = await readdir(dir, { withFileTypes: true }) } catch { return [] }
  const rows = []
  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    const abs = join(dir, entry.name)
    const raw = await readOrNull(join(abs, 'meta.json'))
    let meta = null
    if (raw !== null) { try { meta = JSON.parse(raw.toString('utf8')) } catch { meta = null } }
    let mtime = null
    const info = await statOrNull(abs)
    if (info !== null) mtime = info.mtime.toISOString()
    rows.push({
      id: entry.name,
      at: typeof meta?.at === 'string' ? meta.at : mtime,
      bytes: Number(meta?.bytes) || 0,
      files: Number(meta?.files) || 0,
      label: typeof meta?.label === 'string' ? meta.label : null,
    })
  }
  return rows.sort((a, b) => String(b.at ?? '').localeCompare(String(a.at ?? '')))
}

/** Old snapshots stored { existed: boolean }; normalize to the three-state model. */
function stateOfEntry(entry) {
  if (entry !== null && typeof entry === 'object') {
    if (entry.state === 'file' || entry.state === 'dir' || entry.state === 'other' || entry.state === 'absent') return entry.state
    if (entry.existed === true) return 'file'
  }
  return 'absent'
}

/**
 * Restore one snapshot. Overwritten files come back byte-identical; files the
 * import created are unlinked; directories are NEVER deleted.
 * @returns {{ id: string, restored: number, removed: number, removedDirs: number, skipped: number, warnings: string[], paths: string[] }}
 */
export async function restoreSnapshot(context, id) {
  if (typeof id !== 'string' || !SNAPSHOT_ID.test(id)) throw new MigratorError('bad-request', '快照 id 不合法：' + String(id), 400)
  const root = join(snapshotsDir(context.home), id)
  if (!isInside(snapshotsDir(context.home), root)) throw new MigratorError('forbidden', '快照路径越界', 403)
  const raw = await readOrNull(join(root, 'meta.json'))
  if (raw === null) throw new MigratorError('not-found', '快照不存在：' + id, 404)
  let meta
  try { meta = JSON.parse(raw.toString('utf8')) } catch { throw new MigratorError('bad-request', '快照 meta.json 损坏', 400) }
  const entries = Array.isArray(meta?.entries) ? meta.entries : []
  const profile = typeof meta?.profile === 'string' ? meta.profile : context.profile
  const pluginDataDirs = Array.isArray(meta?.pluginDataDirs) ? meta.pluginDataDirs : []
  let restored = 0
  let removed = 0
  let skipped = 0
  const warnings = []
  const paths = []
  for (const entry of entries) {
    if (typeof entry?.rel !== 'string' || entry.rel.includes('..') || entry.rel.startsWith('/')) { skipped += 1; continue }
    const rel = entry.rel
    const target = join(context.home, ...rel.split('/'))
    const state = stateOfEntry(entry)
    // Whitelist + realpath: a snapshot may not escape $DSH_HOME through a junction.
    try {
      assertWritableTarget(context.home, profile, target, pluginDataDirs)
    } catch (error) {
      skipped += 1
      warnings.push('跳过恢复（不在可写白名单或符号链接逃逸）：' + rel)
      continue
    }
    if (isForbiddenWriteRelPath(rel)) {
      skipped += 1
      warnings.push('跳过恢复（敏感文件）：' + rel)
      continue
    }
    if (state === 'dir') {
      skipped += 1
      warnings.push('目录不删除、不覆盖：' + rel)
      continue
    }
    if (state === 'other') {
      skipped += 1
      warnings.push('跳过非普通文件：' + rel)
      continue
    }
    if (state === 'file') {
      const data = await readOrNull(join(root, 'files', ...rel.split('/')))
      if (data === null) { skipped += 1; warnings.push('快照缺少副本：' + rel); continue }
      await writeFileSafe(target, data)
      restored += 1
      paths.push(rel)
      continue
    }
    // absent: only delete a regular file that exists now; directories stay.
    const result = await unlinkFileOnly(target)
    if (result.removed) {
      removed += 1
      paths.push(rel)
    } else if (result.reason === 'dir') {
      skipped += 1
      warnings.push('目标是目录，回滚不删除：' + rel)
    } else if (result.reason === 'other') {
      skipped += 1
      warnings.push('目标不是普通文件，回滚不删除：' + rel)
    }
  }
  let removedDirs = 0
  const createdDirs = Array.isArray(meta?.createdDirs) ? meta.createdDirs : []
  for (const dir of [...createdDirs].sort((a, b) => b.length - a.length)) {
    if (typeof dir !== 'string' || dir === '' || dir.includes('..')) continue
    const abs = join(context.home, ...dir.split('/'))
    if (!isInside(context.home, abs)) continue
    if (await removeEmptyDir(abs)) removedDirs += 1
  }
  return { id, restored, removed, removedDirs, skipped, warnings, paths }
}
