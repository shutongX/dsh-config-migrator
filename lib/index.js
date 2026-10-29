import { MigratorError } from './host/errors.js'
import { buildExport } from './host/export.js'
import { applyArchive, inspectArchive, inspectArchiveFile, readUpload, rollbackSnapshot } from './host/import.js'
import { createRouter, ROUTE_PREFIX } from './host/http.js'
import { describeEnvironment, snapshotsDir } from './host/paths.js'
import { firstLine, logRouteError, routeStateSummary, setRouteStatus } from './host/route-state.js'
import { scanCatalog } from './host/sections/index.js'
import { listSnapshots } from './host/snapshot.js'

export const name = 'dsh-config-migrator'
export const inject = ['tools', 'webServer', 'connection']

/** Standard-schema config so cordis validates and defaults the entry config. */
export const Config = {
  '~standard': {
    version: 1,
    vendor: 'dsh-config-migrator',
    validate(value) {
      const input = value !== null && typeof value === 'object' ? value : {}
      const issues = []
      if (input.enabled !== undefined && typeof input.enabled !== 'boolean') issues.push({ message: 'enabled 必须是布尔值', path: ['enabled'] })
      if (input.snapshotKeep !== undefined && (!Number.isInteger(input.snapshotKeep) || input.snapshotKeep < 1)) issues.push({ message: 'snapshotKeep 必须是正整数', path: ['snapshotKeep'] })
      if (issues.length > 0) return { issues }
      return { value: normalizeSettings(input) }
    },
  },
}

function normalizeSettings(config) {
  const input = config !== null && typeof config === 'object' ? config : {}
  const keep = Number.isFinite(input.snapshotKeep) ? Math.trunc(input.snapshotKeep) : 20
  return { enabled: input.enabled !== false, snapshotKeep: Math.min(200, Math.max(1, keep)) }
}

/** Service lookup that tolerates a composition without that service. */
function getService(ctx, serviceName) {
  try { return ctx.get(serviceName) } catch { return undefined }
}

function formatBytes(bytes) {
  const value = Number(bytes) || 0
  if (value >= 1024 * 1024) return (value / 1024 / 1024).toFixed(2) + ' MB'
  if (value >= 1024) return (value / 1024).toFixed(1) + ' KB'
  return value + ' B'
}

/** Register the /dsh-config-migrator prefix route; the returned disposer releases it. */
/** Backoff schedule for a hot-reload collision (old fiber removes its route late). */
const ROUTE_RETRY_DELAYS = [150, 600, 2000]

/**
 * Register the prefix route, retrying with backoff when a hot reload still holds the
 * path. Never throws: the fiber stays active and the state is visible via httpRoute.
 */
function registerRoute(ctx, context) {
  const webServer = getService(ctx, 'webServer')
  if (webServer === undefined || typeof webServer.register !== 'function') {
    setRouteStatus('failed', { attempts: 0, error: 'webServer 服务不可用' })
    logRouteError(context.home, 'webServer 服务不可用，无法注册 ' + ROUTE_PREFIX)
    return () => {}
  }
  const router = createRouter({ context, connection: getService(ctx, 'connection'), logger: ctx.logger })
  const route = {
    kind: 'prefix',
    path: ROUTE_PREFIX,
    handler: (request, response) => { void router.handle(request, response) },
  }

  let disposed = false
  let disposer = null
  const timers = new Set()
  // A transient fiber (dev reload creates several) must not poison the state of the
  // fiber that actually owns the route: remember what we found and restore on dispose.
  const baseline = routeStateSummary()

  const attemptRegister = (attempt) => {
    if (disposed) return
    try {
      disposer = webServer.register(route)
      setRouteStatus('ok', { attempts: attempt + 1, error: null })
      logRouteError(context.home, '注册 ' + ROUTE_PREFIX + ' 成功（第 ' + (attempt + 1) + ' 次尝试）')
      try { ctx.logger?.info?.('dsh-config-migrator: HTTP 路由已注册（第 ' + (attempt + 1) + ' 次尝试）') } catch { /* log only */ }
    } catch (error) {
      const stack = error instanceof Error ? (error.stack ?? error.message) : String(error)
      const delay = ROUTE_RETRY_DELAYS[attempt]
      setRouteStatus(delay === undefined ? 'failed' : 'retrying', { attempts: attempt + 1, error: firstLine(stack) })
      logRouteError(context.home, '注册 ' + ROUTE_PREFIX + ' 失败（第 ' + (attempt + 1) + ' 次）：' + stack)
      try { ctx.logger?.warn?.(error) } catch { /* log only */ }
      if (delay === undefined) return
      const timer = setTimeout(() => { timers.delete(timer); attemptRegister(attempt + 1) }, delay)
      if (typeof timer.unref === 'function') timer.unref()
      timers.add(timer)
    }
  }
  attemptRegister(0)

  return () => {
    disposed = true
    logRouteError(context.home, '路由 effect 被清理（已注册=' + (disposer !== null) + '，待重试=' + timers.size + '）')
    for (const timer of timers) clearTimeout(timer)
    timers.clear()
    if (disposer === null) {
      // Never owned the route: put the shared status back where we found it.
      setRouteStatus(baseline.httpRoute, { attempts: baseline.httpRouteAttempts, error: baseline.httpRouteError })
    }
    if (typeof disposer === 'function') {
      try { disposer() } catch { /* route already gone */ }
    }
  }
}

