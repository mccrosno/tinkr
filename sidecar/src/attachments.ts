// Attachments: turn a message and its files into the content blocks Claude receives.
// Images and PDFs are sent as they are; text files become plain-text documents, so
// Claude sees the file name as the document's title.

import type { Attachment } from '../../shared/protocol'

export type ImageType = 'image/png' | 'image/jpeg' | 'image/gif' | 'image/webp'
export const IMAGE_TYPES = new Set<string>(['image/png', 'image/jpeg', 'image/gif', 'image/webp'] satisfies ImageType[])
const isImage = (t: string): t is ImageType => IMAGE_TYPES.has(t)

/** Content blocks of a user message (the Messages API shape). */
export type ContentBlock =
  | { type: 'text'; text: string }
  | { type: 'image'; source: { type: 'base64'; media_type: ImageType; data: string } }
  | {
      type: 'document'
      title: string
      source: { type: 'base64'; media_type: 'application/pdf'; data: string } | { type: 'text'; media_type: 'text/plain'; data: string }
    }

/** One attachment as a content block. Throws on a type Tinkr doesn't send (the UI filters these). */
export function attachmentBlock(a: Attachment): ContentBlock {
  if (isImage(a.mediaType)) return { type: 'image', source: { type: 'base64', media_type: a.mediaType, data: a.data } }
  if (a.mediaType === 'application/pdf') return { type: 'document', title: a.name, source: { type: 'base64', media_type: 'application/pdf', data: a.data } }
  if (a.mediaType === 'text/plain') {
    // The webview sends every file as base64; text documents carry the text itself.
    const text = Buffer.from(a.data, 'base64').toString('utf8')
    return { type: 'document', title: a.name, source: { type: 'text', media_type: 'text/plain', data: text } }
  }
  throw new Error(`can't attach ${a.name}: unsupported type ${a.mediaType}`)
}

/**
 * The whole message. Attachments come first: Claude does best with images and
 * documents placed before the question about them.
 */
export function messageContent(text: string, attachments: Attachment[]): ContentBlock[] {
  const blocks = attachments.map(attachmentBlock)
  if (text) blocks.push({ type: 'text', text })
  return blocks
}
