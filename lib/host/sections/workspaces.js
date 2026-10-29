import { join } from 'node:path'
import { readOrNull } from '../fsutil.js'
import { makeItem, readSingleFile, stagePath, writeItemFiles } from './shared.js'

export function workspaceJsonPath(context) { return join(context.home, 'storages', 'workspace.json') }

/** Known workspace rows ({ id, path, name }) from storages/workspace.json. */
export async function knownWorkspaceDirs(context) {
  const data = await readOrNull(workspaceJsonPath(context))
  if (data === null) return []
  try {
    const parsed = JSON.parse(data.toString('utf8'))
    const table = parsed?.tables?.workspaces
    if (table === null || typeof table !== 'object') return []
    return Object.entries(table)
      .map(([id, row]) => ({
        id,
        path: row !== null && typeof row === 'object' && typeof row.path === 'string' ? row.path : null,
        name: row !== null && typeof row === 'object' && typeof row.name === 'string' ? row.name : null,
      }))
      .filter((row) => row.path !== null)
  } catch { return [] }
}

const DIRS_RELPATH = stagePath('workspaces', 'known-dirs.json')

function dirsPayload(dirs) { return Buffer.from(JSON.stringify({ dirs }, null, 2) + '\n', 'utf8') }

/** 工作区: the workspace storage file plus the known workspace directory list. */
export const workspacesSection = {
  id: 'workspaces',
  title: '工作区',
  desc: 'storages/workspace.json 与已知工作区目录列表（目录本身不打包，导入后按重映射指回）',
  defaultSelected: true,
  async scan(context) {
    const items = []
    const files = await readSingleFile(workspaceJsonPath(context))
    if (files !== null) {
      items.push(makeItem({
        section: 'workspaces',
        id: 'storages/workspace.json',
        label: 'workspace.json',
        detail: 'storages/workspace.json',
        relPath: 'storages/workspace.json',
        files,
        kind: 'config',
      }))
    }
    const dirs = await knownWorkspaceDirs(context)
    if (dirs.length > 0) {
      items.push(makeItem({
        section: 'workspaces',
        id: 'known-dirs',
        label: '已知工作区目录',
        detail: dirs.map((row) => row.path).join('  |  '),
        relPath: DIRS_RELPATH,
        files: [{ rel: '', data: dirsPayload(dirs) }],
        kind: 'remap',
        meta: { dirs },
      }))
    }
    return items
  },
  async read(item, context) {
    if (item.id !== 'known-dirs') return readSingleFile(workspaceJsonPath(context))
    const staged = await readSingleFile(join(context.home, ...item.relPath.split('/')))
    if (staged !== null) return staged
    const dirs = await knownWorkspaceDirs(context)
    return dirs.length === 0 ? null : [{ rel: '', data: dirsPayload(dirs) }]
  },
  async write(item, context, files) { return writeItemFiles(context, item, files) },
}
