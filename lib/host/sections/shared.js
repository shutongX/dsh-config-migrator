import { join, relative, sep } from 'node:path'
import { MigratorError } from '../errors.js'
import { entryBytes, entryHash, readDirectoryFiles, readOrNull, statOrNull, walkFiles, writeFileSafe } from '../fsutil.js'
import { assertWritableTarget } from '../paths.js'
import { isForbiddenWriteRelPath } from '../secret-files.js'

/** Synthetic staging root for items that do not map 1:1 onto a $DSH_HOME file. */
export const STAGE_ROOT = 'config-migrator/export'

/** Staged relPath for a synthetic item (still lives under home/ in the zip). */
export function stagePath(sectionId, ...parts) { return [STAGE_ROOT, sectionId, ...parts].join('/') }

/**
 * Build one catalog item. files use rel='' for a single-file item.
 * @param {{ section: string, id: string, label: string, detail: string, relPath: string, files: { rel: string, data: Buffer }[], kind?: string, meta?: object }} input
 */
export function makeItem({ section, id, label, detail, relPath, files, kind = 'file', meta }) {
  const normalizedMeta = meta ?? {}
  const item = { id, section, label, detail, relPath, bytes: entryBytes(files), sha256: entryHash(files), kind, meta: normalizedMeta }
  // UI contract: the truncation marker lives on the item body (meta kept for detail).
  if (normalizedMeta.truncated === true || files.truncated === true) item.truncated = true
  return item
}

/** Current content of one file as an item payload; null when the file is absent. */
export async function readSingleFile(abs) {
  const data = await readOrNull(abs)
  if (data === null) return null
  const info = await statOrNull(abs)
  return [{ rel: '', data, mtimeMs: info === null ? undefined : info.mtimeMs }]
}

/** Current content of one directory tree as an item payload; null when the directory is absent. */
export async function readTreeFiles(abs, options = {}) {
  const info = await statOrNull(abs)
  if (info === null || !info.isDirectory()) return null
  const loaded = await readDirectoryFiles(abs, options)
  // Sections read this flag into item.meta so a capped tree is visible in the
  // catalog and in export warnings instead of silently losing files.
  if (loaded.truncated) Object.defineProperty(loaded.files, 'truncated', { value: true, enumerable: false })
  return loaded.files
}

/**
 * Single guarded write used by every section during import: whitelist first,
 * then write, then record the path for the failure rollback.
 */
export async function writeTarget(context, abs, data, mtimeMs) {
  // A manifest must never widen what an import may write: secret files stay refused
  // even inside an allowed root (review H1).
  const rel = relative(context.home, abs).split(sep).join('/')
  if (isForbiddenWriteRelPath(rel)) throw new MigratorError('bad-target', '拒绝写入敏感文件：' + rel, 403)
  assertWritableTarget(context.home, context.profile, abs, context.pluginDataDirs ?? [])
  await writeFileSafe(abs, data, mtimeMs)
  if (context.touched instanceof Set) context.touched.add(abs)
  return abs
}

/** Absolute targets an item would write (used to snapshot before applying). */
export function itemTargets(context, item, files) {
  if (item.kind === 'tree') return files.map((file) => join(context.home, ...(item.relPath + '/' + file.rel).split('/')))
  return [join(context.home, ...item.relPath.split('/'))]
}

/** Default write for plain file/tree items. */
export async function writeItemFiles(context, item, files) {
  const written = []
  const targets = files.length === 0 ? [{ rel: '', data: Buffer.alloc(0) }] : files
  for (const file of targets) {
    const rel = item.kind === 'tree' ? item.relPath + '/' + file.rel : item.relPath
    written.push(await writeTarget(context, join(context.home, ...rel.split('/')), file.data, file.mtimeMs))
  }
  return { written }
}

/** Walk a root but report nothing when it is missing (used by optional data dirs). */
export async function listFilesIfAny(abs, options = {}) {
  const info = await statOrNull(abs)
  if (info === null || !info.isDirectory()) return null
  return walkFiles(abs, options)
}
