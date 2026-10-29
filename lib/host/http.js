import { createReadStream } from 'node:fs'
import { stat } from 'node:fs/promises'
import { join } from 'node:path'
import { pipeline } from 'node:stream/promises'
import { MigratorError, toMigratorError } from './errors.js'
import { buildExport } from './export.js'
import { applyArchive, inspectArchive, rollbackSnapshot } from './import.js'
import { exportsDir, isInside } from './paths.js'
import { scanCatalog } from './sections/index.js'
import { routeStateSummary } from './route-state.js'
import { listSnapshots } from './snapshot.js'

/** Prefix every browser call is served under (webserver longest-prefix route). */
export const ROUTE_PREFIX = '/dsh-config-migrator'
const MAX_JSON_BODY = 1024 * 1024
const MAX_UPLOAD_BODY = 512 * 1024 * 1024
const DOWNLOAD_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]*\.zip$/

function sendJson(response, status, payload) {
  const body = Buffer.from(JSON.stringify(payload), 'utf8')
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': String(body.length),
    'cache-control': 'no-store',
  })
  response.end(body)
}

function sendError(response, error) {
  const known = error instanceof MigratorError ? error : toMigratorError(error)
  if (response.headersSent) {
    response.destroy()
    return
  }
  sendJson(response, known.status, { error: { code: known.code, message: known.message } })
}

/** Buffer a request body with a byte cap; undefined/empty bodies read as {} for JSON routes. */
async function readBodyBuffer(request, limit) {
  const chunks = []
  let total = 0
  for await (const chunk of request) {
    total += chunk.length
    if (total > limit) throw new MigratorError('payload-too-large', '请求体超过上限 ' + Math.round(limit / 1024 / 1024) + 'MB', 413)
    chunks.push(chunk)
  }
  return Buffer.concat(chunks)
}

async function readJsonBody(request) {
  const buffer = await readBodyBuffer(request, MAX_JSON_BODY)
  if (buffer.length === 0) return {}
  try {
    const value = JSON.parse(buffer.toString('utf8'))
    return value !== null && typeof value === 'object' && !Array.isArray(value) ? value : {}
  } catch {
    throw new MigratorError('bad-request', '请求体必须是 JSON 对象', 400)
  }
}

/** Host/Origin fence plus browser auth when a Connection service is present; loopback-only otherwise. */
function rejectionOf(request, connection) {
  if (connection !== undefined && typeof connection.requestRejection === 'function') {
    try {
      const rejection = connection.requestRejection(request)
      return rejection === undefined ? undefined : rejection
    } catch {
      return 403
    }
  }
  const address = request.socket?.remoteAddress ?? ''
  return address === '127.0.0.1' || address === '::1' || address === '::ffff:127.0.0.1' ? undefined : 403
}

/** Stream one export archive with an attachment disposition (RFC 5987 for non-ASCII names). */
async function sendArchive(response, file) {
  let info
  try { info = await stat(file) } catch { throw new MigratorError('not-found', '导出文件不存在：' + file, 404) }
  if (!info.isFile()) throw new MigratorError('not-found', '导出文件不存在：' + file, 404)
  const name = file.split(/[\\/]/).pop() ?? 'export.zip'
  response.writeHead(200, {
    'content-type': 'application/zip',
    'content-length': String(info.size),
    'content-disposition': 'attachment; filename="' + name + '"; filename*=UTF-8\'\'' + encodeURIComponent(name),
    'cache-control': 'no-store',
  })
  await pipeline(createReadStream(file), response)
}

/**
 * Build the request dispatcher for the plugin's prefix route.
 * @param {{ context: object, connection?: object, logger?: object }} options - environment context plus optional Connection service.
 */
export function createRouter({ context, connection, logger } = {}) {
  const routes = [
    { method: 'GET', pattern: /^\/api\/overview$/, run: async () => overviewPayload() },
    { method: 'GET', pattern: /^\/api\/catalog$/, run: async () => ({ sections: await scanCatalog(context) }) },
    { method: 'POST', pattern: /^\/api\/export$/, run: async (_match, request) => buildExport(context, await readJsonBody(request)) },
    { method: 'POST', pattern: /^\/api\/import\/inspect$/, run: async (_match, request) => inspectArchive(context, await readBodyBuffer(request, MAX_UPLOAD_BODY)) },
    { method: 'POST', pattern: /^\/api\/import\/apply$/, run: async (_match, request) => applyArchive(context, await readJsonBody(request)) },
    { method: 'POST', pattern: /^\/api\/import\/rollback$/, run: async (_match, request) => rollbackSnapshot(context, await readJsonBody(request)) },
    { method: 'GET', pattern: /^\/api\/snapshots$/, run: async () => listSnapshots(context.home) },
    { method: 'GET', pattern: /^\/download\/([^/]+)$/, download: true, run: async (match, _request, response) => sendArchive(response, resolveDownload(match)) },
  ]

  async function overviewPayload() {
    return {
      dshHome: context.home,
      profile: context.profile,
      profileDir: context.profileDir,
      dshVersion: context.dshVersion,
      platform: context.platform,
      snapshots: await listSnapshots(context.home),
      ...routeStateSummary(),
    }
  }

  /** Resolve a download name inside the exports directory, rejecting traversal. */
  function resolveDownload(match) {
    let name
    try { name = decodeURIComponent(match[1]) } catch { throw new MigratorError('bad-request', '下载名含非法转义：' + match[1], 400) }
    if (!DOWNLOAD_NAME.test(name)) throw new MigratorError('bad-request', '下载名不合法：' + name, 400)
    const dir = exportsDir(context.home)
    const file = join(dir, name)
    if (!isInside(dir, file)) throw new MigratorError('forbidden', '下载路径越界', 403)
    return file
  }

  async function dispatch(request, response) {
    try {
      const rejection = rejectionOf(request, connection)
      if (rejection !== undefined) {
        const unauthorized = rejection === 401
        sendJson(response, rejection, {
          error: { code: unauthorized ? 'unauthorized' : 'forbidden', message: unauthorized ? '需要先登录本机 DSH 面板' : '来源不被信任' },
        })
        return
      }
      const pathname = new URL(request.url ?? '/', 'http://localhost').pathname
      const rest = pathname === ROUTE_PREFIX ? '/' : pathname.startsWith(ROUTE_PREFIX + '/') ? pathname.slice(ROUTE_PREFIX.length) : null
      if (rest === null) {
        sendJson(response, 404, { error: { code: 'not-found', message: '未知路由：' + pathname } })
        return
      }
      const method = (request.method ?? 'GET').toUpperCase()
      const allowed = new Set()
      for (const route of routes) {
        const match = route.pattern.exec(rest)
        if (match === null) continue
        if (route.method !== method) { allowed.add(route.method); continue }
        if (route.download === true) {
          await route.run(match, request, response)
          return
        }
        sendJson(response, 200, await route.run(match, request, response))
        return
      }
      if (allowed.size > 0) {
        response.setHeader('allow', [...allowed].join(', '))
        sendJson(response, 405, { error: { code: 'method-not-allowed', message: '该接口只支持 ' + [...allowed].join(', ') } })
        return
      }
      sendJson(response, 404, { error: { code: 'not-found', message: '未知接口：' + rest } })
    } catch (error) {
      try { logger?.warn?.(error) } catch { /* a logger failure must not mask the response */ }
      sendError(response, error)
    }
  }

  return { prefix: ROUTE_PREFIX, handle: dispatch }
}

export { listSnapshots }
