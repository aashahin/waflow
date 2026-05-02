import { describe, test, expect, mock, beforeEach } from 'bun:test'
import { WatiProvider } from '../../../src/providers/wati/index.js'
import { ProviderError } from '../../../src/core/errors.js'
import type { WatiConfig, ClientOptions } from '../../../src/types/config.js'
import type { WhatsAppProviderAdapter } from '../../../src/types/provider.js'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

import { TEST_DATA } from '../../constants.js'

const DEFAULT_CONFIG: WatiConfig = {
  provider: 'wati',
  apiKey: TEST_DATA.config.wati.apiKey,
  baseUrl: TEST_DATA.config.wati.baseUrl,
  channelNumber: TEST_DATA.config.wati.channelNumber,
  webhookSecret: TEST_DATA.config.wati.webhookSecret,
}

function createProvider(
  configOverrides?: Partial<WatiConfig>,
  options?: ClientOptions,
): WatiProvider {
  return new WatiProvider({ ...DEFAULT_CONFIG, ...configOverrides }, options)
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('WatiProvider', () => {
  describe('constructor', () => {
    test('sets provider name to "wati"', () => {
      const provider = createProvider()
      expect(provider.name).toBe('wati')
    })

    test('requires channelNumber at runtime', () => {
      expect(
        () =>
          new WatiProvider(
            {
              provider: 'wati',
              apiKey: TEST_DATA.config.wati.apiKey,
              baseUrl: TEST_DATA.config.wati.baseUrl,
              channelNumber: '   ',
            },
          ),
      ).toThrow('Wati channelNumber is required in provider config')
    })
  })

  describe('feature support', () => {
    let provider: WatiProvider

    beforeEach(() => {
      provider = createProvider()
    })

    test('supports media.upload', () => {
      expect(provider.supports('media.upload')).toBe(true)
    })

    test('supports webhook.signature_verification', () => {
      expect(provider.supports('webhook.signature_verification')).toBe(true)
    })

    test('does NOT support interactive.button', () => {
      expect(provider.supports('interactive.button')).toBe(false)
    })

    test('does NOT support interactive.list', () => {
      expect(provider.supports('interactive.list')).toBe(false)
    })

    test('does NOT support media.download', () => {
      expect(provider.supports('media.download')).toBe(false)
    })

    test('does NOT support media.delete', () => {
      expect(provider.supports('media.delete')).toBe(false)
    })

    test('does NOT support reaction', () => {
      expect(provider.supports('reaction')).toBe(false)
    })

    test('does NOT support sticker', () => {
      expect(provider.supports('sticker')).toBe(false)
    })

    test('does NOT support location', () => {
      expect(provider.supports('location')).toBe(false)
    })

    test('does NOT support contacts', () => {
      expect(provider.supports('contacts')).toBe(false)
    })

    test('does NOT support template.management', () => {
      expect(provider.supports('template.management')).toBe(false)
    })

    test('does NOT support webhook.challenge', () => {
      expect(provider.supports('webhook.challenge')).toBe(false)
    })
  })

  describe('sendMessage', () => {
    test('sends text message using Bearer auth and tenant-specific URL', async () => {
      const originalFetch = globalThis.fetch
      const fetchMock = mock((_url: string | URL | Request, _init?: RequestInit) =>
        Promise.resolve(
          new Response(
            JSON.stringify({ result: true, info: 'Message sent', localMessageId: 'wati-msg-1' }),
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
          text: { body: 'Hello from Wati!' },
        })

        // Verify extracted messageId from localMessageId field
        expect(result.messageId).toBe('wati-msg-1')
        expect(result.provider).toBe('wati')

        const calledUrl = fetchMock.mock.calls[0]?.[0] as string
        // Should use the Wati base URL
        expect(calledUrl).toContain('live-mt-server.wati.io')
        // Should use the sendSessionMessage endpoint
        expect(calledUrl).toContain('/api/v1/sendSessionMessage/')

        // Verify Bearer auth header
        const calledInit = fetchMock.mock.calls[0]?.[1] as RequestInit | undefined
        const headers = calledInit?.headers as Record<string, string>
        expect(headers['Authorization']).toBe(`Bearer ${TEST_DATA.config.wati.apiKey}`)
      } finally {
        globalThis.fetch = originalFetch
      }
    })

    test('adds channel_number when sending template messages', async () => {
      const originalFetch = globalThis.fetch
      const fetchMock = mock((_url: string | URL | Request, init?: RequestInit) =>
        Promise.resolve(
          new Response(
            JSON.stringify({ result: true, localMessageId: 'wati-template-1' }),
            { status: 200, headers: { 'content-type': 'application/json' } },
          ),
        ),
      )
      globalThis.fetch = fetchMock as unknown as typeof fetch

      try {
        const provider = createProvider({ channelNumber: '201012345678' })

        await provider.sendMessage({
          type: 'template',
          to: TEST_DATA.phone.primary,
          template: {
            name: 'order_confirm',
            language: 'en',
            components: [
              { type: 'body', parameters: [{ type: 'text', text: 'ORD-1' }] },
            ],
          },
        })

        const calledInit = fetchMock.mock.calls[0]?.[1] as RequestInit | undefined
        const parsedBody = JSON.parse(String(calledInit?.body ?? '{}')) as Record<string, unknown>

        expect(parsedBody['channel_number']).toBe('201012345678')
        expect(parsedBody['template_name']).toBe('order_confirm')
      } finally {
        globalThis.fetch = originalFetch
      }
    })

    test('uses alternate messageId fields when localMessageId is missing', async () => {
      const originalFetch = globalThis.fetch
      globalThis.fetch = mock((_url: string | URL | Request, _init?: RequestInit) =>
        Promise.resolve(
          new Response(
            JSON.stringify({ result: true, messageId: 'wati-msg-2' }),
            { status: 200, headers: { 'content-type': 'application/json' } },
          ),
        ),
      ) as unknown as typeof fetch

      try {
        const provider = createProvider()
        const result = await provider.sendMessage({
          type: 'text',
          to: TEST_DATA.phone.primary,
          text: { body: 'test' },
        })

        expect(result.messageId).toBe('wati-msg-2')
      } finally {
        globalThis.fetch = originalFetch
      }
    })

    test('throws when Wati rejects the request with an HTTP 200 response', async () => {
      const originalFetch = globalThis.fetch
      globalThis.fetch = mock((_url: string | URL | Request, _init?: RequestInit) =>
        Promise.resolve(
          new Response(
            JSON.stringify({ result: false, info: 'No active session exists for this number' }),
            { status: 200, headers: { 'content-type': 'application/json' } },
          ),
        ),
      ) as unknown as typeof fetch

      try {
        const provider = createProvider()

        await expect(
          provider.sendMessage({
            type: 'text',
            to: TEST_DATA.phone.primary,
            text: { body: 'test' },
          }),
        ).rejects.toBeInstanceOf(ProviderError)
      } finally {
        globalThis.fetch = originalFetch
      }
    })

    test('throws when Wati does not return a message ID for a successful send', async () => {
      const originalFetch = globalThis.fetch
      globalThis.fetch = mock((_url: string | URL | Request, _init?: RequestInit) =>
        Promise.resolve(
          new Response(
            JSON.stringify({ result: true, info: 'Accepted' }),
            { status: 200, headers: { 'content-type': 'application/json' } },
          ),
        ),
      ) as unknown as typeof fetch

      try {
        const provider = createProvider()

        await expect(
          provider.sendMessage({
            type: 'text',
            to: TEST_DATA.phone.primary,
            text: { body: 'test' },
          }),
        ).rejects.toMatchObject({
          name: 'ProviderError',
          message: 'Wati accepted the send request but did not return a message ID',
        })
      } finally {
        globalThis.fetch = originalFetch
      }
    })
  })

  describe('webhook signature verification', () => {
    test('verifies valid signature', async () => {
      const secret = TEST_DATA.config.wati.webhookSecret
      const provider = createProvider({ webhookSecret: secret })
      const body = `{"waId":"${TEST_DATA.phone.primaryNormalized}"}`

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

    test('returns false when webhookSecret is not configured', async () => {
      const provider = createProvider({ webhookSecret: undefined })

      const result = await provider.verifyWebhookSignature('body', 'sig')
      expect(result).toBe(false)
    })

    test('rejects invalid signature', async () => {
      const provider = createProvider()

      const result = await provider.verifyWebhookSignature('body', 'bad-sig')
      expect(result).toBe(false)
    })
  })

  describe('webhook parsing', () => {
    test('parses Wati-format webhook payload', () => {
      const provider = createProvider()

      const events = provider.parseWebhook({
        eventType: 'message',
        waId: TEST_DATA.phone.primaryNormalized,
        senderName: 'Test User',
        text: 'Hello!',
        type: 'text',
        messageId: TEST_DATA.messageId.wati123,
      })

      expect(events).toHaveLength(1)
      expect(events[0]?.type).toBe('message')
      expect(events[0]?.metadata.provider).toBe('wati')
      if (events[0]?.type === 'message') {
        expect(events[0].from).toBe(TEST_DATA.phone.primaryNormalized)
        expect(events[0].message.type).toBe('text')
      }
    })

    test('does NOT parse Cloud API format', () => {
      const provider = createProvider()

      // Cloud API format should produce empty results from the Wati parser
      const events = provider.parseWebhook({
        object: 'whatsapp_business_account',
        entry: [{ id: '123', changes: [] }],
      })

      expect(events).toEqual([])
    })
  })

  describe('handleVerificationChallenge', () => {
    test('is not implemented (Wati does not use webhook challenges)', () => {
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
})
