import { describe, test, expect, mock } from 'bun:test'
import { HttpClient } from '../../src/core/http.js'
import { RateLimiter } from '../../src/core/rate-limiter.js'
import { noopLogger } from '../../src/core/logger.js'
import { NetworkError, TimeoutError, ValidationError } from '../../src/core/errors.js'
import type { HttpClientConfig } from '../../src/core/http.js'
import type { Logger } from '../../src/core/logger.js'
import type { ProviderName } from '../../src/types/common.js'

function makeClient(overrides: Partial<HttpClientConfig> = {}): HttpClient {
  return new HttpClient({
    baseUrl: 'https://graph.facebook.com/v25.0',
    defaultHeaders: { Authorization: 'Bearer tok' },
    timeout: 30_000,
    provider: 'cloud-api',
    logger: noopLogger,
    rateLimiter: new RateLimiter({ maxRequestsPerSecond: 80 }),
    retry: { maxRetries: 0 },
    ...overrides,
  })
}

async function withFetch<T>(
  impl: (url: string | URL | Request, init?: RequestInit) => Promise<Response>,
  fn: (fetchMock: ReturnType<typeof mock>) => Promise<T>,
): Promise<T> {
  const original = globalThis.fetch
  const fetchMock = mock(impl)
  globalThis.fetch = fetchMock as unknown as typeof fetch
  try {
    return await fn(fetchMock)
  } finally {
    globalThis.fetch = original
  }
}

describe('HttpClient doFetch', () => {
  test('user abort throws non-retryable NetworkError without requiring DOMException', async () => {
    const client = makeClient()
    const ac = new AbortController()
    ac.abort()

    await withFetch(
      async () => {
        const err = new Error('This operation was aborted')
        err.name = 'AbortError'
        throw err
      },
      async () => {
        try {
          await client.request({ method: 'GET', path: '/me', signal: ac.signal })
          throw new Error('expected throw')
        } catch (error) {
          expect(error).toBeInstanceOf(NetworkError)
          expect((error as NetworkError).retryable).toBe(false)
          expect((error as NetworkError).message).toMatch(/^Request aborted: GET /)
        }
      },
    )
  })

  test('timeout-named errors become TimeoutError', async () => {
    const client = makeClient()
    await withFetch(
      async () => {
        const err = new Error('The operation timed out')
        err.name = 'TimeoutError'
        throw err
      },
      async () => {
        await expect(client.request({ method: 'GET', path: '/me' })).rejects.toBeInstanceOf(
          TimeoutError,
        )
      },
    )
  })

  test('AbortError without a user signal is a TimeoutError', async () => {
    const client = makeClient()
    await withFetch(
      async () => {
        const err = new Error('aborted')
        err.name = 'AbortError'
        throw err
      },
      async () => {
        await expect(client.request({ method: 'GET', path: '/me' })).rejects.toBeInstanceOf(
          TimeoutError,
        )
      },
    )
  })

  test('timeout 0 does not abort the request', async () => {
    const client = makeClient({ timeout: 0 })
    await withFetch(
      async (_url, init) => {
        expect(init?.signal?.aborted).toBe(false)
        await new Promise(r => setTimeout(r, 20))
        expect(init?.signal?.aborted).toBe(false)
        return new Response('{}', { status: 200 })
      },
      async () => {
        const res = await client.request({ method: 'GET', path: '/me', timeout: 0 })
        expect(res.status).toBe(200)
      },
    )
  })

  test('client-level abort throws non-retryable NetworkError', async () => {
    const ac = new AbortController()
    ac.abort()
    const client = makeClient({ signal: ac.signal })

    await withFetch(
      async () => {
        const err = new Error('This operation was aborted')
        err.name = 'AbortError'
        throw err
      },
      async () => {
        try {
          await client.request({ method: 'GET', path: '/me' })
          throw new Error('expected throw')
        } catch (error) {
          expect(error).toBeInstanceOf(NetworkError)
          expect((error as NetworkError).retryable).toBe(false)
        }
      },
    )
  })

  test('refuses private absolute URLs before fetch', async () => {
    const client = makeClient()
    await withFetch(
      async () => new Response('ok', { status: 200 }),
      async (fetchMock) => {
        await expect(
          client.rawRequest({ method: 'GET', path: 'http://127.0.0.1/latest' }),
        ).rejects.toBeInstanceOf(ValidationError)
        expect(fetchMock).not.toHaveBeenCalled()
      },
    )
  })
})

describe('HttpClient headersForUrl', () => {
  test('keeps Authorization for relative API paths', async () => {
    const client = makeClient()
    await withFetch(
      async (_url, init) => {
        const headers = init?.headers as Record<string, string>
        expect(headers.Authorization).toBe('Bearer tok')
        return new Response('{}', { status: 200 })
      },
      async () => {
        await client.request({ method: 'GET', path: '/me' })
      },
    )
  })

  test('keeps Authorization for Meta CDNs on cloud-api', async () => {
    const client = makeClient()
    await withFetch(
      async (_url, init) => {
        const headers = init?.headers as Record<string, string>
        expect(headers.Authorization).toBe('Bearer tok')
        return new Response('ok', { status: 200 })
      },
      async () => {
        await client.rawRequest({
          method: 'GET',
          path: 'https://lookaside.fbsbx.com/whatsapp_business/attachments/?mid=1',
        })
      },
    )
  })

  test('strips Authorization for untrusted hosts', async () => {
    const client = makeClient()
    await withFetch(
      async (_url, init) => {
        const headers = init?.headers as Record<string, string>
        expect(headers.Authorization).toBeUndefined()
        return new Response('ok', { status: 200 })
      },
      async () => {
        await client.rawRequest({ method: 'GET', path: 'https://evil.example/steal' })
      },
    )
  })

  test('360dialog does not send D360-API-KEY to Meta CDNs', async () => {
    const client = makeClient({
      baseUrl: 'https://waba-v2.360dialog.io',
      provider: '360dialog' as ProviderName,
      defaultHeaders: { 'D360-API-KEY': 'secret-key' },
    })
    await withFetch(
      async (_url, init) => {
        const headers = init?.headers as Record<string, string>
        expect(headers['D360-API-KEY']).toBeUndefined()
        return new Response('ok', { status: 200 })
      },
      async () => {
        await client.rawRequest({
          method: 'GET',
          path: 'https://lookaside.fbsbx.com/whatsapp_business/attachments/?mid=1',
        })
      },
    )
  })
})

describe('HttpClient logger isolation', () => {
  test('logger throws do not fail the request', async () => {
    const logger: Logger = {
      debug() { throw new Error('debug') },
      info() { throw new Error('info') },
      warn() { throw new Error('warn') },
      error() { throw new Error('error') },
    }
    const client = makeClient({
      logger,
      hooks: {
        onRequest() { throw new Error('onRequest') },
        onResponse() { throw new Error('onResponse') },
      },
    })
    await withFetch(
      async () => new Response('{}', { status: 200 }),
      async () => {
        const res = await client.request({ method: 'GET', path: '/me' })
        expect(res.status).toBe(200)
      },
    )
  })
})
