import { join } from 'node:path'
import { readOrNull, statOrNull } from '../fsutil.js'
import { makeItem, readTreeFiles, writeItemFiles } from './shared.js'

const SESSION_MAX_BYTES = 256 * 1024 * 1024
const SESSION_MAX_FILES = 20000

function projcachePath(context, sessionId) {
  return join(context.home, 'storages', 'session_projcache', 'sessions', sessionId + '.json')
}

/** Title/cwd for one session, read from the projcache record; null when unknown. */
async function sessionMeta(context, sessionId) {
  const data = await readOrNull(projcachePath(context, sessionId))
  if (data === null) return null
  try {
    const record = JSON.parse(data.toString('utf8'))?.record
    const title = record?.rows?.title?.val
    return {
      title: typeof title === 'string' && title.trim() !== '' ? title.trim().slice(0, 80) : null,
      cwd: typeof record?.identity?.cwd === 'string' ? record.identity.cwd : null,
      createdAt: typeof record?.identity?.createdAt === 'number' ? record.identity.createdAt : null,
    }
  } catch { return null }
}

/** 会话: one item per session directory, titled from the projcache record. */
export const sessionsSection = {
  id: 'sessions',
  title: '会话',
  desc: 'sessions/<project>/<session>/ 逐会话勾选；标题来自 storages/session_projcache',
  defaultSelected: true,
  async scan(context) {
    const root = join(context.home, 'sessions')
    const rootInfo = await statOrNull(root)
    if (rootInfo === null || !rootInfo.isDirectory()) return []
    const { readdir } = await import('node:fs/promises')
    const items = []
    for (const project of await readdir(root, { withFileTypes: true })) {
      if (!project.isDirectory()) continue
      const projectDir = join(root, project.name)
      for (const session of await readdir(projectDir, { withFileTypes: true })) {
        if (!session.isDirectory()) continue
        const files = await readTreeFiles(join(projectDir, session.name), { maxBytes: SESSION_MAX_BYTES, maxFiles: SESSION_MAX_FILES })
        if (files === null || files.length === 0) continue
        const meta = await sessionMeta(context, session.name)
        items.push(makeItem({
          section: 'sessions',
          id: project.name + '/' + session.name,
          label: meta?.title ?? session.name,
          detail: project.name + (meta?.cwd === null || meta?.cwd === undefined ? '' : ' · ' + meta.cwd),
          relPath: 'sessions/' + project.name + '/' + session.name,
          files,
          kind: 'tree',
          meta: { sessionId: session.name, project: project.name, truncated: files.truncated === true, ...(meta ?? {}) },
        }))
      }
    }
    return items
  },
  async read(item, context) {
    return readTreeFiles(join(context.home, ...item.relPath.split('/')), { maxBytes: SESSION_MAX_BYTES, maxFiles: SESSION_MAX_FILES })
  },
  async write(item, context, files) { return writeItemFiles(context, item, files) },
}
