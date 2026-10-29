import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { readOrNull } from '../fsutil.js'
import { entryConfigKeys, normalizeBlock, patchEntryText, splitPatchEntries, writePatchEntry } from '../yaml.js'
import { makeItem, stagePath, writeTarget } from './shared.js'

/** Absolute path of the active profile's patch layer. */
export function patchFilePath(context) { return join(context.profileDir, 'cordis.patch.yml') }

/** Whole patch text ('' when the file is missing). */
export async function readPatchText(context) {
  const data = await readOrNull(patchFilePath(context))
  return data === null ? '' : data.toString('utf8')
}

function safeName(value) { return String(value).replace(/[^A-Za-z0-9._-]/g, '_') }

function entryItem(sectionId, entry) {
  const block = normalizeBlock(entry.text)
  return makeItem({
    section: sectionId,
    id: entry.id,
    label: entry.id,
    detail: 'cordis.patch.yml · ' + entry.id,
    relPath: stagePath(sectionId, safeName(entry.id) + '.yml'),
    files: [{ rel: '', data: Buffer.from(block, 'utf8') }],
    kind: 'remap',
    meta: { entryId: entry.id, name: entry.name, configKeys: entryConfigKeys(block), target: 'profiles/<profile>/cordis.patch.yml' },
  })
}

/** Patch entries are written back into cordis.patch.yml, never as standalone files. */
export async function writePatchEntryItem(item, context, files) {
  const data = files.find((file) => file.rel === '')?.data ?? files[0]?.data
  if (data === undefined) throw new Error('patch 条目缺少内容：' + item.id)
  const abs = patchFilePath(context)
  const current = await readPatchText(context)
  const next = writePatchEntry(current, item.meta.entryId, data.toString('utf8'))
  await writeTarget(context, abs, Buffer.from(next, 'utf8'))
  return { written: [abs] }
}

/** Read one patch entry back as an item payload; null when the entry is gone. */
export async function readPatchEntryItem(item, context) {
  const text = await readPatchText(context)
  const block = patchEntryText(text, item.meta.entryId)
  return block === null ? null : [{ rel: '', data: Buffer.from(block, 'utf8') }]
}

/** Patch entries owned by the non-settings sections; everything else is "settings". */
export const PATCH_OWNERS = [
  { id: 'models', test: (entry) => /^llm-/.test(entry.id) || /llm/i.test(entry.name ?? '') },
  { id: 'marketplace', test: (entry) => /market/i.test(entry.id) || /market/i.test(entry.name ?? '') || /^\s+indexes:/m.test(entry.text) },
  { id: 'mcp', test: (entry) => /mcp/i.test(entry.id) || /mcp/i.test(entry.name ?? '') },
  { id: 'agentPresets', test: (entry) => entry.id === 'agent-preset-registry' || /agent[-_]?preset/i.test(entry.id) || /agent[-_]?preset/i.test(entry.name ?? '') },
]

/** Exactly one section owns a patch entry: first matching owner wins, else settings. */
export function ownerOf(entry) {
  const owner = PATCH_OWNERS.find((row) => row.test(entry))
  return owner === undefined ? 'settings' : owner.id
}

/** Build a section whose items are individual cordis.patch.yml entries. */
export function createPatchSection({ id, title, desc, ownsEntry, defaultSelected = true }) {
  return {
    id,
    title,
    desc,
    defaultSelected,
    patchEntries: true,
    async scan(context) {
      const text = await readPatchText(context)
      const seen = new Map()
      for (const entry of splitPatchEntries(text)) {
        if (entry.id === null || !ownsEntry(entry)) continue
        // A duplicate id is a known patch defect; the loader keeps the last one.
        seen.set(entry.id, entry)
      }
      return [...seen.values()].map((entry) => entryItem(id, entry))
    },
    async read(item, context) { return readPatchEntryItem(item, context) },
    async write(item, context, files) { return writePatchEntryItem(item, context, files) },
    targets(item, context) { return [patchFilePath(context)] },
  }
}

export const marketplaceSection = createPatchSection({
  id: 'marketplace',
  title: '插件市场',
  desc: 'cordis.patch.yml 里的 plugin-market.indexes 等自定义市场地址（每个 patch 条目单独勾选）',
  ownsEntry: (entry) => ownerOf(entry) === 'marketplace',
})

export const modelsSection = createPatchSection({
  id: 'models',
  title: '模型供应商',
  desc: 'llm-* patch 条目的 providers / models / baseURL（apiKey 值一律脱敏）',
  ownsEntry: (entry) => ownerOf(entry) === 'models',
})

export const mcpSection = createPatchSection({
  id: 'mcp',
  title: 'MCP 服务',
  desc: 'patch 中 mcp 相关条目与 mcp server 定义',
  ownsEntry: (entry) => ownerOf(entry) === 'mcp',
})

export const agentPresetsSection = createPatchSection({
  id: 'agentPresets',
  title: 'Agent 预设',
  desc: 'agent-preset-registry 配置与自定义预设条目',
  ownsEntry: (entry) => ownerOf(entry) === 'agentPresets',
})

export const settingsSection = createPatchSection({
  id: 'settings',
  title: '系统默认配置',
  desc: '除已归属条目外的全部 patch 条目（默认模型、权限预设、UI 偏好、agent-loop 等）',
  ownsEntry: (entry) => ownerOf(entry) === 'settings',
})
