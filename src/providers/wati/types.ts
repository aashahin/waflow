// ---------------------------------------------------------------------------
// Wati provider-specific raw types
// ---------------------------------------------------------------------------

/** Response from Wati send message endpoints */
export interface WatiSendResponse {
  result: boolean
  info?: string
  localMessageId?: string
  messageId?: string
  id?: string
}

/** Response from Wati send template message */
export interface WatiTemplateResponse {
  result: boolean
  info?: string
  localMessageId?: string
  messageId?: string
  id?: string
}

/** Wati webhook payload — flat structure, very different from Cloud API */
export interface WatiWebhookPayload {
  /** Event type identifier */
  eventType?: string
  /** Incoming message data */
  waId?: string
  senderName?: string
  text?: string
  type?: string
  timestamp?: string
  messageId?: string
  /** Media fields */
  mediaUrl?: string
  mimeType?: string
  caption?: string
  filename?: string
  /** Location fields */
  latitude?: number
  longitude?: number
  locationName?: string
  locationAddress?: string
  /** Status update fields */
  statusString?: string
  localMessageId?: string
  /** Error fields */
  errorCode?: number
  errorMessage?: string
}
