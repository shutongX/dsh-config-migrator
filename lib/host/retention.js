import { readdir, rm, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { exportsDir, snapshotsDir, uploadsDir } from './paths.js'

/** Keep the newest `keep` entries that pass the filter, delete the rest. */
async function prune(dir, keep, filter) {
  let entries
  try { entries = await readdir(dir, { withFileTypes: true }) } catch { return 0 }
  const rows = []
  for (const entry of entries) {
    if (!filter(entry)) continue
    const abs = join(dir, entry.name)
    const info = await stat(abs).catch(() => null)
    if (info === null) continue
    rows.push({ abs, mtime: info.mtimeMs })
  }
  rows.sort((a, b) => b.mtime - a.mtime)
  let removed = 0
  for (const row of rows.slice(keep)) {
    try { await rm(row.abs, { recursive: true, force: true }); removed += 1 } catch { /* already gone */ }
  }
  return removed
}

/** Exports grow ~20MB each; keep the recent ones only. */
export async function pruneExports(home, keep = 10) {
  return prune(exportsDir(home), keep, (entry) => entry.isFile() && entry.name.endsWith('.zip'))
}

/** Uploaded archives are only needed until the following apply; keep a couple. */
export async function pruneUploads(home, keep = 2) {
  return prune(uploadsDir(home), keep, (entry) => entry.isFile() && entry.name.endsWith('.zip'))
}

/** Snapshots are the undo history; keep a short recent window. */
export async function pruneSnapshots(home, keep = 5) {
  return prune(snapshotsDir(home), keep, (entry) => entry.isDirectory())
}
