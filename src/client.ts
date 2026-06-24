// ---------------------------------------------------------------------------
// WhatsAppClient — the consumer-facing orchestrator
//
// Wraps a WhatsAppProviderAdapter with a namespace API:
//   wa.message.text(...)
//   wa.media.upload(...)
//   wa.webhook.parse(...)
//   wa.template.list()
// ---------------------------------------------------------------------------

import type { WhatsAppProviderAdapter, ProviderFeature } from './types/provider.js'
import type { SendResult, MediaSource } from './types/common.js'
import type {
  OutboundMessage,
  TextOptions,
  MediaMessageOptions,
  DocumentOptions,
  InteractiveOptions,
  LocationPayload,
  ContactPayload,
  ButtonDef,
  SectionDef,
  TemplateComponent,
  InteractiveHeader,
  OtpSendOptions,
} from './types/messages.js'
import type { MediaUpload, MediaUploadResult, MediaUrlResult, MediaDownloadResult } from './types/media.js'
import type { Template, CreateTemplateInput } from './types/templates.js'
import type { WebhookEvent } from './types/webhooks.js'
import { UnsupportedFeatureError, ValidationError } from './core/errors.js'

export class WhatsAppClient {
  private readonly adapter: WhatsAppProviderAdapter

  /** Which provider is active */
  readonly provider: string

  /** Message operations */
  readonly message: MessageNamespace

  /** Media operations */
  readonly media: MediaNamespace

  /** Webhook operations */
  readonly webhook: WebhookNamespace

  /** Template operations */
  readonly template: TemplateNamespace

  /** One-time-password (authentication template) helper */
  readonly otp: OtpNamespace

  constructor(adapter: WhatsAppProviderAdapter) {
    this.adapter = adapter
    this.provider = adapter.name
    this.message = new MessageNamespace(adapter)
    this.media = new MediaNamespace(adapter)
    this.webhook = new WebhookNamespace(adapter)
    this.template = new TemplateNamespace(adapter)
    this.otp = new OtpNamespace(adapter)
  }

  /** Check if the current provider supports a specific feature */
  supports(feature: ProviderFeature): boolean {
    return this.adapter.supports(feature)
  }

  /**
   * Release resources held by the client (the rate limiter's pending timer and
   * any queued waiters). Call when you're done with a client you won't reuse —
   * e.g. a per-request client on an edge runtime. Safe to call more than once.
   *
   * ```ts
   * const wa = createWhatsApp({ ... })
   * try {
   *   await wa.message.text(to, 'hi')
   * } finally {
   *   wa.destroy()
   * }
   * ```
   */
  destroy(): void {
    this.adapter.destroy?.()
  }
}

// ---------------------------------------------------------------------------
// message.*
// ---------------------------------------------------------------------------

class MessageNamespace {
  private readonly adapter: WhatsAppProviderAdapter

  /** Interactive message sub-namespace */
  readonly interactive: InteractiveNamespace

  constructor(adapter: WhatsAppProviderAdapter) {
    this.adapter = adapter
    this.interactive = new InteractiveNamespace(adapter)
  }

  /** Send any outbound message (low-level — prefer the typed shorthand methods) */
  async send(message: OutboundMessage): Promise<SendResult> {
    return this.adapter.sendMessage(message)
  }

  /** Send a text message */
  async text(to: string, body: string, options?: TextOptions): Promise<SendResult> {
    return this.adapter.sendMessage({
      type: 'text',
      to,
      text: { body, previewUrl: options?.previewUrl },
      ...(options?.replyTo ? { context: { messageId: options.replyTo } } : {}),
    })
  }

  /** Send a template message */
  async template(
    to: string,
    tmpl: { name: string; language: string; components?: TemplateComponent[] },
  ): Promise<SendResult> {
    return this.adapter.sendMessage({
      type: 'template',
      to,
      template: tmpl,
    })
  }

  /** Send an image message */
  async image(to: string, source: MediaSource, options?: MediaMessageOptions): Promise<SendResult> {
    return this.adapter.sendMessage({
      type: 'image',
      to,
      image: { ...source, caption: options?.caption },
      ...(options?.replyTo ? { context: { messageId: options.replyTo } } : {}),
    })
  }

