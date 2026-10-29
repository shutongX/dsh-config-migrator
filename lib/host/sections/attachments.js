import { join } from 'node:path'
import { statOrNull } from '../fsutil.js'
import { makeItem, readTreeFiles, writeItemFiles } from './shared.js'

/** 附件: everything under $DSH_HOME/attachments as one tree item. */
export const attachmentsSection = {
  id: 'attachments',
  title: '附件',
  desc: '$DSH_HOME/attachments/** 的全部文件',
  defaultSelected: true,
  async scan(context) {
    const abs = join(context.home, 'attachments')
    const info = await statOrNull(abs)
    if (info === null || !info.isDirectory()) return []
    const files = await readTreeFiles(abs)
    if (files === null || files.length === 0) return []
    return [makeItem({
      section: 'attachments',
      id: 'attachments',
      label: 'attachments',
      detail: files.length + ' 个文件',
      relPath: 'attachments',
      files,
      kind: 'tree',
      meta: { fileCount: files.length, truncated: files.truncated === true },
    })]
  },
  async read(item, context) { return readTreeFiles(join(context.home, 'attachments')) },
  async write(item, context, files) { return writeItemFiles(context, item, files) },
}
