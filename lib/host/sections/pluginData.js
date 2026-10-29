import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { walkFiles } from '../fsutil.js'
import { isSecretRelPath } from '../secret-files.js'
import { makeItem, readTreeFiles, writeItemFiles } from './shared.js'

/**
 * Home-level directories owned by another section or by the host itself.
 * dsh-runtimes is host-managed runtime provisioning (257MB of node/python payloads,
 * re-downloaded on demand) — never part of a config migration.
 */
const EXCLUDED = new Set(['profiles', 'sessions', 'storages', 'attachments', 'config-migrator', 'electron', 'node_modules', 'skills', 'dsh-runtimes'])

/**
 * Plugin data is small config, not shipped runtimes: a 55MB cloudflared.exe belongs
 * to the installation, not to a machine migration. Skipped by extension and by
 * top-level directory so a default "everything" export stays in the tens of MB.
 */
const SKIP_FILE = /\.(exe|dll|node|bin|so|dylib|msi|zip|7z|gz|zst|tar|pack|asar|db|sqlite)$/i
const SKIP_DIR = new Set(['bin', 'dist', 'build', 'out', 'node_modules', '.git', 'logs', 'cache'])

/** One decision for every file: never secrets, never runtimes, never cache dirs. */
function keepFile(rel) {
  if (isSecretRelPath(rel)) return false
  const parts = rel.split('/')
  if (parts.some((part) => SKIP_DIR.has(part))) return false
  return !SKIP_FILE.test(rel)
}

/** Load only the config-ish files of one plugin data directory. */
async function loadItemFiles(abs) {
  const walked = await walkFiles(abs)
  const secretFiles = walked.files.filter((file) => isSecretRelPath(file.rel)).map((file) => file.rel)
  const kept = walked.files.filter((file) => keepFile(file.rel))
  const files = []
  for (const file of kept) files.push({ rel: file.rel, data: await readFile(file.abs), mtimeMs: file.mtimeMs })
  return { files, secretFiles, omitted: walked.files.length - kept.length - secretFiles.length, truncated: walked.truncated === true }
}

/** Warnings for the export: which plaintext secrets were left behind on purpose. */
export async function collectSecretFileWarnings(context) {
  let entries
  try { entries = await readdir(context.home, { withFileTypes: true }) } catch { return [] }
  const found = []
  for (const entry of entries) {
    if (!entry.isDirectory() || EXCLUDED.has(entry.name)) continue
    const walked = await walkFiles(join(context.home, entry.name))
    for (const file of walked.files) {
      const rel = entry.name + '/' + file.rel
      if (isSecretRelPath(rel)) found.push(rel)
    }
  }
  if (found.length === 0) return []
  return ['未导出：' + found.join('、') + '（明文密钥文件，新机器会重新生成，不跟随迁移；确实要带走请手动复制）']
}

/** 插件私有数据: known plugin data directories under $DSH_HOME (config-migrator excluded). */
export const pluginDataSection = {
  id: 'pluginData',
  title: '插件私有数据',
  desc: '$DSH_HOME 下各插件的私有目录（排除 profiles/sessions/storages/attachments/electron 与 config-migrator；跳过 bin/ 与运行库；token 等明文密钥文件不导出）',
  defaultSelected: true,
  async scan(context) {
    let entries
    try { entries = await readdir(context.home, { withFileTypes: true }) } catch { return [] }
    const items = []
    for (const entry of entries) {
      if (!entry.isDirectory() || EXCLUDED.has(entry.name)) continue
      const loaded = await loadItemFiles(join(context.home, entry.name))
      if (loaded.files.length === 0) continue
      const notes = []
      if (loaded.omitted > 0) notes.push('跳过 ' + loaded.omitted + ' 个运行库/二进制')
      if (loaded.secretFiles.length > 0) notes.push('排除 ' + loaded.secretFiles.length + ' 个明文密钥')
      items.push(makeItem({
        section: 'pluginData',
        id: entry.name,
        label: entry.name,
        detail: entry.name + '/ · ' + loaded.files.length + ' 个文件' + (notes.length > 0 ? '（' + notes.join('，') + '）' : ''),
        relPath: entry.name,
        files: loaded.files,
        kind: 'tree',
        meta: { dir: entry.name, fileCount: loaded.files.length, omitted: loaded.omitted, secretFiles: loaded.secretFiles, truncated: loaded.truncated },
      }))
    }
    return items
  },
  async read(item, context) {
    const loaded = await readTreeFiles(join(context.home, item.relPath))
    return loaded === null ? null : loaded.filter((file) => keepFile(file.rel))
  },
  async write(item, context, files) { return writeItemFiles(context, item, files) },
  /** Export-time advisories (contract §5.7). */
  async exportNotes(context) { return collectSecretFileWarnings(context) },
}
