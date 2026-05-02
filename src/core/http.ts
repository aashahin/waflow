// ---------------------------------------------------------------------------
// HTTP client wrapper — fetch-based, with retry + rate limiting
// ---------------------------------------------------------------------------

import type { ClientHooks } from '../types/config.js'
import type { ProviderName } from '../types/common.js'
import type { Logger } from './logger.js'
import type { RateLimiter } from './rate-limiter.js'
import type { RetryConfig } from '../types/config.js'
import {
  AuthenticationError,
  NetworkError,
  ProviderError,
  RateLimitError,
  TimeoutError,
  ValidationError,
} from './errors.js'
import { resolveRetryConfig, withRetry } from './retry.js'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface HttpClientConfig {
  /** Default base URL for requests */
  baseUrl: string
  /** Default headers applied to every request */
  defaultHeaders: Record<string, string>
  /** Request timeout in ms */
  timeout: number
  /** Provider name for error context */
  provider: ProviderName
  /** Logger instance */
  logger: Logger
  /** Rate limiter instance */
  rateLimiter: RateLimiter
  /** Retry config */
  retry: RetryConfig
  /** Lifecycle hooks */
  hooks?: ClientHooks
}

export interface RequestOptions {
  /** HTTP method */
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'
  /** Path appended to baseUrl */
  path: string
  /** JSON body (will be serialized) */
  body?: unknown
  /** Additional headers (merged with defaults) */
  headers?: Record<string, string>
  /** Query string parameters */
  query?: Record<string, string | number | boolean | undefined>
  /** Override timeout for this request */
  timeout?: number
  /** Skip retry for this request */
  skipRetry?: boolean
}

export interface HttpResponse<T = unknown> {
  status: number
  data: T
  headers: Headers
}

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

export class HttpClient {
  private readonly config: HttpClientConfig
  private readonly retryConfig: Required<RetryConfig>

  constructor(config: HttpClientConfig) {
    this.config = config
    this.retryConfig = resolveRetryConfig(config.retry)
  }

  /**
   * Make a JSON request. Handles rate limiting, retry, timeout, and
   * error classification.
   */
  async request<T = unknown>(opts: RequestOptions): Promise<HttpResponse<T>> {
    const execute = async (): Promise<HttpResponse<T>> => {
      await this.config.rateLimiter.acquire()

      const url = this.buildUrl(opts.path, opts.query)
      const timeout = opts.timeout ?? this.config.timeout
      const headers: Record<string, string> = {
        ...this.config.defaultHeaders,
        ...opts.headers,
      }

      // Only set Content-Type for JSON bodies
      if (opts.body !== undefined && !headers['Content-Type']) {
        headers['Content-Type'] = 'application/json'
      }

      const startTime = Date.now()

      this.config.hooks?.onRequest?.({
        url,
        method: opts.method,
        body: opts.body,
      })

      this.config.logger.debug(`${opts.method} ${url}`)

      let response: Response
      try {
        response = await fetch(url, {
          method: opts.method,
          headers,
          body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
          signal: AbortSignal.timeout(timeout),
        })
      } catch (error) {
        if (error instanceof DOMException && error.name === 'TimeoutError') {
          throw new TimeoutError({
            message: `Request timed out after ${timeout}ms: ${opts.method} ${url}`,
            provider: this.config.provider,
          })
        }
        if (error instanceof DOMException && error.name === 'AbortError') {
          throw new TimeoutError({
            message: `Request aborted: ${opts.method} ${url}`,
            provider: this.config.provider,
          })
        }
        throw new NetworkError({
          message: `Network error: ${error instanceof Error ? error.message : String(error)}`,
          provider: this.config.provider,
          cause: error,
        })
      }

      const durationMs = Date.now() - startTime

      this.config.hooks?.onResponse?.({
        url,
        status: response.status,
        durationMs,
      })

      if (!response.ok) {
        await this.handleErrorResponse(response, opts)
      }

      // Handle empty responses (204 No Content, etc.)
      const hasBody =
        response.status !== 204 &&
        response.headers.get('content-length') !== '0'

      const data = hasBody ? ((await response.json()) as T) : (undefined as T)

      this.config.logger.debug(`${opts.method} ${url} → ${response.status} (${durationMs}ms)`)

      return {
        status: response.status,
        data,
        headers: response.headers,
      }
    }

    if (opts.skipRetry) {
      return execute()
    }

    return withRetry(execute, this.retryConfig, this.config.logger)
  }

