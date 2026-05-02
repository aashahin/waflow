// ---------------------------------------------------------------------------
// Template management types
// ---------------------------------------------------------------------------

/** A WhatsApp message template */
export interface Template {
  id: string
  name: string
  language: string
  status: 'APPROVED' | 'PENDING' | 'REJECTED' | 'DISABLED' | 'PAUSED'
  category: 'UTILITY' | 'MARKETING' | 'AUTHENTICATION'
  components: TemplateComponentDef[]
}

export interface TemplateComponentDef {
  type: 'HEADER' | 'BODY' | 'FOOTER' | 'BUTTONS'
  format?: 'TEXT' | 'IMAGE' | 'VIDEO' | 'DOCUMENT'
  text?: string
  buttons?: TemplateButtonDef[]
  example?: {
    header_text?: string[]
    body_text?: string[][]
    header_handle?: string[]
  }
}

export interface TemplateButtonDef {
  type: 'PHONE_NUMBER' | 'URL' | 'QUICK_REPLY'
  text: string
  phone_number?: string
  url?: string
  example?: string[]
}

/** Input for creating a new template */
export interface CreateTemplateInput {
  name: string
  language: string
  category: 'UTILITY' | 'MARKETING' | 'AUTHENTICATION'
  components: TemplateComponentDef[]
}
