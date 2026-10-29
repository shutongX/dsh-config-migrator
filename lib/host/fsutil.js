import { createHash } from 'node:crypto'
import { copyFile, lstat, mkdir, open, readFile, readdir, rmdir, rm, stat, writeFile } from 'node:fs/promises'
import { dirname, join, relative, sep } from 'node:path'

export function sha256(buffer) { return createHash('sha256').update(buffer).digest('hex') }

export async function statOrNull(path) {
  try { return await stat(path) } catch { return null }
}

/** lstat variant: never follows symlinks, so rollback can tell a file from a link. */
export async function lstatOrNull(path) {
  try { return await lstat(path) } catch { return null }
}

/** Delete one regular file only. Directories and links are left alone. */
export async function unlinkFileOnly(path) {
  const info = await lstatOrNull(path)
  if (info === null) return { removed: false, reason: 'absent' }
  if (!info.isFile()) return { removed: false, reason: info.isDirectory() ? 'dir' : 'other' }
  await rm(path, { force: true })
  return { removed: true }
}

/** Remove a directory only when it is empty; never recursive. */
export async function removeEmptyDir(path) {
  try {
    await rmdir(path)
    return true
  } catch {
    return false
  }
}

export async function readOrNull(path) {
  try { return await readFile(path) } catch (error) {
    if (error?.code === 'ENOENT' || error?.code === 'ENOTDIR') return null
    throw error
  }
}

/** mkdir -p then write; optional mtime restore keeps exported/imported files comparable. */
export async function writeFileSafe(path, data, mtimeMs) {
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, data)
  if (typeof mtimeMs === 'number' && Number.isFinite(mtimeMs)) {
    try {
      const handle = await open(path, 'r+')
      await handle.utimes(new Date(), new Date(mtimeMs))
      await handle.close()
    } catch { /* mtime is cosmetic; never fail a write over it */ }
  }
}

export async function copyFileSafe(from, to) {
  await mkdir(dirname(to), { recursive: true })
  await copyFile(from, to)
}

export async function removeFileOrDir(path) {
  try { await rm(path, { force: true, recursive: true }) } catch { /* already gone */ }
}

/** Directories a source tree never needs to carry (and must not bloat a 5MB cap). */
export const DEFAULT_SKIP_DIRS = new Set(['node_modules', '.git', '.hg', '.svn', 'dist', 'build', 'out', '.cache', '.turbo'])

/**
 * Breadth-first file walk that never follows symlinks.
 * @returns {{ files: {abs:string, rel:string, size:number, mtimeMs:number}[], truncated: boolean, bytes: number }}
 */
export async function walkFiles(root, options = {}) {
  const skipDirs = options.skipDirs ?? DEFAULT_SKIP_DIRS
  const maxFiles = options.maxFiles ?? 20000
  const maxBytes = options.maxBytes ?? Number.MAX_SAFE_INTEGER
  const files = []
  let bytes = 0
  const queue = [root]
  while (queue.length > 0) {
    const current = queue.shift()
    let entries
    try { entries = await readdir(current, { withFileTypes: true }) } catch { continue }
    for (const entry of entries) {
      if (entry.isSymbolicLink()) continue
      const abs = join(current, entry.name)
      if (entry.isDirectory()) {
        if (!skipDirs.has(entry.name)) queue.push(abs)
        continue
      }
      if (!entry.isFile()) continue
      const info = await stat(abs).catch(() => null)
      if (info === null) continue
      if (files.length >= maxFiles || bytes + info.size > maxBytes) return { files, truncated: true, bytes }
      files.push({ abs, rel: relative(root, abs).split(sep).join('/'), size: info.size, mtimeMs: info.mtimeMs })
      bytes += info.size
    }
  }
  files.sort((a, b) => a.rel.localeCompare(b.rel))
  return { files, truncated: false, bytes }
}

/** Load a whole directory into memory as { rel, data, mtimeMs } rows. */
export async function readDirectoryFiles(root, options = {}) {
  const walked = await walkFiles(root, options)
  const files = []
  for (const file of walked.files) files.push({ rel: file.rel, data: await readFile(file.abs), mtimeMs: file.mtimeMs })
  return { files, truncated: walked.truncated, bytes: walked.bytes }
}

/** Deterministic payload hash for a multi-file item (rel + content, order independent). */
export function entryHash(files) {
  const hash = createHash('sha256')
  for (const file of [...files].sort((a, b) => a.rel.localeCompare(b.rel))) {
    hash.update(file.rel)
    hash.update('\0')
    hash.update(createHash('sha256').update(file.data).digest('hex'))
    hash.update('\n')
  }
  return hash.digest('hex')
}

/** Total payload size of a multi-file item. */
export function entryBytes(files) { return files.reduce((sum, file) => sum + file.data.length, 0) }
