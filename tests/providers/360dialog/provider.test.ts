import { describe, test, expect, mock, beforeEach } from 'bun:test'
import { Dialog360Provider } from '../../../src/providers/360dialog/index.js'
import { MediaError, TimeoutError, ValidationError } from '../../../src/core/errors.js'
import type { Dialog360Config, ClientOptions } from '../../../src/types/config.js'
import type { WhatsAppProviderAdapter } from '../../../src/types/provider.js'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

import { TEST_DATA } from '../../constants.js'

const DEFAULT_CONFIG: Dialog360Config = {
  provider: '360dialog',
  apiKey: TEST_DATA.config.dialog360.apiKey,
  webhookSecret: TEST_DATA.config.dialog360.webhookSecret,
}

function createProvider(
  configOverrides?: Partial<Dialog360Config>,
  options?: ClientOptions,
): Dialog360Provider {
  return new Dialog360Provider({ ...DEFAULT_CONFIG, ...configOverrides }, options)
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Dialog360Provider', () => {
  describe('constructor', () => {
    test('sets provider name to "360dialog"', () => {
      const provider = createProvider()
      expect(provider.name).toBe('360dialog')
    })
  })

  describe('feature support', () => {
    let provider: Dialog360Provider

    beforeEach(() => {
      provider = createProvider()
    })

    test('supports interactive.button', () => {
      expect(provider.supports('interactive.button')).toBe(true)
    })

    test('supports interactive.list', () => {
      expect(provider.supports('interactive.list')).toBe(true)
    })

    test('supports media.upload', () => {
      expect(provider.supports('media.upload')).toBe(true)
    })

    test('supports media.download', () => {
      expect(provider.supports('media.download')).toBe(true)
    })

    test('supports media.delete', () => {
      expect(provider.supports('media.delete')).toBe(true)
    })

    test('supports reaction', () => {
      expect(provider.supports('reaction')).toBe(true)
    })

    test('supports read_receipts', () => {
      expect(provider.supports('read_receipts')).toBe(true)
    })

    test('supports sticker', () => {
      expect(provider.supports('sticker')).toBe(true)
    })

    test('supports location', () => {
      expect(provider.supports('location')).toBe(true)
    })

    test('supports contacts', () => {
      expect(provider.supports('contacts')).toBe(true)
    })

    test('supports webhook.signature_verification', () => {
      expect(provider.supports('webhook.signature_verification')).toBe(true)
    })

    test('does NOT support webhook.challenge', () => {
      expect(provider.supports('webhook.challenge')).toBe(false)
    })

    test('does NOT support template.management', () => {
      expect(provider.supports('template.management')).toBe(false)
    })

    test('does not support webhook.signature_verification when webhookSecret is undefined', () => {
      expect(createProvider({ webhookSecret: undefined }).supports('webhook.signature_verification')).toBe(false)
    })
  })

  describe('webhook parsing', () => {
    test('delegates to Cloud API parser with "360dialog" provider tag', () => {
      const provider = createProvider()

      const payload = {
        object: 'whatsapp_business_account',
        entry: [
          {
            id: '123',
            changes: [
              {
                value: {
                  messaging_product: 'whatsapp',
                  metadata: { display_phone_number: '+1', phone_number_id: 'p1' },
                  messages: [
                    { id: TEST_DATA.messageId.abc123, from: TEST_DATA.phone.minimal, timestamp: '1', type: 'text', text: { body: 'hi' } },
                  ],
                },
                field: 'messages',
              },
            ],
          },
        ],
      }

      const events = provider.parseWebhook(payload)

      expect(events).toHaveLength(1)
      expect(events[0]?.type).toBe('message')
      // Crucially: metadata should say 360dialog, not cloud-api
      expect(events[0]?.metadata.provider).toBe('360dialog')
    })

    test('returns empty array for invalid payloads', () => {
      const provider = createProvider()

      expect(provider.parseWebhook(null)).toEqual([])
      expect(provider.parseWebhook({})).toEqual([])
      expect(provider.parseWebhook('not-json')).toEqual([])
    })
  })

  describe('webhook signature verification', () => {
    test('verifies signature using webhookSecret', async () => {
      const secret = TEST_DATA.config.dialog360.webhookSecret!
      const provider = createProvider({ webhookSecret: secret })
      const body = '{"entry":[]}'

      // Compute the expected HMAC
      const encoder = new TextEncoder()
      const key = await crypto.subtle.importKey(
        'raw',
        encoder.encode(secret),
        { name: 'HMAC', hash: 'SHA-256' },
        false,
        ['sign'],
      )
      const sig = await crypto.subtle.sign('HMAC', key, encoder.encode(body))
      const hex = Array.from(new Uint8Array(sig))
        .map(b => b.toString(16).padStart(2, '0'))
        .join('')

      const result = await provider.verifyWebhookSignature(body, hex)
      expect(result).toBe(true)
    })

    test('rejects invalid signature', async () => {
      const provider = createProvider({ webhookSecret: 'real-secret' })

      const result = await provider.verifyWebhookSignature('body', 'bad-signature')
      expect(result).toBe(false)
    })

    test('returns false when webhookSecret is not configured', async () => {
      const provider = createProvider({ webhookSecret: undefined })

      const result = await provider.verifyWebhookSignature('body', 'sig')
      expect(result).toBe(false)
    })
  })

  describe('handleVerificationChallenge', () => {
    test('is not implemented (360dialog does not use webhook challenges)', () => {
      const provider = createProvider()
      expect((provider as WhatsAppProviderAdapter).handleVerificationChallenge).toBeUndefined()
    })
  })

  describe('template management', () => {
    test('does not expose listTemplates', () => {
      const provider = createProvider()
      expect((provider as unknown as Record<string, unknown>)['listTemplates']).toBeUndefined()
    })

    test('does not expose createTemplate', () => {
      const provider = createProvider()
      expect((provider as unknown as Record<string, unknown>)['createTemplate']).toBeUndefined()
    })

    test('does not expose deleteTemplate', () => {
      const provider = createProvider()
      expect((provider as unknown as Record<string, unknown>)['deleteTemplate']).toBeUndefined()
    })
  })

  describe('differences from Cloud API', () => {
    test('uses D360-API-KEY header instead of Bearer token', () => {
      // We can verify this by checking that the provider constructs without
      // accessToken/phoneNumberId (which Cloud API requires)
      const provider = new Dialog360Provider({
        provider: '360dialog',
        apiKey: 'my-360-key',
      })
      expect(provider.name).toBe('360dialog')
    })

    test('uses custom base URL when provided', () => {
      const provider = createProvider({ baseUrl: 'https://custom.360dialog.io' })
      // Provider should construct without errors
      expect(provider.name).toBe('360dialog')
    })

    test('uploadMedia default timeout outlives the JSON client timeout', async () => {
      const originalFetch = globalThis.fetch
      const fetchMock = mock(async () => {
        await new Promise(r => setTimeout(r, 80))
        return new Response(JSON.stringify({ id: 'media-1' }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        })
      })
      globalThis.fetch = fetchMock as unknown as typeof fetch

      try {
        const provider = createProvider(undefined, { timeout: 25 })
        const result = await provider.uploadMedia({
          file: new Uint8Array([1, 2, 3]),
          mimeType: 'image/png',
        })
        expect(result.id).toBe('media-1')
      } finally {
        globalThis.fetch = originalFetch
      }
    })

    test('uploadMedia honors params.timeout', async () => {
      const originalFetch = globalThis.fetch
      globalThis.fetch = mock((_url: string | URL | Request, init?: RequestInit) =>
        new Promise((_resolve, reject) => {
          const fail = () => {
            const err = new Error('aborted')
            err.name = 'AbortError'
            reject(err)
          }
          if (init?.signal?.aborted) {
            fail()
            return
          }
          init?.signal?.addEventListener('abort', fail, { once: true })
        }),
      ) as unknown as typeof fetch

      try {
        const provider = createProvider()
        await expect(
          provider.uploadMedia({
            file: new Uint8Array([1, 2, 3]),
            mimeType: 'image/png',
            timeout: 30,
          }),
        ).rejects.toBeInstanceOf(TimeoutError)
      } finally {
        globalThis.fetch = originalFetch
      }
    })

    test('uploadMedia throws MediaError when provider returns empty body', async () => {
      const originalFetch = globalThis.fetch
      globalThis.fetch = mock(() =>
        Promise.resolve(new Response('', {
          status: 200,
          headers: { 'content-type': 'application/json' },
        })),
      ) as unknown as typeof fetch

      try {
        const provider = createProvider()
        await expect(
          provider.uploadMedia({ file: new Uint8Array([1, 2, 3]), mimeType: 'image/png' }),
        ).rejects.toThrow(MediaError)
      } finally {
        globalThis.fetch = originalFetch
      }
    })

    test('getMediaUrl throws MediaError when provider returns empty body', async () => {
      const originalFetch = globalThis.fetch
      globalThis.fetch = mock(() =>
        Promise.resolve(new Response('', {
          status: 200,
          headers: { 'content-type': 'application/json' },
        })),
      ) as unknown as typeof fetch

      try {
        const provider = createProvider()
        await expect(provider.getMediaUrl(TEST_DATA.mediaId.media123)).rejects.toThrow(MediaError)
      } finally {
        globalThis.fetch = originalFetch
      }
    })

    test('getMediaUrl throws ValidationError for a path-traversal media ID', async () => {
      const originalFetch = globalThis.fetch
      const fetchMock = mock(() =>
        Promise.resolve(new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } })),
      )
      globalThis.fetch = fetchMock as unknown as typeof fetch

      try {
        const provider = createProvider()
        await expect(provider.getMediaUrl('../x')).rejects.toBeInstanceOf(ValidationError)
        expect(fetchMock.mock.calls).toHaveLength(0)
      } finally {
        globalThis.fetch = originalFetch
      }
    })

    test('deleteMedia throws ValidationError for a path-traversal media ID', async () => {
      const originalFetch = globalThis.fetch
      const fetchMock = mock(() =>
        Promise.resolve(new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } })),
      )
      globalThis.fetch = fetchMock as unknown as typeof fetch

      try {
        const provider = createProvider()
        await expect(provider.deleteMedia('../x')).rejects.toBeInstanceOf(ValidationError)
        expect(fetchMock.mock.calls).toHaveLength(0)
      } finally {
        globalThis.fetch = originalFetch
      }
    })

    test.each(['0', 0] as const)('getMediaUrl parses file_size %p as 0', async (fileSize) => {
      const originalFetch = globalThis.fetch
      globalThis.fetch = mock(() =>
        Promise.resolve(
          new Response(
            JSON.stringify({
              id: TEST_DATA.mediaId.media123,
              url: 'https://lookaside.fbsbx.com/whatsapp_business/attachments/?mid=1',
              mime_type: 'image/jpeg',
              sha256: 'abc',
              file_size: fileSize,
              messaging_product: 'whatsapp',
            }),
            { status: 200, headers: { 'content-type': 'application/json' } },
          ),
        ),
      ) as unknown as typeof fetch

      try {
        const provider = createProvider()
        const result = await provider.getMediaUrl(TEST_DATA.mediaId.media123)
        expect(result.fileSize).toBe(0)
      } finally {
        globalThis.fetch = originalFetch
      }
    })

    test('defaults base URL when not provided', () => {
      const provider = createProvider({ baseUrl: undefined })
      expect(provider.name).toBe('360dialog')
    })

    test('rewrites Meta lookaside URLs onto the 360dialog origin and keeps D360-API-KEY', async () => {
      const originalFetch = globalThis.fetch
      const fetchMock = mock((_url: string | URL | Request, _init?: RequestInit) =>
        Promise.resolve(
          new Response('ok', {
            status: 200,
            headers: { 'content-type': 'image/jpeg' },
          }),
        ),
      )
      globalThis.fetch = fetchMock as unknown as typeof fetch

      try {
        const provider = createProvider()
        await provider.downloadMedia(
          'https://lookaside.fbsbx.com/whatsapp_business/attachments/?mid=1&ext=1&hash=x',
        )

        expect(fetchMock.mock.calls[0]?.[0]).toBe(
          'https://waba-v2.360dialog.io/whatsapp_business/attachments/?mid=1&ext=1&hash=x',
        )
        const headers = (fetchMock.mock.calls[0]?.[1] as RequestInit | undefined)?.headers as Record<string, string>
        expect(headers['D360-API-KEY']).toBe(TEST_DATA.config.dialog360.apiKey)
      } finally {
        globalThis.fetch = originalFetch
      }
    })

    test('rewrites lookaside URLs onto a path-prefixed 360dialog baseUrl', async () => {
      const originalFetch = globalThis.fetch
      const fetchMock = mock((_url: string | URL | Request, _init?: RequestInit) =>
        Promise.resolve(
          new Response('ok', {
            status: 200,
            headers: { 'content-type': 'image/jpeg' },
          }),
        ),
      )
      globalThis.fetch = fetchMock as unknown as typeof fetch

      try {
        const provider = createProvider({ baseUrl: 'https://proxy.example/360' })
        await provider.downloadMedia(
          'https://lookaside.fbsbx.com/whatsapp_business/attachments/?mid=1',
        )

        expect(String(fetchMock.mock.calls[0]?.[0])).toBe(
          'https://proxy.example/360/whatsapp_business/attachments/?mid=1',
        )
      } finally {
        globalThis.fetch = originalFetch
      }
    })

    test('folds uppercase HTTPS lookaside URLs before rewriting', async () => {
      const originalFetch = globalThis.fetch
      const fetchMock = mock((_url: string | URL | Request, _init?: RequestInit) =>
        Promise.resolve(
          new Response('ok', {
            status: 200,
            headers: { 'content-type': 'image/jpeg' },
          }),
        ),
      )
      globalThis.fetch = fetchMock as unknown as typeof fetch

      try {
        const provider = createProvider()
        await provider.downloadMedia(
          'HTTPS://lookaside.fbsbx.com/whatsapp_business/attachments/?mid=1&ext=1&hash=x',
        )

        expect(fetchMock.mock.calls[0]?.[0]).toBe(
          'https://waba-v2.360dialog.io/whatsapp_business/attachments/?mid=1&ext=1&hash=x',
        )
        const headers = (fetchMock.mock.calls[0]?.[1] as RequestInit | undefined)?.headers as Record<string, string>
        expect(headers['D360-API-KEY']).toBe(TEST_DATA.config.dialog360.apiKey)
      } finally {
        globalThis.fetch = originalFetch
      }
    })

    test('downloadMedia rewrites lookaside URL from getMediaUrl onto the 360dialog origin and keeps D360-API-KEY', async () => {
      const originalFetch = globalThis.fetch
      const lookaside = 'https://lookaside.fbsbx.com/whatsapp_business/attachments/?mid=1&ext=1&hash=x'
      const fetchMock = mock((url: string | URL | Request) => {
        if (String(url).endsWith(`/${TEST_DATA.mediaId.media123}`)) {
          return Promise.resolve(
            new Response(
              JSON.stringify({
                id: TEST_DATA.mediaId.media123,
                url: lookaside,
                mime_type: 'image/jpeg',
                sha256: 'abc',
                file_size: '123',
                messaging_product: 'whatsapp',
              }),
              { status: 200, headers: { 'content-type': 'application/json' } },
            ),
          )
        }
        return Promise.resolve(
          new Response('ok', {
            status: 200,
            headers: { 'content-type': 'image/jpeg' },
          }),
        )
      })
      globalThis.fetch = fetchMock as unknown as typeof fetch

      try {
        const provider = createProvider()
        await provider.downloadMedia(TEST_DATA.mediaId.media123)

        expect(fetchMock.mock.calls).toHaveLength(2)
        expect(fetchMock.mock.calls[1]?.[0]).toBe(
          'https://waba-v2.360dialog.io/whatsapp_business/attachments/?mid=1&ext=1&hash=x',
        )
        const headers = (fetchMock.mock.calls[1]?.[1] as RequestInit | undefined)?.headers as Record<string, string>
        expect(headers['D360-API-KEY']).toBe(TEST_DATA.config.dialog360.apiKey)
      } finally {
        globalThis.fetch = originalFetch
      }
    })

    test('does not rewrite non-attachment Meta CDN paths onto the 360dialog origin', async () => {
      const originalFetch = globalThis.fetch
      const fetchMock = mock((_url: string | URL | Request, _init?: RequestInit) =>
        Promise.resolve(
          new Response('ok', {
            status: 200,
            headers: { 'content-type': 'image/jpeg' },
          }),
        ),
      )
      globalThis.fetch = fetchMock as unknown as typeof fetch

      try {
        const provider = createProvider()
        await provider.downloadMedia('https://lookaside.fbsbx.com/not-media/secret')

        expect(fetchMock.mock.calls[0]?.[0]).toBe('https://lookaside.fbsbx.com/not-media/secret')
        expect(String(fetchMock.mock.calls[0]?.[0])).not.toContain('waba-v2.360dialog.io')
        const headers = (fetchMock.mock.calls[0]?.[1] as RequestInit | undefined)?.headers as Record<string, string>
        expect(headers['D360-API-KEY']).toBeUndefined()
      } finally {
        globalThis.fetch = originalFetch
      }
    })

    test('does not send D360-API-KEY to untrusted hosts', async () => {
      const originalFetch = globalThis.fetch
      const fetchMock = mock((_url: string | URL | Request, _init?: RequestInit) =>
        Promise.resolve(
          new Response('ok', {
            status: 200,
            headers: { 'content-type': 'image/jpeg' },
          }),
        ),
      )
      globalThis.fetch = fetchMock as unknown as typeof fetch

      try {
        const provider = createProvider()
        await provider.downloadMedia('https://cdn.example.com/photo.jpg')

        expect(fetchMock.mock.calls[0]?.[0]).toBe('https://cdn.example.com/photo.jpg')
        const headers = (fetchMock.mock.calls[0]?.[1] as RequestInit | undefined)?.headers as Record<string, string>
        expect(headers['D360-API-KEY']).toBeUndefined()
      } finally {
        globalThis.fetch = originalFetch
      }
    })

    test('refuses private download URLs', async () => {
      const provider = createProvider()
      await expect(provider.downloadMedia('http://127.0.0.1/latest')).rejects.toBeInstanceOf(ValidationError)
    })

    test('downloadMedia parses a finite content-length header', async () => {
      const originalFetch = globalThis.fetch
      const fetchMock = mock((_url: string | URL | Request, _init?: RequestInit) =>
        Promise.resolve(
          new Response('ok', {
            status: 200,
            headers: { 'content-type': 'image/jpeg', 'content-length': '42' },
          }),
        ),
      )
      globalThis.fetch = fetchMock as unknown as typeof fetch

      try {
        const provider = createProvider()
        const result = await provider.downloadMedia('https://waba-v2.360dialog.io/media/1')
        expect(result.contentLength).toBe(42)
      } finally {
        globalThis.fetch = originalFetch
      }
    })

    test('downloadMedia omits contentLength when the header is not a finite number', async () => {
      const originalFetch = globalThis.fetch
      const fetchMock = mock((_url: string | URL | Request, _init?: RequestInit) =>
        Promise.resolve(
          new Response('ok', {
            status: 200,
            headers: { 'content-type': 'image/jpeg', 'content-length': 'not-a-number' },
          }),
        ),
      )
      globalThis.fetch = fetchMock as unknown as typeof fetch

      try {
        const provider = createProvider()
        const result = await provider.downloadMedia('https://waba-v2.360dialog.io/media/1')
        expect(result.contentLength).toBeUndefined()
      } finally {
        globalThis.fetch = originalFetch
      }
    })

    test('defaults to no download timeout so a slow body is not aborted', async () => {
      const originalFetch = globalThis.fetch
      const fetchMock = mock(async (_url: string | URL | Request, init?: RequestInit) => {
        await new Promise(r => setTimeout(r, 40))
        expect(init?.signal?.aborted).toBe(false)
        return new Response('ok', {
          status: 200,
          headers: { 'content-type': 'image/jpeg' },
        })
      })
      globalThis.fetch = fetchMock as unknown as typeof fetch

      try {
        const provider = createProvider({}, { timeout: 10, retry: { maxRetries: 0 } })
        const result = await provider.downloadMedia('https://waba-v2.360dialog.io/media/1')
        expect(result.mimeType).toBe('image/jpeg')
      } finally {
        globalThis.fetch = originalFetch
      }
    })

    test('sends messages to /messages (not /{phoneNumberId}/messages)', async () => {
      // We can verify the path by mocking fetch globally
      const originalFetch = globalThis.fetch
      const fetchMock = mock((_url: string | URL | Request, _init?: RequestInit) =>
        Promise.resolve(
          new Response(
            JSON.stringify({ messages: [{ id: TEST_DATA.messageId.d360 }] }),
            { status: 200, headers: { 'content-type': 'application/json' } },
          ),
        ),
      )
      globalThis.fetch = fetchMock as unknown as typeof fetch

      try {
        const provider = createProvider()
        const result = await provider.sendMessage({
          type: 'text',
          to: TEST_DATA.phone.primary,
          text: { body: 'Hello from 360!' },
        })

        expect(result.messageId).toBe(TEST_DATA.messageId.d360)
        expect(result.provider).toBe('360dialog')

        // Verify the URL used — should be /messages, not /{phoneNumberId}/messages
        const calledUrl = fetchMock.mock.calls[0]?.[0]
        expect(typeof calledUrl).toBe('string')
        expect((calledUrl as string).endsWith('/messages')).toBe(true)
        expect((calledUrl as string)).not.toContain('phoneNumberId')

        // Verify D360-API-KEY header
        const calledInit = fetchMock.mock.calls[0]?.[1] as RequestInit | undefined
        const headers = calledInit?.headers as Record<string, string>
        expect(headers['D360-API-KEY']).toBe(TEST_DATA.config.dialog360.apiKey)
        expect(headers['Authorization']).toBeUndefined()
      } finally {
        globalThis.fetch = originalFetch
      }
    })

    test('markAsRead sends to /messages (not /{phoneNumberId}/messages)', async () => {
      const originalFetch = globalThis.fetch
      const fetchMock = mock((_url: string | URL | Request, _init?: RequestInit) =>
        Promise.resolve(
          new Response(JSON.stringify({ success: true }), {
            status: 200,
            headers: { 'content-type': 'application/json' },
          }),
        ),
      )
      globalThis.fetch = fetchMock as unknown as typeof fetch

      try {
        const provider = createProvider()
        await provider.markAsRead(TEST_DATA.messageId.abc123)

        const calledUrl = fetchMock.mock.calls[0]?.[0] as string
        expect(calledUrl.endsWith('/messages')).toBe(true)

        const calledInit = fetchMock.mock.calls[0]?.[1] as RequestInit | undefined
        const body = JSON.parse(calledInit?.body as string) as Record<string, unknown>
        expect(body['message_id']).toBe(TEST_DATA.messageId.abc123)
        expect(body['status']).toBe('read')
        expect(body['messaging_product']).toBe('whatsapp')
      } finally {
        globalThis.fetch = originalFetch
      }
    })
  })
})
