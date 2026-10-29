import { join } from 'node:path'
import { makeItem, readSingleFile, writeItemFiles } from './shared.js'

/** Files that make up a profile's environment skeleton (contract §2, profile). */
export const PROFILE_FILES = ['package.json', 'cordis.patch.yml', 'pnpm-workspace.yaml', 'pnpm-lock.yaml']

async function itemFor(context, name) {
  const abs = join(context.profileDir, name)
  const files = await readSingleFile(abs)
  if (files === null) return null
  return makeItem({
    section: 'profile',
    id: 'profiles/' + context.profile + '/' + name,
    label: name,
    detail: 'profiles/' + context.profile + '/' + name,
    relPath: 'profiles/' + context.profile + '/' + name,
    files,
    kind: name === 'package.json' || name === 'cordis.patch.yml' ? 'config' : 'file',
  })
}

/** 环境骨架: the profile's plugin manifest, patch layer, and pnpm workspace files. */
export const profileSection = {
  id: 'profile',
  title: '环境骨架',
  desc: 'profiles/<profile>/ 下的插件清单 package.json、patch 层 cordis.patch.yml 与 pnpm 工作区文件',
  defaultSelected: true,
  async scan(context) {
    const items = []
    for (const name of PROFILE_FILES) {
      const item = await itemFor(context, name)
      if (item !== null) items.push(item)
    }
    return items
  },
  async read(item, context) { return readSingleFile(join(context.home, ...item.relPath.split('/'))) },
  async write(item, context, files) { return writeItemFiles(context, item, files) },
}
