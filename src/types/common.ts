// ---------------------------------------------------------------------------
// Shared primitive types used across the SDK
// ---------------------------------------------------------------------------

/** Phone number in E.164 format (e.g. "+966501234567") */
export type PhoneNumber = string

/** Provider-issued message identifier */
export type MessageId = string

/** Provider-issued media identifier */
export type MediaId = string

/** ISO 8601 timestamp string */
export type Timestamp = string

/** Supported provider identifiers */
export type ProviderName = 'cloud-api' | '360dialog' | 'wati'

/** Result of any successful send operation */
export interface SendResult {
  /** Provider-assigned message ID */
  messageId: MessageId
  /** Which provider handled this send */
  provider: ProviderName
  /** Raw provider response (opt-in for debugging) */
  raw?: unknown
}

/** Media source — either a public URL or a previously uploaded media ID */
export type MediaSource =
  | { url: string; id?: never }
  | { id: MediaId; url?: never }

/** Contact information for a WhatsApp user */
export interface ContactInfo {
  name: string
  waId: string
}
