// ---------------------------------------------------------------------------
// Token bucket rate limiter — no dependencies
// ---------------------------------------------------------------------------

import type { RateLimitConfig } from '../types/config.js'
import { RateLimitError, TimeoutError } from './errors.js'

const DEFAULT_MAX_RPS = 80 // WhatsApp Cloud API default
const DEFAULT_MAX_QUEUE = 10_000 // overload protection — bounds memory
const DEFAULT_QUEUE_TIMEOUT_MS = 30_000 // a request never waits forever for a token

/** A parked caller waiting for a token. */
interface Waiter {
  grant: () => void
  settled: boolean
}

/**
 * Token bucket rate limiter.
 *
 * Ensures we don't exceed the provider's per-second request limit.
 * When the bucket is empty, callers wait FIFO until a token is available.
 *
 * NOTE: state lives in this instance's memory. It only limits the requests
 * flowing through a single client instance in a single isolate/process — it is
 * NOT a distributed limiter. On multi-isolate platforms (e.g. Cloudflare
 * Workers) construct ONE client and reuse it; for a true cross-isolate limit,
 * front it with Durable Objects / Upstash. Also note Workers freezes
 * `Date.now()` during synchronous execution, so token refill only advances
 * across `await`/I/O boundaries. See the README.
 */
export class RateLimiter {
  private tokens: number
  private readonly maxTokens: number
  private lastRefill: number
  private readonly refillRate: number // tokens per ms
  private readonly maxQueue: number
  private readonly queueTimeoutMs: number
  private readonly waitQueue: Waiter[] = []
  private drainTimerId: ReturnType<typeof setTimeout> | null = null

  constructor(config?: RateLimitConfig) {
    const maxRps = config?.maxRequestsPerSecond ?? DEFAULT_MAX_RPS
    if (!Number.isFinite(maxRps) || maxRps <= 0) {
      throw new RangeError(`rateLimit.maxRequestsPerSecond must be a positive number, got ${maxRps}`)
    }

    const maxQueue = config?.maxQueueSize ?? DEFAULT_MAX_QUEUE
    if (!Number.isInteger(maxQueue) || maxQueue < 1) {
      throw new RangeError(`rateLimit.maxQueueSize must be a positive integer, got ${maxQueue}`)
    }

    const queueTimeoutMs = config?.queueTimeoutMs ?? DEFAULT_QUEUE_TIMEOUT_MS
    if (!Number.isFinite(queueTimeoutMs) || queueTimeoutMs <= 0) {
      throw new RangeError(`rateLimit.queueTimeoutMs must be a positive number, got ${queueTimeoutMs}`)
    }

    this.maxTokens = maxRps
    this.tokens = maxRps
    this.lastRefill = Date.now()
    this.refillRate = maxRps / 1000 // tokens per millisecond
    this.maxQueue = maxQueue
    this.queueTimeoutMs = queueTimeoutMs
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
      const waiter = this.waitQueue.shift()
      if (!waiter || waiter.settled) continue // timed out already — don't waste a token
      this.tokens -= 1
      waiter.grant()
    }
  }

  /**
   * Acquire a token. Resolves immediately if tokens are available AND no one
   * is already waiting (FIFO fairness — newcomers never jump the queue),
   * otherwise waits until a token is refilled.
   *
   * - Rejects with a `RateLimitError` if the wait queue is already at capacity
   *   (bounds memory under sustained overload).
   * - Rejects with a `TimeoutError` if it waits longer than `queueTimeoutMs`,
   *   so a request never hangs forever before its fetch even starts.
   */
  async acquire(): Promise<void> {
    this.refill()

    if (this.tokens >= 1 && this.waitQueue.length === 0) {
      this.tokens -= 1
      return
    }

    if (this.waitQueue.length >= this.maxQueue) {
      throw new RateLimitError({
        message: `Local rate limiter queue is full (${this.maxQueue}) — too many concurrent requests`,
      })
    }

    return new Promise<void>((resolve, reject) => {
      const waiter: Waiter = { settled: false, grant: () => {} }

      const timer = setTimeout(() => {
        if (waiter.settled) return
        waiter.settled = true
        const idx = this.waitQueue.indexOf(waiter)
        if (idx >= 0) this.waitQueue.splice(idx, 1)
        reject(
          new TimeoutError({
            message: `Timed out after ${this.queueTimeoutMs}ms waiting for a rate-limit token`,
          }),
        )
      }, this.queueTimeoutMs)

      waiter.grant = () => {
        if (waiter.settled) return
        waiter.settled = true
        clearTimeout(timer)
        resolve()
      }

      this.waitQueue.push(waiter)
      this.scheduleDrain()
    })
  }

  /** Schedule a drain check if not already scheduled */
  private drainScheduled = false
  private scheduleDrain(): void {
    if (this.drainScheduled) return
    this.drainScheduled = true

    const waitMs = Math.max(1, Math.ceil(1 / this.refillRate))
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
    // Resolve all pending waiters (grant() clears each one's timeout) so
    // nothing hangs after shutdown.
    while (this.waitQueue.length > 0) {
      this.waitQueue.shift()?.grant()
    }
  }
}
