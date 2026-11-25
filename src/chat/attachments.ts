// Files attached to a message (pasted, dropped, or picked). They're read here in the
// webview as browser File objects, so Tinkr needs no extra file-system permissions,
// and sent to the sidecar as base64 (see `Attachment` in shared/protocol.ts).

import type { Attachment } from '../agent/types'

const MB = 1024 * 1024

/** What Claude accepts, with Tinkr's size limit for each kind. */
export const LIMITS = {
  /** The API's limit for one image. */
  image: 5 * MB,
  /** The API takes larger PDFs, but they're slow to send and cost a lot of context. */
  pdf: 20 * MB,
  /** Same as the editor's limit: bigger text is rarely meant for a chat. */
  text: 2 * MB,
  /** All attachments of one message together. */
  total: 30 * MB,
}

export const IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp'])
const IMAGE_BY_EXTENSION: Record<string, string> = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp' }

/** An attachment waiting in the composer. */
export interface DraftAttachment extends Attachment {
  id: number
  /** Size in bytes (of the file, not the base64). */
  size: number
}

export type AttachmentKind = 'image' | 'pdf' | 'text'

/** Which kind of file this is, judging by its name and type (text needs a look inside too). */
export function kindOf(name: string, type: string): AttachmentKind | 'maybeText' {
  const ext = name.toLowerCase().split('.').pop() ?? ''
  if (IMAGE_TYPES.has(type) || IMAGE_BY_EXTENSION[ext]) return 'image'
  if (type === 'application/pdf' || ext === 'pdf') return 'pdf'
  return 'maybeText' // decided by reading it: valid UTF-8 without NUL bytes
}

/** The file's bytes as text, or null if it isn't text (not UTF-8, or has NUL bytes). */
export function asText(bytes: Uint8Array): string | null {
  try {
    const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
    return text.includes('\u0000') ? null : text
  } catch {
    return null
  }
}

export function formatSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < MB) return `${Math.round(bytes / 1024)} KB`
  return `${(bytes / MB).toFixed(1)} MB`
}

/** Base64 of some bytes, in chunks (a single String.fromCharCode call overflows on big files). */
export function toBase64(bytes: Uint8Array): string {
  let binary = ''
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(binary)
}

let nextId = 1

/**
 * Read a file into an attachment. Throws an Error with a message for the user when the
 * file can't be attached (wrong kind, too big).
 */
export async function readAttachment(file: Blob & { name?: string }): Promise<DraftAttachment> {
  // Pasted screenshots arrive without a useful name ("image.png" at best).
  const name = file.name || `pasted.${file.type.split('/')[1] ?? 'bin'}`
  const kind = kindOf(name, file.type)
  const limit = kind === 'image' ? LIMITS.image : kind === 'pdf' ? LIMITS.pdf : LIMITS.text
  if (file.size > limit) throw new Error(`${name} is ${formatSize(file.size)}; the limit for this kind of file is ${formatSize(limit)}.`)
  const bytes = new Uint8Array(await file.arrayBuffer())

  let mediaType: string
  if (kind === 'image') {
    mediaType = IMAGE_TYPES.has(file.type) ? file.type : IMAGE_BY_EXTENSION[name.toLowerCase().split('.').pop() ?? '']
  } else if (kind === 'pdf') {
    mediaType = 'application/pdf'
  } else {
    if (asText(bytes) === null) throw new Error(`${name} can't be attached: only images, PDFs and text files can.`)
    mediaType = 'text/plain'
  }
  return { id: nextId++, name, mediaType, size: file.size, data: toBase64(bytes) }
}

export const isImage = (mediaType: string) => IMAGE_TYPES.has(mediaType)

/** A data: URL for showing an image attachment. */
export const imageUrl = (a: { mediaType: string; data?: string }) => (a.data ? `data:${a.mediaType};base64,${a.data}` : '')
