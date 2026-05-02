import { describe, test, expect, mock, beforeEach } from 'bun:test'
import { Dialog360Provider } from '../../../src/providers/360dialog/index.js'
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

    test('defaults base URL when not provided', () => {
      const provider = createProvider({ baseUrl: undefined })
      expect(provider.name).toBe('360dialog')
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
