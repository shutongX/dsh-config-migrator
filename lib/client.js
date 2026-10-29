// dsh-config-migrator client bundle: settings.section UI for 导出 / 导入 / 快照.
// Single hand-written file, no build step; require('react') is the only import.
// Contract: docs/SPEC.md §6. Every color/border/background is a --dsw-alias-* token,
// so the section follows the host theme (light/dark) instead of owning a palette.
window.__ModuleLoader__.load({ id: 'dsh-config-migrator', factory: (require) => {
  var module = { exports: {} }
  var exports = module.exports
  var React = require('react')
  var h = React.createElement
  var useState = React.useState
  var useEffect = React.useEffect
  var useRef = React.useRef
  var useMemo = React.useMemo
  var useCallback = React.useCallback

  var NS = 'dsh-config-migrator'
  var BASE = '/dsh-config-migrator'

  // --------------------------------------------------------------- i18n ----
  // Host locale registration is optional: when ctx.locale is missing the section
  // still renders with this table (zh default) instead of failing to mount.
  var DICTS = {
    zh: {
      nav: '配置迁移',
      desc: '把本机 DSH 的分区配置导出为 zip，在新机器上按需导入，并在导入前分析冲突。',
      tabExport: '导出',
      tabImport: '导入',
      tabSnapshots: '快照',
      loading: '加载中…',
      refresh: '刷新',
      retry: '重试',
      close: '关闭',
      cancel: '取消',
      errorTitle: '出错了',
      envHome: '主目录',
      envProfile: 'profile',
      envVersion: '版本',
      catalogTitle: '选择要导出的分区',
      catalogDesc: '默认全选（凭据分区除外）；展开卡片可以逐条挑选。',
      itemsCount: '{count} 项',
      sectionEmpty: '该分区暂无可导出的条目',
      scanFailed: '扫描失败：{error}',
      expand: '展开条目',
      collapse: '收起条目',
      selectAll: '全选',
      clearSelection: '清空',
      summary: '已选 {count} 项 · 预计 {size}',
      generate: '生成 zip',
      generating: '正在打包…',
      selectionEmpty: '请至少勾选一个分区或条目',
      catalogEmpty: '没有可导出的分区',
      exportDone: '已生成备份包',
      download: '下载 zip',
      filePath: '落盘位置',
      warningsTitle: '提示（{count}）',
      warningsMore: '还有 {count} 条未显示',
      credentialsNote: '凭据只备份，不支持导入：以密码加密写入 sealed/credentials.bin（scrypt + AES-256-GCM），zip 里不会出现明文；导入时不会解密写回，本机凭据要手动补。',
      passwordPlaceholder: '加密密码',
      passwordRequired: '已勾选凭据分区，请填写至少 6 位加密密码',
      importTitle: '从备份包导入',
      importDesc: '先分析备份内容与冲突，再逐项决定怎么处理。',
      dropHint: '把 zip 拖到这里，或点击选择文件',
      dropPick: '选择 zip 文件',
      notZip: '请选择 .zip 文件',
      inspecting: '正在分析备份…',
      manifestTitle: '备份概要',
      fieldFormat: '格式',
      fieldCreatedAt: '创建时间',
      fieldSourceHome: '来源机器',
      fieldProfile: '来源 profile',
      fieldDshVersion: 'DSH 版本',
      fieldItems: '条目',
      fieldSecrets: '含凭据',
      yes: '是',
      no: '否',
      pathWarnings: '路径提示',
      colItem: '条目',
      colStatus: '状态',
      colLocal: '本机',
      colIncoming: '备份',
      colChoice: '处理方式',
      statusNew: '新增',
      statusSame: '相同',
      statusConflict: '冲突',
      statusMissing: '本机缺失',
      useBackup: '用备份',
      choiceAuto: '自动',
      choiceSkip: '跳过',
      effectiveWrite: '→ 将写入本机',
      effectiveSkip: '→ 不写入',
      batchAuto: '全部自动',
      batchUseBackup: '全部用备份',
      batchSkip: '全部跳过',
      writeCount: '将写入本机 {count} 项',
      truncatedBadge: '备份不完整',
      truncatedHint: '备份时被截断，导入后内容不完整',
      overwriteLocal: '用备份 = 整体覆盖本机这一项（{size}）',
      createLocal: '用备份 = 在本机新建这一项（{size}）',
      secretsNotImported: '备份含加密凭据条目：只备份，不支持导入（不会解密写回）。',
      redactedValue: '（已脱敏）',
      startImport: '开始导入',
      importing: '正在导入…',
      inspectEmpty: '备份包里没有可导入的条目',
      resultTitle: '导入完成',
      applied: '已应用',
      skipped: '已跳过',
      failed: '失败',
      failedTitle: '失败明细',
      restartHint: '需要重启 DSH，package.json 与插件装配才会生效。',
      snapshotCreated: '已自动快照：{id}',
      rollback: '一键回滚',
      rollbackConfirm: '确认回滚本次导入？',
      rollingBack: '正在回滚…',
      rollbackDone: '已回滚 {count} 个文件',
      rollbackRemoved: '，并删除 {count} 个新建文件',
      rolledBackHint: '有文件写入失败，host 已自动回滚本次导入，本机文件保持不变。',
      applyRemap: '应用这条路径重映射',
      chooseAnother: '重新选择备份包',
      impactProfile: '会整体替换本机 profile 的 package.json / cordis.patch.yml 等装配文件，重启后按备份生效',
      impactPlugins: '会按备份重写依赖声明，需要重启并重新安装插件',
      impactLocalPlugins: '会整体覆盖本机同名的本地插件目录（源码）',
      impactMarketplace: '会整体覆盖插件市场地址配置',
      impactModels: '会整体覆盖模型供应商配置；apiKey 已被脱敏，导入后要重新填写',
      impactSkills: '会整体覆盖同名的技能目录',
      impactMcp: '会整体覆盖 MCP 服务定义',
      impactAgentPresets: '会整体覆盖 agent 预设配置',
      impactSettings: '会整体覆盖系统默认配置条目',
      impactInstructions: '会整体覆盖本机的全局规则 AGENTS.md',
      impactWorkspaces: '会整体覆盖工作区列表（含已知目录）',
      impactSessions: '会整体覆盖同名的会话记录文件',
      impactStorages: '会整体替换 storages/*.json：本机已有的定时任务（schedule.json）等会被备份内容整体替换',
      impactPluginData: '会整体覆盖插件私有目录：例如 dsh-pocket 的配对信息被替换后，手机端可能掉线',
      impactAttachments: '会整体覆盖同名附件',
      impactCredentials: '只备份，不支持导入（加密条目不会解密写回）',
      snapshotsTitle: '本机快照',
      snapshotsDesc: '导入前会自动快照被覆盖的文件，这里可以恢复到任意快照。',
      snapshotsEmpty: '暂无快照',
      snapshotFiles: '文件',
      restore: '恢复',
      restoreConfirm: '确认恢复到该快照？当前文件会被覆盖。',
      restoreYes: '确认恢复',
      restoring: '正在恢复…',
      restoreDone: '已恢复 {count} 个文件',
      archiveMissing: '备份包缺少 archive 标识，请重新分析',
      unknownError: '未知错误',
    },
    en: {
      nav: 'Config Migrator',
      desc: 'Export selected DSH configuration sections as a zip, then import them on a new machine with a conflict preview.',
      tabExport: 'Export',
      tabImport: 'Import',
      tabSnapshots: 'Snapshots',
      loading: 'Loading…',
      refresh: 'Refresh',
      retry: 'Retry',
      close: 'Close',
      cancel: 'Cancel',
      errorTitle: 'Something went wrong',
      envHome: 'Home',
      envProfile: 'profile',
      envVersion: 'Version',
      catalogTitle: 'Choose sections to export',
      catalogDesc: 'Everything is selected by default except credentials; expand a card to pick single items.',
      itemsCount: '{count} items',
      sectionEmpty: 'This section has no items to export',
      scanFailed: 'Scan failed: {error}',
      expand: 'Show items',
      collapse: 'Hide items',
      selectAll: 'Select all',
      clearSelection: 'Clear',
      summary: 'Selected {count} items · about {size}',
      generate: 'Build zip',
      generating: 'Packing…',
      selectionEmpty: 'Select at least one section or item',
      catalogEmpty: 'No exportable sections',
      exportDone: 'Archive created',
      download: 'Download zip',
      filePath: 'Saved to',
      warningsTitle: 'Notes ({count})',
      warningsMore: '{count} more not shown',
      credentialsNote: 'Backup only, never imported: credentials are sealed into sealed/credentials.bin (scrypt + AES-256-GCM) so the zip never carries plaintext, and the importer does not decrypt them — fill them in on the new machine.',
      passwordPlaceholder: 'Encryption password',
      passwordRequired: 'The credentials section is selected; enter an encryption password of at least 6 characters',
      importTitle: 'Import from an archive',
      importDesc: 'Inspect the archive and its conflicts first, then decide item by item.',
      dropHint: 'Drop a zip here, or click to choose a file',
      dropPick: 'Choose zip file',
      notZip: 'Choose a .zip file',
      inspecting: 'Inspecting archive…',
      manifestTitle: 'Archive summary',
      fieldFormat: 'Format',
      fieldCreatedAt: 'Created at',
      fieldSourceHome: 'Source machine',
      fieldProfile: 'Source profile',
      fieldDshVersion: 'DSH version',
      fieldItems: 'Items',
      fieldSecrets: 'Includes credentials',
      yes: 'Yes',
      no: 'No',
      pathWarnings: 'Path notes',
      colItem: 'Item',
      colStatus: 'Status',
      colLocal: 'Local',
      colIncoming: 'Archive',
      colChoice: 'Resolution',
      statusNew: 'New',
      statusSame: 'Same',
      statusConflict: 'Conflict',
      statusMissing: 'Missing locally',
      useBackup: 'Use archive',
      choiceAuto: 'Automatic',
      choiceSkip: 'Skip',
      effectiveWrite: '→ will write',
      effectiveSkip: '→ no write',
      batchAuto: 'Reset to automatic',
      batchUseBackup: 'Use archive for all',
      batchSkip: 'Skip all',
      writeCount: '{count} items will be written',
      truncatedBadge: 'Incomplete backup',
      truncatedHint: 'Truncated during export; the imported copy will be incomplete',
      overwriteLocal: 'Use archive = overwrite this local item entirely ({size})',
      createLocal: 'Use archive = create this item locally ({size})',
      secretsNotImported: 'Archive contains sealed credentials: backup only, never imported (no decryption).',
      redactedValue: '(redacted)',
      startImport: 'Start import',
      importing: 'Importing…',
      inspectEmpty: 'The archive has no importable items',
      resultTitle: 'Import finished',
      applied: 'Applied',
      skipped: 'Skipped',
      failed: 'Failed',
      failedTitle: 'Failure details',
      restartHint: 'Restart DSH so package.json and plugin assembly take effect.',
      snapshotCreated: 'Automatic snapshot: {id}',
      rollback: 'Roll back',
      rollbackConfirm: 'Roll back this import?',
      rollingBack: 'Rolling back…',
      rollbackDone: 'Restored {count} files',
      rollbackRemoved: ', removed {count} newly created files',
      rolledBackHint: 'A write failed, so the host rolled this import back automatically; local files are unchanged.',
      applyRemap: 'Apply this path remap',
      chooseAnother: 'Choose another archive',
      impactProfile: 'Replaces the local profile assembly files (package.json / cordis.patch.yml); takes effect after a restart',
      impactPlugins: 'Rewrites dependency specs from the archive; a restart and reinstall is required',
      impactLocalPlugins: 'Overwrites local plugin source directories with the same name',
      impactMarketplace: 'Overwrites the plugin marketplace address configuration',
      impactModels: 'Overwrites model provider configuration; apiKeys are redacted and must be filled in again',
      impactSkills: 'Overwrites skill directories with the same name',
      impactMcp: 'Overwrites MCP server definitions',
      impactAgentPresets: 'Overwrites agent preset configuration',
      impactSettings: 'Overwrites the remaining system configuration entries',
      impactInstructions: 'Overwrites the local global rules AGENTS.md',
      impactWorkspaces: 'Overwrites the workspace list (including known directories)',
      impactSessions: 'Overwrites session files with the same name',
      impactStorages: 'Replaces storages/*.json wholesale: local scheduled tasks (schedule.json) are replaced by the archive copy',
      impactPluginData: 'Overwrites plugin-private directories: e.g. replaced dsh-pocket pairing data can log the phone out',
      impactAttachments: 'Overwrites attachments with the same name',
      impactCredentials: 'Backup only, never imported (sealed entries are not decrypted)',
      snapshotsTitle: 'Local snapshots',
      snapshotsDesc: 'Files overwritten by an import are snapshotted first; restore any snapshot here.',
      snapshotsEmpty: 'No snapshots yet',
      snapshotFiles: 'Files',
      restore: 'Restore',
      restoreConfirm: 'Restore this snapshot? Current files will be overwritten.',
      restoreYes: 'Restore now',
      restoring: 'Restoring…',
      restoreDone: 'Restored {count} files',
      archiveMissing: 'The archive token is missing; inspect the zip again',
      unknownError: 'Unknown error',
    },
  }

  var localeApi = null

  function activeLocale() {
    try {
      var snapshot = localeApi && typeof localeApi.getSnapshot === 'function' ? localeApi.getSnapshot() : null
      if (snapshot && typeof snapshot.active === 'string' && snapshot.active !== '') return snapshot.active
    } catch (error) { /* locale service shape changed: fall through */ }
    var language = typeof navigator !== 'undefined' && navigator && navigator.language ? navigator.language : 'zh'
    return /^zh/i.test(language) ? 'zh' : 'en'
  }

  function translate(key, vars) {
    var table = DICTS[activeLocale()] || DICTS.zh
    var text = table[key]
    if (text === undefined) text = DICTS.zh[key] !== undefined ? DICTS.zh[key] : key
    if (!vars) return text
    return String(text).replace(/\{(\w+)\}/g, function (whole, name) {
      return vars[name] === undefined ? whole : String(vars[name])
    })
  }

  // A section may receive the host-bound t() when the registration declares locale.
  function makeT(props) {
    var bound = props && typeof props.t === 'function' ? props.t : null
    return function (key, vars) {
      if (bound) {
        try {
          var value = bound(key, vars)
          if (typeof value === 'string' && value !== '' && value !== key) return value
        } catch (error) { /* fall back to the bundled table */ }
      }
      return translate(key, vars)
    }
  }

  // --------------------------------------------------------------- HTTP ----
  var API = {
    overview: BASE + '/api/overview',
    catalog: BASE + '/api/catalog',
    export: BASE + '/api/export',
    snapshots: BASE + '/api/snapshots',
    inspect: BASE + '/api/import/inspect',
    apply: BASE + '/api/import/apply',
    rollback: BASE + '/api/import/rollback',
  }

  function httpError(code, message, status) {
    var error = new Error(message)
    error.code = code
    error.status = status
    return error
  }

  function readBody(response) {
    return response.text().then(function (text) {
      if (!text) return null
      try { return JSON.parse(text) } catch (error) { return null }
    })
  }

  // One transport for both JSON calls and the raw zip upload. Every non-2xx answer
  // becomes an Error carrying the host error code, so no screen can swallow a
  // failure (contract §6 网络失败要有可见错误条).
  function request(url, init) {
    var options = { cache: 'no-store', credentials: 'same-origin' }
    if (init) {
      if (init.method) options.method = init.method
      if (init.headers) options.headers = init.headers
      if (init.body !== undefined) options.body = init.body
    }
    return fetch(url, options).then(function (response) {
      return readBody(response).then(function (data) {
        if (response.ok) {
          if (data === null) throw httpError('bad-response', '返回内容不是 JSON', response.status)
          return data
        }
        var detail = data && data.error && typeof data.error === 'object' ? data.error : null
        var code = detail && typeof detail.code === 'string' ? detail.code : 'http-' + response.status
        var message = detail && typeof detail.message === 'string' ? detail.message : ''
        if (message === '' && response.status === 404) message = '接口不存在（HTTP 404）：该功能在当前插件版本里还没实现'
        if (message === '' && response.status === 501) message = '该功能尚未实现（HTTP 501）'
        if (message === '') message = 'HTTP ' + response.status
        throw httpError(code, message, response.status)
      })
    }).catch(function (error) {
      if (error && typeof error.code === 'string') throw error
      throw httpError('network-failed', '网络请求失败：' + String((error && error.message) || error), 0)
    })
  }

  function callJson(url, body) {
    if (body === undefined) return request(url, undefined)
    return request(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
  }

  function uploadZip(url, file) {
    return request(url, { method: 'POST', headers: { 'content-type': 'application/zip' }, body: file })
  }

  // ------------------------------------------------------------- format ----
  function formatBytes(bytes) {
    var value = Number(bytes) || 0
    if (value >= 1024 * 1024) return (value / 1024 / 1024).toFixed(2) + ' MB'
    if (value >= 1024) return (value / 1024).toFixed(1) + ' KB'
    return value + ' B'
  }

  function formatTime(value) {
    if (value === null || value === undefined || value === '') return '—'
    var date = new Date(value)
    if (isNaN(date.getTime())) return String(value)
    try { return date.toLocaleString() } catch (error) { return date.toISOString() }
  }

  function formatBytesOrDash(value) {
    return value === null || value === undefined ? '—' : formatBytes(value)
  }

  // pathWarnings entries are records ({ kind, message, from, to, dirs }) in the host
  // build and plain strings in older ones; render both without leaking "[object Object]".
  function warningText(warning) {
    if (typeof warning === 'string') return warning
    if (warning === null || typeof warning !== 'object') return String(warning)
    var text = String(warning.message || warning.code || '')
    if (typeof warning.from === 'string' && typeof warning.to === 'string') text += '（' + warning.from + ' → ' + warning.to + '）'
    if (Array.isArray(warning.dirs) && warning.dirs.length > 0) text += '：' + warning.dirs.slice(0, 5).join('、')
    return text
  }

  function remapRuleOf(warning) {
    if (warning === null || typeof warning !== 'object') return null
    if (typeof warning.from !== 'string' || warning.from === '') return null
    if (typeof warning.to !== 'string' || warning.to === '') return null
    return { from: warning.from, to: warning.to }
  }

  function remapKeyOf(warning) {
    return String(warning.from) + ' => ' + String(warning.to)
  }

  // The apply response may name the snapshot with a bare id or a { id } record.
  function snapshotIdOf(value) {
    if (typeof value === 'string') return value
    if (value && typeof value === 'object') return String(value.id || value.snapshot || '')
    return ''
  }

  // applied/skipped/failed/restored may be a count or a list depending on the host build.
  function countOf(value) {
    if (typeof value === 'number') return value
    if (Array.isArray(value)) return value.length
    if (value && typeof value === 'object') return Object.keys(value).length
    return 0
  }

  function listOf(value) {
    if (Array.isArray(value)) return value
    if (value && typeof value === 'object') {
      var rows = []
      for (var key in value) rows.push({ id: key, value: value[key] })
      return rows
    }
    return []
  }

  function failureTextOf(row) {
    if (row === null || row === undefined) return ''
    if (typeof row === 'string') return row
    var section = typeof row.section === 'string' && row.section !== '' ? row.section + ' / ' : ''
    var label = row.relPath || row.itemId || row.path || row.id || ''
    var reason = row.error || row.message || row.reason || ''
    if (typeof reason === 'object') reason = reason.message || JSON.stringify(reason)
    return section + (label ? String(label) + ' — ' : '') + String(reason || '')
  }

  // ------------------------------------------------------------- styles ----
  var S = {
    page: { display: 'flex', flexDirection: 'column', gap: '14px', maxWidth: '860px', color: 'var(--dsw-alias-label-primary)', fontSize: '13px', lineHeight: '20px' },
    header: { display: 'flex', flexDirection: 'column', gap: '2px' },
    title: { margin: 0, fontSize: '15px', fontWeight: 600, lineHeight: '22px' },
    muted: { color: 'var(--dsw-alias-label-tertiary)', fontSize: '12px', lineHeight: '18px' },
    row: { display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' },
    rowBetween: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px', flexWrap: 'wrap' },
    grow: { flex: '1 1 auto', minWidth: 0 },
    tabs: { display: 'inline-flex', alignItems: 'center', gap: '2px', padding: '3px', borderRadius: '999px', background: 'var(--dsw-alias-bg-layer-2)', border: '0.5px solid var(--dsw-alias-border-l2)', alignSelf: 'flex-start' },
    card: { boxSizing: 'border-box', display: 'flex', flexDirection: 'column', gap: '8px', padding: '12px 14px', border: '0.5px solid var(--dsw-alias-border-l2)', borderRadius: 'var(--dsw-radius-lg)', background: 'var(--dsw-alias-bg-layer-1)' },
    mono: { fontFamily: "ui-monospace, 'Cascadia Mono', Consolas, monospace", fontSize: '12px', lineHeight: '18px', overflowWrap: 'anywhere' },
    bar: { position: 'sticky', bottom: 0, zIndex: 5, display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '10px', padding: '10px 0 8px', borderTop: '0.5px solid var(--dsw-alias-border-l2)', background: 'var(--dsw-alias-bg-base)' },
    errorBar: { display: 'flex', alignItems: 'flex-start', gap: '8px', padding: '8px 10px', border: '0.5px solid var(--dsw-alias-state-error-primary)', borderRadius: 'var(--dsw-radius-md)', background: 'var(--dsw-alias-bg-layer-1)', color: 'var(--dsw-alias-state-error-primary)', fontSize: '12px', lineHeight: '18px' },
    notice: { display: 'flex', alignItems: 'flex-start', gap: '8px', padding: '8px 10px', borderRadius: 'var(--dsw-radius-md)', background: 'var(--dsw-alias-bg-layer-2)', color: 'var(--dsw-alias-label-secondary)', fontSize: '12px', lineHeight: '18px' },
    chip: { display: 'inline-flex', alignItems: 'center', maxWidth: '100%', padding: '2px 8px', borderRadius: '999px', background: 'var(--dsw-alias-bg-layer-2)', color: 'var(--dsw-alias-label-secondary)', fontFamily: "ui-monospace, 'Cascadia Mono', Consolas, monospace", fontSize: '11px', lineHeight: '16px', overflowWrap: 'anywhere' },
    itemRow: { display: 'flex', alignItems: 'flex-start', gap: '8px', padding: '6px 8px', borderRadius: 'var(--dsw-radius-sm)', fontSize: '12px' },
    num: { textAlign: 'right', whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' },
    kvKey: { color: 'var(--dsw-alias-label-tertiary)', fontSize: '12px', minWidth: '96px' },
    kvVal: { fontSize: '12px', overflowWrap: 'anywhere' },
  }

  // Hover/disabled states need real CSS. Class names are namespaced (dcm-) because the
  // <style> element lives in the shared document, not in a shadow root.
  var CSS = [
    '.dcm-btn { box-sizing:border-box; display:inline-flex; align-items:center; justify-content:center; gap:4px; height:36px; padding:0 16px; border:0; border-radius:999px; cursor:pointer; font:inherit; font-size:13px; font-weight:500; line-height:20px; white-space:nowrap; text-decoration:none; background:var(--dsw-alias-button-primary-fill); color:var(--dsw-alias-label-primary-foreground); }',
    '.dcm-btn:hover:not(:disabled) { background:var(--dsw-alias-button-primary-hover); }',
    '.dcm-btn:disabled { cursor:not-allowed; opacity:.4; }',
    '.dcm-btn[data-variant="secondary"] { background:var(--dsw-alias-bg-layer-1); color:var(--dsw-alias-label-primary); border:0.5px solid var(--dsw-alias-border-l2); }',
    '.dcm-btn[data-variant="secondary"]:hover:not(:disabled) { background:var(--dsw-alias-interactive-bg-hover); }',
    '.dcm-btn[data-variant="ghost"] { height:26px; padding:0 8px; font-size:12px; font-weight:400; background:transparent; color:var(--dsw-alias-label-secondary); }',
    '.dcm-btn[data-variant="ghost"]:hover:not(:disabled) { background:var(--dsw-alias-interactive-bg-hover); color:var(--dsw-alias-label-primary); }',
    '.dcm-btn[data-variant="danger"] { background:var(--dsw-alias-bg-layer-1); color:var(--dsw-alias-state-error-primary); border:0.5px solid var(--dsw-alias-border-l2); }',
    '.dcm-btn[data-variant="danger"]:hover:not(:disabled) { background:var(--dsw-alias-interactive-bg-hover); }',
    '.dcm-tab { box-sizing:border-box; height:28px; padding:0 14px; border:0; border-radius:999px; background:transparent; color:var(--dsw-alias-label-secondary); font:inherit; font-size:13px; cursor:pointer; }',
    '.dcm-tab:hover { color:var(--dsw-alias-label-primary); }',
    '.dcm-tab[data-active="true"] { background:var(--dsw-alias-bg-layer-1); color:var(--dsw-alias-label-primary); font-weight:500; }',
    '.dcm-item:hover { background:var(--dsw-alias-interactive-bg-hover); }',
    '.dcm-input { box-sizing:border-box; height:30px; padding:0 10px; border:0.5px solid var(--dsw-alias-border-l3); border-radius:var(--dsw-radius-md); background:transparent; color:inherit; font:inherit; font-size:12px; outline:none; }',
    '.dcm-input:focus { border-color:var(--dsw-alias-brand-primary); }',
    '.dcm-drop { box-sizing:border-box; display:flex; flex-direction:column; align-items:center; justify-content:center; gap:6px; min-height:112px; padding:20px 16px; border:1px dashed var(--dsw-alias-border-l3); border-radius:var(--dsw-radius-lg); background:var(--dsw-alias-bg-layer-1); color:var(--dsw-alias-label-tertiary); font-size:12px; text-align:center; cursor:pointer; }',
    '.dcm-drop:hover { border-color:var(--dsw-alias-border-l1); }',
    '.dcm-drop[data-over="true"] { border-color:var(--dsw-alias-brand-primary); background:var(--dsw-alias-interactive-bg-hover); color:var(--dsw-alias-label-primary); }',
    '.dcm-table { width:100%; border-collapse:collapse; font-size:12px; }',
    '.dcm-table th { text-align:left; font-weight:500; color:var(--dsw-alias-label-tertiary); padding:6px 8px; border-bottom:0.5px solid var(--dsw-alias-border-l2); white-space:nowrap; }',
    '.dcm-table td { padding:6px 8px; border-bottom:0.5px solid var(--dsw-alias-border-l2); vertical-align:top; }',
    '.dcm-table tr[data-group="true"] td { background:var(--dsw-alias-bg-layer-2); color:var(--dsw-alias-label-secondary); font-weight:500; }',
    '.dcm-scroll { overflow-x:auto; }',
  ].join('\n')

  // --------------------------------------------------------- primitives ----
  function Toggle(props) {
    var on = props.checked === true
    var disabled = props.disabled === true
    return h('button', {
      type: 'button',
      role: 'switch',
      'aria-checked': on ? 'true' : 'false',
      'aria-label': props.label === undefined ? undefined : String(props.label),
      disabled: disabled,
      onClick: props.onChange,
      style: {
        boxSizing: 'border-box',
        flex: 'none',
        width: '36px',
        height: '20px',
        padding: '2px',
        border: 0,
        borderRadius: '999px',
        position: 'relative',
        cursor: disabled ? 'not-allowed' : 'pointer',
        font: 'inherit',
        background: on ? 'var(--dsw-alias-button-primary-fill)' : 'var(--dsw-alias-border-l3)',
        opacity: disabled ? 0.4 : 1,
        transition: 'background 120ms ease',
      },
    }, h('span', {
      style: {
        display: 'block',
        width: '16px',
        height: '16px',
        borderRadius: '50%',
        background: on ? 'var(--dsw-alias-label-primary-foreground)' : 'var(--dsw-alias-label-tertiary)',
        transition: 'transform 120ms ease',
        transform: on ? 'translateX(16px)' : 'translateX(0)',
      },
    }))
  }

  function Button(props) {
    return h('button', {
      type: 'button',
      className: 'dcm-btn',
      'data-variant': props.variant || 'primary',
      disabled: props.disabled === true,
      onClick: props.onClick,
      title: props.title,
    }, props.children)
  }

  function Badge(props) {
    var tone = props.tone || 'muted'
    var color = tone === 'ok'
      ? 'var(--dsw-alias-state-success-primary)'
      : tone === 'warn'
        ? 'var(--dsw-alias-state-warn-primary)'
        : tone === 'error'
          ? 'var(--dsw-alias-state-error-primary)'
          : tone === 'info'
            ? 'var(--dsw-alias-state-business-primary)'
            : 'var(--dsw-alias-label-tertiary)'
    var strong = props.strong === true
    return h('span', {
      style: {
        display: 'inline-flex',
        alignItems: 'center',
        height: '18px',
        padding: '0 7px',
        borderRadius: '999px',
        background: strong ? 'var(--dsw-alias-bg-layer-1)' : 'var(--dsw-alias-bg-layer-2)',
        border: strong ? '0.5px solid currentColor' : '0.5px solid transparent',
        color: color,
        fontSize: '11px',
        lineHeight: '18px',
        whiteSpace: 'nowrap',
      },
    }, props.children)
  }

  function ErrorBar(props) {
    var error = props.error
    if (!error) return null
    var text = props.t('errorTitle') + '：' + (error.code ? '[' + error.code + '] ' : '') + String(error.message || props.t('unknownError'))
    return h('div', { role: 'alert', style: S.errorBar },
      h('span', { style: { flex: '1 1 auto', minWidth: 0, overflowWrap: 'anywhere' } }, text),
      props.onDismiss
        ? h(Button, { variant: 'ghost', onClick: props.onDismiss }, props.t('close'))
        : null)
  }

  function Notice(props) {
    return h('div', { style: S.notice }, h('span', { style: { flex: '1 1 auto', minWidth: 0 } }, props.children))
  }

  function KeyValue(props) {
    return h('div', { style: { display: 'flex', gap: '10px', alignItems: 'flex-start' } },
      h('span', { style: S.kvKey }, props.label),
      h('span', { style: S.kvVal }, props.value))
  }

  function Loading(props) {
    return h('div', { style: S.muted }, props.t('loading'))
  }

  function statusTone(status) {
    if (status === 'new') return 'ok'
    if (status === 'conflict') return 'warn'
    if (status === 'missing') return 'error'
    return 'muted'
  }

  function statusLabel(t, status) {
    if (status === 'new') return t('statusNew')
    if (status === 'conflict') return t('statusConflict')
    if (status === 'missing') return t('statusMissing')
    if (status === 'same') return t('statusSame')
    return String(status || '—')
  }

  // ----------------------------------------------------------- export tab ----
  function newSelection(sections) {
    var selection = {}
    for (var index = 0; index < sections.length; index += 1) {
      var section = sections[index]
      var items = Array.isArray(section.items) ? section.items : []
      // Credentials stay off by default (contract §5.2).
      var on = section.defaultSelected !== false && items.length > 0 && section.id !== 'credentials'
      selection[section.id] = { on: on, all: true, ids: {}, open: false }
    }
    return selection
  }

  function selectionCount(section, state) {
    var items = Array.isArray(section.items) ? section.items : []
    if (!state || state.on !== true) return 0
    if (state.all === true) return items.length
    var count = 0
    for (var index = 0; index < items.length; index += 1) if (state.ids[items[index].id] === true) count += 1
    return count
  }

  // Cards and item rows are components (not inline closures in a for loop) so each
  // handler closes over its own section/item instead of the loop's last value.
  function ItemRow(props) {
    var t = props.t
    var item = props.item
    return h('label', { className: 'dcm-item', style: S.itemRow },
      h('input', {
        type: 'checkbox',
        checked: props.checked === true,
        disabled: props.busy === true,
        style: { marginTop: '3px', accentColor: 'var(--dsw-alias-brand-primary)' },
        onChange: props.onToggle,
      }),
      h('span', { className: 'dcm-item-label', style: { flex: '1 1 auto', minWidth: 0, overflowWrap: 'anywhere' } },
        h('div', null, item.label || item.relPath || item.id),
        h('div', { style: S.mono }, item.relPath || '')),
      isTruncated(item) ? h(Badge, { tone: 'error', strong: true }, t('truncatedBadge')) : null,
      h('span', { style: Object.assign({}, S.muted, { whiteSpace: 'nowrap' }) }, formatBytes(item.bytes)))
  }

  function SectionCard(props) {
    var t = props.t
    var section = props.section
    var state = props.state
    var busy = props.busy === true
    var items = Array.isArray(section.items) ? section.items : []
    var card = []
    card.push(h('div', { key: 'head', style: S.rowBetween },
      h('div', { style: Object.assign({}, S.row, { flex: '1 1 260px', minWidth: 0, flexWrap: 'nowrap' }) },
        h(Toggle, { checked: state.on === true, onChange: props.onToggleSection, disabled: busy, label: section.title }),
        h('div', { style: S.grow },
          h('div', { style: { fontSize: '13px', fontWeight: 500 } }, section.title || section.id),
          h('div', { style: S.muted }, section.desc || ''))),
      h('div', { style: S.row },
        h('span', { style: S.muted }, t('itemsCount', { count: items.length }) + ' · ' + formatBytes(section.totalBytes || 0)),
        items.length > 0
          ? h(Button, { variant: 'ghost', onClick: props.onToggleOpen, disabled: busy }, state.open === true ? t('collapse') : t('expand'))
          : null)))
    if (section.error) {
      card.push(h('div', { key: 'section-error', style: { color: 'var(--dsw-alias-state-error-primary)', fontSize: '12px' } }, t('scanFailed', { error: section.error })))
    }
    if (items.length === 0) card.push(h('div', { key: 'no-items', style: S.muted }, t('sectionEmpty')))
    if (state.open === true && items.length > 0) {
      card.push(h('div', { key: 'items', style: { display: 'flex', flexDirection: 'column', gap: '2px' } },
        h('div', { style: Object.assign({}, S.row, { justifyContent: 'flex-end', gap: '4px' }) },
          h(Button, { variant: 'ghost', onClick: function () { props.onAll(true) }, disabled: busy }, t('selectAll')),
          h(Button, { variant: 'ghost', onClick: function () { props.onAll(false) }, disabled: busy }, t('clearSelection'))),
        items.map(function (item) {
          return h(ItemRow, {
            key: item.id,
            t: t,
            item: item,
            checked: state.all === true || state.ids[item.id] === true,
            busy: busy,
            onToggle: function () { props.onToggleItem(item) },
          })
        })))
    }
    if (section.id === 'credentials' && state.on === true) {
      card.push(h('div', { key: 'credentials', style: S.muted }, t('credentialsNote')))
    }
    return h('div', { className: 'dcm-card', style: S.card, 'data-off': state.on === true ? 'false' : 'true' }, card)
  }

  function ExportPage(props) {
    var t = props.t
    var catalog = useState({ status: 'loading', sections: [], error: null })
    var load = catalog[0]
    var setLoad = catalog[1]
    var pickedState = useState({})
    var picked = pickedState[0]
    var setPicked = pickedState[1]
    var busyState = useState(false)
    var busy = busyState[0]
    var setBusy = busyState[1]
    var errorState = useState(null)
    var error = errorState[0]
    var setError = errorState[1]
    var resultState = useState(null)
    var result = resultState[0]
    var setResult = resultState[1]
    var passwordState = useState('')
    var password = passwordState[0]
    var setPassword = passwordState[1]

    var reload = useCallback(function () {
      setLoad({ status: 'loading', sections: [], error: null })
      callJson(API.catalog).then(function (data) {
        var sections = Array.isArray(data && data.sections) ? data.sections : []
        setPicked(newSelection(sections))
        setLoad({ status: 'ready', sections: sections, error: null })
      }).catch(function (failure) {
        setLoad({ status: 'error', sections: [], error: { code: failure.code, message: failure.message } })
      })
    }, [])

    useEffect(function () { reload() }, [reload])

    function patchSection(sectionId, patch) {
      setPicked(function (previous) {
        var current = previous[sectionId] || { on: false, all: true, ids: {}, open: false }
        var next = {}
        for (var key in previous) next[key] = previous[key]
        next[sectionId] = Object.assign({}, current, patch)
        return next
      })
    }

    function toggleSection(section) {
      var state = picked[section.id] || { on: false }
      patchSection(section.id, { on: state.on !== true })
    }

    function toggleOpen(sectionId) {
      var state = picked[sectionId] || { open: false }
      patchSection(sectionId, { open: !state.open })
    }

    function toggleItem(section, item) {
      setPicked(function (previous) {
        var state = previous[section.id]
        if (!state) return previous
        var items = Array.isArray(section.items) ? section.items : []
        var ids = {}
        var index
        if (state.all === true) {
          for (index = 0; index < items.length; index += 1) ids[items[index].id] = true
        } else {
          for (var key in state.ids) if (state.ids[key] === true) ids[key] = true
        }
        if (ids[item.id] === true) delete ids[item.id]
        else ids[item.id] = true
        var count = Object.keys(ids).length
        var all = count === items.length
        var next = {}
        for (var other in previous) next[other] = previous[other]
        next[section.id] = Object.assign({}, state, { all: all, ids: all ? {} : ids, on: count > 0 })
        return next
      })
    }

    function setSectionAll(section, all) {
      patchSection(section.id, { all: true, ids: {}, on: all === true })
    }

    var summary = useMemo(function () {
      var sections = Array.isArray(load.sections) ? load.sections : []
      var count = 0
      var bytes = 0
      var items = {}
      for (var index = 0; index < sections.length; index += 1) {
        var section = sections[index]
        var state = picked[section.id]
        if (!state || state.on !== true) {
          items[section.id] = []
          continue
        }
        var list = Array.isArray(section.items) ? section.items : []
        if (state.all === true) {
          items[section.id] = null
          count += list.length
          for (var inner = 0; inner < list.length; inner += 1) bytes += Number(list[inner].bytes) || 0
        } else {
          var chosen = []
          for (var cursor = 0; cursor < list.length; cursor += 1) {
            if (state.ids[list[cursor].id] === true) {
              chosen.push(list[cursor].id)
              count += 1
              bytes += Number(list[cursor].bytes) || 0
            }
          }
          items[section.id] = chosen
        }
      }
      return { count: count, bytes: bytes, items: items }
    }, [load.sections, picked])

    var credentialsSelected = useMemo(function () {
      var sections = Array.isArray(load.sections) ? load.sections : []
      for (var index = 0; index < sections.length; index += 1) {
        var section = sections[index]
        if (section.id !== 'credentials') continue
        if (selectionCount(section, picked[section.id]) > 0) return true
      }
      return false
    }, [load.sections, picked])

    function generate() {
      if (busy) return
      if (summary.count === 0) {
        setError({ code: 'empty-selection', message: t('selectionEmpty') })
        return
      }
      if (credentialsSelected && String(password).trim().length < 6) {
        setError({ code: 'password-required', message: t('passwordRequired') })
        return
      }
      var sections = Array.isArray(load.sections) ? load.sections : []
      var body = { sections: {}, items: summary.items }
      for (var index = 0; index < sections.length; index += 1) {
        var state = picked[sections[index].id]
        body.sections[sections[index].id] = state ? state.on === true : false
      }
      if (credentialsSelected) {
        body.includeSecrets = true
        body.password = password
      }
      setBusy(true)
      setError(null)
      setResult(null)
      callJson(API.export, body).then(function (data) {
        setBusy(false)
        setResult(data)
      }).catch(function (failure) {
        setBusy(false)
        setError({ code: failure.code, message: failure.message })
      })
    }

    var children = []
    children.push(h('div', { key: 'title', style: S.header },
      h('h3', { style: S.title }, t('catalogTitle')),
      h('div', { style: S.muted }, t('catalogDesc'))))
    children.push(h(ErrorBar, { key: 'error', error: error, t: t, onDismiss: function () { setError(null) } }))

    if (load.status === 'loading') children.push(h(Loading, { key: 'loading', t: t }))
    if (load.status === 'error') {
      children.push(h(ErrorBar, { key: 'load-error', error: load.error, t: t }))
      children.push(h('div', { key: 'retry' }, h(Button, { variant: 'secondary', onClick: reload }, t('retry'))))
    }
    if (load.status === 'ready' && load.sections.length === 0) {
      children.push(h('div', { key: 'empty', style: S.muted }, t('catalogEmpty')))
    }

    if (load.status === 'ready') {
      children.push(h('div', { key: 'cards', style: { display: 'flex', flexDirection: 'column', gap: '10px' } },
        load.sections.map(function (section) {
          return h(SectionCard, {
            key: section.id,
            t: t,
            section: section,
            state: picked[section.id] || { on: false, all: true, ids: {}, open: false },
            busy: busy,
            onToggleSection: function () { toggleSection(section) },
            onToggleOpen: function () { toggleOpen(section.id) },
            onToggleItem: function (item) { toggleItem(section, item) },
            onAll: function (all) { setSectionAll(section, all) },
          })
        })))
    }

    if (result) {
      var warnings = Array.isArray(result.warnings) ? result.warnings : []
      var resultCard = [
        h('div', { key: 'head', style: S.rowBetween },
          h('div', { style: { fontSize: '13px', fontWeight: 500 } }, t('exportDone')),
          h('a', {
            className: 'dcm-btn',
            href: result.downloadUrl,
            download: result.name || '',
          }, t('download'))),
        h('div', { key: 'name', style: S.mono }, String(result.name || result.file || '')),
        h('div', { key: 'size', style: S.muted }, formatBytes(result.size)),
        result.file ? h('div', { key: 'path', style: S.muted }, t('filePath') + '：' + result.file) : null,
      ]
      if (warnings.length > 0) {
        var shown = warnings.slice(0, 20).map(function (warning, index) {
          return h('div', { key: 'warning-' + index, style: S.muted }, '· ' + String(warning))
        })
        if (warnings.length > 20) shown.push(h('div', { key: 'more', style: S.muted }, t('warningsMore', { count: warnings.length - 20 })))
        resultCard.push(h('div', { key: 'warnings', style: { display: 'flex', flexDirection: 'column', gap: '1px', marginTop: '2px' } },
          h('div', { style: { fontSize: '12px', fontWeight: 500 } }, t('warningsTitle', { count: warnings.length })),
          shown))
      }
      children.push(h('div', { key: 'result', className: 'dcm-card', style: S.card }, resultCard))
    }

    children.push(h('div', { key: 'bar', style: S.bar },
      h('div', { style: Object.assign({}, S.row, { flex: '1 1 auto' }) },
        h('span', { style: { fontSize: '13px' } }, t('summary', { count: summary.count, size: formatBytes(summary.bytes) })),
        credentialsSelected
          ? h('input', {
            className: 'dcm-input',
            type: 'password',
            value: password,
            placeholder: t('passwordPlaceholder'),
            style: { width: '170px' },
            onChange: function (event) { setPassword(event.target.value) },
          })
          : null),
      h(Button, { onClick: generate, disabled: busy || summary.count === 0 }, busy ? t('generating') : t('generate'))))

    return h('div', { style: { display: 'flex', flexDirection: 'column', gap: '12px' } }, children)
  }

  // ----------------------------------------------------------- import tab ----
  // Review M4: a section row states what "用备份" really costs. Keyed by section id so
  // the copy follows the host's section registry without a second source of truth.
  var IMPACT_KEYS = {
    profile: 'impactProfile',
    plugins: 'impactPlugins',
    localPlugins: 'impactLocalPlugins',
    marketplace: 'impactMarketplace',
    models: 'impactModels',
    skills: 'impactSkills',
    mcp: 'impactMcp',
    agentPresets: 'impactAgentPresets',
    settings: 'impactSettings',
    instructions: 'impactInstructions',
    workspaces: 'impactWorkspaces',
    sessions: 'impactSessions',
    storages: 'impactStorages',
    pluginData: 'impactPluginData',
    attachments: 'impactAttachments',
    credentials: 'impactCredentials',
  }

  function impactOf(t, sectionId) {
    var key = IMPACT_KEYS[sectionId]
    return key === undefined ? '' : t(key)
  }

  // Review L5: never reconstruct a masked path; show a neutral marker instead.
  function maskedText(value, t) {
    if (value === null || value === undefined) return '—'
    var text = String(value)
    if (text === '') return '—'
    if (/__REDACTED__|<redacted>|\[redacted\]/i.test(text)) return t('redactedValue')
    if (/^\*+$/.test(text)) return t('redactedValue')
    return text
  }

  // Review H6: the exporter flags truncated items; they must not look like healthy rows.
  function isTruncated(item) {
    if (item === null || typeof item !== 'object') return false
    if (item.truncated === true) return true
    if (item.incomplete === true) return true
    if (item.meta !== null && typeof item.meta === 'object' && item.meta.truncated === true) return true
    return false
  }

  // "auto" keeps the host default (new → use-backup, everything else → keep-local).
  function actionOf(status, choice) {
    if (choice === 'use-backup' || choice === 'skip') return choice
    return status === 'new' ? 'use-backup' : 'keep-local'
  }

  function choiceValue(choices, sectionId, itemId) {
    var sectionChoices = choices ? choices[sectionId] : null
    var value = sectionChoices ? sectionChoices[itemId] : undefined
    return value === 'use-backup' || value === 'skip' ? value : 'auto'
  }

  function inspectRows(inspected) {
    var rows = []
    var sections = inspected && Array.isArray(inspected.sections) ? inspected.sections : []
    for (var outer = 0; outer < sections.length; outer += 1) {
      var items = Array.isArray(sections[outer].items) ? sections[outer].items : []
      for (var inner = 0; inner < items.length; inner += 1) {
        rows.push({ sectionId: sections[outer].id, itemId: items[inner].itemId, status: items[inner].status })
      }
    }
    return rows
  }

  function relPathIndex(manifest) {
    var index = {}
    var sections = manifest && Array.isArray(manifest.sections) ? manifest.sections : []
    for (var outer = 0; outer < sections.length; outer += 1) {
      var section = sections[outer]
      var rows = Array.isArray(section.items) ? section.items : []
      var map = {}
      for (var inner = 0; inner < rows.length; inner += 1) {
        if (rows[inner] && typeof rows[inner].id === 'string') map[rows[inner].id] = rows[inner].relPath || ''
      }
      index[section.id] = map
    }
    return index
  }

  function ImportPage(props) {
    var t = props.t
    var inspectState = useState(null)
    var inspected = inspectState[0]
    var setInspected = inspectState[1]
    var fileState = useState(null)
    var fileInfo = fileState[0]
    var setFileInfo = fileState[1]
    var choiceState = useState({})
    var choices = choiceState[0]
    var setChoices = choiceState[1]
    var busyState = useState(false)
    var busy = busyState[0]
    var setBusy = busyState[1]
    var errorState = useState(null)
    var error = errorState[0]
    var setError = errorState[1]
    var resultState = useState(null)
    var result = resultState[0]
    var setResult = resultState[1]
    var rollbackState = useState({ status: 'idle', count: 0, removed: 0, error: null })
    var rollback = rollbackState[0]
    var setRollback = rollbackState[1]
    var confirmState = useState(false)
    var confirmRollback = confirmState[0]
    var setConfirmRollback = confirmState[1]
    var overState = useState(false)
    var dragOver = overState[0]
    var setDragOver = overState[1]
    var remapState = useState({})
    var remapPicked = remapState[0]
    var setRemapPicked = remapState[1]
    var inputRef = useRef(null)

    var remapRules = useMemo(function () {
      var warnings = inspected && Array.isArray(inspected.pathWarnings) ? inspected.pathWarnings : []
      var rules = []
      for (var index = 0; index < warnings.length; index += 1) {
        var rule = remapRuleOf(warnings[index])
        if (rule === null || remapPicked[remapKeyOf(warnings[index])] !== true) continue
        rules.push(rule)
      }
      return rules
    }, [inspected, remapPicked])

    // What the import will actually do, so the button row can say "writes N items".
    var plan = useMemo(function () {
      var rows = inspectRows(inspected)
      var write = 0
      var skip = 0
      for (var index = 0; index < rows.length; index += 1) {
        var action = actionOf(rows[index].status, choiceValue(choices, rows[index].sectionId, rows[index].itemId))
        if (action === 'use-backup') write += 1
        else skip += 1
      }
      return { write: write, skip: skip, total: rows.length }
    }, [inspected, choices])

    function resetForNewFile() {
      setInspected(null)
      setChoices({})
      setRemapPicked({})
      setResult(null)
      setRollback({ status: 'idle', count: 0, removed: 0, error: null })
      setConfirmRollback(false)
    }

    function toggleRemap(key) {
      setRemapPicked(function (previous) {
        var next = {}
        for (var other in previous) next[other] = previous[other]
        if (next[key] === true) delete next[key]
        else next[key] = true
        return next
      })
    }

    function inspectFile(file) {
      if (!file) return
      if (!/\.zip$/i.test(String(file.name || ''))) {
        setError({ code: 'bad-file', message: t('notZip') })
        return
      }
      resetForNewFile()
      setError(null)
      setBusy(true)
      setFileInfo({ name: file.name, size: file.size })
      uploadZip(API.inspect, file).then(function (data) {
        setBusy(false)
        setInspected(data)
        setChoices({})
      }).catch(function (failure) {
        setBusy(false)
        setFileInfo(null)
        setError({ code: failure.code, message: failure.message })
      })
    }

    function setChoice(sectionId, itemId, value) {
      setChoices(function (previous) {
        var next = {}
        for (var key in previous) next[key] = previous[key]
        var sectionChoices = {}
        for (var other in previous[sectionId] || {}) sectionChoices[other] = previous[sectionId][other]
        if (value === 'auto') delete sectionChoices[itemId]
        else sectionChoices[itemId] = value
        next[sectionId] = sectionChoices
        return next
      })
    }

    // One batch switch for every row (review M3): auto / use-backup / skip.
    function setAllChoices(value) {
      if (value === 'auto') { setChoices({}); return }
      var rows = inspectRows(inspected)
      var next = {}
      for (var index = 0; index < rows.length; index += 1) {
        // "use-backup" on an item whose section does not exist here would only fail.
        if (value === 'use-backup' && rows[index].status === 'missing') continue
        if (!next[rows[index].sectionId]) next[rows[index].sectionId] = {}
        next[rows[index].sectionId][rows[index].itemId] = value
      }
      setChoices(next)
    }

    function choiceOf(sectionId, itemId) {
      return choiceValue(choices, sectionId, itemId)
    }

    function startImport() {
      if (busy) return
      if (!inspected || !inspected.archive) {
        setError({ code: 'archive-missing', message: t('archiveMissing') })
        return
      }
      setBusy(true)
      setError(null)
      setResult(null)
      setRollback({ status: 'idle', count: 0, removed: 0, error: null })
      setConfirmRollback(false)
      var body = {
        archive: inspected.archive,
        choices: choices,
        remap: remapRules,
      }
      callJson(API.apply, body).then(function (data) {
        setBusy(false)
        setResult(data)
      }).catch(function (failure) {
        setBusy(false)
        setError({ code: failure.code, message: failure.message })
      })
    }

    var rollbackTarget = result ? snapshotIdOf(result.snapshot) : ''

    function runRollback() {
      if (busy) return
      if (rollbackTarget === '') {
        setError({ code: 'no-snapshot', message: t('unknownError') })
        return
      }
      if (confirmRollback !== true) {
        setConfirmRollback(true)
        return
      }
      setBusy(true)
      setRollback({ status: 'running', count: 0, removed: 0, error: null })
      callJson(API.rollback, { snapshot: rollbackTarget }).then(function (data) {
        setBusy(false)
        setConfirmRollback(false)
        setRollback({ status: 'done', count: countOf(data && data.restored), removed: countOf(data && data.removed), error: null })
      }).catch(function (failure) {
        setBusy(false)
        setConfirmRollback(false)
        setRollback({ status: 'error', count: 0, removed: 0, error: { code: failure.code, message: failure.message } })
      })
    }

    var children = []
    children.push(h('div', { key: 'title', style: S.header },
      h('h3', { style: S.title }, t('importTitle')),
      h('div', { style: S.muted }, t('importDesc'))))
    children.push(h(ErrorBar, { key: 'error', error: error, t: t, onDismiss: function () { setError(null) } }))

    if (!inspected) {
      children.push(h('div', {
        key: 'drop',
        className: 'dcm-drop',
        'data-over': dragOver === true ? 'true' : 'false',
        role: 'button',
        tabIndex: 0,
        onClick: function () { if (!busy && inputRef.current) inputRef.current.click() },
        onKeyDown: function (event) {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault()
            if (!busy && inputRef.current) inputRef.current.click()
          }
        },
        onDragOver: function (event) { event.preventDefault(); setDragOver(true) },
        onDragLeave: function () { setDragOver(false) },
        onDrop: function (event) {
          event.preventDefault()
          setDragOver(false)
          var files = event.dataTransfer && event.dataTransfer.files ? event.dataTransfer.files : null
          if (files && files.length > 0) inspectFile(files[0])
        },
      },
        h('div', { style: { fontSize: '13px', color: 'var(--dsw-alias-label-secondary)' } }, busy ? t('inspecting') : t('dropHint')),
        h(Button, {
          variant: 'secondary',
          disabled: busy,
          onClick: function (event) { event.stopPropagation(); if (inputRef.current) inputRef.current.click() },
        }, t('dropPick')),
        fileInfo ? h('div', { style: S.mono }, String(fileInfo.name) + ' · ' + formatBytes(fileInfo.size)) : null,
        h('input', {
          ref: inputRef,
          type: 'file',
          accept: '.zip,application/zip',
          style: { display: 'none' },
          onChange: function (event) {
            var files = event.target.files
            var file = files && files.length > 0 ? files[0] : null
            if (inputRef.current) inputRef.current.value = ''
            if (file) inspectFile(file)
          },
        })))
    }

    if (inspected) {
      var manifest = inspected.manifest || {}
      var manifestSections = Array.isArray(manifest.sections) ? manifest.sections : []
      var totalItems = 0
      for (var index = 0; index < manifestSections.length; index += 1) {
        var listed = manifestSections[index].items
        totalItems += typeof listed === 'number' ? listed : (Array.isArray(listed) ? listed.length : 0)
      }
      var statusCounts = { new: 0, same: 0, conflict: 0, missing: 0 }
      var allSections = Array.isArray(inspected.sections) ? inspected.sections : []
      for (var outer = 0; outer < allSections.length; outer += 1) {
        var rows = Array.isArray(allSections[outer].items) ? allSections[outer].items : []
        for (var inner = 0; inner < rows.length; inner += 1) {
          var status = rows[inner].status
          if (statusCounts[status] !== undefined) statusCounts[status] += 1
        }
      }
      var relIndex = relPathIndex(manifest)

      var summaryCard = [
        h('div', { key: 'head', style: { fontSize: '13px', fontWeight: 500 } }, t('manifestTitle')),
        h('div', { key: 'kv', style: { display: 'flex', flexDirection: 'column', gap: '3px' } },
          h(KeyValue, { label: t('fieldFormat'), value: maskedText(manifest.format, t) }),
          h(KeyValue, { label: t('fieldCreatedAt'), value: formatTime(manifest.createdAt) }),
          h(KeyValue, { label: t('fieldSourceHome'), value: maskedText(manifest.sourceHome, t) }),
          h(KeyValue, { label: t('fieldProfile'), value: maskedText(manifest.profile, t) }),
          h(KeyValue, { label: t('fieldDshVersion'), value: maskedText(manifest.dshVersion, t) }),
          h(KeyValue, { label: t('fieldItems'), value: String(totalItems) }),
          h(KeyValue, { label: t('fieldSecrets'), value: manifest.secretsIncluded === true ? t('yes') : t('no') })),
        h('div', { key: 'counts', style: Object.assign({}, S.row, { gap: '6px', marginTop: '2px' }) },
          h(Badge, { tone: 'ok' }, t('statusNew') + ' ' + statusCounts.new),
          h(Badge, { tone: 'muted' }, t('statusSame') + ' ' + statusCounts.same),
          h(Badge, { tone: 'warn' }, t('statusConflict') + ' ' + statusCounts.conflict),
          h(Badge, { tone: 'error' }, t('statusMissing') + ' ' + statusCounts.missing)),
      ]
      // Review M8: sealed credentials are backup-only, say so on the import screen too.
      if (manifest.secretsIncluded === true) {
        summaryCard.push(h('div', { key: 'secrets', style: { color: 'var(--dsw-alias-state-warn-primary)', fontSize: '12px', lineHeight: '18px' } }, t('secretsNotImported')))
      }
      children.push(h('div', { key: 'summary', className: 'dcm-card', style: S.card }, summaryCard))

      var pathWarnings = Array.isArray(inspected.pathWarnings) ? inspected.pathWarnings : []
      if (pathWarnings.length > 0) {
        children.push(h('div', { key: 'path-warnings', className: 'dcm-card', style: S.card },
          h('div', { key: 'head', style: { fontSize: '12px', fontWeight: 500 } }, t('pathWarnings')),
          pathWarnings.slice(0, 20).map(function (warning, at) {
            var rule = remapRuleOf(warning)
            return h('div', { key: 'pw-' + at, style: { display: 'flex', flexDirection: 'column', gap: '2px' } },
              h('div', { style: Object.assign({}, S.muted, { overflowWrap: 'anywhere' }) }, '· ' + warningText(warning)),
              rule === null ? null : h('label', { style: { display: 'flex', alignItems: 'center', gap: '6px', color: 'var(--dsw-alias-label-secondary)', fontSize: '12px' } },
                h('input', {
                  type: 'checkbox',
                  checked: remapPicked[remapKeyOf(warning)] === true,
                  disabled: busy,
                  style: { accentColor: 'var(--dsw-alias-brand-primary)' },
                  onChange: function () { toggleRemap(remapKeyOf(warning)) },
                }),
                t('applyRemap')))
          })))
      }

      children.push(h('div', { key: 'conflicts', style: { display: 'flex', flexDirection: 'column', gap: '8px' } },
        h('div', { key: 'actions', style: S.rowBetween },
          h('div', { style: S.row },
            h('span', { style: S.muted }, t('writeCount', { count: plan.write })),
            h(Button, { variant: 'ghost', disabled: busy || plan.total === 0, onClick: function () { setAllChoices('auto') } }, t('batchAuto')),
            h(Button, { variant: 'ghost', disabled: busy || plan.total === 0, onClick: function () { setAllChoices('use-backup') } }, t('batchUseBackup')),
            h(Button, { variant: 'ghost', disabled: busy || plan.total === 0, onClick: function () { setAllChoices('skip') } }, t('batchSkip'))),
          h(Button, { variant: 'secondary', disabled: busy, onClick: function () { resetForNewFile(); setFileInfo(null); setError(null) } }, t('chooseAnother'))),
        h('div', { key: 'table', className: 'dcm-card', style: S.card },
          h('div', { className: 'dcm-scroll' },
            h('table', { className: 'dcm-table' },
              h('thead', null, h('tr', null,
                h('th', null, t('colItem')),
                h('th', null, t('colStatus')),
                h('th', null, t('colLocal')),
                h('th', null, t('colIncoming')),
                h('th', null, t('colChoice')))),
              h('tbody', null, importRows(t, allSections, relIndex, choiceOf, setChoice, busy)))))))

      if (allSections.length === 0) children.push(h('div', { key: 'empty', style: S.muted }, t('inspectEmpty')))

      children.push(h('div', { key: 'run', style: S.row },
        h(Button, { onClick: startImport, disabled: busy }, busy ? t('importing') : t('startImport'))))
    }

    if (result) {
      var failed = listOf(result.failed)
      var resultCard = [
        h('div', { key: 'head', style: { fontSize: '13px', fontWeight: 500 } }, t('resultTitle')),
        h('div', { key: 'stats', style: Object.assign({}, S.row, { gap: '6px' }) },
          h(Badge, { tone: 'ok' }, t('applied') + ' ' + countOf(result.applied)),
          h(Badge, { tone: 'muted' }, t('skipped') + ' ' + countOf(result.skipped)),
          h(Badge, { tone: failed.length > 0 ? 'error' : 'muted' }, t('failed') + ' ' + countOf(result.failed))),
        rollbackTarget !== '' ? h('div', { key: 'snapshot', style: S.muted }, t('snapshotCreated', { id: rollbackTarget })) : null,
        result.rolledBack === true
          ? h(Notice, { key: 'rolled-back' }, t('rolledBackHint'))
          : result.restartRequired !== false ? h(Notice, { key: 'restart' }, t('restartHint')) : null,
      ]
      if (failed.length > 0) {
        resultCard.push(h('div', { key: 'failed', style: { display: 'flex', flexDirection: 'column', gap: '2px' } },
          h('div', { style: { fontSize: '12px', fontWeight: 500 } }, t('failedTitle')),
          failed.slice(0, 20).map(function (row, at) {
            return h('div', { key: 'failed-' + at, style: { color: 'var(--dsw-alias-state-error-primary)', fontSize: '12px', lineHeight: '18px', overflowWrap: 'anywhere' } }, '· ' + failureTextOf(row))
          })))
      }
      if (rollbackTarget !== '' && result.rolledBack !== true) {
        resultCard.push(h('div', { key: 'rollback', style: S.row },
          h(Button, { variant: 'danger', onClick: runRollback, disabled: busy }, busy ? t('rollingBack') : t('rollback')),
          confirmRollback === true ? h('span', { style: { color: 'var(--dsw-alias-state-warn-primary)', fontSize: '12px' } }, t('rollbackConfirm')) : null))
      }
      if (rollback.status === 'done') {
        resultCard.push(h('div', { key: 'rollback-done', style: S.muted },
          t('rollbackDone', { count: rollback.count }) + (rollback.removed > 0 ? t('rollbackRemoved', { count: rollback.removed }) : '')))
      }
      if (rollback.status === 'error') {
        resultCard.push(h(ErrorBar, { key: 'rollback-error', error: rollback.error, t: t }))
      }
      children.push(h('div', { key: 'result', className: 'dcm-card', style: S.card }, resultCard))
    }

    return h('div', { style: { display: 'flex', flexDirection: 'column', gap: '12px' } }, children)
  }

  function importRows(t, sections, relIndex, choiceOf, setChoice, busy) {
    var rows = []
    for (var outer = 0; outer < sections.length; outer += 1) {
      var section = sections[outer]
      var items = Array.isArray(section.items) ? section.items : []
      if (items.length === 0) continue
      var impact = impactOf(t, section.id)
      rows.push(h('tr', { key: 'group-' + section.id, 'data-group': 'true' },
        h('td', { colSpan: 5 },
          h('span', null, String(section.title || section.id)),
          impact === '' ? null : h('span', { style: { color: 'var(--dsw-alias-label-tertiary)', fontWeight: 400 } }, ' · ' + impact))))
      for (var inner = 0; inner < items.length; inner += 1) {
        rows.push(importRow(t, section, items[inner], relIndex, choiceOf, setChoice, busy))
      }
    }
    if (rows.length === 0) {
      rows.push(h('tr', { key: 'none' }, h('td', { colSpan: 5, style: S.muted }, t('inspectEmpty'))))
    }
    return rows
  }

  function importRow(t, section, item, relIndex, choiceOf, setChoice, busy) {
    var rel = relIndex[section.id] && relIndex[section.id][item.itemId] ? relIndex[section.id][item.itemId] : ''
    var diff = item.diff === undefined || item.diff === null ? '' : (typeof item.diff === 'string' ? item.diff : JSON.stringify(item.diff))
    var choice = choiceOf(section.id, item.itemId)
    var action = actionOf(item.status, choice)
    var truncated = isTruncated(item)
    var writeHint = ''
    if (action === 'use-backup') {
      writeHint = item.status === 'conflict'
        ? t('overwriteLocal', { size: formatBytes(item.localBytes || 0) })
        : t('createLocal', { size: formatBytes(item.incomingBytes || 0) })
    }

    // Review M3: every row carries an explicit action instead of running silently.
    function option(value, label, disabled) {
      return h('label', {
        key: 'opt-' + value,
        style: {
          display: 'flex',
          alignItems: 'center',
          gap: '4px',
          color: disabled ? 'var(--dsw-alias-label-tertiary)' : 'inherit',
          cursor: busy || disabled ? 'not-allowed' : 'pointer',
        },
      },
        h('input', {
          type: 'radio',
          name: 'dcm-choice-' + section.id + '-' + item.itemId,
          checked: choice === value,
          disabled: busy || disabled,
          style: { accentColor: 'var(--dsw-alias-brand-primary)' },
          onChange: function () { setChoice(section.id, item.itemId, value) },
        }),
        label)
    }

    var itemCell = [
      h('div', { key: 'id', style: S.mono }, String(item.itemId || '')),
      rel ? h('div', { key: 'rel', style: S.muted }, rel) : null,
      diff ? h('div', { key: 'diff', style: Object.assign({}, S.muted, { overflowWrap: 'anywhere' }) }, String(diff)) : null,
      truncated
        ? h('div', { key: 'truncated', style: { color: 'var(--dsw-alias-state-error-primary)', fontSize: '12px', lineHeight: '18px', fontWeight: 500 } }, t('truncatedHint'))
        : null,
      writeHint === ''
        ? null
        : h('div', { key: 'write', style: { color: 'var(--dsw-alias-state-warn-primary)', fontSize: '12px', lineHeight: '18px' } }, writeHint),
    ]

    return h('tr', { key: section.id + '|' + item.itemId },
      h('td', null, itemCell),
      h('td', null, h('div', { style: { display: 'flex', flexDirection: 'column', gap: '2px', alignItems: 'flex-start' } },
        h(Badge, { tone: statusTone(item.status) }, statusLabel(t, item.status)),
        truncated ? h(Badge, { tone: 'error', strong: true }, t('truncatedBadge')) : null)),
      h('td', { style: S.num }, formatBytesOrDash(item.localBytes)),
      h('td', { style: S.num }, formatBytesOrDash(item.incomingBytes)),
      h('td', null, h('div', { style: { display: 'flex', flexDirection: 'column', gap: '1px', whiteSpace: 'nowrap' } },
        option('auto', t('choiceAuto'), false),
        option('use-backup', t('useBackup'), item.status === 'missing'),
        option('skip', t('choiceSkip'), false),
        h('div', { key: 'effective', style: Object.assign({}, S.muted, { fontSize: '11px' }) },
          action === 'use-backup' ? t('effectiveWrite') : t('effectiveSkip')))))
  }

  // -------------------------------------------------------- snapshots tab ----
  function SnapshotsPage(props) {
    var t = props.t
    var listState = useState({ status: 'loading', rows: [], error: null })
    var view = listState[0]
    var setView = listState[1]
    var busyState = useState('')
    var busyId = busyState[0]
    var setBusyId = busyState[1]
    var confirmState = useState('')
    var confirmId = confirmState[0]
    var setConfirmId = confirmState[1]
    var errorState = useState(null)
    var error = errorState[0]
    var setError = errorState[1]
    var noticeState = useState(null)
    var notice = noticeState[0]
    var setNotice = noticeState[1]

    var reload = useCallback(function () {
      setView({ status: 'loading', rows: [], error: null })
      callJson(API.snapshots).then(function (data) {
        var rows = Array.isArray(data) ? data : (Array.isArray(data && data.snapshots) ? data.snapshots : [])
        setView({ status: 'ready', rows: rows, error: null })
      }).catch(function (failure) {
        setView({ status: 'error', rows: [], error: { code: failure.code, message: failure.message } })
      })
    }, [])

    useEffect(function () { reload() }, [reload])

    function restore(row) {
      if (busyId !== '') return
      if (confirmId !== row.id) {
        setConfirmId(row.id)
        return
      }
      setBusyId(row.id)
      setError(null)
      setNotice(null)
      callJson(API.rollback, { snapshot: row.id }).then(function (data) {
        setBusyId('')
        setConfirmId('')
        var removed = countOf(data && data.removed)
        setNotice(t('restoreDone', { count: countOf(data && data.restored) }) + (removed > 0 ? t('rollbackRemoved', { count: removed }) : ''))
        reload()
      }).catch(function (failure) {
        setBusyId('')
        setConfirmId('')
        setError({ code: failure.code, message: failure.message })
      })
    }

    var children = []
    children.push(h('div', { key: 'title', style: S.header },
      h('h3', { style: S.title }, t('snapshotsTitle')),
      h('div', { style: S.muted }, t('snapshotsDesc'))))
    children.push(h(ErrorBar, { key: 'error', error: error, t: t, onDismiss: function () { setError(null) } }))
    if (notice) children.push(h(Notice, { key: 'notice' }, notice))

    children.push(h('div', { key: 'actions', style: S.row },
      h(Button, { variant: 'secondary', onClick: reload, disabled: view.status === 'loading' }, t('refresh'))))

    if (view.status === 'loading') children.push(h(Loading, { key: 'loading', t: t }))
    if (view.status === 'error') children.push(h(ErrorBar, { key: 'load-error', error: view.error, t: t }))
    if (view.status === 'ready' && view.rows.length === 0) {
      children.push(h('div', { key: 'empty', style: S.muted }, t('snapshotsEmpty')))
    }
    if (view.status === 'ready' && view.rows.length > 0) {
      var rows = view.rows.map(function (row) {
        var confirming = confirmId === row.id
        return h('div', { key: String(row.id), style: { display: 'flex', flexDirection: 'column', gap: '4px', padding: '8px 0', borderTop: '0.5px solid var(--dsw-alias-border-l2)' } },
          h('div', { style: S.rowBetween },
            h('div', { style: { display: 'flex', flexDirection: 'column', gap: '1px', minWidth: 0 } },
              h('div', { style: { fontSize: '12px', fontWeight: 500 } }, formatTime(row.at)),
              h('div', { style: S.mono }, String(row.id)),
              h('div', { style: S.muted },
                (row.label ? '[' + String(row.label) + '] ' : '') + t('snapshotFiles') + ' ' + String(row.files || 0) + ' · ' + formatBytes(row.bytes))),
            h(Button, {
              variant: confirming ? 'danger' : 'secondary',
              onClick: function () { restore(row) },
              disabled: busyId !== '',
            }, busyId === row.id ? t('restoring') : (confirming ? t('restoreYes') : t('restore')))),
          confirming
            ? h('div', { style: { display: 'flex', alignItems: 'center', gap: '8px', color: 'var(--dsw-alias-state-warn-primary)', fontSize: '12px' } },
              h('span', null, t('restoreConfirm')),
              h(Button, { variant: 'ghost', onClick: function () { setConfirmId('') } }, t('cancel')))
            : null)
      })
      children.push(h('div', { key: 'list', className: 'dcm-card', style: Object.assign({}, S.card, { padding: '4px 14px' }) }, rows))
    }

    return h('div', { style: { display: 'flex', flexDirection: 'column', gap: '12px' } }, children)
  }

  // ---------------------------------------------------------------- root ----
  // Render insurance: a throwing child must show an error bar, never a blank pane.
  var Boundary = (function () {
    if (typeof React.Component !== 'function') {
      return function PassThrough(props) { return props.children }
    }
    return class Boundary extends React.Component {
      constructor(props) {
        super(props)
        this.state = { error: null }
      }
      static getDerivedStateFromError(error) { return { error: error } }
      componentDidCatch(error) { this.setState({ error: error }) }
      render() {
        if (this.state.error) {
          return h(ErrorBar, {
            error: { code: 'render-failed', message: String((this.state.error && this.state.error.message) || this.state.error) },
            t: this.props.t,
          })
        }
        return this.props.children
      }
    }
  })()

  function Panel(props) {
    var t = makeT(props)
    var tabState = useState('export')
    var tab = tabState[0]
    var setTab = tabState[1]
    var overviewState = useState({ status: 'loading', data: null, error: null })
    var overview = overviewState[0]
    var setOverview = overviewState[1]

    useEffect(function () {
      var alive = true
      callJson(API.overview).then(function (data) {
        if (alive) setOverview({ status: 'ready', data: data, error: null })
      }).catch(function (failure) {
        if (alive) setOverview({ status: 'error', data: null, error: { code: failure.code, message: failure.message } })
      })
      return function () { alive = false }
    }, [])

    var tabs = [
      { id: 'export', label: t('tabExport') },
      { id: 'import', label: t('tabImport') },
      { id: 'snapshots', label: t('tabSnapshots') },
    ]

    var header = [
      h('div', { key: 'title', style: S.header },
        h('h3', { style: S.title }, t('nav')),
        h('div', { style: S.muted }, t('desc'))),
    ]
    if (overview.status === 'ready' && overview.data) {
      var data = overview.data
      header.push(h('div', { key: 'env', style: S.row },
        h('span', { style: S.chip }, t('envProfile') + ': ' + String(data.profile || '—')),
        h('span', { style: S.chip }, t('envVersion') + ': ' + String(data.dshVersion || '—')),
        h('span', { style: S.chip }, t('envHome') + ': ' + String(data.dshHome || '—'))))
    }
    if (overview.status === 'error') {
      header.push(h(ErrorBar, { key: 'env-error', error: overview.error, t: t }))
    }

    var body = tab === 'export'
      ? h(ExportPage, { t: t, key: 'export' })
      : tab === 'import'
        ? h(ImportPage, { t: t, key: 'import' })
        : h(SnapshotsPage, { t: t, key: 'snapshots' })

    return h('div', { style: S.page },
      h('style', null, CSS),
      header,
      h('div', { key: 'tabs', style: S.tabs, role: 'tablist' }, tabs.map(function (entry) {
        return h('button', {
          key: entry.id,
          type: 'button',
          role: 'tab',
          className: 'dcm-tab',
          'data-active': tab === entry.id ? 'true' : 'false',
          'aria-selected': tab === entry.id ? 'true' : 'false',
          onClick: function () { setTab(entry.id) },
        }, entry.label)
      })),
      h('div', { key: 'body', role: 'tabpanel' }, h(Boundary, { t: t }, body)))
  }

  // ------------------------------------------------------------- register ----
  function apply(ctx) {
    if (!ctx) return
    localeApi = ctx.locale !== undefined ? ctx.locale : null
    if (localeApi && typeof localeApi.register === 'function') {
      try {
        ctx.effect(function () {
          return localeApi.register(NS, DICTS)
        }, 'dsh-config-migrator: locale dictionaries')
      } catch (error) { /* dictionaries are optional: the bundle carries its own table */ }
    }
    if (!ctx.slots || typeof ctx.slots.inject !== 'function') return
    ctx.effect(function () {
      return ctx.slots.inject('settings.section', function () {
        return ctx.slots.register({
          name: 'settings.section',
          id: 'config-migrator',
          order: 30,
          locale: NS,
          label: function () { return translate('nav') },
        }, Panel)
      })
    }, 'dsh-config-migrator: settings section')
  }

  exports.name = NS
  exports.inject = ['slots', 'locale']
  exports.apply = apply
  exports.DICTS = DICTS
  return module.exports
} })
