import { readFile } from 'node:fs/promises'
import { deflateRawSync, inflateRawSync } from 'node:zlib'

/** Standard zip limits this writer stays inside (no zip64). */
const MAX_UINT32 = 0xffffffff
/** A migration archive never legitimately expands past this (zip-bomb fence). */
export const MAX_ARCHIVE_BYTES = 512 * 1024 * 1024
// The EOCD entry counter is uint16; 0xFFFF is the zip64 marker, so 65534 is the cap.
const MAX_ARCHIVE_ENTRIES = 65534
const MAX_ARCHIVE_WRITE_BYTES = 4 * 1024 * 1024 * 1024 - 1
const STORED = 0
const DEFLATED = 8
const FLAG_UTF8 = 0x0800
const VERSION_MADE_BY = (3 << 8) | 30

const CRC_TABLE = (() => {
  const table = new Int32Array(256)
  for (let n = 0; n < 256; n += 1) {
    let c = n
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[n] = c
  }
  return table
})()

export function crc32(buffer) {
  let crc = -1
  for (let i = 0; i < buffer.length; i += 1) crc = CRC_TABLE[(crc ^ buffer[i]) & 0xff] ^ (crc >>> 8)
  return (crc ^ -1) >>> 0
}

/** MS-DOS date/time pair; zip stores local wall time, not UTC. */
function dosDateTime(value) {
  const date = value instanceof Date ? value : new Date(value ?? Date.now())
  const year = Math.min(2107, Math.max(1980, date.getFullYear()))
  return {
    time: (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2),
    date: ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate(),
  }
}

/** Forward-slash entry name; rejects traversal and absolute names outright. */
export function normalizeEntryName(name) {
  if (typeof name !== 'string' || name === '') throw new Error('zip: entry name must be a non-empty string')
  const normalized = name.replace(/\\/g, '/').replace(/^\/+/, '')
  if (normalized === '' || /^[A-Za-z]:/.test(normalized)) throw new Error('zip: illegal entry name ' + JSON.stringify(name))
  const parts = normalized.split('/').filter((part) => part !== '')
  if (parts.some((part) => part === '..')) throw new Error('zip: entry name escapes the archive ' + JSON.stringify(name))
  const fixed = parts.join('/')
  return name.endsWith('/') ? fixed + '/' : fixed
}

/**
 * Build a zip archive from entries.
 * @param {{ name: string, data?: Buffer|string, mtime?: Date|number }[]} entries - files in output order; a name ending in '/' is a directory.
 * @returns {Buffer} the complete archive.
 */
export function writeZip(entries) {
  if (Array.isArray(entries) && entries.length > MAX_ARCHIVE_ENTRIES) {
    throw new Error('zip: 条目数 ' + entries.length + ' 超过 ' + MAX_ARCHIVE_ENTRIES + ' 上限，请分批导出')
  }
  const chunks = []
  const central = []
  let offset = 0
  for (const entry of entries) {
    const name = normalizeEntryName(entry.name)
    const isDirectory = name.endsWith('/')
    const raw = isDirectory ? Buffer.alloc(0) : Buffer.from(entry.data ?? Buffer.alloc(0))
    const { time, date } = dosDateTime(entry.mtime)
    const crc = crc32(raw)
    const deflated = raw.length > 0 ? deflateRawSync(raw, { level: 6 }) : Buffer.alloc(0)
    const useDeflate = deflated.length > 0 && deflated.length < raw.length
    const body = useDeflate ? deflated : raw
    const method = useDeflate ? DEFLATED : STORED
    const nameBytes = Buffer.from(name, 'utf8')
    if (nameBytes.length > 0xffff) throw new Error('zip: entry name too long ' + JSON.stringify(name))
    if (body.length > MAX_UINT32 || raw.length > MAX_UINT32) throw new Error('zip: entry exceeds 4GiB (zip64 not supported)')

    const local = Buffer.alloc(30 + nameBytes.length)
    local.writeUInt32LE(0x04034b50, 0)
    local.writeUInt16LE(20, 4)
    local.writeUInt16LE(FLAG_UTF8, 6)
    local.writeUInt16LE(method, 8)
    local.writeUInt16LE(time, 10)
    local.writeUInt16LE(date, 12)
    local.writeUInt32LE(crc, 14)
    local.writeUInt32LE(body.length, 18)
    local.writeUInt32LE(raw.length, 22)
    local.writeUInt16LE(nameBytes.length, 26)
    local.writeUInt16LE(0, 28)
    nameBytes.copy(local, 30)

    const mode = isDirectory ? 0o40755 : 0o100644
    const record = Buffer.alloc(46 + nameBytes.length)
    record.writeUInt32LE(0x02014b50, 0)
    record.writeUInt16LE(VERSION_MADE_BY, 4)
    record.writeUInt16LE(20, 6)
    record.writeUInt16LE(FLAG_UTF8, 8)
    record.writeUInt16LE(method, 10)
    record.writeUInt16LE(time, 12)
    record.writeUInt16LE(date, 14)
    record.writeUInt32LE(crc, 16)
    record.writeUInt32LE(body.length, 20)
    record.writeUInt32LE(raw.length, 24)
    record.writeUInt16LE(nameBytes.length, 28)
    record.writeUInt16LE(0, 30)
    record.writeUInt16LE(0, 32)
    record.writeUInt16LE(0, 34)
    record.writeUInt16LE(0, 36)
    record.writeUInt32LE(((mode << 16) | (isDirectory ? 0x10 : 0)) >>> 0, 38)
    record.writeUInt32LE(offset, 42)
    nameBytes.copy(record, 46)

    chunks.push(local, body)
    central.push(record)
    offset += local.length + body.length
  }

  if (offset > MAX_ARCHIVE_WRITE_BYTES) throw new Error('zip: archive would exceed 4GiB；请分批导出（按分区/会话选择）')
  const centralBytes = Buffer.concat(central)
  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50, 0)
  end.writeUInt16LE(0, 4)
  end.writeUInt16LE(0, 6)
  end.writeUInt16LE(central.length, 8)
  end.writeUInt16LE(central.length, 10)
  end.writeUInt32LE(centralBytes.length, 12)
  end.writeUInt32LE(offset, 16)
  end.writeUInt16LE(0, 20)
  return Buffer.concat([...chunks, centralBytes, end])
}

