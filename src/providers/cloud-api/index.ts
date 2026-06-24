// ---------------------------------------------------------------------------
// Cloud API Provider — reference implementation
// ---------------------------------------------------------------------------

import type { WhatsAppProviderAdapter, ProviderFeature } from '../../types/provider.js'
import type { SendResult, ProviderName } from '../../types/common.js'
import type { OutboundMessage } from '../../types/messages.js'
import type { MediaUpload, MediaUploadResult, MediaUrlResult, MediaDownloadResult } from '../../types/media.js'
import type { Template, CreateTemplateInput } from '../../types/templates.js'
import type { WebhookEvent } from '../../types/webhooks.js'
import type { CloudApiConfig, ClientOptions } from '../../types/config.js'
import type { CloudApiSendResponse, CloudApiMediaUploadResponse, CloudApiMediaUrlResponse, CloudApiTemplatesResponse, CloudApiRawTemplate, CloudApiCreateTemplateResponse } from './types.js'
import { HttpClient } from '../../core/http.js'
import { RateLimiter } from '../../core/rate-limiter.js'
import { noopLogger, type Logger } from '../../core/logger.js'
import { UnsupportedFeatureError, MediaError, ValidationError, ProviderError } from '../../core/errors.js'
import { mapOutboundToCloudApi } from './mapper.js'
import { parseCloudApiWebhook } from './webhook-parser.js'
import { verifyHmacSha256 } from '../../utils/crypto.js'

const DEFAULT_API_VERSION = 'v25.0'
const GRAPH_API_BASE = 'https://graph.facebook.com'

/** All features supported by the Cloud API provider */
const SUPPORTED_FEATURES = new Set<ProviderFeature>([
  'interactive.button',
  'interactive.list',
  'media.upload',
  'media.download',
  'media.delete',
  'template.management',
  'reaction',
  'read_receipts',
  'sticker',
  'location',
  'contacts',
  'webhook.signature_verification',
  'webhook.challenge',
])

export class CloudApiProvider implements WhatsAppProviderAdapter {
  readonly name = 'cloud-api' as const

  protected readonly config: CloudApiConfig
  protected readonly options: ClientOptions
  protected readonly http: HttpClient
  protected readonly logger: Logger

  constructor(config: CloudApiConfig, options: ClientOptions = {}) {
    this.config = config
    this.options = options
    this.logger = options.logger ?? noopLogger

    const apiVersion = config.apiVersion ?? DEFAULT_API_VERSION

    this.http = new HttpClient({
      baseUrl: `${GRAPH_API_BASE}/${apiVersion}`,
      defaultHeaders: {
        Authorization: `Bearer ${config.accessToken}`,
      },
      timeout: options.timeout ?? 30_000,
      provider: 'cloud-api',
      logger: this.logger,
      rateLimiter: new RateLimiter(options.rateLimit),
      retry: options.retry ?? {},
      hooks: options.hooks,
    })
  }

  // -- Messaging ----------------------------------------------------------

