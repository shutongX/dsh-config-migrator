import { createCipheriv, createHash, randomBytes, scryptSync } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { MigratorError } from './errors.js'
import { exportsDir, maskHomePath } from './paths.js'
import { collectInstallerEntries } from './embed.js'
import { pruneExports } from './retention.js'
import { getSection, resolveSelection } from './sections/index.js'
import { writeZip } from './zip.js'

export const FORMAT = 'dsh-config-migrator/v1'

/**
 * Key names masked before anything reaches the zip (contract §5.1). The matcher
 * splits camelCase/separators into words so clientSecret, openai.key and api_key_2
 * all count, while apiKeyEnv (an env-var NAME) stays untouched.
 */
// Singular words only: plural forms show up in legitimate names such as
// maxTokens or @deepseek-ai/dsh-credentials and must not be masked.
const SECRET_WORDS = new Set(['token', 'secret', 'password', 'authorization'])
const KEY_EXCEPTIONS = new Set(['env', 'public', 'shortcut', 'hot', 'hotkey', 'binding', 'map'])
/** Values that are plainly not secrets (numbers, booleans) stay untouched. */
function looksLikeNonSecret(value) {
  return /^-?\d+(\.\d+)?$/.test(value.trim()) || value.trim() === 'true' || value.trim() === 'false' || value.trim() === 'null'
}

export function isSecretKeyName(key) {
  const words = String(key ?? '')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[^A-Za-z0-9]+/g, ' ')
    .trim()
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
  if (words.length === 0) return false
  if (words.some((word) => SECRET_WORDS.has(word))) return true
  if (words.some((word) => KEY_EXCEPTIONS.has(word))) return false
  if (words.includes('key')) return true
  return words.length > 1 && words[words.length - 1] === 'keys'
}
/** Well-known credential value shapes, masked even when the key name is innocent. */
const VALUE_PREFIX = /(^|[^A-Za-z0-9])((?:sk|ghp|gho|github_pat|xoxb|xoxp|xai|AIza)[-_A-Za-z0-9]{8,}|AKIA[0-9A-Z]{12,})/g
const TEXT_FILE = /\.(json|jsonc|jsonl|ya?ml|toml|ini|conf|cfg|env)$/i
const REDACTED = '__REDACTED__'

function looksBinary(data) {
  const probe = data.subarray(0, 8192)
  for (let i = 0; i < probe.length; i += 1) if (probe[i] === 0) return true
  return false
}

/** Mask value-shaped credentials inside one string (used by JSON and line masking). */
function maskValuePrefixes(text, hits) {
  return String(text).replace(VALUE_PREFIX, (match, lead, token) => {
    hits.push('credential-value')
    return lead + REDACTED
  })
}

function redactValue(value, path, hits) {
  if (typeof value === 'string') {
    const masked = maskValuePrefixes(value, hits)
    return masked === value ? value : masked
  }
  if (Array.isArray(value)) return value.map((entry, index) => redactValue(entry, path + '[' + index + ']', hits))
  if (value === null || typeof value !== 'object') return value
  const out = {}
  for (const [key, entry] of Object.entries(value)) {
    const numeric = typeof entry === 'number' || (typeof entry === 'string' && looksLikeNonSecret(entry))
    if (isSecretKeyName(key) && !numeric) {
      out[key] = REDACTED
      hits.push((path === '' ? '' : path + '.') + key)
    } else {
      out[key] = redactValue(entry, path === '' ? key : path + '.' + key, hits)
    }
  }
  return out
}

