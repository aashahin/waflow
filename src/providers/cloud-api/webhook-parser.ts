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
import { isRecord } from '../../utils/assert.js'

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
  options: { includeRaw?: boolean } = {},
): WebhookEvent[] {
  if (!isValidWebhookPayload(body)) return []

  const events: WebhookEvent[] = []
  const raw = options.includeRaw ? body : undefined

  for (const entry of body.entry) {
    if (!isRecord(entry) || !Array.isArray(entry.changes)) continue

    for (const change of entry.changes) {
      if (!isRecord(change) || !isRecord(change.value)) continue

      const field = typeof change.field === 'string' ? change.field : ''
      const value = change.value

      if (field === 'message_template_status_update') {
        const templateEvent = parseTemplateStatusEvent(value as Record<string, unknown>, raw, providerName)
        if (templateEvent) events.push(templateEvent)
        continue
      }

      if (field !== 'messages') continue

      const metadata = buildMetadata(value, raw, providerName)

      if (Array.isArray(value.messages)) {
        const contactsByWaId = new Map<string, { name: string; waId: string }>()
        if (Array.isArray(value.contacts)) {
          for (const c of value.contacts) {
            if (!isRecord(c) || typeof c.wa_id !== 'string' || contactsByWaId.has(c.wa_id)) continue
            const name = isRecord(c.profile) && typeof c.profile.name === 'string' ? c.profile.name : undefined
            if (name) contactsByWaId.set(c.wa_id, { name, waId: c.wa_id })
          }
        }

        for (const msg of value.messages) {
          if (!isRecord(msg) || typeof msg.id !== 'string' || typeof msg.from !== 'string') continue
          const typed = msg as unknown as CloudApiRawMessage
          events.push({
            type: 'message',
            messageId: typed.id,
            from: typed.from,
            timestamp: parseUnixTimestamp(typed.timestamp),
            message: parseIncomingMessage(typed),
            contact: contactsByWaId.get(typed.from),
            context: parseMessageContext(typed),
            metadata,
          })
        }
      }

      if (Array.isArray(value.statuses)) {
        for (const status of value.statuses) {
          if (!isRecord(status) || typeof status.id !== 'string') continue
          if (
            status.status !== 'sent'
            && status.status !== 'delivered'
            && status.status !== 'read'
            && status.status !== 'failed'
          ) {
            continue
          }
          events.push(parseStatusEvent(status as unknown as CloudApiRawStatus, metadata))
        }
      }

      if (Array.isArray(value.errors)) {
        for (const error of value.errors) {
          if (!isRecord(error)) continue
          events.push({
            type: 'error',
            code: typeof error.code === 'number' ? error.code : 0,
            title: typeof error.title === 'string' ? error.title : 'Error',
            message: typeof error.message === 'string' ? error.message : '',
            metadata,
          })
        }
      }
    }
  }

  return events
}

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

    case 'button':
      return {
        type: 'button_reply',
        buttonId: msg.button?.payload ?? '',
        title: msg.button?.text ?? '',
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

function parseStatusEvent(
  status: CloudApiRawStatus,
  metadata: WebhookMetadata,
): WebhookEvent {
  return {
    type: 'status',
    messageId: status.id,
    status: status.status,
    recipientId: status.recipient_id,
    timestamp: parseUnixTimestamp(status.timestamp),
    errors: status.errors,
    metadata,
  }
}

function parseTemplateStatusEvent(
  value: Record<string, unknown>,
  raw: unknown,
  provider: ProviderName,
): WebhookEvent | undefined {
  const status = typeof value.event === 'string' ? value.event : undefined
  const templateName = typeof value.message_template_name === 'string' ? value.message_template_name : undefined
  const templateId = value.message_template_id !== undefined ? String(value.message_template_id) : undefined
  if (!status && !templateName && !templateId) return undefined
  return {
    type: 'template_status',
    templateId,
    templateName,
    language: typeof value.message_template_language === 'string' ? value.message_template_language : undefined,
    status: status ?? 'UNKNOWN',
    reason: typeof value.reason === 'string' ? value.reason : undefined,
    metadata: {
      provider,
      ...(raw !== undefined ? { raw } : {}),
    },
  }
}

function parseMessageContext(
  msg: CloudApiRawMessage,
): { messageId: string; from?: string } | undefined {
  if (!msg.context?.id) return undefined
  return {
    messageId: msg.context.id,
    from: msg.context.from,
  }
}

function parseUnixTimestamp(raw: unknown): Date {
  if (typeof raw !== 'string' && typeof raw !== 'number') return new Date(0)
  const seconds = typeof raw === 'number' ? raw : parseInt(raw, 10)
  if (!Number.isFinite(seconds)) return new Date(0)
  return new Date(seconds * 1000)
}

function buildMetadata(
  value: CloudApiWebhookValue | Record<string, unknown>,
  raw: unknown,
  provider: ProviderName,
): WebhookMetadata {
  const metadata = isRecord(value.metadata) ? value.metadata : undefined
  return {
    provider,
    phoneNumberId: typeof metadata?.phone_number_id === 'string' ? metadata.phone_number_id : undefined,
    displayPhoneNumber: typeof metadata?.display_phone_number === 'string' ? metadata.display_phone_number : undefined,
    ...(raw !== undefined ? { raw } : {}),
  }
}

function isValidWebhookPayload(body: unknown): body is CloudApiWebhookPayload {
  return isRecord(body) && Array.isArray(body.entry)
}
