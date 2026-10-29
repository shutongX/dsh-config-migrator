/**
 * Plaintext secret files that must never travel in an export. They are regenerated
 * on the new machine (dsh-pocket rotates its tunnel PIN) and the zip is often
 * copied to a cloud drive, so a leaked token file would hand out the tunnel entry.
 *
 * Matching happens at scan time, before packing, so the catalog never offers them.
 */
export const EXACT_SECRET_PATHS = new Set(['dsh-pocket/token', 'dsh-pocket/token-lan'])

/** Generic name rule for plugin data / storages: tokens, secrets, credentials, keys. */
export const SECRET_BASENAME = /^(token|tokens|token-.*|.*\.secret|credentials?\.(json|ya?ml)|.*\.key|.*\.pem)$/i

/** Home-relative path in POSIX form, lower-cased (Windows names are case-insensitive). */
export function normalizeRelPath(value) {
  return String(value ?? '').replace(/\\/g, '/').replace(/^\/+/, '').toLowerCase()
}

export function isSecretFileName(name) {
  return SECRET_BASENAME.test(String(name ?? ''))
}

/** True when this home-relative path names a plaintext secret we refuse to export. */
export function isSecretRelPath(relPath) {
  const rel = normalizeRelPath(relPath)
  if (rel === '') return false
  if (EXACT_SECRET_PATHS.has(rel)) return true
  const base = rel.split('/').pop() ?? ''
  return isSecretFileName(base)
}

const FORBIDDEN_WRITE_BASENAMES = new Set(['.credentials.yaml', '.credentials.yml'])

/**
 * Write-side guard (review H1): the importer must refuse to create or overwrite
 * secret files even when the path sits inside an allowed root, because the archive
 * is untrusted input and must not widen its own writable range.
 */
export function isForbiddenWriteRelPath(relPath) {
  const rel = normalizeRelPath(relPath)
  if (rel === '') return false
  const base = rel.split('/').pop() ?? ''
  if (FORBIDDEN_WRITE_BASENAMES.has(base)) return true
  if (isSecretRelPath(rel)) return true
  if (/^\.?credentials?\.(json|ya?ml)$/i.test(base)) return true
  if (/\.(pem|key)$/i.test(base)) return true
  return false
}

/** Human list for warnings: "a、b（跳过 N 个）" is built by the caller. */
export function secretPathsIn(files) {
  return files.filter((file) => isSecretRelPath(file.rel ?? file)).map((file) => file.rel ?? String(file))
}
