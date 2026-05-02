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
} from './types/messages.js'
import type { MediaUpload, MediaUploadResult, MediaUrlResult, MediaDownloadResult } from './types/media.js'
import type { Template, CreateTemplateInput } from './types/templates.js'
import type { WebhookEvent } from './types/webhooks.js'
import { UnsupportedFeatureError } from './core/errors.js'

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

  constructor(adapter: WhatsAppProviderAdapter) {
    this.adapter = adapter
    this.provider = adapter.name
    this.message = new MessageNamespace(adapter)
    this.media = new MediaNamespace(adapter)
    this.webhook = new WebhookNamespace(adapter)
    this.template = new TemplateNamespace(adapter)
  }

  /** Check if the current provider supports a specific feature */
  supports(feature: ProviderFeature): boolean {
    return this.adapter.supports(feature)
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
  parse(body: unknown, headers?: Record<string, string>): WebhookEvent[] {
    return this.adapter.parseWebhook(body, headers)
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
