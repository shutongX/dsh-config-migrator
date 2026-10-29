import { createHash } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, join, relative, sep } from 'node:path'
import { MigratorError } from './errors.js'
import { isInside, maskHomePath, uploadsDir } from './paths.js'
import { isForbiddenWriteRelPath } from './secret-files.js'
import { pruneUploads } from './retention.js'
import { getSection } from './sections/index.js'
import { itemTargets } from './sections/shared.js'
import { createSnapshot, restoreSnapshot } from './snapshot.js'
import { entryHash, lstatOrNull, readOrNull, writeFileSafe } from './fsutil.js'
import { normalizeEntryName, readZip } from './zip.js'

export const FORMAT_PREFIX = 'dsh-config-migrator/'
const TOKEN = /^[a-f0-9]{64}$/

/** One apply/rollback at a time: two writers would interleave snapshots and writes. */
let applyLock = false
async function withApplyLock(run) {
  if (applyLock) throw new MigratorError('busy', '已有导入或回滚正在进行中，请稍后重试', 409)
  applyLock = true
  try { return await run() } finally { applyLock = false }
}

/** Store an uploaded/inspected archive under config-migrator/uploads and return its sha256 token. */
export async function saveUpload(context, buffer) {
  const token = createHash('sha256').update(buffer).digest('hex')
  const dir = uploadsDir(context.home)
  await mkdir(dir, { recursive: true })
  await writeFile(join(dir, token + '.zip'), buffer)
  return token
}

/** Read a previously stored archive by token. */
export async function readUpload(context, token) {
  if (typeof token !== 'string' || !TOKEN.test(token)) throw new MigratorError('bad-request', 'archive token 不合法：' + String(token), 400)
  const dir = uploadsDir(context.home)
  const file = join(dir, token + '.zip')
  if (!isInside(dir, file)) throw new MigratorError('forbidden', '上传路径越界', 403)
  const data = await readOrNull(file)
  if (data === null) throw new MigratorError('not-found', '找不到已上传的 zip：' + token, 404)
  return data
}

function parseManifest(raw) {
  let manifest
  try { manifest = JSON.parse(raw.toString('utf8')) } catch { throw new MigratorError('bad-archive', 'manifest.json 不是合法 JSON', 400) }
  if (typeof manifest?.format !== 'string' || !manifest.format.startsWith(FORMAT_PREFIX)) {
    throw new MigratorError('bad-archive', '不是本插件导出的 zip（format=' + String(manifest?.format) + '）', 400)
  }
  return manifest
}

/** Read the archive once: manifest + entry table. */
export function parseArchive(buffer) {
  let entries
  try { entries = readZip(buffer) } catch (error) { throw new MigratorError('bad-archive', 'zip 解析失败：' + (error instanceof Error ? error.message : String(error)), 400) }
  const manifestEntry = entries.find((entry) => entry.name === 'manifest.json')
  if (manifestEntry === undefined) throw new MigratorError('bad-archive', 'zip 里没有 manifest.json', 400)
  return { entries, manifest: parseManifest(manifestEntry.read()) }
}

/** Files that belong to one manifest item, read out of the archive. */
function itemFilesOf(manifestItem, entries) {
  if (manifestItem.kind === 'sealed') return []
  if (manifestItem.kind === 'tree') {
    const prefix = 'home/' + manifestItem.relPath + '/'
    return entries
      .filter((entry) => entry.name.startsWith(prefix))
      .map((entry) => ({ rel: entry.name.slice(prefix.length), data: entry.read(), mtimeMs: entry.mtime.getTime() }))
  }
  const entry = entries.find((row) => row.name === 'home/' + manifestItem.relPath)
  if (entry === undefined) return []
  return [{ rel: '', data: entry.read(), mtimeMs: entry.mtime.getTime() }]
}

