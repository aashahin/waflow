// ---------------------------------------------------------------------------
// Custom error class hierarchy — typed, serializable, provider-aware
// ---------------------------------------------------------------------------

import type { WhatsAppErrorCode } from '../types/errors.js'

/**
 * Base error class for all waflow errors.
 * Extends native Error with structured code, provider, and status info.
 */
export class WhatsAppError extends Error {
  readonly code: WhatsAppErrorCode
  readonly provider: string
  readonly statusCode: number | undefined
  readonly raw: unknown

  constructor(opts: {
    code: WhatsAppErrorCode
    message: string
    provider?: string
    statusCode?: number
    raw?: unknown
    cause?: unknown
  }) {
    super(opts.message, { cause: opts.cause })
    this.name = 'WhatsAppError'
    this.code = opts.code
    this.provider = opts.provider ?? 'unknown'
    this.statusCode = opts.statusCode
    this.raw = opts.raw
  }
}

export class AuthenticationError extends WhatsAppError {
  constructor(opts: Omit<ConstructorParameters<typeof WhatsAppError>[0], 'code'>) {
    super({ ...opts, code: 'AUTH_FAILED' })
    this.name = 'AuthenticationError'
  }
}

export class RateLimitError extends WhatsAppError {
  readonly retryAfter: number | undefined

  constructor(
    opts: Omit<ConstructorParameters<typeof WhatsAppError>[0], 'code'> & {
      retryAfter?: number
    },
  ) {
    super({ ...opts, code: 'RATE_LIMITED' })
    this.name = 'RateLimitError'
    this.retryAfter = opts.retryAfter
  }
}

export class ValidationError extends WhatsAppError {
  constructor(opts: Omit<ConstructorParameters<typeof WhatsAppError>[0], 'code'>) {
    super({ ...opts, code: 'VALIDATION_FAILED' })
    this.name = 'ValidationError'
  }
}

export class MediaError extends WhatsAppError {
  constructor(opts: Omit<ConstructorParameters<typeof WhatsAppError>[0], 'code'>) {
    super({ ...opts, code: 'MEDIA_ERROR' })
    this.name = 'MediaError'
  }
}

export class TemplateError extends WhatsAppError {
  constructor(opts: Omit<ConstructorParameters<typeof WhatsAppError>[0], 'code'>) {
    super({ ...opts, code: 'TEMPLATE_ERROR' })
    this.name = 'TemplateError'
  }
}

export class ProviderError extends WhatsAppError {
  constructor(opts: Omit<ConstructorParameters<typeof WhatsAppError>[0], 'code'>) {
    super({ ...opts, code: 'PROVIDER_ERROR' })
    this.name = 'ProviderError'
  }
}

export class UnsupportedFeatureError extends WhatsAppError {
  constructor(opts: Omit<ConstructorParameters<typeof WhatsAppError>[0], 'code'>) {
    super({ ...opts, code: 'UNSUPPORTED_FEATURE' })
    this.name = 'UnsupportedFeatureError'
  }
}

export class NetworkError extends WhatsAppError {
  constructor(opts: Omit<ConstructorParameters<typeof WhatsAppError>[0], 'code'>) {
    super({ ...opts, code: 'NETWORK_ERROR' })
    this.name = 'NetworkError'
  }
}

export class TimeoutError extends WhatsAppError {
  constructor(opts: Omit<ConstructorParameters<typeof WhatsAppError>[0], 'code'>) {
    super({ ...opts, code: 'TIMEOUT' })
    this.name = 'TimeoutError'
  }
}

export class WebhookVerificationError extends WhatsAppError {
  constructor(opts: Omit<ConstructorParameters<typeof WhatsAppError>[0], 'code'>) {
    super({ ...opts, code: 'WEBHOOK_VERIFICATION_FAILED' })
    this.name = 'WebhookVerificationError'
  }
}
