// ---------------------------------------------------------------------------
// HTTP client wrapper — fetch-based, with retry + rate limiting
// ---------------------------------------------------------------------------

import type { ClientHooks } from '../types/config.js'
import type { ProviderName } from '../types/common.js'
import type { Logger } from './logger.js'
import type { RateLimiter } from './rate-limiter.js'
import type { RetryConfig } from '../types/config.js'
import { NetworkError, ProviderError, TimeoutError } from './errors.js'
import { throwForHttpError } from './http-error.js'
import { resolveRetryConfig, withRetry } from './retry.js'
import { assertSafeFetchUrl, isAbsoluteUrl, isSameOrigin, isTrustedMediaHost, makeRequestSignal, mergeAbortSignals } from './url-guard.js'

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
  /** Optional caller abort signal merged with the per-request timeout */
  signal?: AbortSignal
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
  /**
   * Override idempotency for retry purposes. By default GET/PUT/DELETE are
   * treated as idempotent (safe to retry after ambiguous failures) and
   * POST/PATCH are not. Set explicitly when the default is wrong.
   */
  idempotent?: boolean
  /** Per-request abort signal (merged with the timeout signal) */
  signal?: AbortSignal
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
    const signal = mergeAbortSignals(opts.signal, this.config.signal)
    const execute = async (): Promise<HttpResponse<T>> => {
      await this.config.rateLimiter.acquire(signal)

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

      this.safeHook('onRequest', { url, method: opts.method, body: opts.body })

      this.log('debug', `${opts.method} ${url}`)

      const response = await this.doFetch(url, {
        method: opts.method,
        headers,
        headerUrl: opts.path,
        body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
        timeout,
        signal,
      })

      const durationMs = Date.now() - startTime

      this.safeHook('onResponse', { url, status: response.status, durationMs })

      if (!response.ok) {
        await this.handleErrorResponse(response, opts)
      }

      const data = await this.parseJsonBody<T>(response, opts)

      this.log('debug', `${opts.method} ${url} → ${response.status} (${durationMs}ms)`)

      return {
        status: response.status,
        data,
        headers: response.headers,
      }
    }

    return this.run(execute, opts.method, opts.skipRetry, opts.idempotent, signal)
  }

  /**
   * Make a raw fetch request (for media downloads that return streams).
   * Returns the raw Response so the caller can access .body as a stream.
   * Supports retry for transient failures.
   */
  async rawRequest(opts: RequestOptions): Promise<Response> {
    const signal = mergeAbortSignals(opts.signal, this.config.signal)
    const execute = async (): Promise<Response> => {
      await this.config.rateLimiter.acquire(signal)

      const url = this.buildUrl(opts.path, opts.query)
      const timeout = opts.timeout ?? this.config.timeout
      const headers: Record<string, string> = {
        ...this.config.defaultHeaders,
        ...opts.headers,
      }

      const startTime = Date.now()
      this.safeHook('onRequest', { url, method: opts.method, body: opts.body })

      const response = await this.doFetch(url, {
        method: opts.method,
        headers,
        headerUrl: opts.path,
        body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
        timeout,
        signal,
      })

      this.safeHook('onResponse', {
        url,
        status: response.status,
        durationMs: Date.now() - startTime,
      })

      if (!response.ok) {
        await this.handleErrorResponse(response, opts)
      }

      return response
    }

    return this.run(execute, opts.method, opts.skipRetry, opts.idempotent, signal)
  }

  /**
   * Make a multipart/form-data request (for media uploads).
   *
   * Uploads are POSTs and therefore treated as non-idempotent: they are not
   * retried after ambiguous failures (to avoid duplicate uploads), though a
   * `429` is still retried. Pass `skipRetry: true` to disable retry entirely.
   */
  async uploadRequest<T = unknown>(
    path: string,
    formData: FormData,
    options?: {
      extraHeaders?: Record<string, string>
      skipRetry?: boolean
      timeout?: number
      signal?: AbortSignal
    },
  ): Promise<HttpResponse<T>> {
    const signal = mergeAbortSignals(options?.signal, this.config.signal)
    const execute = async (): Promise<HttpResponse<T>> => {
      await this.config.rateLimiter.acquire(signal)

      const url = this.buildUrl(path)
      const timeout = options?.timeout ?? this.config.timeout
      const headers: Record<string, string> = {
        ...this.config.defaultHeaders,
        ...options?.extraHeaders,
      }

      const startTime = Date.now()
      this.safeHook('onRequest', { url, method: 'POST' })

      const response = await this.doFetch(url, {
        method: 'POST',
        headers,
        headerUrl: path,
        body: formData,
        timeout,
        signal,
      })

      this.safeHook('onResponse', {
        url,
        status: response.status,
        durationMs: Date.now() - startTime,
      })

      if (!response.ok) {
        await this.handleErrorResponse(response, { method: 'POST', path })
      }

      const data = await this.parseJsonBody<T>(response, { method: 'POST', path })

      return { status: response.status, data, headers: response.headers }
    }

    return this.run(execute, 'POST', options?.skipRetry, false, signal)
  }

  /**
   * Release resources held by this client (the rate limiter's pending timer
   * and queued waiters). Call when you're done with the client.
   */
  destroy(): void {
    this.config.rateLimiter.destroy()
  }

  // -----------------------------------------------------------------------
  // Private helpers
  // -----------------------------------------------------------------------

  /** Run `execute` with retry + a single onError hook on terminal failure. */
  private async run<T>(
    execute: () => Promise<T>,
    method: RequestOptions['method'],
    skipRetry: boolean | undefined,
    idempotentOverride: boolean | undefined,
    signal?: AbortSignal,
  ): Promise<T> {
    try {
      if (skipRetry) return await execute()
      const idempotent = idempotentOverride ?? isIdempotentMethod(method)
      return await withRetry(execute, this.retryConfig, this.config.logger, { idempotent, signal })
    } catch (error) {
      // Fire once, after retries are exhausted, with the actual thrown error
      // (covers network/timeout errors, not just HTTP error responses).
      this.safeErrorHook(error)
      throw error
    }
  }

  private safeHook(
    name: 'onRequest' | 'onResponse',
    payload: { url: string; method?: string; body?: unknown; status?: number; durationMs?: number },
  ): void {
    try {
      if (name === 'onRequest') {
        this.config.hooks?.onRequest?.({
          url: payload.url,
          method: payload.method ?? 'GET',
          body: payload.body,
        })
        return
      }
      this.config.hooks?.onResponse?.({
        url: payload.url,
        status: payload.status ?? 0,
        durationMs: payload.durationMs ?? 0,
      })
    } catch (error) {
      this.log('warn', `hooks.${name} threw`, {
        errorMessage: error instanceof Error ? error.message : String(error),
      })
    }
  }

  private safeErrorHook(error: unknown): void {
    try {
      this.config.hooks?.onError?.(error)
    } catch (hookError) {
      this.log('warn', 'hooks.onError threw', {
        errorMessage: hookError instanceof Error ? hookError.message : String(hookError),
      })
    }
  }

  private log(level: 'debug' | 'warn', msg: string, meta?: Record<string, unknown>): void {
    try {
      this.config.logger[level](msg, meta)
    } catch {}
  }

  private stripAuthHeaders(headers: Record<string, string>): Record<string, string> {
    const stripped = { ...headers }
    delete stripped['Authorization']
    delete stripped['authorization']
    delete stripped['D360-API-KEY']
    delete stripped['d360-api-key']
    return stripped
  }

  private headersForUrl(url: string, headers: Record<string, string>): Record<string, string> {
    if (!isAbsoluteUrl(url)) return headers
    // Never send credentials on an http hop when the API origin is https
    // (e.g. 360dialog https → http on the same host).
    try {
      if (new URL(url).protocol === 'http:' && new URL(this.config.baseUrl).protocol === 'https:') {
        return this.stripAuthHeaders(headers)
      }
    } catch {
      return this.stripAuthHeaders(headers)
    }
    if (isTrustedMediaHost(url, this.config.baseUrl, this.config.provider)) {
      return headers
    }
    return this.stripAuthHeaders(headers)
  }

  /**
   * SSRF guard: refuse off-origin private/local URLs. Same-origin as the
   * configured API (e.g. a local mock at http://127.0.0.1:4010) is allowed.
   */
  private assertUrlAllowed(url: string): void {
    if (isAbsoluteUrl(url) && !isSameOrigin(url, this.config.baseUrl)) {
      assertSafeFetchUrl(url, this.config.provider)
    }
  }

  /** Perform a single fetch, translating low-level failures to typed errors. */
  private async doFetch(
    url: string,
    init: {
      method: string
      /** Unstripped headers; credentials are filtered per hop via headersForUrl. */
      headers: Record<string, string>
      /** Path/URL used for the first hop's credential policy. */
      headerUrl: string
      body?: BodyInit
      timeout: number
      signal?: AbortSignal
    },
  ): Promise<Response> {
    this.assertUrlAllowed(url)

    const { signal, cleanup } = makeRequestSignal(init.timeout, init.signal)
    let currentUrl = url
    let method = init.method
    let body = init.body
    let headers = this.headersForUrl(init.headerUrl, init.headers)

    try {
      for (let hop = 0; hop <= MAX_REDIRECT_HOPS; hop++) {
        let response: Response
        try {
          response = await fetch(currentUrl, {
            method,
            headers,
            body,
            signal,
            redirect: 'manual',
          })
        } catch (error) {
          if (init.signal?.aborted || this.config.signal?.aborted) {
            throw new NetworkError({
              message: `Request aborted: ${method} ${currentUrl}`,
              provider: this.config.provider,
              retryable: false,
            })
          }
          const name = error instanceof Error ? error.name : ''
          if (name === 'TimeoutError' || name === 'AbortError') {
            throw new TimeoutError({
              message: `Request timed out after ${init.timeout}ms: ${method} ${currentUrl}`,
              provider: this.config.provider,
            })
          }
          throw new NetworkError({
            message: `Network error: ${error instanceof Error ? error.message : String(error)}`,
            provider: this.config.provider,
            cause: error,
          })
        }

        if (!REDIRECT_STATUS.has(response.status)) {
          return response
        }

        void response.body?.cancel()

        if (hop === MAX_REDIRECT_HOPS) {
          throw new ProviderError({
            message: `Too many redirects: ${method} ${currentUrl}`,
            provider: this.config.provider,
            statusCode: response.status,
          })
        }

        const location = response.headers.get('Location')
        if (!location || !location.trim()) {
          throw new ProviderError({
            message: `Redirect (${response.status}) missing Location header: ${method} ${currentUrl}`,
            provider: this.config.provider,
            statusCode: response.status,
          })
        }

        let resolved: URL
        try {
          resolved = new URL(location, currentUrl)
        } catch {
          throw new ProviderError({
            message: `Redirect (${response.status}) has invalid Location header: ${location}`,
            provider: this.config.provider,
            statusCode: response.status,
          })
        }

        const resolvedHref = resolved.href
        this.assertUrlAllowed(resolvedHref)

        // 303 always continues as GET. 301/302 POST historically become GET with no body
        // (fetch/browsers do this; 307/308 keep method and body).
        if (
          response.status === 303
          || ((response.status === 301 || response.status === 302) && method !== 'GET' && method !== 'HEAD')
        ) {
          method = 'GET'
          body = undefined
        }

        // Graph is not a trusted media host, so headersForUrl would strip an
        // authenticated API hop. Stay on the current header set for same-origin
        // redirects; recompute from the originals for every off-origin hop so
        // credentials never go to an untrusted host.
        headers = isSameOrigin(resolvedHref, this.config.baseUrl)
          ? headers
          : this.headersForUrl(resolvedHref, init.headers)
        currentUrl = resolvedHref
      }

      throw new ProviderError({
        message: `Too many redirects: ${method} ${currentUrl}`,
        provider: this.config.provider,
      })
    } finally {
      cleanup()
    }
  }

  /**
   * Parse a JSON response body, tolerating empty bodies (204, no content) and
   * surfacing non-JSON bodies as a typed ProviderError instead of an
   * unhandled SyntaxError.
   */
  private async parseJsonBody<T>(
    response: Response,
    opts: Pick<RequestOptions, 'method' | 'path'>,
  ): Promise<T> {
    if (response.status === 204) return undefined as T
    const text = await response.text()
    if (!text) return undefined as T
    try {
      return JSON.parse(text) as T
    } catch {
      throw new ProviderError({
        message: `Provider returned a non-JSON response: ${opts.method} ${opts.path}`,
        provider: this.config.provider,
        statusCode: response.status,
        raw: text,
      })
    }
  }

  private buildUrl(path: string, query?: Record<string, string | number | boolean | undefined>): string {
    // If path is already a full URL (e.g., media download URLs), use as-is
    if (isAbsoluteUrl(path)) {
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

    throwForHttpError({
      status: response.status,
      method: opts.method,
      path: opts.path,
      provider: this.config.provider,
      raw: errorBody,
      retryAfterHeader: response.headers.get('Retry-After'),
    })
  }
}

/** GET/PUT/DELETE are idempotent and safe to retry after ambiguous failures. */
function isIdempotentMethod(method: RequestOptions['method']): boolean {
  return method === 'GET' || method === 'PUT' || method === 'DELETE'
}

const MAX_REDIRECT_HOPS = 5
const REDIRECT_STATUS = new Set([301, 302, 303, 307, 308])
