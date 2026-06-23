// ---------------------------------------------------------------------------
// Wati webhook parser — normalizes Wati's flat webhook payloads
// ---------------------------------------------------------------------------

import type { WebhookEvent, IncomingMessage, WebhookMetadata } from '../../types/webhooks.js'
import type { WatiWebhookPayload } from './types.js'
import { isRecord } from '../../utils/assert.js'

/**
 * Parse a raw Wati webhook payload into normalized WebhookEvent[].
 *
 * Wati sends flat JSON payloads — one event per webhook POST.
 * Unlike Cloud API, there is no nested entry/changes structure.
 */
export function parseWatiWebhook(
  body: unknown,
  options: { includeRaw?: boolean } = {},
): WebhookEvent[] {
  if (!isRecord(body)) return []

  const payload = body as WatiWebhookPayload
  const metadata = buildMetadata(payload, options.includeRaw ?? false)

  // Determine event type from the payload
  const eventType = payload.eventType ?? detectEventType(payload)

  switch (eventType) {
    case 'message':
    case 'messages':
      return parseIncomingMessage(payload, metadata)

    case 'status':
    case 'message_status':
      return parseStatusUpdate(payload, metadata)

    case 'error':
      return parseError(payload, metadata)

    default:
      // Try to detect from payload shape
      if (payload.waId && (payload.text || payload.type)) {
        return parseIncomingMessage(payload, metadata)
      }
      if (payload.statusString && payload.localMessageId) {
        return parseStatusUpdate(payload, metadata)
      }
      return []
  }
}

// ---------------------------------------------------------------------------
// Parsers
// ---------------------------------------------------------------------------

function parseIncomingMessage(
  payload: WatiWebhookPayload,
  metadata: WebhookMetadata,
): WebhookEvent[] {
  if (!payload.waId) return []

  const message = parseMessageContent(payload)

  return [
    {
      type: 'message',
      messageId: payload.messageId ?? '',
      from: payload.waId,
      timestamp: parseWatiTimestamp(payload.timestamp),
      message,
      contact: payload.senderName
        ? { name: payload.senderName, waId: payload.waId }
        : undefined,
      metadata,
    },
  ]
}

function parseMessageContent(payload: WatiWebhookPayload): IncomingMessage {
  const msgType = payload.type?.toLowerCase()

  switch (msgType) {
    case 'text':
      return { type: 'text', body: payload.text ?? '' }

    case 'image':
      return {
        type: 'image',
        mediaId: payload.mediaUrl ?? '',
        mimeType: payload.mimeType ?? 'image/jpeg',
        caption: payload.caption,
      }

    case 'video':
      return {
        type: 'video',
        mediaId: payload.mediaUrl ?? '',
        mimeType: payload.mimeType ?? 'video/mp4',
        caption: payload.caption,
      }

    case 'audio':
      return {
        type: 'audio',
        mediaId: payload.mediaUrl ?? '',
        mimeType: payload.mimeType ?? 'audio/ogg',
      }

    case 'document':
      return {
        type: 'document',
        mediaId: payload.mediaUrl ?? '',
        mimeType: payload.mimeType ?? 'application/octet-stream',
        filename: payload.filename,
        caption: payload.caption,
      }

    case 'location':
      return {
        type: 'location',
        latitude: payload.latitude ?? 0,
        longitude: payload.longitude ?? 0,
        name: payload.locationName,
        address: payload.locationAddress,
      }

    default:
      // If there's text content, treat as text
      if (payload.text) {
        return { type: 'text', body: payload.text }
      }
      return { type: 'unknown', raw: payload }
  }
}

function parseStatusUpdate(
  payload: WatiWebhookPayload,
  metadata: WebhookMetadata,
): WebhookEvent[] {
  const statusMap: Record<string, 'sent' | 'delivered' | 'read' | 'failed'> = {
    sent: 'sent',
    delivered: 'delivered',
    read: 'read',
    failed: 'failed',
    error: 'failed',
  }

  const status = statusMap[payload.statusString?.toLowerCase() ?? ''] ?? 'sent'

  return [
    {
      type: 'status',
      messageId: payload.localMessageId ?? payload.messageId ?? '',
      status,
      recipientId: payload.waId ?? '',
      timestamp: parseWatiTimestamp(payload.timestamp),
      metadata,
    },
  ]
}

function parseError(
  payload: WatiWebhookPayload,
  metadata: WebhookMetadata,
): WebhookEvent[] {
  return [
    {
      type: 'error',
      code: payload.errorCode ?? 0,
      title: 'Wati Error',
      message: payload.errorMessage ?? 'Unknown error',
      metadata,
    },
  ]
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function buildMetadata(payload: WatiWebhookPayload, includeRaw: boolean): WebhookMetadata {
  return {
    provider: 'wati',
    ...(includeRaw ? { raw: payload } : {}),
  }
}

function detectEventType(payload: WatiWebhookPayload): string {
  if (payload.errorCode !== undefined || payload.errorMessage) return 'error'
  if (payload.statusString) return 'status'
  if (payload.waId) return 'message'
  return 'unknown'
}

/**
 * Parse Wati timestamp — handles both ISO strings and Unix epoch strings.
 * Wati's API doesn't document the exact format, so we handle both gracefully.
 */
function parseWatiTimestamp(raw?: string): Date {
  if (!raw) return new Date()
  // If the timestamp is all digits, treat as Unix epoch (seconds)
  if (/^\d+$/.test(raw)) {
    return new Date(parseInt(raw, 10) * 1000)
  }
  // Otherwise, try ISO string parsing
  const date = new Date(raw)
  return isNaN(date.getTime()) ? new Date() : date
}
