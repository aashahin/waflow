// ---------------------------------------------------------------------------
// Wati mapper — unified types → Wati REST API structure
//
// Wati has a completely different API surface:
// - Different endpoint per message type
// - Phone number in URL path or query param (not in body)
// - Template parameters use a flat array structure
// ---------------------------------------------------------------------------

import type { OutboundMessage, TemplateComponent } from '../../types/messages.js'
import type { MediaSource } from '../../types/common.js'
import { normalizePhoneNumber } from '../../utils/phone.js'
import { UnsupportedFeatureError } from '../../core/errors.js'

/** The result of mapping: which endpoint to call and what body to send */
export interface WatiMappedRequest {
  /** HTTP method */
  method: 'POST'
  /** Relative path (including phone number) */
  path: string
  /** Query parameters */
  query?: Record<string, string>
  /** JSON body */
  body?: Record<string, unknown>
  /** If true, use multipart/form-data instead of JSON */
  multipart?: boolean
}

/**
 * Map a unified OutboundMessage to a Wati REST API request.
 *
 * Key differences from Cloud API:
 * - Each message type has its own endpoint
 * - Phone number goes in URL, not body
 * - Templates have flat parameter arrays
 */
export function mapOutboundToWati(message: OutboundMessage): WatiMappedRequest {
  const phone = normalizePhoneNumber(message.to)

  switch (message.type) {
    case 'text':
      return {
        method: 'POST',
        path: `/api/v1/sendSessionMessage/${phone}`,
        body: {
          messageText: message.text.body,
        },
      }

    case 'template':
      return {
        method: 'POST',
        path: '/api/v2/sendTemplateMessage',
        query: { whatsappNumber: phone },
        body: {
          template_name: message.template.name,
          broadcast_name: `waflow_${Date.now()}`,
          parameters: flattenTemplateParameters(message.template.components),
        },
      }

    case 'image': {
      const imageUrl = extractWatiMediaUrl(message.image, 'image')
      return {
        method: 'POST',
        path: `/api/v1/sendSessionFile/${phone}`,
        body: {
          url: imageUrl,
          caption: message.image.caption ?? '',
        },
      }
    }

    case 'video': {
      const videoUrl = extractWatiMediaUrl(message.video, 'video')
      return {
        method: 'POST',
        path: `/api/v1/sendSessionFile/${phone}`,
        body: {
          url: videoUrl,
          caption: message.video.caption ?? '',
        },
      }
    }

    case 'audio': {
      const audioUrl = extractWatiMediaUrl(message.audio, 'audio')
      return {
        method: 'POST',
        path: `/api/v1/sendSessionFile/${phone}`,
        body: {
          url: audioUrl,
        },
      }
    }

    case 'document': {
      const docUrl = extractWatiMediaUrl(message.document, 'document')
      return {
        method: 'POST',
        path: `/api/v1/sendSessionFile/${phone}`,
        body: {
          url: docUrl,
          caption: message.document.caption ?? '',
          filename: message.document.filename ?? '',
        },
      }
    }

    // Wati does not support these — throw immediately
    case 'sticker':
    case 'location':
    case 'contacts':
    case 'reaction':
    case 'interactive.button':
    case 'interactive.list':
      throw new UnsupportedFeatureError({
        message: `Message type "${message.type}" is not supported by the Wati provider`,
        provider: 'wati',
      })

    default: {
      // Exhaustive check
      const _exhaustive: never = message
      throw new Error(`Unhandled message type: ${JSON.stringify(_exhaustive)}`)
    }
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Flatten template components into Wati's parameter format.
 * Wati expects: [{ name: "1", value: "..." }, { name: "2", value: "..." }]
 */
function flattenTemplateParameters(
  components?: TemplateComponent[],
): Array<{ name: string; value: string }> {
  if (!components) return []

  const params: Array<{ name: string; value: string }> = []
  let index = 1

  for (const component of components) {
    if (component.type === 'body') {
      for (const param of component.parameters) {
        if (param.type === 'text') {
          params.push({ name: String(index), value: param.text })
          index++
        }
      }
    }
  }

  return params
}

/**
 * Extract URL from a MediaSource, throwing if only an ID is provided.
 * Wati's sendSessionFile API requires a direct URL — it does not support
 * media IDs like the Cloud API does.
 */
function extractWatiMediaUrl(source: MediaSource & { caption?: string; filename?: string }, mediaType: string): string {
  if ('url' in source && source.url) {
    return source.url
  }
  throw new UnsupportedFeatureError({
    message: `Wati requires a URL for ${mediaType} messages. Media ID references are not supported — upload your file and use the URL instead.`,
    provider: 'wati',
  })
}
