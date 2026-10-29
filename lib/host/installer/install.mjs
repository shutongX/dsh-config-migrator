#!/usr/bin/env node
/**
 * dsh-config-migrator 自带安装器（随导出的 zip 一起分发）。
 *
 * 用法：把 zip 解压到任意目录，然后
 *   Windows: 双击 restore/install.cmd
 *   mac/linux: sh restore/install.sh
 * 只用 node 内置模块，不依赖网络。
 */
import { cp, mkdir, readdir, readFile, rename, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { basename, dirname, join, resolve } from 'node:path'
import { homedir } from 'node:os'
import { fileURLToPath } from 'node:url'

const PLUGIN_NAME = 'dsh-config-migrator'
const LINK_SPEC = 'link:./node_modules/' + PLUGIN_NAME

const restoreDir = dirname(fileURLToPath(import.meta.url))
const zipRoot = dirname(restoreDir)
const toolDir = join(zipRoot, 'tool', PLUGIN_NAME)

function log(line = '') { process.stdout.write(line + '\n') }
function stamp(date = new Date()) {
  const pad = (value) => String(value).padStart(2, '0')
  return String(date.getFullYear()) + pad(date.getMonth() + 1) + pad(date.getDate()) + '-' + pad(date.getHours()) + pad(date.getMinutes()) + pad(date.getSeconds())
}
function isPlainObject(value) { return value !== null && typeof value === 'object' && !Array.isArray(value) }

async function resolveProfile(home) {
  const envDir = (process.env.DSH_PROFILE_DIR || '').trim()
  const envName = (process.env.DSH_PROFILE || '').trim()
  if (envDir !== '') {
    const dir = resolve(envDir)
    return { name: envName !== '' ? envName : basename(dir), dir }
  }
  if (envName !== '') return { name: envName, dir: join(home, 'profiles', envName) }
  // 只有一个 profile 目录时直接用它，否则默认 desktop
  let names = []
  try {
    names = (await readdir(join(home, 'profiles'), { withFileTypes: true }))
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort()
  } catch { names = [] }
  const name = names.length === 1 ? names[0] : 'desktop'
  return { name, dir: join(home, 'profiles', name) }
}

async function main() {
  const home = resolve((process.env.DSH_HOME || '').trim() !== '' ? process.env.DSH_HOME.trim() : join(homedir(), '.dsh'))
  const profile = await resolveProfile(home)
  log('DSH_HOME  : ' + home)
  log('profile   : ' + profile.name)
  log('profile 目录: ' + profile.dir)

  if (!existsSync(profile.dir)) {
    log('')
    log('没有找到这个 profile 目录。请先启动一次 DSH，让它把 profile 建好，再运行本脚本。')
    log('（如果 profile 名不是 ' + profile.name + '，可以用环境变量 DSH_PROFILE 指定。）')
    return 1
  }
  if (!existsSync(toolDir)) {
    log('')
    log('zip 里缺少 tool/' + PLUGIN_NAME + '，请重新导出或重新解压完整的 zip。')
    return 1
  }

  const nodeModules = join(profile.dir, 'node_modules')
  const target = join(nodeModules, PLUGIN_NAME)
  await mkdir(nodeModules, { recursive: true })
  if (existsSync(target)) {
    const backup = target + '.bak-' + stamp()
    if (existsSync(backup)) {
      log('备份 ' + backup + ' 已存在，跳过备份，直接覆盖')
    } else {
      await rename(target, backup)
      log('已备份旧插件 → ' + backup)
    }
  }
  await cp(toolDir, target, { recursive: true })
  log('已安装插件 → ' + target)

  const pkgPath = join(profile.dir, 'package.json')
  let pkg = {}
  if (existsSync(pkgPath)) {
    let raw = ''
    try { raw = await readFile(pkgPath, 'utf8') } catch (error) {
      log('读取 package.json 失败：' + String(error && error.message ? error.message : error))
      return 1
    }
    try { pkg = JSON.parse(raw) } catch {
      log('')
      log('package.json 不是合法 JSON，已停止，未做任何修改。请修复后重试，或手工加入：')
      log('  dependencies["' + PLUGIN_NAME + '"] = "' + LINK_SPEC + '"')
      log('  dsh.profile.bundles += "' + PLUGIN_NAME + '"')
      return 1
    }
    if (!isPlainObject(pkg)) {
      log('package.json 顶层不是对象，已停止。请手动处理。')
      return 1
    }
  } else {
    log('profile 里没有 package.json，将新建一个最小结构')
  }

  let changed = false
  const dependencies = isPlainObject(pkg.dependencies) ? pkg.dependencies : {}
  if (dependencies[PLUGIN_NAME] === undefined) {
    dependencies[PLUGIN_NAME] = LINK_SPEC
    changed = true
    log('dependencies 已加入 ' + PLUGIN_NAME + ' → ' + LINK_SPEC)
  } else if (dependencies[PLUGIN_NAME] !== LINK_SPEC) {
    log('dependencies 里已有 ' + dependencies[PLUGIN_NAME] + '，保留原值不改写')
  }
  pkg.dependencies = dependencies

  const dsh = isPlainObject(pkg.dsh) ? pkg.dsh : {}
  const profileSection = isPlainObject(dsh.profile) ? dsh.profile : {}
  const bundles = Array.isArray(profileSection.bundles) ? profileSection.bundles : []
  if (!bundles.includes(PLUGIN_NAME)) {
    bundles.push(PLUGIN_NAME)
    changed = true
    log('dsh.profile.bundles 已追加 ' + PLUGIN_NAME)
  } else {
    log('dsh.profile.bundles 已包含 ' + PLUGIN_NAME + '，无需重复添加')
  }
  profileSection.bundles = bundles
  dsh.profile = profileSection
  pkg.dsh = dsh

  if (!changed) {
    log('package.json 无需修改')
  } else {
    const backup = pkgPath + '.bak-' + stamp()
    if (existsSync(backup)) log('备份 ' + backup + ' 已存在，跳过备份')
    else if (existsSync(pkgPath)) { await cp(pkgPath, backup); log('已备份 package.json → ' + backup) }
    await writeFile(pkgPath, JSON.stringify(pkg, null, 2) + '\n', 'utf8')
    log('package.json 已更新')
  }

  log('')
  log('安装完成。下一步：')
  log('  1) 重启 DSH')
  log('  2) 打开 设置 → 「配置迁移」')
  log('  3) 点「导入」，选择这个 zip，按提示处理冲突')
  log('  4) 导入完成后再重启一次，让配置生效')
  return 0
}

let code = 1
try {
  code = await main()
} catch (error) {
  log('安装失败：' + String(error && error.stack ? error.stack : error))
  code = 1
}
process.exit(code)
