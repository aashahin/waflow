// ---------------------------------------------------------------------------
// Exponential backoff retry logic
// ---------------------------------------------------------------------------

import type { RetryConfig } from '../types/config.js'
import type { Logger } from './logger.js'
import { RateLimitError, NetworkError, TimeoutError, ProviderError } from './errors.js'

const DEFAULT_RETRY_CONFIG = {
  maxRetries: 3,
  baseDelay: 1000,
  maxDelay: 30_000,
  retryNonIdempotent: false,
} as const satisfies Required<RetryConfig>

/** Merge user config with defaults, validating numeric ranges */
export function resolveRetryConfig(config?: RetryConfig): Required<RetryConfig> {
  const maxRetries = config?.maxRetries ?? DEFAULT_RETRY_CONFIG.maxRetries
  const baseDelay = config?.baseDelay ?? DEFAULT_RETRY_CONFIG.baseDelay
  const maxDelay = config?.maxDelay ?? DEFAULT_RETRY_CONFIG.maxDelay

  if (!Number.isInteger(maxRetries) || maxRetries < 0) {
    throw new RangeError(`retry.maxRetries must be a non-negative integer, got ${maxRetries}`)
  }
  if (!Number.isFinite(baseDelay) || baseDelay < 0) {
    throw new RangeError(`retry.baseDelay must be a non-negative number, got ${baseDelay}`)
  }
  if (!Number.isFinite(maxDelay) || maxDelay < 0) {
    throw new RangeError(`retry.maxDelay must be a non-negative number, got ${maxDelay}`)
  }

  return {
    maxRetries,
    baseDelay,
    maxDelay,
    retryNonIdempotent: config?.retryNonIdempotent ?? DEFAULT_RETRY_CONFIG.retryNonIdempotent,
  }
}

/** Retry policy for a single operation */
export interface RetryPolicy {
  /**
   * Whether the operation is safe to retry after an *ambiguous* failure —
   * a network error, timeout, or 5xx, where the request may already have
   * been processed by the provider. Idempotent reads/deletes set this true;
   * sends/creates set it false to avoid duplicate side effects.
   */
  idempotent: boolean
}

/**
 * Determine if an error is retryable.
 *
 * - `429` is always retryable: the request was rejected before processing, so
 *   there is no duplicate risk.
 * - Network errors, timeouts, and `5xx` are *ambiguous* (the request may have
 *   landed). They are only retried when the operation is idempotent.
 */
function isRetryable(error: unknown, canRetryAmbiguous: boolean): boolean {
  if (error instanceof RateLimitError) return true
  if (error instanceof NetworkError) return canRetryAmbiguous
  if (error instanceof TimeoutError) return canRetryAmbiguous
  if (error instanceof ProviderError) {
    return canRetryAmbiguous && (error.statusCode ?? 0) >= 500
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
 * Retries on rate limits (429) always, and on network errors / timeouts /
 * 5xx only when `policy.idempotent` is set (or `retryNonIdempotent` is
 * enabled in config). This prevents duplicate sends for non-idempotent POSTs.
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  config: Required<RetryConfig>,
  logger: Logger,
  policy: RetryPolicy,
): Promise<T> {
  const canRetryAmbiguous = policy.idempotent || config.retryNonIdempotent
  let lastError: unknown

  for (let attempt = 0; attempt <= config.maxRetries; attempt++) {
    try {
      return await fn()
    } catch (error) {
      lastError = error

      if (attempt >= config.maxRetries || !isRetryable(error, canRetryAmbiguous)) {
        throw error
      }

      // Respect Retry-After header from rate limit responses, but never wait
      // longer than maxDelay — a huge Retry-After must not park an edge
      // function past its wall-clock budget.
      let delay: number
      if (error instanceof RateLimitError && error.retryAfter) {
        delay = Math.min(error.retryAfter * 1000, config.maxDelay)
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
