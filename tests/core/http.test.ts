import { describe, test, expect, mock } from 'bun:test'
import { HttpClient } from '../../src/core/http.js'
import { RateLimiter } from '../../src/core/rate-limiter.js'
import { noopLogger } from '../../src/core/logger.js'
import { NetworkError, ProviderError, TimeoutError, ValidationError } from '../../src/core/errors.js'
import type { HttpClientConfig } from '../../src/core/http.js'
import type { Logger } from '../../src/core/logger.js'

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
  test('user abort during fetch throws non-retryable NetworkError without requiring DOMException', async () => {
    const client = makeClient()
    const ac = new AbortController()

    await withFetch(
      async () => {
        ac.abort()
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

  test('already-aborted signal does not call fetch', async () => {
    const client = makeClient()
    const ac = new AbortController()
    ac.abort()

    await withFetch(
      async () => new Response('{}', { status: 200 }),
      async (fetchMock) => {
        try {
          await client.request({ method: 'GET', path: '/me', signal: ac.signal })
          throw new Error('expected throw')
        } catch (error) {
          expect(error).toBeInstanceOf(NetworkError)
          expect((error as NetworkError).retryable).toBe(false)
          expect((error as NetworkError).message).toBe('Request aborted')
        }
        expect(fetchMock).not.toHaveBeenCalled()
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

  test('client-level abort during fetch throws non-retryable NetworkError', async () => {
    const ac = new AbortController()
    const client = makeClient({ signal: ac.signal })

    await withFetch(
      async () => {
        ac.abort()
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

  test('localhost baseUrl GET /messages is allowed', async () => {
    const client = makeClient({ baseUrl: 'http://127.0.0.1:4010' })
    await withFetch(
      async (url, init) => {
        expect(String(url)).toBe('http://127.0.0.1:4010/messages')
        expect(init?.redirect).toBe('manual')
        return new Response('{}', { status: 200 })
      },
      async (fetchMock) => {
        const res = await client.request({ method: 'GET', path: '/messages' })
        expect(res.status).toBe(200)
        expect(fetchMock).toHaveBeenCalled()
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

  test('abort while queued in the rate limiter rejects without hanging', async () => {
    const limiter = new RateLimiter({ maxRequestsPerSecond: 1, queueTimeoutMs: 5_000 })
    await limiter.acquire()
    const ac = new AbortController()
    const client = makeClient({ rateLimiter: limiter })
    const start = Date.now()

    await withFetch(
      async () => new Response('{}', { status: 200 }),
      async (fetchMock) => {
        const pending = client.request({ method: 'GET', path: '/me', signal: ac.signal })
        setTimeout(() => ac.abort(), 15)
        try {
          await pending
          throw new Error('expected throw')
        } catch (error) {
          expect(error).toBeInstanceOf(NetworkError)
          expect((error as NetworkError).message).toBe('Request aborted')
          expect((error as NetworkError).retryable).toBe(false)
        }
        expect(fetchMock).not.toHaveBeenCalled()
        expect(Date.now() - start).toBeLessThan(200)
      },
    )

    limiter.destroy()
  })
})

describe('HttpClient redirects', () => {
  test('redirect 302 to private URL is refused before fetch', async () => {
    const client = makeClient()
    await withFetch(
      async () =>
        new Response(null, {
          status: 302,
          headers: { Location: 'http://127.0.0.1/steal' },
        }),
      async (fetchMock) => {
        await expect(client.request({ method: 'GET', path: '/me' })).rejects.toBeInstanceOf(
          ValidationError,
        )
        expect(fetchMock).toHaveBeenCalledTimes(1)
        expect(String(fetchMock.mock.calls[0]?.[0])).not.toContain('127.0.0.1')
      },
    )
  })

  test.each([301, 302, 303] as const)(
    'POST %d redirect continues as GET with no body',
    async (status) => {
      const client = makeClient()
      const calls: Array<{ method?: string; body?: unknown }> = []
      await withFetch(
        async (_url, init) => {
          calls.push({ method: init?.method, body: init?.body })
          if (calls.length === 1) {
            return new Response(null, {
              status,
              headers: { Location: 'https://graph.facebook.com/v25.0/me' },
            })
          }
          return new Response('{}', { status: 200 })
        },
        async () => {
          await client.request({ method: 'POST', path: '/messages', body: { hello: 'world' } })
        },
      )
      expect(calls[0]?.method).toBe('POST')
      expect(calls[0]?.body).toBeTruthy()
      expect(calls[1]?.method).toBe('GET')
      expect(calls[1]?.body).toBeUndefined()
    },
  )

  test('307 POST redirect preserves method and body', async () => {
    const client = makeClient()
    const calls: Array<{ method?: string; body?: unknown }> = []
    await withFetch(
      async (_url, init) => {
        calls.push({ method: init?.method, body: init?.body })
        if (calls.length === 1) {
          return new Response(null, {
            status: 307,
            headers: { Location: 'https://graph.facebook.com/v25.0/me' },
          })
        }
        return new Response('{}', { status: 200 })
      },
      async () => {
        await client.request({ method: 'POST', path: '/messages', body: { hello: 'world' } })
      },
    )
    expect(calls[0]?.method).toBe('POST')
    expect(calls[1]?.method).toBe('POST')
    expect(calls[1]?.body).toBe(calls[0]?.body)
  })

  test('same-origin redirect keeps Authorization', async () => {
    const client = makeClient()
    await withFetch(
      async (url, init) => {
        const headers = init?.headers as Record<string, string>
        expect(headers.Authorization).toBe('Bearer tok')
        if (String(url).endsWith('/me')) {
          return new Response(null, {
            status: 302,
            headers: { Location: '/v25.0/other' },
          })
        }
        return new Response('{}', { status: 200 })
      },
      async () => {
        await client.request({ method: 'GET', path: '/me' })
      },
    )
  })

  test('redirect to untrusted host strips Authorization', async () => {
    const client = makeClient()
    await withFetch(
      async (url, init) => {
        const headers = init?.headers as Record<string, string>
        if (String(url).includes('evil.example')) {
          expect(headers.Authorization).toBeUndefined()
          return new Response('ok', { status: 200 })
        }
        expect(headers.Authorization).toBe('Bearer tok')
        return new Response(null, {
          status: 302,
          headers: { Location: 'https://evil.example/steal' },
        })
      },
      async () => {
        await client.rawRequest({ method: 'GET', path: '/me' })
      },
    )
  })

  test('redirect without Location throws ProviderError', async () => {
    const client = makeClient()
    await withFetch(
      async () => new Response(null, { status: 302 }),
      async () => {
        await expect(client.request({ method: 'GET', path: '/me' })).rejects.toBeInstanceOf(
          ProviderError,
        )
      },
    )
  })

  test('redirect with invalid Location throws ProviderError', async () => {
    const client = makeClient()
    await withFetch(
      async () =>
        new Response(null, {
          status: 302,
          headers: { Location: 'http://[' },
        }),
      async () => {
        await expect(client.request({ method: 'GET', path: '/me' })).rejects.toBeInstanceOf(
          ProviderError,
        )
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
      provider: '360dialog',
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

  test('360dialog keeps D360-API-KEY for same-origin waba URLs', async () => {
    const client = makeClient({
      baseUrl: 'https://waba-v2.360dialog.io',
      provider: '360dialog',
      defaultHeaders: { 'D360-API-KEY': 'secret-key' },
    })
    await withFetch(
      async (url, init) => {
        expect(String(url)).toBe(
          'https://waba-v2.360dialog.io/whatsapp_business/attachments/?mid=1&ext=1&hash=x',
        )
        const headers = init?.headers as Record<string, string>
        expect(headers['D360-API-KEY']).toBe('secret-key')
        expect(init?.redirect).toBe('manual')
        return new Response('ok', { status: 200 })
      },
      async () => {
        const res = await client.rawRequest({
          method: 'GET',
          path: 'https://waba-v2.360dialog.io/whatsapp_business/attachments/?mid=1&ext=1&hash=x',
        })
        expect(res.status).toBe(200)
      },
    )
  })

  test('360dialog https → http redirect strips D360-API-KEY', async () => {
    const client = makeClient({
      baseUrl: 'https://waba-v2.360dialog.io',
      provider: '360dialog',
      defaultHeaders: { 'D360-API-KEY': 'secret-key' },
    })
    const keys: Array<string | undefined> = []
    await withFetch(
      async (url, init) => {
        const headers = init?.headers as Record<string, string>
        keys.push(headers['D360-API-KEY'])
        if (String(url).startsWith('https://')) {
          return new Response(null, {
            status: 302,
            headers: {
              Location: 'http://waba-v2.360dialog.io/whatsapp_business/attachments/?mid=1',
            },
          })
        }
        return new Response('ok', { status: 200, headers: { 'content-type': 'image/jpeg' } })
      },
      async () => {
        await client.rawRequest({
          method: 'GET',
          path: 'https://waba-v2.360dialog.io/whatsapp_business/attachments/?mid=1',
        })
      },
    )
    expect(keys[0]).toBe('secret-key')
    expect(keys[1]).toBeUndefined()
  })

  test('client-level abort still fires when a per-request signal is also passed', async () => {
    const clientAbort = new AbortController()
    const requestAbort = new AbortController()
    const client = makeClient({ signal: clientAbort.signal, retry: { maxRetries: 0 } })

    await withFetch(
      async (_url, init) => {
        const fetchSignal = init?.signal
        await new Promise<void>((_resolve, reject) => {
          const fail = () => {
            const err = new Error('This operation was aborted')
            err.name = 'AbortError'
            reject(err)
          }
          if (fetchSignal?.aborted) {
            fail()
            return
          }
          fetchSignal?.addEventListener('abort', fail, { once: true })
        })
        return new Response('{}', { status: 200 })
      },
      async () => {
        const pending = client.request({ method: 'GET', path: '/me', signal: requestAbort.signal })
        clientAbort.abort()
        try {
          await pending
          throw new Error('expected throw')
        } catch (error) {
          expect(error).toBeInstanceOf(NetworkError)
          expect((error as NetworkError).retryable).toBe(false)
        }
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
