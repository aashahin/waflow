// ---------------------------------------------------------------------------
// Cloud API mapper — unified types → Meta Graph API payloads
// ---------------------------------------------------------------------------

import type { OutboundMessage, TemplateComponent, TemplateParameter } from '../../types/messages.js'
import type { MediaSource, ProviderName } from '../../types/common.js'
import { normalizePhoneNumber } from '../../utils/phone.js'
import { assertNever } from '../../utils/assert.js'
import { ValidationError } from '../../core/errors.js'

/**
 * Map a unified OutboundMessage to the Cloud API request payload.
 * This is the canonical mapping — 360Dialog reuses it since their
 * payload format is identical.
 */
export function mapOutboundToCloudApi(
  message: OutboundMessage,
  provider: ProviderName = 'cloud-api',
): Record<string, unknown> {
  const to = normalizePhoneNumber(message.to, provider)

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
            ? { components: mapTemplateComponents(message.template.components, provider) }
            : {}),
        },
      }

    case 'image':
      return {
        ...base,
        type: 'image',
        image: {
           ...mapMediaSource(message.image, provider),
           ...(message.image.caption ? { caption: message.image.caption } : {}),
        },
      }

    case 'video':
      return {
        ...base,
        type: 'video',
        video: {
           ...mapMediaSource(message.video, provider),
           ...(message.video.caption ? { caption: message.video.caption } : {}),
        },
      }

    case 'audio':
      return {
        ...base,
        type: 'audio',
         audio: mapMediaSource(message.audio, provider),
      }

    case 'document':
      return {
        ...base,
        type: 'document',
        document: {
           ...mapMediaSource(message.document, provider),
           ...(message.document.caption ? { caption: message.document.caption } : {}),
          ...(message.document.filename ? { filename: message.document.filename } : {}),
        },
      }

    case 'sticker':
      return {
        ...base,
        type: 'sticker',
         sticker: mapMediaSource(message.sticker, provider),
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
      if (message.body.length < 1 || message.body.length > 1024) {
        throw new ValidationError({
          message: `Interactive buttons: body must be 1-1024 characters (got ${message.body.length})`,
          provider,
        })
      }
      if (message.buttons.length === 0) {
        throw new ValidationError({
          message: 'Interactive buttons: at least 1 button is required',
          provider,
        })
      }
      if (message.buttons.length > 3) {
        throw new ValidationError({
          message: `Interactive buttons: maximum 3 buttons allowed, got ${message.buttons.length}`,
          provider,
        })
      }
      for (const button of message.buttons) {
        if (button.title.length > 20) {
          throw new ValidationError({
            message: `Interactive buttons: title exceeds 20 characters (got ${button.title.length})`,
            provider,
          })
        }
        if (button.id.length < 1 || button.id.length > 256) {
          throw new ValidationError({
            message: `Interactive buttons: id must be 1-256 characters (got ${button.id.length})`,
            provider,
          })
        }
      }
      return {
        ...base,
        type: 'interactive',
        interactive: {
          type: 'button',
           ...(message.header ? { header: mapInteractiveHeader(message.header, provider) } : {}),
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

    case 'interactive.list': {
      if (message.body.length < 1 || message.body.length > 1024) {
        throw new ValidationError({
          message: `Interactive list: body must be 1-1024 characters (got ${message.body.length})`,
          provider,
        })
      }
      if (message.buttonText.length > 20) {
        throw new ValidationError({
          message: `Interactive list: button text exceeds 20 characters (got ${message.buttonText.length})`,
          provider,
        })
      }
      if (message.sections.length === 0) {
        throw new ValidationError({
          message: 'Interactive list: at least 1 section is required',
          provider,
        })
      }
      if (message.sections.length > 10) {
        throw new ValidationError({
          message: `Interactive list: maximum 10 sections allowed, got ${message.sections.length}`,
          provider,
        })
      }
      // WhatsApp's real binding limit is ≤ 10 rows TOTAL across all sections.
      const totalRows = message.sections.reduce((sum, section) => sum + section.rows.length, 0)
      if (totalRows === 0) {
        throw new ValidationError({
          message: 'Interactive list: at least 1 row is required',
          provider,
        })
      }
      if (totalRows > 10) {
        throw new ValidationError({
          message: `Interactive list: maximum 10 rows total across all sections, got ${totalRows}`,
          provider,
        })
      }
      for (const section of message.sections) {
        if (section.title.length > 24) {
          throw new ValidationError({
            message: `Interactive list: section title exceeds 24 characters (got ${section.title.length})`,
            provider,
          })
        }
        for (const row of section.rows) {
          if (row.title.length > 24) {
            throw new ValidationError({
              message: `Interactive list: row title exceeds 24 characters (got ${row.title.length})`,
              provider,
            })
          }
          if (row.description !== undefined && row.description.length > 72) {
            throw new ValidationError({
              message: `Interactive list: row description exceeds 72 characters (got ${row.description.length})`,
              provider,
            })
          }
        }
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
    }

    default:
      return assertNever(message)
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function mapMediaSource(source: MediaSource, provider: ProviderName): Record<string, string> {
  if ('url' in source && source.url) {
    return { link: source.url }
  }
  if ('id' in source && source.id) {
    return { id: source.id }
  }
  throw new ValidationError({
    message: 'MediaSource must have either url or id',
    provider,
  })
}

function mapInteractiveHeader(
  header: NonNullable<Extract<OutboundMessage, { type: 'interactive.button' }>['header']>,
  provider: ProviderName,
): Record<string, unknown> {
  switch (header.type) {
    case 'text':
      return { type: 'text', text: header.text }
    case 'image':
      return { type: 'image', image: mapMediaSource(header.image, provider) }
    case 'video':
      return { type: 'video', video: mapMediaSource(header.video, provider) }
    case 'document':
      return { type: 'document', document: mapMediaSource(header.document, provider) }
    default:
      return assertNever(header)
  }
}

function mapTemplateComponents(
  components: TemplateComponent[],
  provider: ProviderName,
): Array<Record<string, unknown>> {
  return components.map(component => ({
    type: component.type,
    ...(component.sub_type ? { sub_type: component.sub_type } : {}),
    ...(component.index !== undefined ? { index: component.index } : {}),
    parameters: component.parameters.map(parameter => mapTemplateParameter(parameter, provider)),
  }))
}

function mapTemplateParameter(
  parameter: TemplateParameter,
  provider: ProviderName,
): Record<string, unknown> {
  switch (parameter.type) {
    case 'text':
      return {
        type: 'text',
        text: parameter.text,
        ...(parameter.name ? { parameter_name: parameter.name } : {}),
      }
    case 'image':
      return { type: 'image', image: mapMediaSource(parameter.image, provider) }
    case 'video':
      return { type: 'video', video: mapMediaSource(parameter.video, provider) }
    case 'document':
      return { type: 'document', document: mapMediaSource(parameter.document, provider) }
    case 'currency':
      return { type: 'currency', currency: parameter.currency }
    case 'date_time':
      return { type: 'date_time', date_time: parameter.date_time }
    case 'payload':
      return { type: 'payload', payload: parameter.payload }
    default:
      return assertNever(parameter)
  }
}
