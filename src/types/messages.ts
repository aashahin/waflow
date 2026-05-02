// ---------------------------------------------------------------------------
// Unified outbound message types
// ---------------------------------------------------------------------------

import type { MediaSource, PhoneNumber } from './common.js'

// ---------------------------------------------------------------------------
// Individual message shapes (discriminated by `type`)
// ---------------------------------------------------------------------------

export interface TextMessage {
  type: 'text'
  to: PhoneNumber
  text: {
    body: string
    previewUrl?: boolean
  }
  /** Reply to a specific message */
  context?: { messageId: string }
}

export interface TemplateMessage {
  type: 'template'
  to: PhoneNumber
  template: {
    name: string
    language: string
    components?: TemplateComponent[]
  }
}

export interface ImageMessage {
  type: 'image'
  to: PhoneNumber
  image: MediaSource & { caption?: string }
  context?: { messageId: string }
}

export interface VideoMessage {
  type: 'video'
  to: PhoneNumber
  video: MediaSource & { caption?: string }
  context?: { messageId: string }
}

export interface AudioMessage {
  type: 'audio'
  to: PhoneNumber
  audio: MediaSource
  context?: { messageId: string }
}

export interface DocumentMessage {
  type: 'document'
  to: PhoneNumber
  document: MediaSource & { caption?: string; filename?: string }
  context?: { messageId: string }
}

export interface StickerMessage {
  type: 'sticker'
  to: PhoneNumber
  sticker: MediaSource
  context?: { messageId: string }
}

export interface LocationMessage {
  type: 'location'
  to: PhoneNumber
  location: {
    latitude: number
    longitude: number
    name?: string
    address?: string
  }
  context?: { messageId: string }
}

export interface ContactsMessage {
  type: 'contacts'
  to: PhoneNumber
  contacts: ContactPayload[]
  context?: { messageId: string }
}

export interface ReactionMessage {
  type: 'reaction'
  to: PhoneNumber
  reaction: {
    /** The message ID to react to */
    messageId: string
    /** Emoji to react with, or empty string to remove reaction */
    emoji: string
  }
}

export interface InteractiveButtonMessage {
  type: 'interactive.button'
  to: PhoneNumber
  body: string
  header?: InteractiveHeader
  footer?: string
  /** Maximum 3 buttons */
  buttons: ButtonDef[]
  context?: { messageId: string }
}

export interface InteractiveListMessage {
  type: 'interactive.list'
  to: PhoneNumber
  body: string
  buttonText: string
  header?: string
  footer?: string
  /** Maximum 10 sections */
  sections: SectionDef[]
  context?: { messageId: string }
}

// ---------------------------------------------------------------------------
// Union of all outbound messages
// ---------------------------------------------------------------------------

export type OutboundMessage =
  | TextMessage
  | TemplateMessage
  | ImageMessage
  | VideoMessage
  | AudioMessage
  | DocumentMessage
  | StickerMessage
  | LocationMessage
  | ContactsMessage
  | ReactionMessage
  | InteractiveButtonMessage
  | InteractiveListMessage

// ---------------------------------------------------------------------------
// Supporting types
// ---------------------------------------------------------------------------

export interface ButtonDef {
  id: string
  title: string
}

export interface SectionDef {
  title: string
  rows: SectionRow[]
}

export interface SectionRow {
  id: string
  title: string
  description?: string
}

export type InteractiveHeader =
  | { type: 'text'; text: string }
  | { type: 'image'; image: MediaSource }
  | { type: 'video'; video: MediaSource }
  | { type: 'document'; document: MediaSource }

// ---------------------------------------------------------------------------
// Template component types
// ---------------------------------------------------------------------------

export interface TemplateComponent {
  type: 'header' | 'body' | 'button'
  sub_type?: 'quick_reply' | 'url'
  index?: number
  parameters: TemplateParameter[]
}

export type TemplateParameter =
  | { type: 'text'; text: string }
  | { type: 'currency'; currency: CurrencyParam }
  | { type: 'date_time'; date_time: { fallback_value: string } }
  | { type: 'image'; image: MediaSource }
  | { type: 'video'; video: MediaSource }
  | { type: 'document'; document: MediaSource }
  | { type: 'payload'; payload: string }

export interface CurrencyParam {
  fallback_value: string
  code: string
  amount_1000: number
}

// ---------------------------------------------------------------------------
// Contact payload (vCard)
// ---------------------------------------------------------------------------

export interface ContactPayload {
  name: {
    formatted_name: string
    first_name?: string
    last_name?: string
    middle_name?: string
    prefix?: string
    suffix?: string
  }
  phones?: Array<{
    phone: string
    type?: 'CELL' | 'MAIN' | 'IPHONE' | 'HOME' | 'WORK'
    wa_id?: string
  }>
  emails?: Array<{
    email: string
    type?: 'HOME' | 'WORK'
  }>
  urls?: Array<{
    url: string
    type?: 'HOME' | 'WORK'
  }>
  addresses?: Array<{
    street?: string
    city?: string
    state?: string
    zip?: string
    country?: string
    country_code?: string
    type?: 'HOME' | 'WORK'
  }>
  org?: {
    company?: string
    department?: string
    title?: string
  }
  birthday?: string
}

// ---------------------------------------------------------------------------
// Convenience option types for the client's shorthand methods
// ---------------------------------------------------------------------------

export interface TextOptions {
  previewUrl?: boolean
  replyTo?: string
}

export interface MediaMessageOptions {
  caption?: string
  replyTo?: string
}

export interface DocumentOptions extends MediaMessageOptions {
  filename?: string
}

export interface InteractiveOptions {
  header?: InteractiveHeader
  footer?: string
  replyTo?: string
}

export interface LocationPayload {
  latitude: number
  longitude: number
  name?: string
  address?: string
}
