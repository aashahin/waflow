// ---------------------------------------------------------------------------
// Token bucket rate limiter — no dependencies
// ---------------------------------------------------------------------------

import type { RateLimitConfig } from '../types/config.js'

const DEFAULT_MAX_RPS = 80 // WhatsApp Cloud API default

/**
 * Token bucket rate limiter.
 *
 * Ensures we don't exceed the provider's per-second request limit.
 * When the bucket is empty, callers wait until a token is available.
 */
export class RateLimiter {
  private tokens: number
  private readonly maxTokens: number
  private lastRefill: number
  private readonly refillRate: number // tokens per ms
  private readonly waitQueue: Array<() => void> = []
  private drainTimerId: ReturnType<typeof setTimeout> | null = null

  constructor(config?: RateLimitConfig) {
    const maxRps = config?.maxRequestsPerSecond ?? DEFAULT_MAX_RPS
    this.maxTokens = maxRps
    this.tokens = maxRps
    this.lastRefill = Date.now()
    this.refillRate = maxRps / 1000 // tokens per millisecond
  }

  /** Refill tokens based on elapsed time */
  private refill(): void {
    const now = Date.now()
    const elapsed = now - this.lastRefill
    const newTokens = elapsed * this.refillRate
    this.tokens = Math.min(this.maxTokens, this.tokens + newTokens)
    this.lastRefill = now
  }

  /** Drain queued waiters if tokens are available */
  private drain(): void {
    while (this.waitQueue.length > 0 && this.tokens >= 1) {
      this.tokens -= 1
      const resolve = this.waitQueue.shift()
      resolve?.()
    }
  }

  /**
   * Acquire a token. Resolves immediately if tokens are available,
   * otherwise waits until a token is refilled.
   */
  async acquire(): Promise<void> {
    this.refill()

    if (this.tokens >= 1) {
      this.tokens -= 1
      return
    }

    // Wait for a token to become available
    return new Promise<void>(resolve => {
      this.waitQueue.push(resolve)
      this.scheduleDrain()
    })
  }

  /** Schedule a drain check if not already scheduled */
  private drainScheduled = false
  private scheduleDrain(): void {
    if (this.drainScheduled) return
    this.drainScheduled = true

    const waitMs = Math.ceil(1 / this.refillRate)
    this.drainTimerId = setTimeout(() => {
      this.drainTimerId = null
      this.drainScheduled = false
      this.refill()
      this.drain()
      // If there are still waiters, schedule another drain
      if (this.waitQueue.length > 0) {
        this.scheduleDrain()
      }
    }, waitMs)
    // Unref so the timer doesn't hold the event loop open in serverless/edge
    if (typeof this.drainTimerId === 'object' && this.drainTimerId !== null && 'unref' in this.drainTimerId) {
      (this.drainTimerId as { unref: () => void }).unref()
    }
  }

  /**
   * Clean up pending timers and resolve queued waiters.
   * Call this when you're done with the client to allow clean shutdown
   * in serverless/edge environments.
   */
  destroy(): void {
    if (this.drainTimerId !== null) {
      clearTimeout(this.drainTimerId)
      this.drainTimerId = null
    }
    this.drainScheduled = false
    // Resolve all pending waiters so they don't hang
    while (this.waitQueue.length > 0) {
      const resolve = this.waitQueue.shift()
      resolve?.()
    }
  }
}