/** One home-relative path, guaranteed to stay inside home (zip input is untrusted). */
function safeRelPath(value) {
  if (typeof value !== 'string' || value === '') throw new MigratorError('bad-archive', '条目缺少 relPath', 400)
  let normalized
  try { normalized = normalizeEntryName(value) } catch { throw new MigratorError('bad-archive', '条目路径非法（含 .. / 绝对路径 / 盘符）：' + value, 400) }
  if (normalized !== value) throw new MigratorError('bad-archive', '条目路径不是规范形式：' + value, 400)
  return normalized
}

/**
 * Refuse a tampered archive: every manifest item must match its recorded sha256,
 * so a zip edited after export cannot silently overwrite local files.
 */
function verifyArchive(parsed) {
  const { manifest, entries } = parsed
  if (!Array.isArray(manifest.sections)) throw new MigratorError('bad-archive', 'manifest.sections 缺失', 400)
  let items = 0
  for (const section of manifest.sections) {
    if (!Array.isArray(section.items)) throw new MigratorError('bad-archive', 'manifest 分区缺少 items：' + String(section.id), 400)
    for (const item of section.items) {
      if (typeof item.id !== 'string' || typeof item.sha256 !== 'string') throw new MigratorError('bad-archive', 'manifest 条目字段缺失', 400)
      safeRelPath(item.relPath)
      items += 1
      if (item.kind === 'sealed') {
        const entry = entries.find((row) => row.name === item.relPath)
        if (entry === undefined) throw new MigratorError('bad-archive', '缺少加密凭据条目', 400)
        if (entryHash([{ rel: '', data: entry.read() }]) !== item.sha256) throw new MigratorError('bad-archive', 'sha256 校验失败：' + item.relPath, 400)
        continue
      }
      const files = itemFilesOf(item, entries)
      if (files.length === 0) throw new MigratorError('bad-archive', '缺少条目内容：' + item.relPath, 400)
      if (entryHash(files) !== item.sha256) throw new MigratorError('bad-archive', 'sha256 校验失败（zip 内容与 manifest 不符）：' + item.relPath, 400)
    }
  }
  if (items === 0) throw new MigratorError('bad-archive', 'manifest 里没有任何条目', 400)
}

/** profiles/<archive profile>/... → profiles/<local profile>/... (review H1). */
export function rewriteProfileRelPath(relPath, fromProfile, toProfile) {
  if (typeof relPath !== 'string' || typeof fromProfile !== 'string' || typeof toProfile !== 'string') return relPath
  if (fromProfile === '' || toProfile === '' || fromProfile === toProfile) return relPath
  const from = 'profiles/' + fromProfile
  const to = 'profiles/' + toProfile
  if (relPath === from) return to
  if (relPath.startsWith(from + '/')) return to + relPath.slice(from.length)
  return relPath
}

/** Rebuild the section-side item descriptor from one manifest row. */
function hydrateItem(section, manifestItem, manifest, context) {
  const localRelPath = rewriteProfileRelPath(manifestItem.relPath, manifest?.profile, context.profile)
  const item = {
    id: manifestItem.id,
    section: section?.id,
    relPath: localRelPath,
    kind: manifestItem.kind ?? 'file',
    bytes: Number(manifestItem.bytes) || 0,
    sha256: manifestItem.sha256,
    label: String(manifestItem.id),
    detail: localRelPath,
    meta: {},
  }
  if (typeof manifestItem.meta?.sourcePath === 'string') item.meta = { sourcePath: manifestItem.meta.sourcePath }
  if (section?.patchEntries === true) item.meta = { entryId: manifestItem.id }
  if (section?.dependencyItems === true) item.meta = { name: manifestItem.id }
  return item
}

function sumBytes(files) { return files.reduce((sum, file) => sum + file.data.length, 0) }

function firstLineDiff(local, incoming) {
  const a = local.toString('utf8').split(/\r?\n/)
  const b = incoming.toString('utf8').split(/\r?\n/)
  const limit = Math.min(a.length, b.length)
  for (let index = 0; index < limit; index += 1) {
    if (a[index] !== b[index]) return { line: index + 1, local: a[index].slice(0, 120), incoming: b[index].slice(0, 120) }
  }
  return a.length === b.length ? null : { line: limit + 1, local: a[limit] === undefined ? '(文件结束)' : a[limit].slice(0, 120), incoming: b[limit] === undefined ? '(文件结束)' : b[limit].slice(0, 120) }
}

