// ---------------------------------------------------------------------------
// Wati Provider — full adapter for Wati's unique REST API surface
// ---------------------------------------------------------------------------

import type { WhatsAppProviderAdapter, ProviderFeature } from '../../types/provider.js'
import type { SendResult } from '../../types/common.js'
import type { OutboundMessage } from '../../types/messages.js'
import type { MediaUpload, MediaUploadResult, MediaUrlResult, MediaDownloadResult } from '../../types/media.js'
import type { WebhookEvent } from '../../types/webhooks.js'
import type { WatiConfig, ClientOptions } from '../../types/config.js'
import type { WatiSendResponse } from './types.js'
import { HttpClient } from '../../core/http.js'
import { RateLimiter } from '../../core/rate-limiter.js'
import { noopLogger, type Logger } from '../../core/logger.js'
import { ProviderError, UnsupportedFeatureError, ValidationError } from '../../core/errors.js'
import { mapOutboundToWati } from './mapper.js'
import { parseWatiWebhook } from './webhook-parser.js'
import { verifyHmacSha256 } from '../../utils/crypto.js'

/** Features supported by the Wati provider */
const SUPPORTED_FEATURES = new Set<ProviderFeature>([
  'media.upload',
  'webhook.signature_verification',
])

function extractMessageId(response: WatiSendResponse): string {
  return response.localMessageId ?? response.messageId ?? response.id ?? ''
}


export class WatiProvider implements WhatsAppProviderAdapter {
  readonly name = 'wati' as const

  private readonly config: WatiConfig
  private readonly options: ClientOptions
  private readonly http: HttpClient
  private readonly logger: Logger

  constructor(config: WatiConfig, options: ClientOptions = {}) {
    const channelNumber = typeof config.channelNumber === 'string' ? config.channelNumber.trim() : ''
    if (!channelNumber) {
      throw new ValidationError({
        message: 'Wati channelNumber is required in provider config',
        provider: 'wati',
      })
    }

    this.config = {
      ...config,
      channelNumber,
    }
    this.options = options
    this.logger = options.logger ?? noopLogger

    this.http = new HttpClient({
      baseUrl: config.baseUrl.replace(/\/$/, ''),
      defaultHeaders: {
        Authorization: `Bearer ${config.apiKey}`,
      },
      timeout: options.timeout ?? 30_000,
      provider: 'wati',
      logger: this.logger,
      rateLimiter: new RateLimiter(options.rateLimit),
      retry: options.retry ?? {},
      hooks: options.hooks,
    })
  }

  // -- Messaging ----------------------------------------------------------

  async sendMessage(message: OutboundMessage): Promise<SendResult> {
    const mapped = mapOutboundToWati(message)
    const body =
      message.type === 'template' && mapped.body
        ? {
            ...mapped.body,
            channel_number: this.config.channelNumber,
          }
        : mapped.body

    const response = await this.http.request<WatiSendResponse>({
      method: mapped.method,
      path: mapped.path,
      body,
      query: mapped.query as Record<string, string | number | boolean | undefined>,
    })

    if (!response.data.result) {
      throw new ProviderError({
        message: response.data.info?.trim()
          ? `Wati rejected the send request: ${response.data.info}`
          : 'Wati rejected the send request',
        provider: this.name,
        statusCode: response.status,
        raw: response.data,
      })
    }

    const messageId = extractMessageId(response.data)

    if (!messageId) {
      throw new ProviderError({
        message: 'Wati accepted the send request but did not return a message ID',
        provider: this.name,
        statusCode: response.status,
        raw: response.data,
      })
    }

    return {
      messageId,
      provider: this.name,
      ...(this.options.includeRawResponse ? { raw: response.data } : {}),
    }
  }

  async markAsRead(_messageId: string): Promise<void> {
    // Wati does not support programmatic read receipts
    this.logger.warn('markAsRead is not supported by the Wati provider')
  }

  // -- Media --------------------------------------------------------------

  async uploadMedia(params: MediaUpload): Promise<MediaUploadResult> {
    const formData = new FormData()

    if (params.file instanceof Blob) {
      formData.set('file', params.file, params.filename ?? 'file')
    } else if (params.file instanceof ReadableStream) {
      const response = new Response(params.file)
      const blob = await response.blob()
      formData.set('file', blob, params.filename ?? 'file')
    } else {
      const blob = new Blob([params.file.slice()], { type: params.mimeType })
      formData.set('file', blob, params.filename ?? 'file')
    }

    const response = await this.http.uploadRequest<{ id?: string; url?: string }>(
      '/api/v1/media',
      formData,
    )

    return { id: response.data.id ?? response.data.url ?? '' }
  }

  async getMediaUrl(_mediaId: string): Promise<MediaUrlResult> {
    throw new UnsupportedFeatureError({
      message: 'getMediaUrl is not supported by the Wati provider. Wati provides direct URLs in webhook payloads.',
      provider: 'wati',
    })
  }

  async downloadMedia(_mediaIdOrUrl: string): Promise<MediaDownloadResult> {
    throw new UnsupportedFeatureError({
      message: 'downloadMedia is not supported by the Wati provider. Use the direct media URL from the webhook payload.',
      provider: 'wati',
    })
  }

  async deleteMedia(_mediaId: string): Promise<void> {
    throw new UnsupportedFeatureError({
      message: 'deleteMedia is not supported by the Wati provider',
      provider: 'wati',
    })
  }

  // -- Webhooks -----------------------------------------------------------

  parseWebhook(body: unknown): WebhookEvent[] {
    return parseWatiWebhook(body)
  }

  async verifyWebhookSignature(body: string, signature: string): Promise<boolean> {
    if (!this.config.webhookSecret) {
      this.logger.warn('verifyWebhookSignature called but no webhookSecret configured')
      return false
    }
    return verifyHmacSha256(body, signature, this.config.webhookSecret)
  }

  // -- Capabilities -------------------------------------------------------

  supports(feature: ProviderFeature): boolean {
    return SUPPORTED_FEATURES.has(feature)
  }
}