/** Structured overview payload (same fields the HTTP /api/overview returns). */
function overviewPayload(context, catalog, snapshots) {
  return {
    dshHome: context.home,
    profile: context.profile,
    profileDir: context.profileDir,
    dshVersion: context.dshVersion,
    platform: context.platform,
    node: context.node,
    snapshots,
    ...routeStateSummary(),
    sections: catalog.map((row) => ({
      id: row.id,
      title: row.title,
      desc: row.desc,
      defaultSelected: row.defaultSelected !== false,
      totalBytes: row.totalBytes,
      itemCount: row.items.length,
      items: row.items.map((item) => ({ id: item.id, label: item.label, kind: item.kind, bytes: item.bytes, relPath: item.relPath })),
      ...(row.error === undefined ? {} : { error: row.error }),
    })),
  }
}

function overviewText(context, catalog, snapshots) {
  const lines = [
    'DSH_HOME：' + context.home,
    'profile：' + context.profile,
    'profile 目录：' + context.profileDir,
    'DSH 版本：' + context.dshVersion,
    '平台：' + context.platform + ' / node ' + context.node,
    '分区：' + catalog.length + ' 个（有内容 ' + catalog.filter((row) => row.items.length > 0).length + ' 个）',
    '快照：' + snapshots.length + ' 个（目录 ' + snapshotsDir(context.home) + '）',
    'HTTP 路由：' + routeStateSummary().httpRoute + (routeStateSummary().httpRoute === 'ok' ? '' : '（' + String(routeStateSummary().httpRouteError ?? '') + '，详见 ' + String(routeStateSummary().httpRouteLog ?? '') + '）'),
  ]
  for (const row of catalog) {
    lines.push('- ' + row.id + '（' + row.title + '）：' + row.items.length + ' 项，' + formatBytes(row.totalBytes) + (row.error === undefined ? '' : ' ！' + row.error))
  }
  return lines.join('\n')
}

async function catalogText(context) {
  const catalog = await scanCatalog(context)
  const lines = []
  for (const row of catalog) {
    lines.push('## ' + row.id + ' · ' + row.title + '（' + row.items.length + ' 项 / ' + formatBytes(row.totalBytes) + '）')
    lines.push(row.desc)
    for (const item of row.items.slice(0, 40)) lines.push('  - ' + item.id + '  ' + formatBytes(item.bytes))
    if (row.items.length > 40) lines.push('  …还有 ' + (row.items.length - 40) + ' 项')
    if (row.error !== undefined) lines.push('  ! 扫描失败：' + row.error)
  }
  return lines.join('\n')
}

function statusCounts(sections) {
  const counts = { new: 0, same: 0, conflict: 0, missing: 0 }
  for (const section of sections) for (const item of section.items) counts[item.status] = (counts[item.status] ?? 0) + 1
  return counts
}

