import { profileSection } from './profile.js'
import { pluginsSection } from './plugins.js'
import { marketplaceSection, modelsSection, mcpSection, agentPresetsSection, settingsSection } from './patch.js'
import { localPluginsSection } from './localPlugins.js'
import { skillsSection } from './skills.js'
import { instructionsSection } from './instructions.js'
import { workspacesSection } from './workspaces.js'
import { sessionsSection } from './sessions.js'
import { storagesSection } from './storages.js'
import { pluginDataSection } from './pluginData.js'
import { attachmentsSection } from './attachments.js'
import { credentialsSection } from './credentials.js'

/** Ordered registry — the order is the contract §2 table and the zip entry order. */
export const SECTIONS = [
  profileSection,
  pluginsSection,
  marketplaceSection,
  localPluginsSection,
  modelsSection,
  skillsSection,
  mcpSection,
  agentPresetsSection,
  settingsSection,
  instructionsSection,
  workspacesSection,
  sessionsSection,
  storagesSection,
  pluginDataSection,
  attachmentsSection,
  credentialsSection,
]

export function listSections() { return SECTIONS }

export function getSection(id) { return SECTIONS.find((section) => section.id === id) }

/**
 * Scan every section into catalog rows. A failing section degrades to an empty
 * list plus its error message instead of failing the whole catalog.
 */
export async function scanCatalog(context) {
  const out = []
  for (const section of SECTIONS) {
    const row = {
      id: section.id,
      title: section.title,
      desc: section.desc ?? '',
      defaultSelected: section.defaultSelected !== false,
      totalBytes: 0,
      items: [],
    }
    try {
      row.items = await section.scan(context)
      row.totalBytes = row.items.reduce((sum, item) => sum + item.bytes, 0)
    } catch (error) {
      row.error = error instanceof Error ? error.message : String(error)
    }
    out.push(row)
  }
  return out
}

/**
 * Turn a request selection into concrete section/item pairs.
 * @param context - environment context.
 * @param selection - { sections?: { [id]: boolean }, items?: { [sectionId]: string[] | null } }.
 */
export async function resolveSelection(context, selection = {}) {
  const wanted = selection && typeof selection === 'object' && selection.sections && typeof selection.sections === 'object' ? selection.sections : {}
  const itemFilter = selection && typeof selection === 'object' && selection.items && typeof selection.items === 'object' ? selection.items : {}
  const picked = []
  // A non-empty sections map is a whitelist: unlisted sections stay out. Without it,
  // every section keeps its own defaultSelected flag. includeSecrets is the explicit
  // opt-in that also pulls in the (default-off) credentials section.
  const whitelist = Object.keys(wanted).length > 0
  const includeSecrets = selection?.includeSecrets === true
  for (const section of SECTIONS) {
    const secretOptIn = includeSecrets && section.id === 'credentials'
    const enabled = whitelist ? (wanted[section.id] === true || secretOptIn) : (section.defaultSelected !== false || secretOptIn)
    if (!enabled) continue
    const items = await section.scan(context)
    const only = itemFilter[section.id]
    picked.push({ section, items: Array.isArray(only) ? items.filter((item) => only.includes(item.id)) : items })
  }
  return picked
}
