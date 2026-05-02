import { describe, test, expect, mock, beforeEach } from 'bun:test'
import { CloudApiProvider } from '../../../src/providers/cloud-api/index.js'
import { ValidationError } from '../../../src/core/errors.js'
import type { CloudApiConfig, ClientOptions } from '../../../src/types/config.js'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

import { TEST_DATA } from '../../constants.js'

const DEFAULT_CONFIG: CloudApiConfig = {
  provider: 'cloud-api',
  phoneNumberId: TEST_DATA.config.cloudApi.phoneNumberId,
  accessToken: TEST_DATA.config.cloudApi.accessToken,
  appSecret: TEST_DATA.config.cloudApi.appSecret,
  webhookVerifyToken: TEST_DATA.config.cloudApi.webhookVerifyToken,
  wabaId: TEST_DATA.config.cloudApi.wabaId,
}

function createProvider(
  configOverrides?: Partial<CloudApiConfig>,
  options?: ClientOptions,
): CloudApiProvider {
  return new CloudApiProvider({ ...DEFAULT_CONFIG, ...configOverrides }, options)
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('CloudApiProvider', () => {
  describe('constructor', () => {
    test('sets provider name to "cloud-api"', () => {
      const provider = createProvider()
      expect(provider.name).toBe('cloud-api')
    })
  })

  describe('feature support', () => {
    let provider: CloudApiProvider

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

    test('supports template.management', () => {
      expect(provider.supports('template.management')).toBe(true)
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

    test('supports webhook.challenge', () => {
      expect(provider.supports('webhook.challenge')).toBe(true)
    })
  })

  describe('sendMessage', () => {
    test('sends text message to /{phoneNumberId}/messages', async () => {
      const originalFetch = globalThis.fetch
      const fetchMock = mock((_url: string | URL | Request, _init?: RequestInit) =>
        Promise.resolve(
          new Response(
            JSON.stringify({ messages: [{ id: 'wamid.cloud' }] }),
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
          text: { body: 'Hello from Cloud API!' },
        })

        expect(result.messageId).toBe('wamid.cloud')
        expect(result.provider).toBe('cloud-api')

        // Verify URL path includes phoneNumberId
        const calledUrl = fetchMock.mock.calls[0]?.[0] as string
        expect(calledUrl).toContain(`/${TEST_DATA.config.cloudApi.phoneNumberId}/messages`)

        // Verify Bearer auth header
        const calledInit = fetchMock.mock.calls[0]?.[1] as RequestInit | undefined
        const headers = calledInit?.headers as Record<string, string>
        expect(headers['Authorization']).toBe('Bearer EAAx-test-token')
      } finally {
        globalThis.fetch = originalFetch
      }
    })

    test('includes raw response when includeRawResponse is true', async () => {
      const originalFetch = globalThis.fetch
      const rawResponse = { messages: [{ id: 'wamid.raw' }] }
      globalThis.fetch = mock((_url: string | URL | Request, _init?: RequestInit) =>
        Promise.resolve(
          new Response(JSON.stringify(rawResponse), {
            status: 200,
            headers: { 'content-type': 'application/json' },
          }),
        ),
      ) as unknown as typeof fetch

      try {
        const provider = createProvider({}, { includeRawResponse: true })
        const result = await provider.sendMessage({
          type: 'text',
          to: TEST_DATA.phone.secondary,
          text: { body: 'test' },
        })

        expect(result.raw).toEqual(rawResponse)
      } finally {
        globalThis.fetch = originalFetch
      }
    })
  })

  describe('webhook verification challenge', () => {
    test('accepts valid challenge', () => {
      const provider = createProvider()

      const result = provider.handleVerificationChallenge({
        'hub.mode': 'subscribe',
        'hub.verify_token': 'verify-me',
        'hub.challenge': 'challenge-token-abc',
      })

      expect(result).toBe('challenge-token-abc')
    })

    test('rejects invalid verify token', () => {
      const provider = createProvider()

      const result = provider.handleVerificationChallenge({
        'hub.mode': 'subscribe',
        'hub.verify_token': 'wrong-token',
        'hub.challenge': 'challenge-token-abc',
      })

      expect(result).toBeNull()
    })

    test('rejects non-subscribe mode', () => {
      const provider = createProvider()

      const result = provider.handleVerificationChallenge({
        'hub.mode': 'unsubscribe',
        'hub.verify_token': 'verify-me',
        'hub.challenge': 'challenge-token-abc',
      })

      expect(result).toBeNull()
    })

    test('rejects when challenge is missing', () => {
      const provider = createProvider()

      const result = provider.handleVerificationChallenge({
        'hub.mode': 'subscribe',
        'hub.verify_token': 'verify-me',
      })

      expect(result).toBeNull()
    })
  })

  describe('webhook signature verification', () => {
    test('returns false when appSecret is not configured', async () => {
      const provider = createProvider({ appSecret: undefined })

      const result = await provider.verifyWebhookSignature('body', 'sig')
      expect(result).toBe(false)
    })

    test('verifies valid signature', async () => {
      const secret = TEST_DATA.config.cloudApi.appSecret!
      const provider = createProvider({ appSecret: secret })
      const body = '{"data":"test"}'

      // Compute expected HMAC
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

      expect(await provider.verifyWebhookSignature(body, hex)).toBe(true)
    })
  })

  describe('template management', () => {
    test('throws ValidationError when wabaId is not configured', async () => {
      const provider = createProvider({ wabaId: undefined })

      await expect(provider.listTemplates()).rejects.toThrow(ValidationError)
    })

    test('listTemplates uses /{wabaId}/message_templates path', async () => {
      const originalFetch = globalThis.fetch
      const fetchMock = mock((_url: string | URL | Request, _init?: RequestInit) =>
        Promise.resolve(
          new Response(JSON.stringify({ data: [] }), {
            status: 200,
            headers: { 'content-type': 'application/json' },
          }),
        ),
      )
      globalThis.fetch = fetchMock as unknown as typeof fetch

      try {
        const provider = createProvider({ wabaId: 'waba-789' })
        await provider.listTemplates()

        const calledUrl = fetchMock.mock.calls[0]?.[0] as string
        expect(calledUrl).toContain('/waba-789/message_templates')
        // Should NOT contain phoneNumberId
        expect(calledUrl).not.toContain(TEST_DATA.config.cloudApi.phoneNumberId)
      } finally {
        globalThis.fetch = originalFetch
      }
    })

    test('deleteTemplate uses /{wabaId}/message_templates with name query', async () => {
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
        const provider = createProvider({ wabaId: 'waba-789' })
        await provider.deleteTemplate('hello_world')

        const calledUrl = fetchMock.mock.calls[0]?.[0] as string
        expect(calledUrl).toContain('/waba-789/message_templates')
        expect(calledUrl).toContain('name=hello_world')
      } finally {
        globalThis.fetch = originalFetch
      }
    })

    test('createTemplate lowercases category and component payload for Cloud API', async () => {
      const originalFetch = globalThis.fetch
      const fetchMock = mock((_url: string | URL | Request, _init?: RequestInit) =>
        Promise.resolve(
          new Response(
            JSON.stringify({
              id: 'tmpl-123',
              status: 'PENDING',
              category: 'UTILITY',
            }),
            {
              status: 200,
              headers: { 'content-type': 'application/json' },
            },
          ),
        ),
      )
      globalThis.fetch = fetchMock as unknown as typeof fetch

      try {
        const provider = createProvider({ wabaId: 'waba-789' })
        await provider.createTemplate({
          name: 'reservation_confirmation',
          language: 'en_US',
          category: 'UTILITY',
          components: [
            {
              type: 'BODY',
              text: 'Hi {{1}}',
              example: { body_text: [['Pablo']] },
            },
          ],
        })

        const calledInit = fetchMock.mock.calls[0]?.[1] as RequestInit | undefined
        const body = JSON.parse(String(calledInit?.body ?? '{}')) as Record<string, unknown>

        expect(body.category).toBe('utility')
        expect(body.parameter_format).toBe('positional')
        expect(Array.isArray(body.components)).toBe(true)
        expect((body.components as Array<Record<string, unknown>>)[0]?.type).toBe('body')

        const result = await provider.createTemplate({
          name: 'reservation_confirmation',
          language: 'en_US',
          category: 'UTILITY',
          components: [
            {
              type: 'BODY',
              text: 'Hi {{1}}',
              example: { body_text: [['Pablo']] },
            },
          ],
        })

        expect(result.id).toBe('tmpl-123')
        expect(result.name).toBe('reservation_confirmation')
        expect(result.language).toBe('en_US')
        expect(result.status).toBe('PENDING')
        expect(result.components[0]?.type).toBe('BODY')
      } finally {
        globalThis.fetch = originalFetch
      }
    })
  })
})
