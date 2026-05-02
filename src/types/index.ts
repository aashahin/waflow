// ---------------------------------------------------------------------------
// Public type re-exports — `import type { ... } from 'waflow'`
// ---------------------------------------------------------------------------

export type { PhoneNumber, MessageId, MediaId, Timestamp, ProviderName, SendResult, MediaSource, ContactInfo } from './common.js'
export type { CloudApiConfig, Dialog360Config, WatiConfig, ProviderConfig, RetryConfig, RateLimitConfig, ClientHooks, ClientOptions, CreateWhatsAppConfig } from './config.js'
export type { WhatsAppErrorCode } from './errors.js'
export type { MediaUpload, MediaUploadResult, MediaUrlResult, MediaDownloadResult } from './media.js'
export type { TextMessage, TemplateMessage, ImageMessage, VideoMessage, AudioMessage, DocumentMessage, StickerMessage, LocationMessage, ContactsMessage, ReactionMessage, InteractiveButtonMessage, InteractiveListMessage, OutboundMessage, ButtonDef, SectionDef, SectionRow, InteractiveHeader, TemplateComponent, TemplateParameter, CurrencyParam, ContactPayload, TextOptions, MediaMessageOptions, DocumentOptions, InteractiveOptions, LocationPayload } from './messages.js'
export type { WhatsAppProviderAdapter, ProviderFeature } from './provider.js'
export type { Template, TemplateComponentDef, TemplateButtonDef, CreateTemplateInput } from './templates.js'
export type { WebhookEvent, IncomingMessageEvent, MessageStatusEvent, MessageErrorEvent, IncomingMessage, IncomingTextMessage, IncomingImageMessage, IncomingVideoMessage, IncomingAudioMessage, IncomingDocumentMessage, IncomingLocationMessage, IncomingStickerMessage, IncomingReactionMessage, IncomingButtonReply, IncomingListReply, IncomingContactsMessage, IncomingUnknownMessage, WebhookMetadata } from './webhooks.js'
