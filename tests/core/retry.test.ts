import { describe, test, expect } from 'bun:test'
import { withRetry, resolveRetryConfig } from '../../src/core/retry.js'
import { noopLogger } from '../../src/core/logger.js'
import {
  RateLimitError,
  NetworkError,
  TimeoutError,
  ProviderError,
  ValidationError,
} from '../../src/core/errors.js'

// Fast config so retries don't slow the suite down.
const FAST = resolveRetryConfig({ maxRetries: 3, baseDelay: 1, maxDelay: 2 })

/** A function that throws `error` the first `failures` times, then returns 'ok'. */
function failing(error: unknown, failures: number): { fn: () => Promise<string>; calls: () => number } {
  let calls = 0
  return {
    fn: () => {
      calls++
      if (calls <= failures) return Promise.reject(error)
      return Promise.resolve('ok')
    },
    calls: () => calls,
  }
}

describe('withRetry — idempotency-aware policy', () => {
  test('429 is always retried, even for non-idempotent operations', async () => {
    const { fn, calls } = failing(new RateLimitError({ message: 'slow down' }), 2)
    const result = await withRetry(fn, FAST, noopLogger, { idempotent: false })
    expect(result).toBe('ok')
    expect(calls()).toBe(3)
  })

  test('5xx IS retried for idempotent operations (regression: used to never retry)', async () => {
    const err = new ProviderError({ message: 'boom', statusCode: 503 })
    const { fn, calls } = failing(err, 2)
    const result = await withRetry(fn, FAST, noopLogger, { idempotent: true })
    expect(result).toBe('ok')
    expect(calls()).toBe(3)
  })

  test('5xx is NOT retried for non-idempotent operations', async () => {
    const err = new ProviderError({ message: 'boom', statusCode: 500 })
    const { fn, calls } = failing(err, 1)
    await expect(withRetry(fn, FAST, noopLogger, { idempotent: false })).rejects.toBeInstanceOf(ProviderError)
    expect(calls()).toBe(1)
  })

  test('network error is NOT retried for non-idempotent sends (no duplicate delivery)', async () => {
    const { fn, calls } = failing(new NetworkError({ message: 'connection reset' }), 1)
    await expect(withRetry(fn, FAST, noopLogger, { idempotent: false })).rejects.toBeInstanceOf(NetworkError)
    expect(calls()).toBe(1)
  })

  test('network error IS retried for idempotent operations', async () => {
    const { fn, calls } = failing(new NetworkError({ message: 'connection reset' }), 2)
    const result = await withRetry(fn, FAST, noopLogger, { idempotent: true })
    expect(result).toBe('ok')
    expect(calls()).toBe(3)
  })

  test('timeout is NOT retried for non-idempotent operations', async () => {
    const { fn, calls } = failing(new TimeoutError({ message: 'timed out' }), 1)
    await expect(withRetry(fn, FAST, noopLogger, { idempotent: false })).rejects.toBeInstanceOf(TimeoutError)
    expect(calls()).toBe(1)
  })

  test('retryNonIdempotent opt-in retries network errors on non-idempotent ops', async () => {
    const cfg = resolveRetryConfig({ maxRetries: 3, baseDelay: 1, maxDelay: 2, retryNonIdempotent: true })
    const { fn, calls } = failing(new NetworkError({ message: 'connection reset' }), 2)
    const result = await withRetry(fn, cfg, noopLogger, { idempotent: false })
    expect(result).toBe('ok')
    expect(calls()).toBe(3)
  })

  test('non-retryable errors (validation) throw immediately', async () => {
    const { fn, calls } = failing(new ValidationError({ message: 'bad input' }), 1)
    await expect(withRetry(fn, FAST, noopLogger, { idempotent: true })).rejects.toBeInstanceOf(ValidationError)
    expect(calls()).toBe(1)
  })

  test('gives up after maxRetries and throws the last error', async () => {
    const err = new NetworkError({ message: 'down' })
    const { fn, calls } = failing(err, Infinity)
    await expect(withRetry(fn, FAST, noopLogger, { idempotent: true })).rejects.toBe(err)
    expect(calls()).toBe(FAST.maxRetries + 1) // initial attempt + retries
  })
})

describe('resolveRetryConfig — validation', () => {
  test('rejects negative maxRetries', () => {
    expect(() => resolveRetryConfig({ maxRetries: -1 })).toThrow(RangeError)
  })

  test('rejects non-finite delays', () => {
    expect(() => resolveRetryConfig({ baseDelay: Infinity })).toThrow(RangeError)
  })

  test('applies defaults', () => {
    const cfg = resolveRetryConfig()
    expect(cfg.maxRetries).toBe(3)
    expect(cfg.retryNonIdempotent).toBe(false)
  })
})
