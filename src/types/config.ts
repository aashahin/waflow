// ---------------------------------------------------------------------------
// Provider configuration — discriminated union by `provider` field
// ---------------------------------------------------------------------------

import type { Logger } from '../core/logger.js'

// ---------------------------------------------------------------------------
// Per-provider configs
// ---------------------------------------------------------------------------

export interface CloudApiConfig {
  provider: 'cloud-api'
  /** The phone number ID from Meta Business Manager */
  phoneNumberId: string
  /** Permanent or temporary access token */
  accessToken: string
  /** Graph API version (default: "v25.0") */
  apiVersion?: string
  /** Token used when Meta sends the webhook verification GET request */
  webhookVerifyToken?: string
  /** App secret used to verify inbound webhook signatures (HMAC SHA-256) */
  appSecret?: string
  /**
   * WhatsApp Business Account ID — required for template management.
   * If not provided, template operations (list/create/delete) will throw.
   * Find it in Meta Business Manager → WhatsApp → Business Account Settings.
   */
  wabaId?: string
}

export interface Dialog360Config {
  provider: '360dialog'
  /** API key from the 360dialog dashboard */
  apiKey: string
  /** Override the default base URL (default: "https://waba-v2.360dialog.io") */
  baseUrl?: string
  /** Secret for webhook signature verification */
  webhookSecret?: string
}

export interface WatiConfig {
  provider: 'wati'
  /** Bearer token from Wati dashboard → Settings → API */
  apiKey: string
  /** Tenant-specific base URL (e.g. "https://live-mt-server.wati.io/300305") */
  baseUrl: string
  /** WATI sender channel number (example: "201234567890") */
  channelNumber: string
  /** Secret for webhook signature verification */
  webhookSecret?: string
}

/** Union of all provider configurations */
export type ProviderConfig = CloudApiConfig | Dialog360Config | WatiConfig

// ---------------------------------------------------------------------------
// Client-level options (applied on top of any provider config)
// ---------------------------------------------------------------------------

export interface RetryConfig {
  /** Maximum number of retry attempts (default: 3) */
  maxRetries?: number
  /** Base delay in ms before first retry (default: 1000) */
  baseDelay?: number
  /** Maximum delay in ms between retries (default: 30000) */
  maxDelay?: number
}

export interface RateLimitConfig {
  /** Maximum requests per second (default: 80 for Cloud API) */
  maxRequestsPerSecond?: number
}

export interface ClientHooks {
  /** Called before every outbound HTTP request */
  onRequest?: (info: { url: string; method: string; body?: unknown }) => void
  /** Called after every HTTP response */
  onResponse?: (info: { url: string; status: number; durationMs: number }) => void
  /** Called on every error (after retries exhausted) */
  onError?: (error: unknown) => void
}

export interface ClientOptions {
  /** Pluggable logger (default: no-op) */
  logger?: Logger
  /** Retry configuration */
  retry?: RetryConfig
  /** Rate limiting configuration */
  rateLimit?: RateLimitConfig
  /** Request timeout in milliseconds (default: 30_000) */
  timeout?: number
  /** Lifecycle hooks */
  hooks?: ClientHooks
  /** Include raw provider response in SendResult (default: false) */
  includeRawResponse?: boolean
}

/** Full config passed to `createWhatsApp()` */
export type CreateWhatsAppConfig = ProviderConfig & ClientOptions