  /**
   * Make a raw fetch request (for media downloads that return streams).
   * Returns the raw Response so the caller can access .body as a stream.
   * Supports retry for transient failures.
   */
  async rawRequest(opts: RequestOptions): Promise<Response> {
    const execute = async (): Promise<Response> => {
      await this.config.rateLimiter.acquire()

      const url = this.buildUrl(opts.path, opts.query)
      const timeout = opts.timeout ?? this.config.timeout
      const headers: Record<string, string> = {
        ...this.config.defaultHeaders,
        ...opts.headers,
      }

      let response: Response
      try {
        response = await fetch(url, {
          method: opts.method,
          headers,
          body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
          signal: AbortSignal.timeout(timeout),
        })
      } catch (error) {
        if (error instanceof DOMException && error.name === 'TimeoutError') {
          throw new TimeoutError({
            message: `Request timed out after ${timeout}ms: ${opts.method} ${url}`,
            provider: this.config.provider,
          })
        }
        throw new NetworkError({
          message: `Network error: ${error instanceof Error ? error.message : String(error)}`,
          provider: this.config.provider,
          cause: error,
        })
      }

      if (!response.ok) {
        await this.handleErrorResponse(response, opts)
      }

      return response
    }

    if (opts.skipRetry) {
      return execute()
    }

    return withRetry(execute, this.retryConfig, this.config.logger)
  }

  /**
   * Make a multipart/form-data request (for media uploads).
   *
   * By default, uploads are retried on transient failures. Pass
   * `skipRetry: true` to disable retry (recommended for large uploads
   * where duplicate uploads are a concern).
   */
  async uploadRequest<T = unknown>(
    path: string,
    formData: FormData,
    extraHeaders?: Record<string, string>,
    skipRetry?: boolean,
  ): Promise<HttpResponse<T>> {
    const execute = async (): Promise<HttpResponse<T>> => {
      await this.config.rateLimiter.acquire()

      const url = this.buildUrl(path)
      const timeout = this.config.timeout
      const headers: Record<string, string> = {
        ...this.config.defaultHeaders,
        ...extraHeaders,
      }
      // Do NOT set Content-Type — fetch sets it with boundary for FormData

      let response: Response
      try {
        response = await fetch(url, {
          method: 'POST',
          headers,
          body: formData,
          signal: AbortSignal.timeout(timeout),
        })
      } catch (error) {
        if (error instanceof DOMException && error.name === 'TimeoutError') {
          throw new TimeoutError({
            message: `Upload timed out after ${timeout}ms`,
            provider: this.config.provider,
          })
        }
        throw new NetworkError({
          message: `Upload failed: ${error instanceof Error ? error.message : String(error)}`,
          provider: this.config.provider,
          cause: error,
        })
      }

      if (!response.ok) {
        await this.handleErrorResponse(response, { method: 'POST', path })
      }

      const data = (await response.json()) as T

      return { status: response.status, data, headers: response.headers }
    }

    if (skipRetry) {
      return execute()
    }

    return withRetry(execute, this.retryConfig, this.config.logger)
  }

  // -----------------------------------------------------------------------
  // Private helpers
  // -----------------------------------------------------------------------

  private buildUrl(path: string, query?: Record<string, string | number | boolean | undefined>): string {
    // If path is already a full URL (e.g., media download URLs), use as-is
    if (path.startsWith('http://') || path.startsWith('https://')) {
      return path
    }

    const base = this.config.baseUrl.replace(/\/$/, '')
    const cleanPath = path.startsWith('/') ? path : `/${path}`
    const url = new URL(`${base}${cleanPath}`)

    if (query) {
      for (const [key, value] of Object.entries(query)) {
        if (value !== undefined) {
          url.searchParams.set(key, String(value))
        }
      }
    }

    return url.toString()
  }

  private async handleErrorResponse(response: Response, opts: Pick<RequestOptions, 'method' | 'path'>): Promise<never> {
    // Read as text first, then try to parse as JSON.
    // This avoids double-consuming the body stream (response.json() + response.text()
    // would fail because Response.body is a one-shot ReadableStream).
    let errorBody: unknown
    try {
      const text = await response.text()
      try {
        errorBody = JSON.parse(text)
      } catch {
        errorBody = text || null
      }
    } catch {
      errorBody = null
    }

    const context = {
      provider: this.config.provider,
      statusCode: response.status,
      raw: errorBody,
    } as const

    this.config.hooks?.onError?.(errorBody)

    // Classify by HTTP status
    switch (response.status) {
      case 401:
        throw new AuthenticationError({
          message: `Authentication failed: ${opts.method} ${opts.path}`,
          ...context,
        })
      case 403:
        throw new AuthenticationError({
          message: `Access forbidden: ${opts.method} ${opts.path}`,
          ...context,
        })
      case 429: {
        const retryAfter = response.headers.get('Retry-After')
        throw new RateLimitError({
          message: `Rate limited: ${opts.method} ${opts.path}`,
          ...context,
          retryAfter: retryAfter ? parseInt(retryAfter, 10) : undefined,
        })
      }
      case 400:
        throw new ValidationError({
          message: `Validation failed: ${opts.method} ${opts.path}`,
          ...context,
        })
      default:
        throw new ProviderError({
          message: `Provider error (${response.status}): ${opts.method} ${opts.path}`,
          ...context,
        })
    }
  }
}
