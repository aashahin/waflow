// ---------------------------------------------------------------------------
// Cloud API webhook parser — normalizes Meta webhook payloads to unified events
// ---------------------------------------------------------------------------

import type { ProviderName } from '../../types/common.js'
import type {
  WebhookEvent,
  IncomingMessage,
  WebhookMetadata,
} from '../../types/webhooks.js'
import type {
  CloudApiWebhookPayload,
  CloudApiWebhookValue,
  CloudApiRawMessage,
  CloudApiRawStatus,
} from './types.js'
import { isRecord, hasProp } from '../../utils/assert.js'

/**
 * Parse a raw Cloud API webhook payload into normalized WebhookEvent[].
 *
 * A single webhook POST can contain multiple entries and multiple changes,
 * each of which may contain multiple messages or statuses.
 * We flatten all of them into a single array.
 *
 * @param providerName - Allows 360Dialog to reuse this parser with its own name
 */
export function parseCloudApiWebhook(
  body: unknown,
  providerName: ProviderName = 'cloud-api',
): WebhookEvent[] {
  if (!isValidWebhookPayload(body)) return []

  const events: WebhookEvent[] = []

  for (const entry of body.entry) {
    for (const change of entry.changes) {
      if (change.field !== 'messages') continue

      const value = change.value
      const metadata = buildMetadata(value, body, providerName)

      // Parse incoming messages
      if (value.messages) {
        for (const msg of value.messages) {
          const contact = value.contacts?.find(c => c.wa_id === msg.from) ?? value.contacts?.[0]
          events.push({
            type: 'message',
            messageId: msg.id,
            from: msg.from,
            timestamp: new Date(parseInt(msg.timestamp, 10) * 1000),
            message: parseIncomingMessage(msg),
            contact: contact
              ? { name: contact.profile.name, waId: contact.wa_id }
              : undefined,
            metadata,
          })
        }
      }

      // Parse status updates
      if (value.statuses) {
        for (const status of value.statuses) {
          events.push(parseStatusEvent(status, metadata))
        }
      }

      // Parse errors
      if (value.errors) {
        for (const error of value.errors) {
          events.push({
            type: 'error',
            code: error.code,
            title: error.title,
            message: error.message,
            metadata,
          })
        }
      }
    }
  }

  return events
}

// ---------------------------------------------------------------------------
// Message type parsing
// ---------------------------------------------------------------------------

function parseIncomingMessage(msg: CloudApiRawMessage): IncomingMessage {
  switch (msg.type) {
    case 'text':
      return { type: 'text', body: msg.text?.body ?? '' }

    case 'image':
      return {
        type: 'image',
        mediaId: msg.image?.id ?? '',
        mimeType: msg.image?.mime_type ?? '',
        sha256: msg.image?.sha256,
        caption: msg.image?.caption,
      }

    case 'video':
      return {
        type: 'video',
        mediaId: msg.video?.id ?? '',
        mimeType: msg.video?.mime_type ?? '',
        sha256: msg.video?.sha256,
        caption: msg.video?.caption,
      }

    case 'audio':
      return {
        type: 'audio',
        mediaId: msg.audio?.id ?? '',
        mimeType: msg.audio?.mime_type ?? '',
        sha256: msg.audio?.sha256,
        voice: msg.audio?.voice,
      }

    case 'document':
      return {
        type: 'document',
        mediaId: msg.document?.id ?? '',
        mimeType: msg.document?.mime_type ?? '',
        sha256: msg.document?.sha256,
        filename: msg.document?.filename,
        caption: msg.document?.caption,
      }

    case 'location':
      return {
        type: 'location',
        latitude: msg.location?.latitude ?? 0,
        longitude: msg.location?.longitude ?? 0,
        name: msg.location?.name,
        address: msg.location?.address,
      }

    case 'sticker':
      return {
        type: 'sticker',
        mediaId: msg.sticker?.id ?? '',
        mimeType: msg.sticker?.mime_type ?? '',
        animated: msg.sticker?.animated ?? false,
      }

    case 'reaction':
      return {
        type: 'reaction',
        emoji: msg.reaction?.emoji ?? '',
        reactedMessageId: msg.reaction?.message_id ?? '',
      }

    case 'interactive':
      if (msg.interactive?.type === 'button_reply' && msg.interactive.button_reply) {
        return {
          type: 'button_reply',
          buttonId: msg.interactive.button_reply.id,
          title: msg.interactive.button_reply.title,
        }
      }
      if (msg.interactive?.type === 'list_reply' && msg.interactive.list_reply) {
        return {
          type: 'list_reply',
          listId: msg.interactive.list_reply.id,
          title: msg.interactive.list_reply.title,
          description: msg.interactive.list_reply.description,
        }
      }
      return { type: 'unknown', raw: msg }

    case 'contacts':
      return {
        type: 'contacts',
        contacts: msg.contacts ?? [],
      }

    default:
      return { type: 'unknown', raw: msg }
  }
}

// ---------------------------------------------------------------------------
// Status event parsing
// ---------------------------------------------------------------------------

function parseStatusEvent(
  status: CloudApiRawStatus,
  metadata: WebhookMetadata,
): WebhookEvent {
  return {
    type: 'status',
    messageId: status.id,
    status: status.status,
    recipientId: status.recipient_id,
    timestamp: new Date(parseInt(status.timestamp, 10) * 1000),
    errors: status.errors,
    metadata,
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function buildMetadata(
  value: CloudApiWebhookValue,
  raw: unknown,
  provider: ProviderName,
): WebhookMetadata {
  return {
    provider,
    phoneNumberId: value.metadata.phone_number_id,
    displayPhoneNumber: value.metadata.display_phone_number,
    raw,
  }
}

function isValidWebhookPayload(body: unknown): body is CloudApiWebhookPayload {
  return (
    isRecord(body) &&
    hasProp(body, 'entry') &&
    Array.isArray(body['entry'])
  )
}
