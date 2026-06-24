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
  /**
   * AUTHENTICATION templates only — adds the "this code is for you" security
   * disclaimer to the BODY. Passed through verbatim to the provider.
   */
  add_security_recommendation?: boolean
  /**
   * AUTHENTICATION templates only — minutes until the code expires, shown in
   * the FOOTER. Passed through verbatim to the provider.
   */
  code_expiration_minutes?: number
}

export interface TemplateButtonDef {
  /** `OTP` is used by AUTHENTICATION templates (copy-code / one-tap autofill). */
  type: 'PHONE_NUMBER' | 'URL' | 'QUICK_REPLY' | 'OTP'
  text?: string
  phone_number?: string
  url?: string
  example?: string[]
  /** OTP buttons only — the autofill behaviour. */
  otp_type?: 'COPY_CODE' | 'ONE_TAP' | 'ZERO_TAP'
  /** ONE_TAP/ZERO_TAP OTP buttons only — Android app integration fields. */
  autofill_text?: string
  package_name?: string
  signature_hash?: string
}

/** Input for creating a new template */
export interface CreateTemplateInput {
  name: string
  language: string
  category: 'UTILITY' | 'MARKETING' | 'AUTHENTICATION'
  components: TemplateComponentDef[]
}