  /** Send a video message */
  async video(to: string, source: MediaSource, options?: MediaMessageOptions): Promise<SendResult> {
    return this.adapter.sendMessage({
      type: 'video',
      to,
      video: { ...source, caption: options?.caption },
      ...(options?.replyTo ? { context: { messageId: options.replyTo } } : {}),
    })
  }

  /** Send an audio message */
  async audio(to: string, source: MediaSource, options?: { replyTo?: string }): Promise<SendResult> {
    return this.adapter.sendMessage({
      type: 'audio',
      to,
      audio: source,
      ...(options?.replyTo ? { context: { messageId: options.replyTo } } : {}),
    })
  }

  /** Send a document message */
  async document(to: string, source: MediaSource, options?: DocumentOptions): Promise<SendResult> {
    return this.adapter.sendMessage({
      type: 'document',
      to,
      document: { ...source, caption: options?.caption, filename: options?.filename },
      ...(options?.replyTo ? { context: { messageId: options.replyTo } } : {}),
    })
  }

  /** Send a sticker message */
  async sticker(to: string, source: MediaSource, options?: { replyTo?: string }): Promise<SendResult> {
    return this.adapter.sendMessage({
      type: 'sticker',
      to,
      sticker: source,
      ...(options?.replyTo ? { context: { messageId: options.replyTo } } : {}),
    })
  }

  /** Send a location message */
  async location(to: string, loc: LocationPayload, options?: { replyTo?: string }): Promise<SendResult> {
    return this.adapter.sendMessage({
      type: 'location',
      to,
      location: loc,
      ...(options?.replyTo ? { context: { messageId: options.replyTo } } : {}),
    })
  }

  /** Send contact card(s) */
  async contacts(to: string, contacts: ContactPayload[], options?: { replyTo?: string }): Promise<SendResult> {
    return this.adapter.sendMessage({
      type: 'contacts',
      to,
      contacts,
      ...(options?.replyTo ? { context: { messageId: options.replyTo } } : {}),
    })
  }

  /** Send a reaction to a message */
  async reaction(to: string, messageId: string, emoji: string): Promise<SendResult> {
    return this.adapter.sendMessage({
      type: 'reaction',
      to,
      reaction: { messageId, emoji },
    })
  }

  /** Mark a message as read */
  async markAsRead(messageId: string): Promise<void> {
    return this.adapter.markAsRead(messageId)
  }
}

// ---------------------------------------------------------------------------
// message.interactive.*
// ---------------------------------------------------------------------------

class InteractiveNamespace {
  private readonly adapter: WhatsAppProviderAdapter

  constructor(adapter: WhatsAppProviderAdapter) {
    this.adapter = adapter
  }

  /** Send a message with reply buttons (max 3) */
  async buttons(
    to: string,
    body: string,
    buttons: ButtonDef[],
    options?: InteractiveOptions,
  ): Promise<SendResult> {
    return this.adapter.sendMessage({
      type: 'interactive.button',
      to,
      body,
      buttons,
      header: options?.header,
      footer: options?.footer,
      ...(options?.replyTo ? { context: { messageId: options.replyTo } } : {}),
    })
  }

  /** Send a list message with sections (max 10 sections) */
  async list(
    to: string,
    body: string,
    buttonText: string,
    sections: SectionDef[],
    options?: Omit<InteractiveOptions, 'header'> & { header?: string },
  ): Promise<SendResult> {
    return this.adapter.sendMessage({
      type: 'interactive.list',
      to,
      body,
      buttonText,
      sections,
      header: options?.header,
      footer: options?.footer,
      ...(options?.replyTo ? { context: { messageId: options.replyTo } } : {}),
    })
  }
}

// ---------------------------------------------------------------------------
// media.*
// ---------------------------------------------------------------------------

class MediaNamespace {
  private readonly adapter: WhatsAppProviderAdapter

  constructor(adapter: WhatsAppProviderAdapter) {
    this.adapter = adapter
  }

  /** Upload media to the provider */
  async upload(params: MediaUpload): Promise<MediaUploadResult> {
    return this.adapter.uploadMedia(params)
  }

