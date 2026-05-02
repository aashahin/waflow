// ---------------------------------------------------------------------------
// Error type definitions
// ---------------------------------------------------------------------------

/** All possible error codes emitted by the SDK */
export type WhatsAppErrorCode =
  | 'AUTH_FAILED'
  | 'RATE_LIMITED'
  | 'VALIDATION_FAILED'
  | 'MEDIA_ERROR'
  | 'TEMPLATE_ERROR'
  | 'PROVIDER_ERROR'
  | 'UNSUPPORTED_FEATURE'
  | 'NETWORK_ERROR'
  | 'WEBHOOK_VERIFICATION_FAILED'
  | 'TIMEOUT'
