// ---------------------------------------------------------------------------
// 360Dialog Provider — thin BSP wrapper over Cloud API
//
// Same payload format, same webhook format.
// Only differences: base URL, auth header, and no webhook challenge.
// ---------------------------------------------------------------------------

import type { WhatsAppProviderAdapter, ProviderFeature } from '../../types/provider.js'
import type { SendResult } from '../../types/common.js'
import type { OutboundMessage } from '../../types/messages.js'
import type { MediaUpload, MediaUploadResult, MediaUrlResult, MediaDownloadResult } from '../../types/media.js'
import type { WebhookEvent } from '../../types/webhooks.js'
import type { Dialog360Config, ClientOptions } from '../../types/config.js'
import type { CloudApiSendResponse, CloudApiMediaUploadResponse, CloudApiMediaUrlResponse } from '../cloud-api/types.js'
import { HttpClient } from '../../core/http.js'
import { RateLimiter } from '../../core/rate-limiter.js'
import { noopLogger, type Logger } from '../../core/logger.js'
import { UnsupportedFeatureError } from '../../core/errors.js'
import { mapOutboundToCloudApi } from '../cloud-api/mapper.js'
import { parseCloudApiWebhook } from '../cloud-api/webhook-parser.js'
import { getResponseBodyStream } from '../cloud-api/index.js'
import { verifyHmacSha256 } from '../../utils/crypto.js'

const DEFAULT_BASE_URL = 'https://waba-v2.360dialog.io'

/** 360Dialog supports same features as Cloud API, minus webhook challenge */
const SUPPORTED_FEATURES = new Set<ProviderFeature>([
  'interactive.button',
  'interactive.list',
  'media.upload',
  'media.download',
  'media.delete',
  'reaction',
  'read_receipts',
  'sticker',
  'location',
  'contacts',
  'webhook.signature_verification',
])

export class Dialog360Provider implements WhatsAppProviderAdapter {
  readonly name = '360dialog' as const

  private readonly config: Dialog360Config
  private readonly options: ClientOptions
  private readonly http: HttpClient
  private readonly logger: Logger

  constructor(config: Dialog360Config, options: ClientOptions = {}) {
    this.config = config
    this.options = options
    this.logger = options.logger ?? noopLogger

    this.http = new HttpClient({
      baseUrl: config.baseUrl ?? DEFAULT_BASE_URL,
      defaultHeaders: {
        'D360-API-KEY': config.apiKey,
      },
      timeout: options.timeout ?? 30_000,
      provider: '360dialog',
      logger: this.logger,
      rateLimiter: new RateLimiter(options.rateLimit),
      retry: options.retry ?? {},
      hooks: options.hooks,
    })
  }

  // -- Messaging (reuses Cloud API mapper) --------------------------------

  async sendMessage(message: OutboundMessage): Promise<SendResult> {
    const payload = mapOutboundToCloudApi(message)

    const response = await this.http.request<CloudApiSendResponse>({
      method: 'POST',
      path: '/messages',
      body: payload,
    })

    const messageId = response.data.messages[0]?.id ?? ''

    return {
      messageId,
      provider: this.name,
      ...(this.options.includeRawResponse ? { raw: response.data } : {}),
    }
  }

  async markAsRead(messageId: string): Promise<void> {
    await this.http.request({
      method: 'POST',
      path: '/messages',
      body: {
        messaging_product: 'whatsapp',
        status: 'read',
        message_id: messageId,
      },
    })
  }

  // -- Media --------------------------------------------------------------

  async uploadMedia(params: MediaUpload): Promise<MediaUploadResult> {
    const formData = new FormData()
    formData.set('messaging_product', 'whatsapp')
    formData.set('type', params.mimeType)

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

    const response = await this.http.uploadRequest<CloudApiMediaUploadResponse>(
      '/media',
      formData,
    )

    return { id: response.data.id }
  }

  async getMediaUrl(mediaId: string): Promise<MediaUrlResult> {
    const response = await this.http.request<CloudApiMediaUrlResponse>({
      method: 'GET',
      path: `/${mediaId}`,
    })

    return {
      url: response.data.url,
      mimeType: response.data.mime_type,
      sha256: response.data.sha256,
      fileSize: response.data.file_size ? parseInt(response.data.file_size, 10) : undefined,
    }
  }

  async downloadMedia(mediaIdOrUrl: string): Promise<MediaDownloadResult> {
    let downloadUrl: string
    let expectedMimeType: string | undefined

    if (mediaIdOrUrl.startsWith('http://') || mediaIdOrUrl.startsWith('https://')) {
      downloadUrl = mediaIdOrUrl
    } else {
      const mediaInfo = await this.getMediaUrl(mediaIdOrUrl)
      downloadUrl = mediaInfo.url
      expectedMimeType = mediaInfo.mimeType
    }

    const response = await this.http.rawRequest({
      method: 'GET',
      path: downloadUrl,
    })

    const stream = getResponseBodyStream(response, this.name)

    const mimeType =
      response.headers.get('content-type') ??
      expectedMimeType ??
      'application/octet-stream'

    const contentLength = response.headers.get('content-length')

    return {
      stream,
      mimeType,
      contentLength: contentLength ? parseInt(contentLength, 10) : undefined,
    }
  }

  async deleteMedia(mediaId: string): Promise<void> {
    await this.http.request({
      method: 'DELETE',
      path: `/${mediaId}`,
    })
  }

  // -- Webhooks (reuses Cloud API parser) ---------------------------------

  parseWebhook(body: unknown): WebhookEvent[] {
    return parseCloudApiWebhook(body, '360dialog')
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

  protected assertSupported(feature: ProviderFeature): void {
    if (!this.supports(feature)) {
      throw new UnsupportedFeatureError({
        message: `Feature "${feature}" is not supported by the ${this.name} provider`,
        provider: this.name,
      })
    }
  }
}