  /** Get the download URL for a media item */
  async getUrl(mediaId: string): Promise<MediaUrlResult> {
    return this.adapter.getMediaUrl(mediaId)
  }

  /** Download media as a ReadableStream — pipe directly to R2/S3 */
  async download(mediaIdOrUrl: string): Promise<MediaDownloadResult> {
    return this.adapter.downloadMedia(mediaIdOrUrl)
  }

  /** Delete a previously uploaded media item */
  async delete(mediaId: string): Promise<void> {
    return this.adapter.deleteMedia(mediaId)
  }
}

// ---------------------------------------------------------------------------
// webhook.*
// ---------------------------------------------------------------------------

class WebhookNamespace {
  private readonly adapter: WhatsAppProviderAdapter

  constructor(adapter: WhatsAppProviderAdapter) {
    this.adapter = adapter
  }

  /** Parse a raw webhook payload into normalized events */
  parse(body: unknown): WebhookEvent[] {
    return this.adapter.parseWebhook(body)
  }

  /** Verify the cryptographic signature of a webhook payload */
  async verify(body: string, signature: string): Promise<boolean> {
    return this.adapter.verifyWebhookSignature(body, signature)
  }

  /**
   * Handle the webhook verification challenge (GET request from Meta).
   * Returns the challenge string to respond with, or null if invalid.
   */
  handleChallenge(query: Record<string, string>): string | null {
    if (!this.adapter.handleVerificationChallenge) {
      return null
    }
    return this.adapter.handleVerificationChallenge(query)
  }
}

// ---------------------------------------------------------------------------
// otp.*
// ---------------------------------------------------------------------------

class OtpNamespace {
  private readonly adapter: WhatsAppProviderAdapter

  constructor(adapter: WhatsAppProviderAdapter) {
    this.adapter = adapter
  }

  /**
   * Send a one-time password using an approved AUTHENTICATION template.
   *
   * Builds the correct auth-template payload — the code is placed in the body
   * and (by default) in the copy-code / one-tap autofill button — so callers
   * don't have to assemble template components by hand.
   *
   * @example
   * ```ts
   * await wa.otp.send('+966501234567', '123456', { template: 'login_code' })
   * ```
   */
  async send(to: string, code: string, options: OtpSendOptions): Promise<SendResult> {
    const trimmed = code.trim()
    if (!trimmed) {
      throw new ValidationError({
        message: 'otp.send requires a non-empty code',
        provider: this.adapter.name,
      })
    }

    const components: TemplateComponent[] = [
      { type: 'body', parameters: [{ type: 'text', text: trimmed }] },
    ]
    if (options.button !== false) {
      // Auth templates carry the code again in the URL/copy-code button.
      components.push({
        type: 'button',
        sub_type: 'url',
        index: 0,
        parameters: [{ type: 'text', text: trimmed }],
      })
    }

    return this.adapter.sendMessage({
      type: 'template',
      to,
      template: {
        name: options.template,
        language: options.language ?? 'en_US',
        components,
      },
    })
  }
}

// ---------------------------------------------------------------------------
// template.*
// ---------------------------------------------------------------------------

class TemplateNamespace {
  private readonly adapter: WhatsAppProviderAdapter

  constructor(adapter: WhatsAppProviderAdapter) {
    this.adapter = adapter
  }

  /** List all message templates */
  async list(): Promise<Template[]> {
    if (!this.adapter.listTemplates) {
      throw new UnsupportedFeatureError({
        message: 'Template management is not supported by this provider',
        provider: this.adapter.name,
      })
    }
    return this.adapter.listTemplates()
  }

  /** Create a new message template */
  async create(input: CreateTemplateInput): Promise<Template> {
    if (!this.adapter.createTemplate) {
      throw new UnsupportedFeatureError({
        message: 'Template creation is not supported by this provider',
        provider: this.adapter.name,
      })
    }
    return this.adapter.createTemplate(input)
  }

  /** Delete a message template by name */
  async delete(name: string): Promise<void> {
    if (!this.adapter.deleteTemplate) {
      throw new UnsupportedFeatureError({
        message: 'Template deletion is not supported by this provider',
        provider: this.adapter.name,
      })
    }
    return this.adapter.deleteTemplate(name)
  }
}
