import { readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { statOrNull } from '../fsutil.js'
import { makeItem, readTreeFiles, writeItemFiles } from './shared.js'

/** Skill roots that live under $DSH_HOME and are therefore writable on import. */
function roots(context) {
  return [
    { abs: join(context.home, 'skills'), rel: 'skills' },
    { abs: join(context.profileDir, 'skills'), rel: 'profiles/' + context.profile + '/skills' },
  ]
}

/** 技能: one item per skill directory (name/SKILL.md/...). */
export const skillsSection = {
  id: 'skills',
  title: '技能',
  desc: '$DSH_HOME/skills 与 profile 内 skills 目录，逐技能勾选',
  defaultSelected: true,
  async scan(context) {
    const items = []
    for (const root of roots(context)) {
      const info = await statOrNull(root.abs)
      if (info === null || !info.isDirectory()) continue
      for (const entry of await readdir(root.abs, { withFileTypes: true })) {
        if (!entry.isDirectory()) continue
        const files = await readTreeFiles(join(root.abs, entry.name))
        if (files === null || files.length === 0) continue
        const rel = root.rel + '/' + entry.name
        items.push(makeItem({
          section: 'skills',
          id: rel,
          label: entry.name,
          detail: rel,
          relPath: rel,
          files,
          kind: 'tree',
          meta: { skill: entry.name, truncated: files.truncated === true },
        }))
      }
    }
    return items
  },
  async read(item, context) { return readTreeFiles(join(context.home, ...item.relPath.split('/'))) },
  async write(item, context, files) { return writeItemFiles(context, item, files) },
}
