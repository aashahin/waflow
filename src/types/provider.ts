// ---------------------------------------------------------------------------
// Provider adapter interface — the contract every provider must implement
// ---------------------------------------------------------------------------

import type { SendResult } from './common.js'
import type { MediaDownloadResult, MediaUpload, MediaUploadResult, MediaUrlResult } from './media.js'
import type { OutboundMessage } from './messages.js'
import type { CreateTemplateInput, Template } from './templates.js'
import type { WebhookEvent } from './webhooks.js'

/** Features that a provider may or may not support */
export type ProviderFeature =
  | 'interactive.button'
  | 'interactive.list'
  | 'media.upload'
  | 'media.download'
  | 'media.delete'
  | 'template.management'
  | 'reaction'
  | 'read_receipts'
  | 'sticker'
  | 'location'
  | 'contacts'
  | 'webhook.signature_verification'
  | 'webhook.challenge'

/**
 * The contract every WhatsApp provider adapter must implement.
 *
 * The `WhatsAppClient` delegates all operations to the active adapter.
 * To add a new provider, implement this interface and register it
 * in the provider factory map.
 */
export interface WhatsAppProviderAdapter {
  /** Provider identifier (e.g. "cloud-api", "360dialog", "wati") */
  readonly name: string

  // -- Messaging ----------------------------------------------------------

  /** Send any outbound message type */
  sendMessage(message: OutboundMessage): Promise<SendResult>

  /** Mark a message as read (send read receipt) */
  markAsRead(messageId: string): Promise<void>

  // -- Media --------------------------------------------------------------

  /** Upload media to the provider */
  uploadMedia(params: MediaUpload): Promise<MediaUploadResult>

  /** Get the download URL for a media item */
  getMediaUrl(mediaId: string): Promise<MediaUrlResult>

  /** Download media as a ReadableStream */
  downloadMedia(mediaIdOrUrl: string): Promise<MediaDownloadResult>

  /** Delete a previously uploaded media item */
  deleteMedia(mediaId: string): Promise<void>

  // -- Webhooks -----------------------------------------------------------

  /** Parse a raw webhook payload into normalized events */
  parseWebhook(body: unknown): WebhookEvent[]

  /**
   * Verify the cryptographic signature of a webhook payload.
   * Uses Web Crypto API (crypto.subtle) — no node:crypto.
   */
  verifyWebhookSignature(body: string, signature: string): Promise<boolean>

  /**
   * Handle the webhook verification challenge (GET request).
   * Returns the challenge string if valid, null if invalid.
   * Only applicable to providers that use challenge-response (Cloud API).
   */
  handleVerificationChallenge?(query: Record<string, string>): string | null

  // -- Templates (optional) -----------------------------------------------

  /** List all message templates */
  listTemplates?(): Promise<Template[]>

  /** Create a new message template */
  createTemplate?(input: CreateTemplateInput): Promise<Template>

  /** Delete a message template by name */
  deleteTemplate?(name: string): Promise<void>

  // -- Capabilities -------------------------------------------------------

  /** Check if this provider supports a specific feature */
  supports(feature: ProviderFeature): boolean

  // -- Lifecycle (optional) -----------------------------------------------

  /**
   * Release any resources held by the adapter (e.g. the rate limiter's pending
   * timer and queued waiters). Optional — adapters without resources may omit it.
   */
  destroy?(): void
}
