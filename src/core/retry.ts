// ---------------------------------------------------------------------------
// Exponential backoff retry logic
// ---------------------------------------------------------------------------

import type { RetryConfig } from '../types/config.js'
import type { Logger } from './logger.js'
import { RateLimitError, NetworkError, TimeoutError } from './errors.js'

const DEFAULT_RETRY_CONFIG = {
  maxRetries: 3,
  baseDelay: 1000,
  maxDelay: 30_000,
} as const satisfies Required<RetryConfig>

/** Merge user config with defaults */
export function resolveRetryConfig(config?: RetryConfig): Required<RetryConfig> {
  return {
    maxRetries: config?.maxRetries ?? DEFAULT_RETRY_CONFIG.maxRetries,
    baseDelay: config?.baseDelay ?? DEFAULT_RETRY_CONFIG.baseDelay,
    maxDelay: config?.maxDelay ?? DEFAULT_RETRY_CONFIG.maxDelay,
  }
}

/** Determine if an error is retryable */
function isRetryable(error: unknown): boolean {
  if (error instanceof RateLimitError) return true
  if (error instanceof NetworkError) return true
  if (error instanceof TimeoutError) return true

  // Retry on 5xx or 429 status codes from raw fetch errors
  if (error instanceof Response) {
    return error.status === 429 || error.status >= 500
  }

  return false
}

/** Calculate delay with jitter for the given attempt */
function calculateDelay(attempt: number, config: Required<RetryConfig>): number {
  const exponential = config.baseDelay * Math.pow(2, attempt)
  const capped = Math.min(exponential, config.maxDelay)
  // Add ±25% jitter to prevent thundering herd
  const jitter = capped * (0.75 + Math.random() * 0.5)
  return Math.round(jitter)
}

/**
 * Execute a function with exponential backoff retry.
 *
 * Only retries on rate limit errors, network errors, timeouts,
 * and 5xx HTTP status codes.
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  config: Required<RetryConfig>,
  logger: Logger,
): Promise<T> {
  let lastError: unknown

  for (let attempt = 0; attempt <= config.maxRetries; attempt++) {
    try {
      return await fn()
    } catch (error) {
      lastError = error

      if (attempt >= config.maxRetries || !isRetryable(error)) {
        throw error
      }

      // Respect Retry-After header from rate limit responses
      let delay: number
      if (error instanceof RateLimitError && error.retryAfter) {
        delay = error.retryAfter * 1000
      } else {
        delay = calculateDelay(attempt, config)
      }

      logger.warn(`Retrying request (attempt ${attempt + 1}/${config.maxRetries})`, {
        delay,
        errorMessage: error instanceof Error ? error.message : String(error),
      })

      await sleep(delay)
    }
  }

  throw lastError
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}
