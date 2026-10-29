import { readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { isSecretFileName, isSecretRelPath } from '../secret-files.js'
import { makeItem, readSingleFile, writeItemFiles } from './shared.js'

/** Cache-like stores never travel: they are rebuilt by the host on demand. */
const EXCLUDED = new Set(['workspace.json'])

/** token.json / credentials.yaml / *.key never ship, whatever the section. */
function isSecretStore(name) {
  return isSecretRelPath('storages/' + name) || isSecretFileName(name.replace(/\.[^.]+$/, ''))
}

/** 其它存储: top-level storages/*.json except the ones another section owns. */
export const storagesSection = {
  id: 'storages',
  title: '其它存储',
  desc: 'storages/*.json（schedule.json 等），排除缓存类与已归属的 workspace.json',
  defaultSelected: true,
  async scan(context) {
    const dir = join(context.home, 'storages')
    let entries
    try { entries = await readdir(dir, { withFileTypes: true }) } catch { return [] }
    const items = []
    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith('.json') || EXCLUDED.has(entry.name) || isSecretStore(entry.name)) continue
      const rel = 'storages/' + entry.name
      const files = await readSingleFile(join(dir, entry.name))
      if (files === null) continue
      items.push(makeItem({
        section: 'storages',
        id: rel,
        label: entry.name,
        detail: rel,
        relPath: rel,
        files,
        kind: 'config',
      }))
    }
    return items
  },
  async read(item, context) { return readSingleFile(join(context.home, ...item.relPath.split('/'))) },
  async write(item, context, files) { return writeItemFiles(context, item, files) },
}