/** Mask key/value pairs of YAML, .env (KEY=VALUE) and single-line JSON bodies. */
function redactLines(text) {
  const hits = []
  const lines = text.split(/\r?\n/)
  const out = lines.map((line) => {
    const yaml = /^(\s*(?:-\s+)?)([A-Za-z0-9_.$-]+|"[^"]+"|'[^']+')\s*:\s*(.*)$/.exec(line)
    if (yaml !== null) {
      const key = yaml[2].replace(/^['"]|['"]$/g, '')
      const value = yaml[3].trim()
      if (isSecretKeyName(key) && value !== '' && !looksLikeNonSecret(value) && !value.startsWith('|') && !value.startsWith('>')) {
        hits.push(key)
        return maskValuePrefixes(yaml[1] + yaml[2] + ': ' + REDACTED, hits)
      }
    }
    const env = /^(\s*(?:export\s+)?)([A-Za-z0-9_.-]+)\s*=\s*(.+)$/.exec(line)
    if (env !== null && isSecretKeyName(env[2]) && !looksLikeNonSecret(env[3])) {
      hits.push(env[2])
      return env[1] + env[2] + '=' + REDACTED
    }
    return maskValuePrefixes(line, hits)
  })
  return { text: out.join('\n'), hits }
}

/** Mask secrets in one file body; binary files and unknown types pass through. */
function redactFile(relPath, data) {
  if (looksBinary(data) || !TEXT_FILE.test(relPath)) return { data, hits: [] }
  const text = data.toString('utf8')
  if (/\.(json|jsonc)$/i.test(relPath)) {
    try {
      const hits = []
      const masked = redactValue(JSON.parse(text), '', hits)
      // A file with nothing to mask keeps its exact bytes: re-serializing would turn
      // every healthy config into a false "conflict" on the next inspect.
      if (hits.length === 0) return { data, hits: [] }
      return { data: Buffer.from(JSON.stringify(masked, null, 2) + '\n', 'utf8'), hits }
    } catch { /* not a JSON document: fall back to line masking */ }
  }
  // .jsonl is masked line by line (each line is usually its own JSON object) so a
  // tool-call transcript cannot smuggle a key out while the file stays readable.
  const result = redactLines(text)
  if (result.hits.length === 0) return { data, hits: [] }
  return { data: Buffer.from(result.text, 'utf8'), hits: result.hits }
}

function timestamp(date) {
  const pad = (value) => String(value).padStart(2, '0')
  return String(date.getFullYear()) + pad(date.getMonth() + 1) + pad(date.getDate()) + '-' + pad(date.getHours()) + pad(date.getMinutes()) + pad(date.getSeconds())
}

/** scrypt + AES-256-GCM sealed blob; never writes credential plaintext into the zip. */
function sealCredentials(plaintext, password) {
  const salt = randomBytes(16)
  const iv = randomBytes(12)
  const key = scryptSync(password, salt, 32, { N: 16384, r: 8, p: 1 })
  const cipher = createCipheriv('aes-256-gcm', key, iv)
  const data = Buffer.concat([cipher.update(plaintext), cipher.final()])
  return Buffer.from(JSON.stringify({
    v: 1,
    kdf: 'scrypt',
    params: { N: 16384, r: 8, p: 1, salt: salt.toString('base64') },
    cipher: 'aes-256-gcm',
    iv: iv.toString('base64'),
    tag: cipher.getAuthTag().toString('base64'),
    data: data.toString('base64'),
  }, null, 2) + '\n', 'utf8')
}

function entryName(item, rel) { return item.kind === 'tree' ? 'home/' + item.relPath + '/' + rel : 'home/' + item.relPath }

/**
 * Pack the selected sections into a zip on disk.
 * @param context - environment context from paths.describeEnvironment.
 * @param request - { sections?, items?, includeSecrets?, password? }.
 */
export async function buildExport(context, request = {}) {
  const includeSecrets = request.includeSecrets === true
  const password = typeof request.password === 'string' ? request.password : ''
  if (includeSecrets && password.trim().length < 6) throw new MigratorError('bad-request', '勾选凭据分区时必须提供至少 6 位密码', 400)

  const picked = await resolveSelection(context, request)
  const warnings = []
  const entries = []
  const manifestSections = []
  let sealed = false

  if (context.authDegraded === true) warnings.push('鉴权退化为仅 loopback：当前组成没有 connection 服务，导出/导入接口只接受本机请求')
  if (!includeSecrets) {
    const credentials = getSection('credentials')
    const found = credentials === undefined ? [] : await credentials.scan(context).catch(() => [])
    if (found.length > 0) warnings.push('未导出：.credentials.yaml（默认不导出，勾选「凭据」并设密码才会加密写入 sealed/credentials.bin）')
  }
  // Sections may declare what they deliberately leave behind (plaintext secrets).
  for (const { section } of picked) {
    if (typeof section.exportNotes !== 'function') continue
    try { warnings.push(...(await section.exportNotes(context))) } catch { /* advisories must never fail an export */ }
  }
  if (picked.some(({ section, items }) => (section.id === 'sessions' || section.id === 'attachments') && items.length > 0)) {
    warnings.push('提示：会话与附件内容原样导出，未做脱敏（会话是压缩 jsonl、附件是二进制，改写会破坏内容；见 SPEC §5.8）')
  }

  for (const { section, items } of picked) {
    const rows = []
    for (const item of items) {
      if (item.meta?.truncated === true) warnings.push('未完整导出：' + section.id + '/' + item.id + '（超过单条大小/数量上限，已截断）')
      if (section.id === 'credentials') {
        if (!includeSecrets) {
          warnings.push('未导出：' + item.relPath + '（.credentials.yaml 默认不导出）')
          continue
        }
        const source = await section.read(item, context)
        if (source === null) { warnings.push('未导出：.credentials.yaml（文件不存在）'); continue }
        const blob = sealCredentials(source[0].data, password)
        entries.push({ name: 'sealed/credentials.bin', data: blob })
        sealed = true
        rows.push({ id: item.id, relPath: 'sealed/credentials.bin', bytes: blob.length, sha256: hashFiles([{ rel: '', data: blob }]), kind: 'sealed' })
        continue
      }
      const files = await section.read(item, context)
      if (files === null) { warnings.push('未导出：' + item.relPath + '（本机已不存在）'); continue }
      const outFiles = []
      for (const file of files) {
        const masked = redactFile(file.rel === '' ? item.relPath : file.rel, file.data)
        for (const key of masked.hits) warnings.push('已脱敏：' + item.relPath + (file.rel === '' ? '' : '/' + file.rel) + ' · ' + key)
        outFiles.push({ rel: file.rel, data: masked.data, mtimeMs: file.mtimeMs })
        entries.push({ name: entryName(item, file.rel), data: masked.data, mtime: file.mtimeMs })
      }
      rows.push({
        id: item.id,
        relPath: item.relPath,
        bytes: outFiles.reduce((sum, file) => sum + file.data.length, 0),
        sha256: hashFiles(outFiles),
        kind: item.kind,
        files: outFiles.length > 1 || item.kind === 'tree' ? outFiles.map((file) => ({ rel: file.rel, bytes: file.data.length, sha256: hashFiles([file]) })) : undefined,
        ...(typeof item.meta?.sourcePath === 'string' ? { meta: { sourcePath: maskHomePath(item.meta.sourcePath) } } : {}),
      })
    }
    if (rows.length > 0) manifestSections.push({ id: section.id, title: section.title, items: rows })
  }
  if (entries.length === 0) throw new MigratorError('empty-selection', '没有选中任何条目，请先勾选至少一个分区或条目', 400)

  const manifest = {
    format: FORMAT,
    createdAt: new Date().toISOString(),
    dshVersion: context.dshVersion,
    profile: context.profile,
    // Privacy: a shared zip must not carry the real user name or home layout (§5.9).
    profileDir: maskHomePath(context.profileDir),
    sourceHome: maskHomePath(context.home),
    homeMasked: true,
    secretsIncluded: sealed,
    encrypted: sealed,
    sections: manifestSections,
    env: { node: process.version, platform: context.platform, homePaths: [maskHomePath(homedir())] },
  }
  // Self-installer: restore/ scripts + the plugin source, so a new machine needs no
  // prior install to open this zip. Disabled only for size/timing tests.
  let embedded = []
  if (request.embedInstaller !== false) {
    try { embedded = await collectInstallerEntries() } catch (error) {
      warnings.push('未内嵌安装器：' + (error instanceof Error ? error.message : String(error)))
    }
  }
  const embeddedBytes = embedded.reduce((sum, entry) => sum + entry.data.length, 0)
  if (embeddedBytes > 1024 * 1024) warnings.push('内嵌安装器 ' + Math.round(embeddedBytes / 1024) + 'KB，超过 1MB 预期')

  let archive
  try {
    archive = writeZip([{ name: 'manifest.json', data: Buffer.from(JSON.stringify(manifest, null, 2) + '\n', 'utf8') }, ...entries, ...embedded])
  } catch (error) {
    // Entry-count / 4GiB limits surface as a clear 4xx instead of a raw RangeError.
    throw new MigratorError('export-too-large', '生成 zip 失败：' + (error instanceof Error ? error.message : String(error)) + '；请分批导出（按分区或会话选择）', 400)
  }

  const dir = exportsDir(context.home)
  await mkdir(dir, { recursive: true })
  const safeProfile = context.profile.replace(/[^A-Za-z0-9._-]+/g, '_') || 'profile'
  const name = 'dsh-config-' + safeProfile + '-' + timestamp(new Date()) + '-' + randomBytes(2).toString('hex') + '.zip'
  const file = join(dir, name)
  await writeFile(file, archive)
  await pruneExports(context.home, 10).catch(() => 0)
  return {
    file,
    name,
    size: archive.length,
    downloadUrl: '/dsh-config-migrator/download/' + encodeURIComponent(name),
    warnings,
    itemCount: entries.length,
    sectionCount: manifestSections.length,
    secretsIncluded: sealed,
  }
}

/** Deterministic payload hash over rel + content, matching sections/shared entryHash. */
function hashFiles(files) {
  const hash = createHash('sha256')
  for (const file of [...files].sort((a, b) => a.rel.localeCompare(b.rel))) {
    hash.update(file.rel)
    hash.update('\0')
    hash.update(createHash('sha256').update(file.data).digest('hex'))
    hash.update('\n')
  }
  return hash.digest('hex')
}