function looksBinary(data) {
  const probe = data.subarray(0, 512)
  for (let index = 0; index < probe.length; index += 1) if (probe[index] === 0) return true
  return false
}

/** One-line explanation for a conflict row. */
function describeDiff(localFiles, incomingFiles) {
  if (localFiles.length === 1 && incomingFiles.length === 1) {
    const local = localFiles[0].data
    const incoming = incomingFiles[0].data
    if (looksBinary(local) || looksBinary(incoming)) return '本机 ' + local.length + 'B / 备份 ' + incoming.length + 'B；二进制内容不同'
    const changed = firstLineDiff(local, incoming)
    if (changed !== null) return '本机 ' + local.length + 'B / 备份 ' + incoming.length + 'B；第 ' + changed.line + ' 行起不同：本机 ' + JSON.stringify(changed.local) + ' / 备份 ' + JSON.stringify(changed.incoming)
    return '本机 ' + local.length + 'B / 备份 ' + incoming.length + 'B；逐行相同但字节不同（缩进/换行/末行差异）'
  }
  const localMap = new Map(localFiles.map((file) => [file.rel, file]))
  const incomingMap = new Map(incomingFiles.map((file) => [file.rel, file]))
  const changed = []
  let added = 0
  let removed = 0
  for (const [rel, file] of incomingMap) {
    const local = localMap.get(rel)
    if (local === undefined) added += 1
    else if (!local.data.equals(file.data)) changed.push(rel)
  }
  for (const rel of localMap.keys()) if (!incomingMap.has(rel)) removed += 1
  const parts = ['本机 ' + localFiles.length + ' 个文件 / 备份 ' + incomingFiles.length + ' 个文件']
  if (added > 0) parts.push('新增 ' + added)
  if (removed > 0) parts.push('本机多出 ' + removed)
  if (changed.length > 0) parts.push('内容不同 ' + changed.length + '（如 ' + changed.slice(0, 3).join(', ') + '）')
  return parts.join('；')
}

/** Compare one archive item against local state. */
async function statusOf(section, manifestItem, context, files, manifest) {
  if (section === undefined) return { status: 'missing', localBytes: 0, incomingBytes: sumBytes(files), diff: '本机没有分区 ' + String(manifestItem.id) + '，无法导入', localFiles: null }
  if (manifestItem.kind === 'sealed') return { status: 'new', localBytes: 0, incomingBytes: sumBytes(files), diff: '加密凭据条目（需要密码解密，本版本仅备份）', localFiles: null }
  const item = hydrateItem(section, manifestItem, manifest, context)
  let local = null
  let readFailed = false
  try { local = await section.read(item, context) } catch { readFailed = true }
  // A read error (locked file, EACCES) is NOT "does not exist": never default-apply
  // over a file we could not inspect.
  if (readFailed) return { status: 'unknown', localBytes: 0, incomingBytes: sumBytes(files), diff: '本机读取失败（可能被占用或无权限），必须显式选择 use-backup / skip', localFiles: null }
  if (local === null) return { status: 'new', localBytes: 0, incomingBytes: sumBytes(files), diff: '本机尚无此项', localFiles: null }
  const same = entryHash(local) === entryHash(files)
  return {
    status: same ? 'same' : 'conflict',
    localBytes: sumBytes(local),
    incomingBytes: sumBytes(files),
    diff: same ? '' : describeDiff(local, files),
    localFiles: same ? null : local,
  }
}