function inspectText(result) {
  const counts = statusCounts(result.sections)
  const lines = [
    '检查完成',
    'archive=' + result.archive,
    '来源：' + result.manifest.profile + ' / ' + result.manifest.sourceHome + ' / ' + result.manifest.createdAt,
    '判定：新增 ' + counts.new + ' · 相同 ' + counts.same + ' · 冲突 ' + counts.conflict + ' · 缺失 ' + counts.missing,
  ]
  for (const section of result.sections) {
    const bad = section.items.filter((item) => item.status !== 'same')
    if (bad.length === 0) { lines.push('- ' + section.id + '：全部相同（' + section.items.length + ' 项）'); continue }
    lines.push('- ' + section.id + '：' + section.items.length + ' 项，其中 ' + bad.length + ' 项需处理')
    for (const item of bad.slice(0, 8)) lines.push('    · ' + item.status + ' ' + item.itemId + (item.diff === '' ? '' : ' — ' + item.diff))
    if (bad.length > 8) lines.push('    · …还有 ' + (bad.length - 8) + ' 项')
  }
  for (const warning of result.pathWarnings) lines.push('提示：' + warning.message)
  return lines.join('\n')
}

/** Build the model-facing config_migrator tool (same operations as the HTTP contract). */
function createTool(context) {
  return {
    name: 'config_migrator',
    description: 'DSH 配置迁移：分区清单、导出 zip、检查导入包冲突、应用导入、回滚与快照。所有 action 与 HTTP 契约同一实现。',
    parameters: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: ['overview', 'catalog', 'export', 'inspect', 'apply', 'rollback', 'snapshots'],
          description: 'overview=环境概览；catalog=分区清单；export=打包 zip；inspect=检查 zip 冲突；apply=应用导入；rollback=回滚快照；snapshots=快照列表',
        },
        sections: { type: 'object', description: '导出时按分区开关，例如 {"profile": true, "sessions": false}' },
        items: { type: 'object', description: '导出时按分区限定条目 id 数组，例如 {"sessions": ["<project>/<session>"]}；省略或 null 表示该分区全选' },
        format: { type: 'string', enum: ['text', 'json'], description: '返回文本摘要（默认）或结构化 JSON；UI/catalog 取数用 json' },
        includeSecrets: { type: 'boolean', description: '是否加密导出凭据分区（需要 password）' },
        password: { type: 'string', description: '凭据加密密码（includeSecrets=true 时必填，至少 6 位）' },
        file: { type: 'string', description: 'inspect 时本机 zip 的绝对路径（与 archive 二选一）' },
        archive: { type: 'string', description: 'inspect/apply 的 archive token（inspect 返回的 sha256）' },
        choices: { type: 'object', description: 'apply 时按条目选择：{ sectionId: { itemId: "use-backup" | "keep-local" | "skip" } }' },
        remap: { type: 'array', items: { type: 'object' }, description: 'apply 时路径重映射：[{ from, to }]' },
        confirm: { type: 'boolean', description: 'apply 必须显式 true 才会写盘' },
        snapshot: { type: 'string', description: 'rollback 的快照 id' },
      },
      required: ['action'],
      additionalProperties: false,
    },
    output: {
      schema: { type: 'string' },
      render(_args, value) { return [{ type: 'text', text: String(value) }] },
    },
    async execute(args) {
      const input = args !== null && typeof args === 'object' ? args : {}
      const action = typeof input.action === 'string' ? input.action : 'overview'
      const wantsJson = input.format === 'json'
      if (action === 'overview') {
        const catalog = await scanCatalog(context)
        const snapshots = await listSnapshots(context.home)
        return wantsJson ? JSON.stringify(overviewPayload(context, catalog, snapshots), null, 2) : overviewText(context, catalog, snapshots)
      }
      if (action === 'catalog') {
        if (wantsJson) return JSON.stringify({ sections: await scanCatalog(context) }, null, 2)
        return catalogText(context)
      }
      if (action === 'snapshots') {
        const rows = await listSnapshots(context.home)
        if (wantsJson) return JSON.stringify(rows, null, 2)
        if (rows.length === 0) return '快照目录：' + snapshotsDir(context.home) + '\n暂无快照（每次导入前会自动生成）'
        return ['快照目录：' + snapshotsDir(context.home), ...rows.map((row) => '- ' + row.id + '  ' + row.at + '  ' + formatBytes(row.bytes) + ' / ' + row.files + ' 个文件')].join('\n')
      }
      if (action === 'export') {
        const result = await buildExport(context, { sections: input.sections, items: input.items, includeSecrets: input.includeSecrets === true, password: input.password })
        if (wantsJson) return JSON.stringify(result, null, 2)
        const lines = [
          '导出完成',
          '文件：' + result.file,
          '大小：' + formatBytes(result.size) + '（' + result.size + ' 字节）',
          '条目：' + result.itemCount + ' 个 / 分区：' + result.sectionCount + ' 个',
          '下载：' + result.downloadUrl,
          '凭据：' + (result.secretsIncluded ? '已加密包含' : '未包含'),
        ]
        if (result.warnings.length > 0) lines.push('提示：', ...result.warnings.map((warning) => '- ' + warning))
        return lines.join('\n')
      }
      if (action === 'inspect') {
        const result = typeof input.file === 'string' && input.file !== ''
          ? await inspectArchiveFile(context, input.file)
          : await inspectArchive(context, await readUpload(context, String(input.archive ?? '')))
        return wantsJson ? JSON.stringify(result, null, 2) : inspectText(result)
      }
      if (action === 'apply') {
        if (input.confirm !== true) throw new MigratorError('confirm-required', 'apply 需要 confirm:true 才会写盘', 400)
        const result = await applyArchive(context, { archive: input.archive, choices: input.choices, remap: input.remap })
        if (wantsJson) return JSON.stringify(result, null, 2)
        const lines = [
          '导入完成',
          '应用 ' + result.applied.length + ' 项；跳过 ' + result.skipped.length + ' 项；失败 ' + result.failed.length + ' 项',
          '快照：' + String(result.snapshot),
          '需要重启 DSH 生效：' + (result.restartRequired ? '是' : '否'),
        ]
        if (result.rolledBack) lines.push('！全部已回滚（有失败项）')
        for (const row of result.failed) lines.push('  失败 ' + row.section + '/' + row.itemId + '：' + row.error)
        for (const row of result.skipped.slice(0, 10)) lines.push('  跳过 ' + row.section + '/' + row.itemId + '：' + row.reason)
        return lines.join('\n')
      }
      if (action === 'rollback') {
        const result = await rollbackSnapshot(context, { snapshot: input.snapshot })
        if (wantsJson) return JSON.stringify(result, null, 2)
        return '回滚完成：恢复 ' + result.restored + ' 个文件，删除 ' + result.removed + ' 个新建文件（快照 ' + result.snapshot + '）'
      }
      throw new MigratorError('bad-request', '未知 action：' + action, 400)
    },
  }
}

/**
 * Host entry: register the HTTP prefix route and the config_migrator tool.
 * @param {object} ctx - plugin context (injects tools + webServer).
 * @param {object} config - validated entry config.
 */
export function apply(ctx, config) {
  const settings = normalizeSettings(config)
  if (!settings.enabled) return
  const connection = getService(ctx, 'connection')
  const context = { ...describeEnvironment(), authDegraded: connection === undefined }
  logRouteError(context.home, 'apply 启动（profile=' + context.profile + '）')
  if (connection === undefined) {
    try { ctx.logger?.warn?.('dsh-config-migrator: connection 服务不可用，HTTP 鉴权退化为仅 loopback（exports/inspect 的 warnings 会提示）') } catch { /* log only */ }
  }
  ctx.effect(() => registerRoute(ctx, context), 'dsh-config-migrator: HTTP route')
  ctx.effect(() => {
    const tools = getService(ctx, 'tools')
    if (tools === undefined || typeof tools.register !== 'function') return () => {}
    return tools.register(createTool(context))
  }, 'dsh-config-migrator: config_migrator tool')
}
