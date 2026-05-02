// ---------------------------------------------------------------------------
// Cloud API provider-specific raw types (what Meta's Graph API returns)
// ---------------------------------------------------------------------------

/** Response from POST /{phone_number_id}/messages */
export interface CloudApiSendResponse {
  messaging_product: 'whatsapp'
  contacts: Array<{ input: string; wa_id: string }>
  messages: Array<{ id: string }>
}

/** Response from POST /{phone_number_id}/media */
export interface CloudApiMediaUploadResponse {
  id: string
}

/** Response from GET /{media_id} */
export interface CloudApiMediaUrlResponse {
  id: string
  url: string
  mime_type: string
  sha256: string
  file_size: string
  messaging_product: 'whatsapp'
}

/** Raw webhook payload from Meta */
export interface CloudApiWebhookPayload {
  object: 'whatsapp_business_account'
  entry: CloudApiWebhookEntry[]
}

export interface CloudApiWebhookEntry {
  id: string
  changes: CloudApiWebhookChange[]
}

export interface CloudApiWebhookChange {
  value: CloudApiWebhookValue
  field: string
}

export interface CloudApiWebhookValue {
  messaging_product: 'whatsapp'
  metadata: {
    display_phone_number: string
    phone_number_id: string
  }
  contacts?: Array<{
    profile: { name: string }
    wa_id: string
  }>
  messages?: CloudApiRawMessage[]
  statuses?: CloudApiRawStatus[]
  errors?: CloudApiRawError[]
}

export interface CloudApiRawMessage {
  id: string
  from: string
  timestamp: string
  type: string
  text?: { body: string }
  image?: CloudApiRawMedia
  video?: CloudApiRawMedia
  audio?: CloudApiRawMedia & { voice?: boolean }
  document?: CloudApiRawMedia & { filename?: string }
  sticker?: CloudApiRawMedia & { animated?: boolean }
  location?: {
    latitude: number
    longitude: number
    name?: string
    address?: string
  }
  reaction?: {
    message_id: string
    emoji: string
  }
  interactive?: {
    type: 'button_reply' | 'list_reply'
    button_reply?: { id: string; title: string }
    list_reply?: { id: string; title: string; description?: string }
  }
  contacts?: Array<{
    name: { formatted_name: string; first_name?: string; last_name?: string }
    phones?: Array<{ phone: string; wa_id?: string; type?: string }>
  }>
  context?: {
    from: string
    id: string
  }
}

export interface CloudApiRawMedia {
  id: string
  mime_type: string
  sha256?: string
  caption?: string
}

export interface CloudApiRawStatus {
  id: string
  status: 'sent' | 'delivered' | 'read' | 'failed'
  timestamp: string
  recipient_id: string
  errors?: Array<{
    code: number
    title: string
    message?: string
  }>
}

export interface CloudApiRawError {
  code: number
  title: string
  message: string
}

/** Response from GET /{waba_id}/message_templates */
export interface CloudApiTemplatesResponse {
  data: CloudApiRawTemplate[]
  paging?: { cursors: { before: string; after: string }; next?: string }
}

/** Response from POST /{waba_id}/message_templates */
export interface CloudApiCreateTemplateResponse {
  id: string
  status: string
  category: string
}

export interface CloudApiRawTemplate {
  id: string
  name: string
  language: string
  status: string
  category: string
  components: Array<{
    type: string
    format?: string
    text?: string
    buttons?: Array<{
      type: string
      text: string
      phone_number?: string
      url?: string
      example?: string[]
    }>
    example?: {
      header_text?: string[]
      body_text?: string[][]
      header_handle?: string[]
    }
  }>
}
