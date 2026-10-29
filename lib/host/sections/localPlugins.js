import { isAbsolute, join, resolve } from 'node:path'
import { readOrNull } from '../fsutil.js'
import { entryBytes, entryHash } from '../fsutil.js'
import { makeItem, readTreeFiles, stagePath, writeItemFiles } from './shared.js'
import { packageJsonPath } from './plugins.js'

/** The contract caps one local plugin tree at 5MB by default. */
export const LOCAL_PLUGIN_MAX_BYTES = 5 * 1024 * 1024

function safeName(value) { return String(value).replace(/[^A-Za-z0-9._-]/g, '_') }

/** Resolve a link: spec against the profile directory. */
export function resolveLinkTarget(spec, profileDir) {
  const raw = String(spec).slice('link:'.length).trim()
  if (raw === '') return null
  return isAbsolute(raw) ? resolve(raw) : resolve(profileDir, raw)
}

async function linkDependencies(context) {
  const data = await readOrNull(packageJsonPath(context))
  if (data === null) return []
  let parsed
  try { parsed = JSON.parse(data.toString('utf8')) } catch { return [] }
  const dependencies = parsed?.dependencies
  if (dependencies === null || typeof dependencies !== 'object') return []
  return Object.entries(dependencies)
    .filter(([, spec]) => typeof spec === 'string' && spec.startsWith('link:'))
    .map(([name, spec]) => ({ name, spec, target: resolveLinkTarget(spec, context.profileDir) }))
    .filter((row) => row.target !== null)
}

async function itemFor(context, row) {
  const files = await readTreeFiles(row.target, { maxBytes: LOCAL_PLUGIN_MAX_BYTES, maxFiles: 4000 })
  if (files === null) return null
  const item = makeItem({
    section: 'localPlugins',
    id: row.name,
    label: row.name,
    detail: row.spec + ' → ' + row.target,
    relPath: stagePath('localPlugins', safeName(row.name)),
    files,
    kind: 'tree',
    meta: { name: row.name, spec: row.spec, sourcePath: row.target, fileCount: files.length, truncated: files.truncated === true },
  })
  return item
}

/**
 * Prefer the live link target; the staged copy under config-migrator/export is only
 * the fallback on a fresh machine, so a second export never ships a stale backup.
 */
async function readItem(item, context) {
  // The manifest keeps sourcePath masked for privacy, so resolve the real target from
  // the local package.json first; the masked path is only a last-resort hint.
  const row = (await linkDependencies(context)).find((entry) => entry.name === item.id)
  let sourcePath = row === undefined ? null : row.target
  if (sourcePath === null && typeof item.meta?.sourcePath === 'string' && !item.meta.sourcePath.includes('<user>')) {
    sourcePath = item.meta.sourcePath
  }
  if (sourcePath !== null) {
    const live = await readTreeFiles(sourcePath, { maxBytes: LOCAL_PLUGIN_MAX_BYTES, maxFiles: 4000 })
    if (live !== null) return live
  }
  return readTreeFiles(join(context.home, ...item.relPath.split('/')), { maxBytes: LOCAL_PLUGIN_MAX_BYTES, maxFiles: 4000 })
}

/** 自写插件: source trees behind link: dependencies (5MB per plugin, node_modules/.git skipped). */
export const localPluginsSection = {
  id: 'localPlugins',
  title: '自写插件',
  desc: 'link: 依赖指向的本地目录（源码 tree，单插件默认上限 5MB；导入解包到 config-migrator/export/localPlugins/）',
  defaultSelected: true,
  async scan(context) {
    const items = []
    for (const row of await linkDependencies(context)) {
      const item = await itemFor(context, row)
      if (item !== null) items.push(item)
    }
    return items
  },
  async read(item, context) { return readItem(item, context) },
  async write(item, context, files) { return writeItemFiles(context, item, files) },
}

export { entryBytes, entryHash }
