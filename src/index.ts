// ---------------------------------------------------------------------------
// waflow — Public API
//
// Usage:
//   import { createWhatsApp } from 'waflow'
//
//   const wa = createWhatsApp({
//     provider: 'cloud-api',
//     phoneNumberId: '...',
//     accessToken: '...',
//   })
//
//   await wa.message.text('+966501234567', 'Hello!')
// ---------------------------------------------------------------------------

import type { CreateWhatsAppConfig, ProviderConfig, ClientOptions } from './types/config.js'
import type { WhatsAppProviderAdapter } from './types/provider.js'
import { WhatsAppClient } from './client.js'
import { CloudApiProvider } from './providers/cloud-api/index.js'
import { Dialog360Provider } from './providers/360dialog/index.js'
import { WatiProvider } from './providers/wati/index.js'
import { assertNever } from './utils/assert.js'
import { ValidationError } from './core/errors.js'

/**
 * Create a new WhatsApp client configured for a specific provider.
 *
 * Switch providers by changing the `provider` field in the config.
 * All other code (message.*, media.*, webhook.*) stays identical.
 *
 * @example
 * ```ts
 * const wa = createWhatsApp({
 *   provider: 'cloud-api',
 *   phoneNumberId: process.env.WA_PHONE_ID,
 *   accessToken: process.env.WA_TOKEN,
 * })
 *
 * await wa.message.text('+966501234567', 'Hello!')
 * ```
 */
export function createWhatsApp(config: CreateWhatsAppConfig): WhatsAppClient {
  validateProviderConfig(config)
  const adapter = createAdapter(config)
  return new WhatsAppClient(adapter)
}

/**
 * Create a WhatsApp client from a custom adapter.
 * Use this when implementing your own provider.
 *
 * @example
 * ```ts
 * const wa = createWhatsAppFromAdapter(new MyCustomProvider(config))
 * ```
 */
export function createWhatsAppFromAdapter(adapter: WhatsAppProviderAdapter): WhatsAppClient {
  return new WhatsAppClient(adapter)
}

// ---------------------------------------------------------------------------
// Provider factory
// ---------------------------------------------------------------------------

function extractClientOptions(config: CreateWhatsAppConfig): ClientOptions {
  return {
    logger: config.logger,
    retry: config.retry,
    rateLimit: config.rateLimit,
    timeout: config.timeout,
    hooks: config.hooks,
    includeRawResponse: config.includeRawResponse,
  }
}

/** Fail fast with a clear error when required credentials are missing. */
function validateProviderConfig(config: CreateWhatsAppConfig): void {
  const requireField = (value: unknown, field: string): void => {
    if (typeof value !== 'string' || !value.trim()) {
      throw new ValidationError({
        message: `${config.provider} config requires a non-empty "${field}"`,
        provider: config.provider,
      })
    }
  }

  switch (config.provider) {
    case 'cloud-api':
      requireField(config.phoneNumberId, 'phoneNumberId')
      requireField(config.accessToken, 'accessToken')
      break
    case '360dialog':
      requireField(config.apiKey, 'apiKey')
      break
    case 'wati':
      requireField(config.apiKey, 'apiKey')
      requireField(config.baseUrl, 'baseUrl')
      requireField(config.channelNumber, 'channelNumber')
      break
    default:
      assertNever(config)
  }
}

function createAdapter(config: CreateWhatsAppConfig): WhatsAppProviderAdapter {
  const options = extractClientOptions(config)

  switch (config.provider) {
    case 'cloud-api':
      return new CloudApiProvider(config, options)

    case '360dialog':
      return new Dialog360Provider(config, options)

    case 'wati':
      return new WatiProvider(config, options)

    default:
      return assertNever(config)
  }
}

// ---------------------------------------------------------------------------
// Re-exports — everything available from 'waflow'
// ---------------------------------------------------------------------------

// Client
export { WhatsAppClient } from './client.js'

// Providers (for direct instantiation or extension)
export { CloudApiProvider } from './providers/cloud-api/index.js'
export { Dialog360Provider } from './providers/360dialog/index.js'
export { WatiProvider } from './providers/wati/index.js'

// Errors
export {
  WhatsAppError,
  AuthenticationError,
  RateLimitError,
  ValidationError,
  MediaError,
  TemplateError,
  ProviderError,
  UnsupportedFeatureError,
  NetworkError,
  TimeoutError,
  WebhookVerificationError,
} from './core/errors.js'

// Types
export type * from './types/index.js'

// Logger
export type { Logger } from './core/logger.js'
export { noopLogger } from './core/logger.js'
