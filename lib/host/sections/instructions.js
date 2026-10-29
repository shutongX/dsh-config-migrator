import { join } from 'node:path'
import { readOrNull } from '../fsutil.js'
import { maskHomePath } from '../paths.js'
import { makeItem, readSingleFile, stagePath, writeItemFiles } from './shared.js'
import { knownWorkspaceDirs } from './workspaces.js'

function safeName(value) { return String(value).replace(/[^A-Za-z0-9._-]/g, '_') }

/** AGENTS.md of one workspace directory: staged under config-migrator, never written back. */
function workspaceItem(dir, index) {
  return {
    id: 'workspace-agents:' + index,
    section: 'instructions',
    label: 'AGENTS.md',
    detail: dir,
    relPath: stagePath('instructions', 'workspace-' + index + '-' + safeName(dir.split(/[\\/]/).pop() || 'ws') + '.md'),
    kind: 'remap',
    meta: { sourcePath: join(dir, 'AGENTS.md'), workspaceDir: dir },
  }
}

/** 全局规则: $DSH_HOME/AGENTS.md plus each known workspace AGENTS.md. */
export const instructionsSection = {
  id: 'instructions',
  title: '全局规则',
  desc: '$DSH_HOME/AGENTS.md 与已知工作区的 AGENTS.md（工作区文件导入时落到 config-migrator/export/instructions/，需手动放置）',
  defaultSelected: true,
  async scan(context) {
    const items = []
    const homeFiles = await readSingleFile(join(context.home, 'AGENTS.md'))
    if (homeFiles !== null) {
      items.push(makeItem({
        section: 'instructions',
        id: 'AGENTS.md',
        label: 'AGENTS.md',
        detail: '~/.dsh/AGENTS.md',
        relPath: 'AGENTS.md',
        files: homeFiles,
        kind: 'file',
      }))
    }
    const dirs = await knownWorkspaceDirs(context)
    for (let index = 0; index < dirs.length; index += 1) {
      const descriptor = workspaceItem(dirs[index].path, index)
      const files = await readSingleFile(descriptor.meta.sourcePath)
      if (files === null) continue
      items.push(makeItem({ ...descriptor, files }))
    }
    return items
  },
  async read(item, context) {
    if (item.meta?.sourcePath !== undefined || String(item.id).startsWith('workspace-agents:')) {
      // Live workspace file wins; the staged copy is only a fallback on a machine
      // where that workspace does not exist yet. A masked path (<user>) is resolved
      // back to a real directory through the local workspace list.
      if (typeof item.meta?.sourcePath === 'string') {
        let livePath = item.meta.sourcePath
        if (livePath.includes('<user>')) {
          const match = (await knownWorkspaceDirs(context)).find((row) => maskHomePath(join(row.path, 'AGENTS.md')) === livePath)
          livePath = match === undefined ? '' : join(match.path, 'AGENTS.md')
        }
        if (livePath !== '') {
          const live = await readSingleFile(livePath)
          if (live !== null) return live
        }
      }
      return readSingleFile(join(context.home, ...item.relPath.split('/')))
    }
    return readSingleFile(join(context.home, 'AGENTS.md'))
  },
  async write(item, context, files) { return writeItemFiles(context, item, files) },
}

export async function readTextOrNull(path) {
  const data = await readOrNull(path)
  return data === null ? null : data.toString('utf8')
}
