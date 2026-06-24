// ---------------------------------------------------------------------------
// Unified inbound webhook event types
// ---------------------------------------------------------------------------

import type { ProviderName } from './common.js'

// ---------------------------------------------------------------------------
// Top-level webhook event (discriminated by `type`)
// ---------------------------------------------------------------------------

export type WebhookEvent =
  | IncomingMessageEvent
  | MessageStatusEvent
  | MessageErrorEvent

// ---------------------------------------------------------------------------
// Incoming message from a user
// ---------------------------------------------------------------------------

export interface IncomingMessageEvent {
  type: 'message'
  /** Provider-assigned message ID */
  messageId: string
  /** Sender phone number in E.164 format */
  from: string
  /** When the message was sent */
  timestamp: Date
  /** The actual message content */
  message: IncomingMessage
  /** Sender contact info (when available) */
  contact?: { name: string; waId: string }
  /** Provider metadata */
  metadata: WebhookMetadata
}

/** Discriminated union of all possible incoming message shapes */
export type IncomingMessage =
  | IncomingTextMessage
  | IncomingImageMessage
  | IncomingVideoMessage
  | IncomingAudioMessage
  | IncomingDocumentMessage
  | IncomingLocationMessage
  | IncomingStickerMessage
  | IncomingReactionMessage
  | IncomingButtonReply
  | IncomingListReply
  | IncomingContactsMessage
  | IncomingUnknownMessage

export interface IncomingTextMessage {
  type: 'text'
  body: string
}

export interface IncomingImageMessage {
  type: 'image'
  mediaId: string
  mimeType: string
  sha256?: string
  caption?: string
}

export interface IncomingVideoMessage {
  type: 'video'
  mediaId: string
  mimeType: string
  sha256?: string
  caption?: string
}

export interface IncomingAudioMessage {
  type: 'audio'
  mediaId: string
  mimeType: string
  sha256?: string
  voice?: boolean
}

export interface IncomingDocumentMessage {
  type: 'document'
  mediaId: string
  mimeType: string
  sha256?: string
  filename?: string
  caption?: string
}

export interface IncomingLocationMessage {
  type: 'location'
  latitude: number
  longitude: number
  name?: string
  address?: string
}

export interface IncomingStickerMessage {
  type: 'sticker'
  mediaId: string
  mimeType: string
  animated: boolean
}

export interface IncomingReactionMessage {
  type: 'reaction'
  emoji: string
  reactedMessageId: string
}

export interface IncomingButtonReply {
  type: 'button_reply'
  buttonId: string
  title: string
}

export interface IncomingListReply {
  type: 'list_reply'
  listId: string
  title: string
  description?: string
}

export interface IncomingContactsMessage {
  type: 'contacts'
  contacts: Array<{
    name: { formatted_name: string; first_name?: string; last_name?: string }
    phones?: Array<{ phone: string; wa_id?: string; type?: string }>
  }>
}

export interface IncomingUnknownMessage {
  type: 'unknown'
  /** Raw payload for debugging */
  raw: unknown
}

// ---------------------------------------------------------------------------
// Message status update
// ---------------------------------------------------------------------------

export interface MessageStatusEvent {
  type: 'status'
  /** The message ID this status relates to */
  messageId: string
  /** Delivery status */
  status: 'sent' | 'delivered' | 'read' | 'failed'
  /** Recipient phone number */
  recipientId: string
  /** When this status was recorded */
  timestamp: Date
  /** Error details (only when status === 'failed') */
  errors?: Array<{ code: number; title: string; message?: string }>
  /** Provider metadata */
  metadata: WebhookMetadata
}

// ---------------------------------------------------------------------------
// Error event
// ---------------------------------------------------------------------------

export interface MessageErrorEvent {
  type: 'error'
  code: number
  title: string
  message: string
  metadata: WebhookMetadata
}

// ---------------------------------------------------------------------------
// Shared webhook metadata
// ---------------------------------------------------------------------------

export interface WebhookMetadata {
  /** Which provider this webhook came from */
  provider: ProviderName
  /** Phone number ID (when available) */
  phoneNumberId?: string
  /** Display phone number (when available) */
  displayPhoneNumber?: string
  /**
   * Raw webhook payload for debugging. Only populated when the client is
   * created with `includeRawWebhook: true` (otherwise `undefined` to avoid
   * retaining the full body on every event).
   */
  raw?: unknown
}
