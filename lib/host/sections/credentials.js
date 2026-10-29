import { join } from 'node:path'
import { statOrNull } from '../fsutil.js'
import { makeItem, readSingleFile, stagePath } from './shared.js'

export const CREDENTIALS_FILE = '.credentials.yaml'

/** 凭据: only exported when includeSecrets is on and a password is supplied (sealed blob). */
export const credentialsSection = {
  id: 'credentials',
  title: '凭据',
  desc: '$DSH_HOME/.credentials.yaml（默认不导出；勾选后必须设密码，以 scrypt + AES-256-GCM 密文写入 zip）',
  defaultSelected: false,
  async scan(context) {
    const abs = join(context.home, CREDENTIALS_FILE)
    const info = await statOrNull(abs)
    if (info === null || !info.isFile()) return []
    return [makeItem({
      section: 'credentials',
      id: CREDENTIALS_FILE,
      label: CREDENTIALS_FILE,
      detail: '加密导出：sealed/credentials.bin',
      relPath: stagePath('credentials', 'credentials.bin'),
      files: [{ rel: '', data: Buffer.alloc(0) }],
      kind: 'file',
      meta: { zipPath: 'sealed/credentials.bin', sourcePath: abs, encrypted: true, bytes: info.size },
    })]
  },
  async read(item, context) {
    // The staged relPath is the import destination; the source is always the live file.
    return readSingleFile(typeof item.meta?.sourcePath === 'string' ? item.meta.sourcePath : join(context.home, CREDENTIALS_FILE))
  },
  async write() { throw new Error('凭据导入尚未实现：密文条目需要密码解密，请在后续版本导入') },
}
