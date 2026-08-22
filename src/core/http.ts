// ---------------------------------------------------------------------------
// HTTP client wrapper — fetch-based, with retry + rate limiting
// ---------------------------------------------------------------------------

import type { ClientHooks } from '../types/config.js'
import type { ProviderName } from '../types/common.js'
import type { Logger } from './logger.js'
import type { RateLimiter } from './rate-limiter.js'
import type { RetryConfig } from '../types/config.js'
import { NetworkError, ProviderError, TimeoutError, WhatsAppError } from './errors.js'
import { throwForHttpError } from './http-error.js'
import { resolveRetryConfig, withRetry } from './retry.js'
import { assertSafeFetchUrl, bindAbortSignals, isAbsoluteUrl, isSameOrigin, isTrustedMediaHost, makeRequestSignal } from './url-guard.js'

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

/** Origin + pathname only so debug logs never include query/hash tokens. */
function redactUrlForLog(url: string): string {
  try {
    const parsed = new URL(url)
    return `${parsed.origin}${parsed.pathname}`
  } catch {
    const q = url.indexOf('?')
    return q === -1 ? url : url.slice(0, q)
  }
}

function abortReasonName(error: unknown, signal?: AbortSignal): string {
  if (error instanceof Error && error.cause instanceof Error) return error.cause.name
  const reason = signal?.reason
  return reason instanceof Error ? reason.name : ''
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
    const { signal, cleanup } = bindAbortSignals([opts.signal, this.config.signal])
    try {
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

        this.log('debug', `${opts.method} ${redactUrlForLog(url)}`)

        const { response, cleanup: releaseTimeout } = await this.doFetch(url, {
          method: opts.method,
          headers,
          headerUrl: opts.path,
          body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
          timeout,
          signal,
        })

        try {
          const durationMs = Date.now() - startTime

          this.safeHook('onResponse', { url, status: response.status, durationMs })

          if (!response.ok) {
            await this.handleErrorResponse(response, opts)
          }

          const data = await this.parseJsonBody<T>(response, opts)

          this.log('debug', `${opts.method} ${redactUrlForLog(url)} → ${response.status} (${durationMs}ms)`)

          return {
            status: response.status,
            data,
            headers: response.headers,
          }
        } catch (error) {
          return this.classifyFetchFailure(error, {
            method: opts.method,
            url,
            timeout,
            userSignal: signal,
          })
        } finally {
          releaseTimeout()
        }
      }

      return await this.run(execute, opts.method, opts.skipRetry, opts.idempotent, signal)
    } finally {
      cleanup()
    }
  }

  /**
   * Make a raw fetch request (for media downloads that return streams).
   * Returns the raw Response so the caller can access .body as a stream.
   * Supports retry for transient failures.
   *
   * The request timeout applies until headers arrive (TTFB). It is then
   * released so a streaming download body is not aborted.
   */
  async rawRequest(opts: RequestOptions): Promise<Response> {
    const { signal, cleanup } = bindAbortSignals([opts.signal, this.config.signal])
    // On success the body stream outlives this stack frame. Dropping polyfill
    // abort listeners here would detach ClientOptions.signal / per-call abort
    // from the download on Node 18 (no AbortSignal.any).
    let detachAbort = cleanup
    try {
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

        const { response, cleanup: releaseTimeout } = await this.doFetch(url, {
          method: opts.method,
          headers,
          headerUrl: opts.path,
          body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
          timeout,
          signal,
        })

        try {
          this.safeHook('onResponse', {
            url,
            status: response.status,
            durationMs: Date.now() - startTime,
          })

          if (!response.ok) {
            try {
              await this.handleErrorResponse(response, opts)
            } catch (error) {
              this.classifyFetchFailure(error, {
                method: opts.method,
                url,
                timeout,
                userSignal: signal,
              })
            }
          }

          detachAbort = () => {}
          return response
        } catch (error) {
          return this.classifyFetchFailure(error, {
            method: opts.method,
            url,
            timeout,
            userSignal: signal,
          })
        } finally {
          // Error-body reads stay under the TTFB timeout; 2xx streams do not.
          releaseTimeout()
        }
      }

      return await this.run(execute, opts.method, opts.skipRetry, opts.idempotent, signal)
    } finally {
      detachAbort()
    }
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
    const { signal, cleanup } = bindAbortSignals([options?.signal, this.config.signal])
    try {
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

        const { response, cleanup: releaseTimeout } = await this.doFetch(url, {
          method: 'POST',
          headers,
          headerUrl: path,
          body: formData,
          timeout,
          signal,
        })

        try {
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
        } catch (error) {
          return this.classifyFetchFailure(error, {
            method: 'POST',
            url,
            timeout,
            userSignal: signal,
          })
        } finally {
          releaseTimeout()
        }
      }

      return await this.run(execute, 'POST', options?.skipRetry, false, signal)
    } finally {
      cleanup()
    }
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

  /**
   * Perform a single fetch, translating low-level failures to typed errors.
   * Returns a cleanup that clears the timeout timer. JSON callers must invoke
   * it after reading the body; raw/stream callers should invoke it as soon as
   * headers arrive so download bodies are not killed (TTFB-only timeout).
   */
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
  ): Promise<{ response: Response; cleanup: () => void }> {
    this.assertUrlAllowed(url)

    const { signal, cleanup } = makeRequestSignal(init.timeout, init.signal)
    let currentUrl = url
    let method = init.method
    let body = init.body
    let headers = this.headersForUrl(init.headerUrl, init.headers)

    try {
      for (let hop = 0; ; hop++) {
        const response = await fetch(currentUrl, {
          method,
          headers,
          body,
          signal,
          redirect: 'manual',
        })

        if (!REDIRECT_STATUS.has(response.status)) {
          return { response, cleanup }
        }

        void response.body?.cancel()

        if (hop >= MAX_REDIRECT_HOPS) {
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
    } catch (error) {
      cleanup()
      return this.classifyFetchFailure(error, {
        method,
        url: currentUrl,
        timeout: init.timeout,
        userSignal: init.signal,
        fetchSignal: signal,
      })
    }
  }

  /**
   * Classify a fetch/body abort. User/client abort is a non-retryable
   * NetworkError. A timeout-named failure is TimeoutError only when a
   * timeout was actually configured.
   */
  private classifyFetchFailure(
    error: unknown,
    ctx: {
      method: string
      url: string
      timeout: number
      userSignal?: AbortSignal
      fetchSignal?: AbortSignal
    },
  ): never {
    if (error instanceof WhatsAppError) throw error

    if (ctx.userSignal?.aborted || this.config.signal?.aborted) {
      throw new NetworkError({
        message: `Request aborted: ${ctx.method} ${ctx.url}`,
        provider: this.config.provider,
        retryable: false,
      })
    }

    const errorName = error instanceof Error ? error.name : ''
    const reasonName = abortReasonName(error, ctx.fetchSignal)
    const timedOut = errorName === 'TimeoutError' || reasonName === 'TimeoutError' || errorName === 'AbortError'

    if (ctx.timeout > 0 && timedOut) {
      throw new TimeoutError({
        message: `Request timed out after ${ctx.timeout}ms: ${ctx.method} ${ctx.url}`,
        provider: this.config.provider,
      })
    }

    if (timedOut) {
      throw new NetworkError({
        message: `Request aborted: ${ctx.method} ${ctx.url}`,
        provider: this.config.provider,
        retryable: false,
      })
    }

    throw new NetworkError({
      message: `Network error: ${error instanceof Error ? error.message : String(error)}`,
      provider: this.config.provider,
      cause: error,
    })
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
    } catch (error) {
      const name = error instanceof Error ? error.name : ''
      if (name === 'AbortError' || name === 'TimeoutError') throw error
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