/** Remap suggestions + safety warnings for one archive (contract §5.6). */
async function buildPathWarnings(context, manifest, entries) {
  const warnings = []
  const localHome = maskHomePath(context.home)
  if (typeof manifest.sourceHome === 'string' && manifest.sourceHome !== localHome) {
    warnings.push({
      kind: 'home-mismatch',
      message: '备份来自 ' + manifest.sourceHome + '，本机是 ' + localHome + '；可在 apply 时用 remap 把旧路径换成本机路径',
      from: manifest.sourceHome,
      to: localHome,
      files: [],
      hitCount: 0,
    })
  }
  if (typeof manifest.profile === 'string' && manifest.profile !== context.profile) {
    warnings.push({
      kind: 'profile-mismatch',
      message: '备份来自 profile ' + manifest.profile + '，本机是 ' + context.profile + '；profiles/<profile>/ 路径会自动改写为本机 profile',
      from: manifest.profile,
      to: context.profile,
    })
  }
  const dirsItem = manifest.sections?.find((section) => section.id === 'workspaces')?.items?.find((item) => item.id === 'known-dirs')
  if (dirsItem !== undefined) {
    const entry = entries.find((row) => row.name === 'home/' + dirsItem.relPath)
    if (entry !== undefined) {
      try {
        const dirs = JSON.parse(entry.read().toString('utf8'))?.dirs ?? []
        warnings.push({ kind: 'workspace-dirs', message: '备份包含 ' + dirs.length + ' 个已知工作区目录，新机器上路径可能需要调整', dirs: dirs.map((row) => row.path).filter(Boolean) })
      } catch { /* malformed dirs payload: nothing to suggest */ }
    }
  }
  return warnings
}

/** Summarize a manifest for the panel (no payload, no absolute secrets). */
function manifestSummary(manifest) {
  return {
    format: manifest.format,
    createdAt: manifest.createdAt,
    dshVersion: manifest.dshVersion,
    profile: manifest.profile,
    sourceHome: manifest.sourceHome,
    homeMasked: manifest.homeMasked === true,
    secretsIncluded: manifest.secretsIncluded === true,
    encrypted: manifest.encrypted === true,
    sections: (manifest.sections ?? []).map((section) => ({ id: section.id, title: section.title, items: (section.items ?? []).length })),
  }
}

/**
 * Inspect a zip against the local machine without writing anything.
 * @param context - environment context.
 * @param buffer - zip bytes.
 */
export async function inspectArchive(context, buffer) {
  const parsed = parseArchive(buffer)
  verifyArchive(parsed)
  const token = await saveUpload(context, buffer)
  await pruneUploads(context.home, 2).catch(() => 0)
  const sections = []
  for (const manifestSection of parsed.manifest.sections ?? []) {
    const section = getSection(manifestSection.id)
    const items = []
    for (const manifestItem of manifestSection.items ?? []) {
      const files = itemFilesOf(manifestItem, parsed.entries)
      const state = await statusOf(section, manifestItem, context, files, parsed.manifest)
      items.push({ itemId: manifestItem.id, status: state.status, localBytes: state.localBytes, incomingBytes: state.incomingBytes, diff: state.diff })
    }
    sections.push({ id: manifestSection.id, title: manifestSection.title, items })
  }
  return {
    archive: token,
    manifest: manifestSummary(parsed.manifest),
    sections,
    pathWarnings: await buildPathWarnings(context, parsed.manifest, parsed.entries),
  }
}

/** Inspect a zip that already lives on this machine (agent tool + tests). */
export async function inspectArchiveFile(context, absPath) {
  const buffer = await readOrNull(absPath)
  if (buffer === null) throw new MigratorError('not-found', '找不到 zip：' + absPath, 404)
  return inspectArchive(context, buffer)
}

/** Apply one remap rule to text payloads (sessions cwd, workspace.json paths, link: specs). */
function applyRemap(files, remap) {
  const rules = (Array.isArray(remap) ? remap : []).filter((rule) => rule !== null && typeof rule === 'object' && typeof rule.from === 'string' && rule.from !== '' && typeof rule.to === 'string')
  if (rules.length === 0) return { files, changes: 0 }
  let changes = 0
  const out = files.map((file) => {
    if (!/\.(json|jsonl|ya?ml|toml|md|txt)$/i.test(file.rel === '' ? 'x.json' : file.rel) && file.rel !== '') return file
    let text = file.data.toString('utf8')
    let touched = false
    for (const rule of rules) {
      if (!text.includes(rule.from)) continue
      const count = text.split(rule.from).length - 1
      text = text.split(rule.from).join(rule.to)
      changes += count
      touched = true
    }
    return touched ? { ...file, data: Buffer.from(text, 'utf8') } : file
  })
  return { files: out, changes }
}