/** Locate the end-of-central-directory record, allowing a trailing comment. */
function findEnd(buffer) {
  const lowest = Math.max(0, buffer.length - 22 - 0xffff)
  for (let at = buffer.length - 22; at >= lowest; at -= 1) {
    if (buffer.readUInt32LE(at) === 0x06054b50) return at
  }
  throw new Error('zip: end of central directory not found (not a zip archive?)')
}

/**
 * Read a zip archive held in memory.
 * @param {Buffer} buffer - archive bytes.
 * @returns {{ name: string, isDirectory: boolean, size: number, crc32: number, method: number, mtime: Date, read: () => Buffer }[]}
 */
export function readZip(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 22) throw new Error('zip: buffer is not a zip archive')
  const end = findEnd(buffer)
  const count = buffer.readUInt16LE(end + 10)
  if (count > MAX_ARCHIVE_ENTRIES) throw new Error('zip: too many entries (' + count + ' > ' + MAX_ARCHIVE_ENTRIES + ')')
  const centralSize = buffer.readUInt32LE(end + 12)
  const centralOffset = buffer.readUInt32LE(end + 16)
  if (count === 0xffff || centralOffset === 0xffffffff) throw new Error('zip: zip64 archives are not supported')
  if (centralOffset + centralSize > buffer.length) throw new Error('zip: central directory lies outside the archive')
  const entries = []
  let at = centralOffset
  let totalSize = 0
  for (let index = 0; index < count; index += 1) {
    if (buffer.readUInt32LE(at) !== 0x02014b50) throw new Error('zip: bad central directory entry at ' + at)
    const method = buffer.readUInt16LE(at + 10)
    const time = buffer.readUInt16LE(at + 12)
    const date = buffer.readUInt16LE(at + 14)
    const expectedCrc = buffer.readUInt32LE(at + 16)
    const compressedSize = buffer.readUInt32LE(at + 20)
    const size = buffer.readUInt32LE(at + 24)
    const nameLength = buffer.readUInt16LE(at + 28)
    const extraLength = buffer.readUInt16LE(at + 30)
    const commentLength = buffer.readUInt16LE(at + 32)
    const localOffset = buffer.readUInt32LE(at + 42)
    const rawName = buffer.subarray(at + 46, at + 46 + nameLength).toString('utf8')
    // The archive is untrusted input: reuse the writer's normalization so '..',
    // absolute paths and drive letters can never reach a file operation.
    const name = normalizeEntryName(rawName)
    totalSize += size
    if (totalSize > MAX_ARCHIVE_BYTES) throw new Error('zip: archive expands past ' + Math.round(MAX_ARCHIVE_BYTES / 1024 / 1024) + 'MB (possible zip bomb)')
    const isDirectory = name.endsWith('/')
    const next = at + 46 + nameLength + extraLength + commentLength
    entries.push({
      name,
      isDirectory,
      size,
      crc32: expectedCrc,
      method,
      mtime: new Date(1980 + (date >> 9), ((date >> 5) & 0x0f) - 1, date & 0x1f, time >> 11, (time >> 5) & 0x3f, (time & 0x1f) * 2),
      read: () => {
        if (buffer.readUInt32LE(localOffset) !== 0x04034b50) throw new Error('zip: bad local header for ' + name)
        const localNameLength = buffer.readUInt16LE(localOffset + 26)
        const localExtraLength = buffer.readUInt16LE(localOffset + 28)
        const start = localOffset + 30 + localNameLength + localExtraLength
        const stored = buffer.subarray(start, start + compressedSize)
        if (isDirectory) return Buffer.alloc(0)
        // Cap the inflate at the declared size so a small entry cannot expand
        // to gigabytes in memory.
        const data = method === DEFLATED
          ? inflateRawSync(stored, { maxOutputLength: Math.max(1, size + 1) })
          : method === STORED ? Buffer.from(stored) : null
        if (data === null) throw new Error('zip: unsupported compression method ' + method + ' for ' + name)
        if (data.length !== size) throw new Error('zip: size mismatch for ' + name)
        if (crc32(data) !== expectedCrc) throw new Error('zip: crc mismatch for ' + name)
        return data
      },
    })
    at = next
  }
  return entries
}

/** Read a zip file from disk (small helper used by tests and the importer). */
export async function readZipFile(path) { return readZip(await readFile(path)) }
