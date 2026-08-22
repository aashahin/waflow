// ---------------------------------------------------------------------------
// 360Dialog Provider — thin BSP wrapper over Cloud API
//
// Same payload format, same webhook format.
// Only differences: base URL, auth header, and no webhook challenge.
// ---------------------------------------------------------------------------

import type { WhatsAppProviderAdapter, ProviderFeature } from '../../types/provider.js'
import type { SendResult } from '../../types/common.js'
import type { OutboundMessage } from '../../types/messages.js'
import type { MediaUpload, MediaUploadResult, MediaUrlResult, MediaDownloadResult, MediaDownloadOptions } from '../../types/media.js'
import type { WebhookEvent } from '../../types/webhooks.js'
import type { Dialog360Config, ClientOptions } from '../../types/config.js'
import type { CloudApiSendResponse, CloudApiMediaUploadResponse, CloudApiMediaUrlResponse } from '../cloud-api/types.js'
import { HttpClient } from '../../core/http.js'
import { RateLimiter } from '../../core/rate-limiter.js'
import { noopLogger, type Logger } from '../../core/logger.js'
import { MediaError, ProviderError } from '../../core/errors.js'
import { assertSafeMediaId, resolveHttpDownloadUrl } from '../../core/url-guard.js'
import { mapOutboundToCloudApi } from '../cloud-api/mapper.js'
import { parseCloudApiWebhook } from '../cloud-api/webhook-parser.js'
import { getResponseBodyStream, parseOptionalFileSize } from '../cloud-api/index.js'
import { verifyHmacSha256 } from '../../utils/crypto.js'

const DEFAULT_BASE_URL = 'https://waba-v2.360dialog.io'

/** Meta media CDNs that 360dialog proxies on its own origin. */
const META_MEDIA_CDN_HOSTS = new Set(['lookaside.fbsbx.com', 'fbsbx.com', 'fbcdn.net', 'facebook.com', 'whatsapp.net'])
const META_MEDIA_CDN_SUFFIXES = ['.fbsbx.com', '.fbcdn.net', '.facebook.com', '.whatsapp.net'] as const

function isMetaMediaCdnHost(hostname: string): boolean {
  const host = hostname.toLowerCase()
  if (host === 'graph.facebook.com' || host === 'graph.whatsapp.com') return false
  if (META_MEDIA_CDN_HOSTS.has(host)) return true
  return META_MEDIA_CDN_SUFFIXES.some(suffix => host.endsWith(suffix))
}

/**
 * 360dialog serves WhatsApp attachment paths from its API origin, which is
 * what keeps `D360-API-KEY` on the subsequent download (same origin as baseUrl).
 * Other Meta-CDN paths stay unchanged so HttpClient strips the key off-origin.
 */
function rewriteDialog360MediaUrl(downloadUrl: string, apiBaseUrl: string): string {
  let media: URL
  try {
    media = new URL(downloadUrl)
  } catch {
    return downloadUrl
  }

  if (!isMetaMediaCdnHost(media.hostname)) return downloadUrl

  // Only proxy WhatsApp media paths; anything else on lookaside/fbcdn would
  // otherwise inherit D360-API-KEY after the origin rewrite.
  const segments = media.pathname.split('/')
  if (!segments.includes('whatsapp_business') && !segments.includes('attachments')) {
    return downloadUrl
  }

  let api: URL
  try {
    api = new URL(apiBaseUrl)
  } catch {
    return downloadUrl
  }

  const basePath = api.pathname.replace(/\/$/, '')
  return `${api.origin}${basePath}${media.pathname}${media.search}${media.hash}`
}

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
      signal: options.signal,
    })
  }

  // -- Messaging (reuses Cloud API mapper) --------------------------------

  async sendMessage(message: OutboundMessage): Promise<SendResult> {
    const payload = mapOutboundToCloudApi(message, this.name)

    const response = await this.http.request<CloudApiSendResponse>({
      method: 'POST',
      path: '/messages',
      body: payload,
    })

    const messageId = response.data?.messages?.[0]?.id ?? ''

    if (!messageId) {
      throw new ProviderError({
        message: 'Provider returned no message ID — the send may not have succeeded',
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

    const response = await this.http.uploadRequest<CloudApiMediaUploadResponse>(
      '/media',
      formData,
      // JSON client timeout is 30s; large uploads need longer. Caller timeout still wins.
      { timeout: params.timeout ?? 120_000 },
    )

    const id = response.data?.id
    if (typeof id !== 'string' || !id) {
      throw new MediaError({
        message: 'Provider returned no media ID',
        provider: this.name,
        statusCode: response.status,
        raw: response.data,
      })
    }

    return { id }
  }

  async getMediaUrl(mediaId: string): Promise<MediaUrlResult> {
    const response = await this.http.request<CloudApiMediaUrlResponse>({
      method: 'GET',
      path: `/${assertSafeMediaId(mediaId, this.name)}`,
    })

    const url = response.data?.url
    if (typeof url !== 'string' || !url) {
      throw new MediaError({
        message: 'Provider returned no media URL',
        provider: this.name,
        statusCode: response.status,
        raw: response.data,
      })
    }

    return {
      url: resolveHttpDownloadUrl(url) ?? url,
      mimeType: response.data?.mime_type,
      sha256: response.data?.sha256,
      fileSize: parseOptionalFileSize(response.data?.file_size),
    }
  }

  async downloadMedia(mediaIdOrUrl: string, options?: MediaDownloadOptions): Promise<MediaDownloadResult> {
    let downloadUrl: string
    let expectedMimeType: string | undefined

    const absoluteUrl = resolveHttpDownloadUrl(mediaIdOrUrl)
    if (absoluteUrl) {
      downloadUrl = absoluteUrl
    } else {
      const mediaInfo = await this.getMediaUrl(mediaIdOrUrl)
      downloadUrl = resolveHttpDownloadUrl(mediaInfo.url) ?? mediaInfo.url
      expectedMimeType = mediaInfo.mimeType
    }

    downloadUrl = rewriteDialog360MediaUrl(
      downloadUrl,
      this.config.baseUrl ?? DEFAULT_BASE_URL,
    )

    const response = await this.http.rawRequest({
      method: 'GET',
      path: downloadUrl,
      timeout: options?.timeout ?? 0,
      signal: options?.signal,
    })

    const stream = getResponseBodyStream(response, this.name)

    const mimeType =
      response.headers.get('content-type') ??
      expectedMimeType ??
      'application/octet-stream'

    return {
      stream,
      mimeType,
      contentLength: parseOptionalFileSize(response.headers.get('content-length')),
    }
  }

  async deleteMedia(mediaId: string): Promise<void> {
    await this.http.request({
      method: 'DELETE',
      path: `/${assertSafeMediaId(mediaId, this.name)}`,
    })
  }

  // -- Webhooks (reuses Cloud API parser) ---------------------------------

  parseWebhook(body: unknown): WebhookEvent[] {
    return parseCloudApiWebhook(body, '360dialog', { includeRaw: this.options.includeRawWebhook ?? false })
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
    if (feature === 'webhook.signature_verification') {
      return typeof this.config.webhookSecret === 'string' && this.config.webhookSecret.length > 0
    }
    return SUPPORTED_FEATURES.has(feature)
  }

  /** Release the rate limiter's pending timer and queued waiters. */
  destroy(): void {
    this.http.destroy()
  }

}
