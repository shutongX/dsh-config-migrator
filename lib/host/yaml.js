/**
 * Minimal YAML block handling for cordis.patch.yml only: this project never parses
 * a full YAML document, it slices the top-level `- ...` entries and re-emits the
 * raw text it was given (no re-serialization, so comments and !!js stay intact).
 */

function unquote(value) { return value.replace(/^['"]|['"]$/g, '') }

/** Normalize one entry block so a read-back equals what an import wrote. */
export function normalizeBlock(text) { return text.replace(/\s+$/, '') + '\n' }

/**
 * Split a patch file into its top-level list entries. Lines before the first
 * entry (the file header comments) belong to nobody and stay untouched.
 * @param {string} text - whole cordis.patch.yml body.
 * @returns {{ id: string|null, name: string|null, text: string, start: number, bodyEnd: number, end: number }[]}
 */
export function splitPatchEntries(text) {
  const lines = String(text ?? '').split(/\r?\n/)
  const ranges = []
  let current = null
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]
    if (/^-(\s|$)/.test(line)) {
      if (current !== null) ranges.push({ start: current.start, end: index, lines: current.lines })
      current = { start: index, lines: [line] }
      continue
    }
    if (current !== null) current.lines.push(line)
  }
  if (current !== null) ranges.push({ start: current.start, end: lines.length, lines: current.lines })
  return ranges.map((range) => {
    // Trailing blank lines are the separator before the next entry, not content:
    // slicing them out keeps a re-write byte-identical.
    let last = range.lines.length
    while (last > 0 && range.lines[last - 1].trim() === '') last -= 1
    const body = range.lines.join('\n')
    // Entries ship as "- id: x" (shipped style) or "- name: ...\n  id: x"; a nested
    // "- id:" inside config must never win over the entry's own id.
    const idMatch = /^-\s+id:\s*(.+?)\s*$/.exec(range.lines[0] ?? '') ?? /^\s{2}id:\s*(.+?)\s*$/m.exec(body)
    const nameMatch = /^\s{2}name:\s*(.+?)\s*$/m.exec(body)
    return {
      id: idMatch === null ? null : unquote(idMatch[1]),
      name: nameMatch === null ? null : unquote(nameMatch[1]),
      text: range.lines.slice(0, last).join('\n'),
      start: range.start,
      bodyEnd: range.start + last,
      end: range.end,
    }
  })
}

/** Current block of one patch entry, or null when the id is absent. */
export function patchEntryText(text, id) {
  const entry = splitPatchEntries(text).find((row) => row.id === id)
  return entry === undefined ? null : normalizeBlock(entry.text)
}

/** Replace (or append) one top-level patch entry, keeping every other byte intact. */
export function writePatchEntry(text, id, block) {
  const source = String(text ?? '')
  const lines = source.split(/\r?\n/)
  const target = splitPatchEntries(source).find((row) => row.id === id)
  const blockLines = normalizeBlock(block).replace(/\n$/, '').split('\n')
  if (target !== undefined) {
    const merged = [...lines.slice(0, target.start), ...blockLines, ...lines.slice(target.bodyEnd)]
    const tail = merged.join('\n')
    if (tail.endsWith('\n') || !source.endsWith('\n')) return tail
    return tail + '\n'
  }
  const trimmed = source.replace(/\s+$/, '')
  return (trimmed === '' ? '' : trimmed + '\n') + blockLines.join('\n') + '\n'
}

/** Top-level config key names present inside one entry block (diagnostics only). */
export function entryConfigKeys(block) {
  const keys = []
  let inConfig = false
  for (const line of String(block ?? '').split(/\r?\n/)) {
    if (/^\s{2}config:\s*$/.test(line)) { inConfig = true; continue }
    if (/^\s{2}[A-Za-z_][\w.-]*:/.test(line)) inConfig = false
    if (!inConfig) continue
    const match = /^\s{4}([A-Za-z_][\w.-]*):/.exec(line)
    if (match !== null) keys.push(match[1])
  }
  return keys
}
