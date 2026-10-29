import { appendFile, mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

/**
 * Route registration state, shared by the entry (writes) and the overview readers
 * (HTTP + tool). Exposed as httpRoute so a silently missing route is impossible.
 */
// globalThis, not a module local: dev_reload_package clears the module cache, so a
// per-module STATE would leave the tool reading a stale instance after a reload.
const STATE = (globalThis.__DSH_CONFIG_MIGRATOR_ROUTE_STATE__ ??= { status: 'ok', attempts: 0, lastError: null, logPath: null })

export function routeLogPath(home) { return join(home, 'config-migrator', 'route-error.log') }
export function routeStatePath(home) { return join(home, 'config-migrator', 'route-state.json') }

/** Mirror the state to disk: lets the agent verify the LIVE process after a reload. */
function persistRouteState(home) {
  if (typeof home !== 'string' || home === '') return
  void (async () => {
    try {
      await mkdir(join(home, 'config-migrator'), { recursive: true })
      await writeFile(routeStatePath(home), JSON.stringify({ ...STATE, at: new Date().toISOString() }, null, 2) + '\n', 'utf8')
    } catch { /* diagnostics only */ }
  })()
}

export function setRouteStatus(status, details = {}) {
  STATE.status = status
  if (typeof details.attempts === 'number') STATE.attempts = details.attempts
  if (details.error !== undefined) STATE.lastError = details.error
  if (details.logPath !== undefined) STATE.logPath = details.logPath
}

/** Fields merged into the overview payload (HTTP and tool, same numbers). */
export function routeStateSummary() {
  return {
    httpRoute: STATE.status,
    httpRouteAttempts: STATE.attempts,
    httpRouteError: STATE.lastError,
    httpRouteLog: STATE.logPath,
  }
}

/** Fire-and-forget append: route diagnosis must never throw or delay apply(). */
export function logRouteError(home, message) {
  const logPath = routeLogPath(home)
  STATE.logPath = logPath
  persistRouteState(home)
  void (async () => {
    try {
      await mkdir(join(home, 'config-migrator'), { recursive: true })
      await appendFile(logPath, new Date().toISOString() + ' ' + String(message) + '\n', 'utf8')
    } catch { /* diagnostics only */ }
  })()
}

export function firstLine(value) {
  return String(value ?? '').split(/\r?\n/)[0].slice(0, 300)
}
