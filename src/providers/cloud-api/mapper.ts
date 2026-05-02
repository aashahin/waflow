// ---------------------------------------------------------------------------
// Cloud API mapper — unified types → Meta Graph API payloads
// ---------------------------------------------------------------------------

import type { OutboundMessage } from '../../types/messages.js'
import type { MediaSource } from '../../types/common.js'
import { normalizePhoneNumber } from '../../utils/phone.js'
import { assertNever } from '../../utils/assert.js'
import { ValidationError } from '../../core/errors.js'

/**
 * Map a unified OutboundMessage to the Cloud API request payload.
 * This is the canonical mapping — 360Dialog reuses it since their
 * payload format is identical.
 */
export function mapOutboundToCloudApi(message: OutboundMessage): Record<string, unknown> {
  const to = normalizePhoneNumber(message.to)

  const base: Record<string, unknown> = {
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to,
  }

  // Attach reply context if present
  if ('context' in message && message.context?.messageId) {
    base['context'] = { message_id: message.context.messageId }
  }

  switch (message.type) {
    case 'text':
      return {
        ...base,
        type: 'text',
        text: {
          body: message.text.body,
          preview_url: message.text.previewUrl ?? false,
        },
      }

    case 'template':
      return {
        ...base,
        type: 'template',
        template: {
          name: message.template.name,
          language: { code: message.template.language },
          ...(message.template.components
            ? { components: message.template.components }
            : {}),
        },
      }

    case 'image':
      return {
        ...base,
        type: 'image',
        image: {
          ...mapMediaSource(message.image),
          ...(message.image.caption ? { caption: message.image.caption } : {}),
        },
      }

    case 'video':
      return {
        ...base,
        type: 'video',
        video: {
          ...mapMediaSource(message.video),
          ...(message.video.caption ? { caption: message.video.caption } : {}),
        },
      }

    case 'audio':
      return {
        ...base,
        type: 'audio',
        audio: mapMediaSource(message.audio),
      }

    case 'document':
      return {
        ...base,
        type: 'document',
        document: {
          ...mapMediaSource(message.document),
          ...(message.document.caption ? { caption: message.document.caption } : {}),
          ...(message.document.filename ? { filename: message.document.filename } : {}),
        },
      }

    case 'sticker':
      return {
        ...base,
        type: 'sticker',
        sticker: mapMediaSource(message.sticker),
      }

    case 'location':
      return {
        ...base,
        type: 'location',
        location: {
          latitude: message.location.latitude,
          longitude: message.location.longitude,
          ...(message.location.name ? { name: message.location.name } : {}),
          ...(message.location.address ? { address: message.location.address } : {}),
        },
      }

    case 'contacts':
      return {
        ...base,
        type: 'contacts',
        contacts: message.contacts,
      }

    case 'reaction':
      return {
        ...base,
        type: 'reaction',
        reaction: {
          message_id: message.reaction.messageId,
          emoji: message.reaction.emoji,
        },
      }

    case 'interactive.button':
      if (message.buttons.length > 3) {
        throw new ValidationError({
          message: `Interactive buttons: maximum 3 buttons allowed, got ${message.buttons.length}`,
          provider: 'cloud-api',
        })
      }
      return {
        ...base,
        type: 'interactive',
        interactive: {
          type: 'button',
          ...(message.header ? { header: mapInteractiveHeader(message.header) } : {}),
          body: { text: message.body },
          ...(message.footer ? { footer: { text: message.footer } } : {}),
          action: {
            buttons: message.buttons.map(btn => ({
              type: 'reply' as const,
              reply: { id: btn.id, title: btn.title },
            })),
          },
        },
      }

    case 'interactive.list':
      if (message.sections.length > 10) {
        throw new ValidationError({
          message: `Interactive list: maximum 10 sections allowed, got ${message.sections.length}`,
          provider: 'cloud-api',
        })
      }
      return {
        ...base,
        type: 'interactive',
        interactive: {
          type: 'list',
          ...(message.header ? { header: { type: 'text', text: message.header } } : {}),
          body: { text: message.body },
          ...(message.footer ? { footer: { text: message.footer } } : {}),
          action: {
            button: message.buttonText,
            sections: message.sections.map(section => ({
              title: section.title,
              rows: section.rows.map(row => ({
                id: row.id,
                title: row.title,
                ...(row.description ? { description: row.description } : {}),
              })),
            })),
          },
        },
      }

    default:
      return assertNever(message)
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function mapMediaSource(source: MediaSource): Record<string, string> {
  if ('url' in source && source.url) {
    return { link: source.url }
  }
  if ('id' in source && source.id) {
    return { id: source.id }
  }
  throw new Error('MediaSource must have either url or id')
}

function mapInteractiveHeader(
  header: NonNullable<Extract<OutboundMessage, { type: 'interactive.button' }>['header']>,
): Record<string, unknown> {
  switch (header.type) {
    case 'text':
      return { type: 'text', text: header.text }
    case 'image':
      return { type: 'image', image: mapMediaSource(header.image) }
    case 'video':
      return { type: 'video', video: mapMediaSource(header.video) }
    case 'document':
      return { type: 'document', document: mapMediaSource(header.document) }
    default:
      return assertNever(header)
  }
}
