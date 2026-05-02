import { describe, test, expect } from 'bun:test'
import { RateLimiter } from '../../src/core/rate-limiter.js'

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
})
