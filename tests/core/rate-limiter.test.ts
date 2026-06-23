import { describe, test, expect } from 'bun:test'
import { RateLimiter } from '../../src/core/rate-limiter.js'
import { RateLimitError, TimeoutError } from '../../src/core/errors.js'

describe('RateLimiter', () => {
  test('allows requests within the rate limit', async () => {
    const limiter = new RateLimiter({ maxRequestsPerSecond: 10 })

    // Should not throw or block for a small number of requests
    for (let i = 0; i < 5; i++) {
      await limiter.acquire()
    }
  })

  test('defaults to 80 requests per second', async () => {
    const limiter = new RateLimiter()

    // Should be able to acquire many tokens quickly with default limit
    const start = Date.now()
    for (let i = 0; i < 10; i++) {
      await limiter.acquire()
    }
    const elapsed = Date.now() - start

    // 10 requests with 80/sec limit should be nearly instant
    expect(elapsed).toBeLessThan(500)
  })

  test('accepts undefined config', async () => {
    const limiter = new RateLimiter(undefined)
    await limiter.acquire() // Should not throw
  })

  test('queues requests when bucket is empty', async () => {
    // Very low rate limit to force queueing
    const limiter = new RateLimiter({ maxRequestsPerSecond: 2 })

    const start = Date.now()

    // Exhaust the bucket (2 tokens)
    await limiter.acquire()
    await limiter.acquire()

    // Third request should be queued and wait for refill
    await limiter.acquire()
    const elapsed = Date.now() - start

    // Should have waited for at least one refill interval (~500ms for 2/sec)
    expect(elapsed).toBeGreaterThanOrEqual(400)
  })

  test('rejects invalid maxRequestsPerSecond', () => {
    expect(() => new RateLimiter({ maxRequestsPerSecond: 0 })).toThrow(RangeError)
    expect(() => new RateLimiter({ maxRequestsPerSecond: -5 })).toThrow(RangeError)
  })

  test('rejects invalid maxQueueSize', () => {
    expect(() => new RateLimiter({ maxRequestsPerSecond: 10, maxQueueSize: 0 })).toThrow(RangeError)
  })

  test('rejects with RateLimitError when the queue overflows', async () => {
    // 1 token, then queue capacity of 1 — the third concurrent acquire overflows.
    const limiter = new RateLimiter({ maxRequestsPerSecond: 1, maxQueueSize: 1 })

    await limiter.acquire() // consumes the only token
    const queued = limiter.acquire() // fills the queue (will resolve later)

    await expect(limiter.acquire()).rejects.toBeInstanceOf(RateLimitError)

    limiter.destroy() // release the queued waiter so the test doesn't hang
    await queued
  })

  test('rejects with TimeoutError when a waiter exceeds queueTimeoutMs', async () => {
    // 1 rps → next token is ~1s away, but the queue timeout is 50ms.
    const limiter = new RateLimiter({ maxRequestsPerSecond: 1, queueTimeoutMs: 50 })

    await limiter.acquire() // consume the token
    await expect(limiter.acquire()).rejects.toBeInstanceOf(TimeoutError)

    limiter.destroy()
  })

  test('newcomers do not jump queued waiters (FIFO fairness)', async () => {
    const limiter = new RateLimiter({ maxRequestsPerSecond: 2 })
    const order: number[] = []

    await limiter.acquire()
    await limiter.acquire() // bucket now empty

    // Two queued in order; both should resolve, first-in-first-out.
    const a = limiter.acquire().then(() => order.push(1))
    const b = limiter.acquire().then(() => order.push(2))

    await Promise.all([a, b])
    expect(order).toEqual([1, 2])
    limiter.destroy()
  })
})
