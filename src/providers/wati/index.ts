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

/**
 * Features supported by the Wati provider.
 *
 * Note: 'webhook.signature_verification' is intentionally absent — Wati does NOT
 * natively sign its webhooks (no HMAC signature header). `verifyWebhookSignature`
 * is kept functional only for callers who front Wati with their own signing
 * proxy/gateway that adds an HMAC.
 */
const SUPPORTED_FEATURES = new Set<ProviderFeature>([
  'media.upload',
])

function extractMessageIdFromRecord(record: Record<string, unknown>): string {
  const candidates = [record.localMessageId, record.messageId, record.id]

  for (const candidate of candidates) {
    if (typeof candidate === 'string' && candidate.trim()) {
      return candidate.trim()
    }
  }

  return ''
}

function extractMessageId(response: WatiSendResponse): string {
  const directMessageId = extractMessageIdFromRecord(
    response as unknown as Record<string, unknown>,
  )
  if (directMessageId) {
    return directMessageId
  }

  if (!Array.isArray(response.receivers)) {
    return ''
  }

  for (const receiver of response.receivers) {
    if (!receiver || typeof receiver !== 'object') {
      continue
    }

    const nestedMessageId = extractMessageIdFromRecord(
      receiver as Record<string, unknown>,
    )
    if (nestedMessageId) {
      return nestedMessageId
    }
  }

  return ''
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
      this.logger.warn('Wati accepted the send request without a message ID', {
        messageType: message.type,
        path: mapped.path,
        raw: response.data,
      })
    }

    return {
      messageId,
      provider: this.name,
      ...(this.options.includeRawResponse ? { raw: response.data } : {}),
    }
  }

  async markAsRead(): Promise<void> {
    // Wati does not support programmatic read receipts (read_receipts ❌).
    throw new UnsupportedFeatureError({
      message: 'markAsRead (read receipts) is not supported by the Wati provider',
      provider: 'wati',
    })
  }

  // -- Media --------------------------------------------------------------

  async uploadMedia(params: MediaUpload): Promise<MediaUploadResult> {
    const formData = new FormData()

    if (params.file instanceof Blob) {
      formData.set('file', params.file, params.filename ?? 'file')
    } else if (params.file instanceof ReadableStream) {
      // The ReadableStream branch still buffers the whole stream into memory via
      // `new Response(stream).blob()` — unavoidable with fetch FormData. Callers
      // with very large media should prefer URL-based sends where supported.
      const response = new Response(params.file)
      const blob = await response.blob()
      formData.set('file', blob, params.filename ?? 'file')
    } else {
      // Uint8Array — pass the view directly. Blob already copies the bytes, so an
      // extra `.slice()` here would just double peak memory for no benefit. The
      // cast is type-only (Uint8Array<ArrayBufferLike> → BlobPart); it copies nothing.
      const blob = new Blob([params.file as BlobPart], { type: params.mimeType })
      formData.set('file', blob, params.filename ?? 'file')
    }

    const response = await this.http.uploadRequest<{ id?: string; url?: string }>(
      '/api/v1/media',
      formData,
    )

    // Wati sends require a URL (the mapper throws on a media id), so surface the
    // URL alongside the id. Callers should pass `url` to subsequent message sends.
    return { id: response.data.id ?? response.data.url ?? '', url: response.data.url }
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

  // Wati does NOT natively sign its webhooks — it sends no HMAC signature header.
  // This verification therefore only works when the caller fronts Wati with their
  // own signing proxy/gateway that adds an HMAC over the raw body using
  // `webhookSecret`. Without a `webhookSecret` configured it returns false, and
  // `supports('webhook.signature_verification')` returns false accordingly.
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