  async sendMessage(message: OutboundMessage): Promise<SendResult> {
    const payload = mapOutboundToCloudApi(message)

    const response = await this.http.request<CloudApiSendResponse>({
      method: 'POST',
      path: `/${this.config.phoneNumberId}/messages`,
      body: payload,
    })

    const messageId = response.data.messages[0]?.id ?? ''

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
      path: `/${this.config.phoneNumberId}/messages`,
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
      `/${this.config.phoneNumberId}/media`,
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
    // If it's a media ID, first get the download URL
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

  // -- Webhooks -----------------------------------------------------------

  parseWebhook(body: unknown): WebhookEvent[] {
    return parseCloudApiWebhook(body, 'cloud-api', { includeRaw: this.options.includeRawWebhook ?? false })
  }

  async verifyWebhookSignature(body: string, signature: string): Promise<boolean> {
    if (!this.config.appSecret) {
      this.logger.warn('verifyWebhookSignature called but no appSecret configured')
      return false
    }
    return verifyHmacSha256(body, signature, this.config.appSecret)
  }

  handleVerificationChallenge(query: Record<string, string>): string | null {
    if (!this.config.webhookVerifyToken) {
      this.logger.warn('handleVerificationChallenge called but no webhookVerifyToken configured')
      return null
    }

    const mode = query['hub.mode']
    const token = query['hub.verify_token']
    const challenge = query['hub.challenge']

    if (
      mode === 'subscribe' &&
      token === this.config.webhookVerifyToken &&
      challenge
    ) {
      this.logger.info('Webhook verification challenge accepted')
      return challenge
    }

    this.logger.warn('Webhook verification challenge rejected', { mode, token })
    return null
  }

  // -- Templates ----------------------------------------------------------

  /** Get the WABA ID for template operations, throwing if not configured */
  private getWabaId(): string {
    if (!this.config.wabaId) {
      throw new ValidationError({
        message: 'Template management requires wabaId in the Cloud API config. Set it from Meta Business Manager → WhatsApp → Business Account Settings.',
        provider: this.name,
      })
    }
    return this.config.wabaId
  }

  async listTemplates(): Promise<Template[]> {
    const wabaId = this.getWabaId()
    const templates: Template[] = []
    let after: string | undefined

    // Paginate through all pages — Meta returns max ~25 templates per page
    do {
      const query: Record<string, string> = {}
      if (after) query['after'] = after

      const response = await this.http.request<CloudApiTemplatesResponse>({
        method: 'GET',
        path: `/${wabaId}/message_templates`,
        query,
      })

      templates.push(...response.data.data.map(mapRawTemplate))

      // Continue only if there's a next page
      after = response.data.paging?.next ? response.data.paging.cursors.after : undefined
    } while (after)

    return templates
  }

  async createTemplate(input: CreateTemplateInput): Promise<Template> {
    const wabaId = this.getWabaId()

    // Meta's CREATE template endpoint requires UPPERCASE enums for category,
    // component `type`/`format`, and button `type` (e.g. BODY/HEADER, UTILITY,
    // TEXT/IMAGE, QUICK_REPLY/URL). Send them AS-IS — lowercasing here makes Meta
    // reject the request with a (#100) error. (The SEND path in mapper.ts uses
    // lowercase, which is correct for that endpoint.) Extra/auth fields
    // (add_security_recommendation, code_expiration_minutes, otp_type) flow
    // through untouched.
    const response = await this.http.request<CloudApiCreateTemplateResponse>({
      method: 'POST',
      path: `/${wabaId}/message_templates`,
      body: {
        name: input.name,
        language: input.language,
        category: input.category,
        parameter_format: 'positional',
        components: input.components,
      },
    })

    return {
      id: response.data.id,
      name: input.name,
      language: input.language,
      status: toEnum(response.data.status, TEMPLATE_STATUSES, 'PENDING'),
      category: toEnum(response.data.category, TEMPLATE_CATEGORIES, input.category),
      components: input.components,
    }
  }

  async deleteTemplate(name: string): Promise<void> {
    const wabaId = this.getWabaId()

    await this.http.request({
      method: 'DELETE',
      path: `/${wabaId}/message_templates`,
      query: { name },
    })
  }

  // -- Capabilities -------------------------------------------------------

  supports(feature: ProviderFeature): boolean {
    return SUPPORTED_FEATURES.has(feature)
  }

  // -- Lifecycle ----------------------------------------------------------

  /** Release the rate limiter's pending timer and queued waiters. */
  destroy(): void {
    this.http.destroy()
  }

  // -- Utility for subclasses (360Dialog) ---------------------------------

  /** Throws if the given feature is not supported by this provider */
  protected assertSupported(feature: ProviderFeature): void {
    if (!this.supports(feature)) {
      throw new UnsupportedFeatureError({
        message: `Feature "${feature}" is not supported by the ${this.name} provider`,
        provider: this.name,
      })
    }
  }
}

// ---------------------------------------------------------------------------
// Module-level helpers
// ---------------------------------------------------------------------------

/**
 * Extract the body stream from a Response, throwing if empty.
 * The fetch spec guarantees body emits Uint8Array chunks, but some runtimes
 * (Bun) type it as ReadableStream<any>. This function safely narrows the type.
 */
export function getResponseBodyStream(response: Response, providerName: ProviderName): ReadableStream<Uint8Array> {
  if (!response.body) {
    throw new MediaError({
      message: 'Media download returned empty body',
      provider: providerName,
    })
  }
  // The fetch spec guarantees response.body is ReadableStream<Uint8Array>.
  // Some runtimes type it as ReadableStream<any>, so we annotate the return type.
  return response.body as ReadableStream<Uint8Array>
}

// ---------------------------------------------------------------------------
// Type-safe template mapping helpers
// ---------------------------------------------------------------------------

const TEMPLATE_STATUSES: readonly Template['status'][] = ['APPROVED', 'PENDING', 'REJECTED', 'DISABLED', 'PAUSED']
const TEMPLATE_CATEGORIES: readonly Template['category'][] = ['UTILITY', 'MARKETING', 'AUTHENTICATION']
const COMPONENT_TYPES: readonly ('HEADER' | 'BODY' | 'FOOTER' | 'BUTTONS')[] = ['HEADER', 'BODY', 'FOOTER', 'BUTTONS']
const BUTTON_TYPES: readonly ('PHONE_NUMBER' | 'URL' | 'QUICK_REPLY')[] = ['PHONE_NUMBER', 'URL', 'QUICK_REPLY']
const FORMAT_TYPES: readonly ('TEXT' | 'IMAGE' | 'VIDEO' | 'DOCUMENT')[] = ['TEXT', 'IMAGE', 'VIDEO', 'DOCUMENT']

/** Coerce a raw string to a known enum value, falling back to a default */
function toEnum<T extends string>(raw: string, valid: readonly T[], fallback: T): T {
  return (valid as readonly string[]).includes(raw) ? (raw as T) : fallback
}

/** Map a raw Cloud API template response to a normalized Template */
function mapRawTemplate(t: CloudApiRawTemplate): Template {
  return {
    id: t.id,
    name: t.name,
    language: t.language,
    status: toEnum(t.status, TEMPLATE_STATUSES, 'PENDING'),
    category: toEnum(t.category, TEMPLATE_CATEGORIES, 'UTILITY'),
    components: (t.components ?? []).map(c => ({
      type: toEnum(c.type, COMPONENT_TYPES, 'BODY'),
      format: c.format ? toEnum(c.format, FORMAT_TYPES, 'TEXT') : undefined,
      text: c.text,
      buttons: c.buttons?.map(b => ({
        type: toEnum(b.type, BUTTON_TYPES, 'QUICK_REPLY'),
        text: b.text,
        phone_number: b.phone_number,
        url: b.url,
        example: b.example,
      })),
      example: c.example,
    })),
  }
}
