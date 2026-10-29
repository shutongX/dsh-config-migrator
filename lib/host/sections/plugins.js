import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { MigratorError } from '../errors.js'
import { readOrNull } from '../fsutil.js'
import { makeItem, stagePath, writeTarget } from './shared.js'

export function packageJsonPath(context) { return join(context.profileDir, 'package.json') }

/** Classify one dependency spec: plain version, tgz URL, link: local dir, or git source. */
export function classifySpec(spec) {
  if (typeof spec !== 'string' || spec.trim() === '') return 'unknown'
  const value = spec.trim()
  if (value.startsWith('link:')) return 'link'
  if (value.startsWith('file:')) return 'file'
  if (/\.tgz($|\?)/i.test(value)) return 'tgz'
  if (/^(git\+|git:|github:|gitlab:|bitbucket:|git@|https?:\/\/github\.com)/i.test(value)) return 'git'
  return 'version'
}

function payloadFor(name, spec) {
  return { name, spec, specKind: classifySpec(spec) }
}

async function readDependencies(context) {
  const data = await readOrNull(packageJsonPath(context))
  if (data === null) return null
  try {
    const parsed = JSON.parse(data.toString('utf8'))
    return parsed !== null && typeof parsed === 'object' && parsed.dependencies !== null && typeof parsed.dependencies === 'object' ? parsed.dependencies : {}
  } catch { return null }
}

function safeName(value) { return String(value).replace(/[^A-Za-z0-9._-]/g, '_') }

function itemFor(name, spec) {
  const payload = JSON.stringify(payloadFor(name, spec), null, 2) + '\n'
  return makeItem({
    section: 'plugins',
    id: name,
    label: name,
    detail: classifySpec(spec) + ' · ' + spec,
    relPath: stagePath('plugins', safeName(name) + '.json'),
    files: [{ rel: '', data: Buffer.from(payload, 'utf8') }],
    kind: 'remap',
    meta: { name, spec, specKind: classifySpec(spec), target: 'profiles/<profile>/package.json' },
  })
}

/** 已装插件: one item per dependency spec in the profile package.json. */
export const pluginsSection = {
  id: 'plugins',
  title: '已装插件',
  desc: 'package.json 里每个依赖的安装 spec（npm 版本 / tgz URL / link: 本地目录 / git）',
  defaultSelected: true,
  dependencyItems: true,
  async scan(context) {
    const dependencies = await readDependencies(context)
    if (dependencies === null) return []
    return Object.entries(dependencies).map(([name, spec]) => itemFor(name, String(spec)))
  },
  async read(item, context) {
    const dependencies = await readDependencies(context)
    if (dependencies === null || !Object.hasOwn(dependencies, item.meta.name)) return null
    const payload = JSON.stringify(payloadFor(item.meta.name, String(dependencies[item.meta.name])), null, 2) + '\n'
    return [{ rel: '', data: Buffer.from(payload, 'utf8') }]
  },
  async write(item, context, files) {
    const data = files.find((file) => file.rel === '')?.data ?? files[0]?.data
    if (data === undefined) throw new MigratorError('bad-archive', '插件条目缺少内容：' + item.id, 400)
    let payload
    try { payload = JSON.parse(data.toString('utf8')) } catch { throw new MigratorError('bad-archive', '插件条目不是合法 JSON：' + item.id, 400) }
    if (payload === null || typeof payload !== 'object' || typeof payload.name !== 'string' || payload.name === '' || typeof payload.spec !== 'string' || payload.spec === '') {
      throw new MigratorError('bad-archive', '插件条目字段非法（name/spec 必须是非空字符串）：' + item.id, 400)
    }
    const abs = packageJsonPath(context)
    const raw = await readOrNull(abs)
    if (raw === null) throw new MigratorError('not-found', '本机 profile 没有 package.json，拒绝凭空创建', 404)
    let parsed
    try { parsed = JSON.parse(raw.toString('utf8')) } catch { throw new MigratorError('bad-request', '本机 package.json 解析失败，拒绝覆盖', 400) }
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) throw new MigratorError('bad-request', '本机 package.json 结构异常，拒绝覆盖', 400)
    // Only merge dependencies: name/type/dsh.bundles and every other field stay intact.
    const dependencies = parsed.dependencies !== null && typeof parsed.dependencies === 'object' && !Array.isArray(parsed.dependencies) ? parsed.dependencies : {}
    parsed.dependencies = { ...dependencies, [payload.name]: payload.spec }
    await writeTarget(context, abs, Buffer.from(JSON.stringify(parsed, null, 2) + '\n', 'utf8'))
    return { written: [abs] }
  },
  targets(item, context) { return [packageJsonPath(context)] },
}