function targetsOf(section, item, context, files) {
  if (typeof section.targets === 'function') return section.targets(item, context, files)
  return itemTargets(context, item, files)
}

/**
 * Apply an inspected archive with per-item choices.
 * @param context - environment context.
 * @param request - { archive, choices?, remap?, dryRun? }.
 */
export async function applyArchive(context, request = {}) {
  return withApplyLock(() => runApply(context, request))
}

async function runApply(context, request) {
  const buffer = await readUpload(context, String(request.archive ?? ''))
  const parsed = parseArchive(buffer)
  verifyArchive(parsed)
  const choices = request.choices !== null && typeof request.choices === 'object' ? request.choices : {}
  // The writable plugin-data roots come from THIS machine's scan only (review H1):
  // a manifest item.id must never be able to widen the whitelist.
  const pluginDataSection = getSection('pluginData')
  let localPluginDataDirs = []
  try { localPluginDataDirs = pluginDataSection === undefined ? [] : (await pluginDataSection.scan(context)).map((item) => item.id) } catch { localPluginDataDirs = [] }
  const applyContext = { ...context, apply: true, touched: new Set(), pluginDataDirs: localPluginDataDirs }

  // Resolve every item first: what to do, where it would write, which bytes.
  const plan = []
  for (const manifestSection of parsed.manifest.sections ?? []) {
    const section = getSection(manifestSection.id)
    for (const manifestItem of manifestSection.items ?? []) {
      const files = itemFilesOf(manifestItem, parsed.entries)
      const state = await statusOf(section, manifestItem, context, files, parsed.manifest)
      const chosen = choices?.[manifestSection.id]?.[manifestItem.id]
      let action
      if (typeof chosen === 'string') action = chosen
      else if (state.status === 'new') action = 'use-backup'
      // unknown (local read failed) must be an explicit user decision, never a default
      else if (state.status === 'unknown') action = 'skip'
      else action = 'keep-local'
      plan.push({ manifestSection, manifestItem, section, files, state, action })
    }
  }

  const actions = plan.filter((row) => row.action === 'use-backup')
  const skipped = plan.filter((row) => row.action !== 'use-backup').map((row) => ({
    section: row.manifestSection.id,
    itemId: row.manifestItem.id,
    action: row.action,
    reason: row.action === 'skip'
      ? (row.state.status === 'unknown' ? '本机读取失败，需显式选择' : '用户选择跳过')
      : row.state.status === 'same' ? '与本机相同' : '用户选择保留本机',
  }))
  const relOfHome = (abs) => relative(context.home, abs).split(sep).join('/')
  const targets = []
  const plannedActions = []
  const planningFailed = []
  for (const row of actions) {
    if (row.manifestItem.kind === 'sealed') { plannedActions.push(row); continue }
    if (row.section === undefined) {
      planningFailed.push({ section: row.manifestSection.id, itemId: row.manifestItem.id, error: 'bad-target: 本机没有这个分区' })
      continue
    }
    let rowTargets
    try {
      rowTargets = targetsOf(row.section, hydrateItem(row.section, row.manifestItem, parsed.manifest, context), applyContext, applyRemap(row.files, request.remap).files)
    } catch (error) {
      planningFailed.push({ section: row.manifestSection.id, itemId: row.manifestItem.id, error: 'bad-target: 计算写入目标失败：' + (error instanceof Error ? error.message : String(error)) })
      continue
    }
    // A file write must never land on an existing directory/symlink (review B1), and
    // never on a secret file the archive itself points at (review H1). Reject before
    // the snapshot and before any write.
    let blocked = null
    for (const abs of rowTargets) {
      const rel = relOfHome(abs)
      if (isForbiddenWriteRelPath(rel)) { blocked = 'bad-target: 拒绝写入敏感文件：' + rel; break }
      const info = await lstatOrNull(abs)
      if (info !== null && (info.isDirectory() || info.isSymbolicLink())) { blocked = 'bad-target: 目标是目录，拒绝写入：' + rel; break }
    }
    if (blocked !== null) {
      planningFailed.push({ section: row.manifestSection.id, itemId: row.manifestItem.id, error: blocked })
      continue
    }
    targets.push(...rowTargets)
    plannedActions.push(row)
  }
  if (planningFailed.length > 0) {
    // Nothing has been written yet: report and stop (M13 keeps fail-first semantics).
    return { applied: [], skipped, failed: planningFailed, snapshot: null, restartRequired: false, blocked: true }
  }

  if (request.dryRun === true) {
    return { applied: [], skipped, failed: [], snapshot: null, restartRequired: false, dryRun: true, planned: plannedActions.map((row) => ({ section: row.manifestSection.id, itemId: row.manifestItem.id })) }
  }

  // Directories that do not exist yet: rollback may rmdir exactly these (empty only).
  const createdDirs = []
  for (const abs of targets) {
    let dir = dirname(abs)
    for (let guard = 0; guard < 32 && dir !== context.home && isInside(context.home, dir); guard += 1) {
      if ((await lstatOrNull(dir)) !== null) break
      createdDirs.push(dir)
      dir = dirname(dir)
    }
  }

  const snapshot = await createSnapshot(context, { label: 'import', targets, createdDirs, pluginDataDirs: localPluginDataDirs })
  const applied = []
  const failed = []
  let restartRequired = false
  let touchedCount = 0
  for (const row of plannedActions) {
    const section = row.section
    if (section === undefined) { failed.push({ section: row.manifestSection.id, itemId: row.manifestItem.id, error: '本机没有这个分区' }); break }
    if (row.manifestItem.kind === 'sealed') { skipped.push({ section: row.manifestSection.id, itemId: row.manifestItem.id, action: 'skip', reason: '加密凭据条目暂不支持导入' }); continue }
    try {
      const remapped = applyRemap(row.files, request.remap)
      const item = hydrateItem(section, row.manifestItem, parsed.manifest, context)
      const result = await section.write(item, applyContext, remapped.files)
      applied.push({ section: row.manifestSection.id, itemId: row.manifestItem.id, written: result?.written?.length ?? 0, remapped: remapped.changes })
      touchedCount += result?.written?.length ?? 0
      if (['profile', 'plugins', 'localPlugins', 'marketplace', 'models', 'mcp', 'agentPresets', 'settings'].includes(row.manifestSection.id)) restartRequired = true
    } catch (error) {
      failed.push({ section: row.manifestSection.id, itemId: row.manifestItem.id, error: error instanceof Error ? error.message : String(error) })
      // Fail fast: stop at the first bad item instead of half-writing later sections.
      break
    }
  }
  if (failed.length > 0) {
    // Contract §5.4: any failure rolls the whole apply back.
    const rollback = await restoreSnapshot(context, snapshot.id)
    return { applied: [], skipped, failed, snapshot: snapshot.id, rolledBack: true, restartRequired: false, touched: 0, rollbackWarnings: rollback.warnings, removedDirs: rollback.removedDirs }
  }
  return { applied, skipped, failed, snapshot: snapshot.id, restartRequired, touched: touchedCount }
}

/** Undo one import snapshot. */
export async function rollbackSnapshot(context, request = {}) {
  return withApplyLock(async () => {
    const id = typeof request.snapshot === 'string' ? request.snapshot : String(request.snapshot ?? '')
    if (id === '') throw new MigratorError('bad-request', '缺少 snapshot id', 400)
    const result = await restoreSnapshot(context, id)
    return {
      restored: result.restored,
      removed: result.removed,
      removedDirs: result.removedDirs,
      skipped: result.skipped,
      warnings: result.warnings,
      snapshot: result.id,
      paths: result.paths,
    }
  })
}
