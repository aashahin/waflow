import { describe, test, expect } from 'bun:test'
import { createWhatsApp, createWhatsAppFromAdapter, WhatsAppClient } from '../src/index.js'
import type { WhatsAppProviderAdapter } from '../src/types/provider.js'
import { TEST_DATA } from './constants.js'
import { ValidationError } from '../src/core/errors.js'

describe('createWhatsApp', () => {
  test('creates a client for cloud-api provider', () => {
    const wa = createWhatsApp({
      provider: 'cloud-api',
      phoneNumberId: TEST_DATA.config.cloudApi.phoneNumberId,
      accessToken: TEST_DATA.config.cloudApi.accessToken,
    })

    expect(wa).toBeInstanceOf(WhatsAppClient)
    expect(wa.provider).toBe('cloud-api')
  })

  test('creates a client for 360dialog provider', () => {
    const wa = createWhatsApp({
      provider: '360dialog',
      apiKey: TEST_DATA.config.dialog360.apiKey,
    })

    expect(wa).toBeInstanceOf(WhatsAppClient)
    expect(wa.provider).toBe('360dialog')
  })

  test('creates a client for wati provider', () => {
    const wa = createWhatsApp({
      provider: 'wati',
      apiKey: TEST_DATA.config.wati.apiKey,
      baseUrl: TEST_DATA.config.wati.baseUrl,
      channelNumber: TEST_DATA.config.wati.channelNumber,
    })

    expect(wa).toBeInstanceOf(WhatsAppClient)
    expect(wa.provider).toBe('wati')
  })

  test('throws when wati channelNumber is missing at runtime', () => {
    expect(
      () =>
        createWhatsApp({
          provider: 'wati',
          apiKey: TEST_DATA.config.wati.apiKey,
          baseUrl: TEST_DATA.config.wati.baseUrl,
        } as any),
    ).toThrow(ValidationError)
  })

  test('throws when cloud-api credentials are missing', () => {
    expect(() =>
      createWhatsApp({ provider: 'cloud-api', phoneNumberId: '', accessToken: 'x' } as any),
    ).toThrow(ValidationError)
    expect(() =>
      createWhatsApp({ provider: 'cloud-api', phoneNumberId: '123', accessToken: '  ' } as any),
    ).toThrow(ValidationError)
  })

  test('throws when 360dialog apiKey is missing', () => {
    expect(() => createWhatsApp({ provider: '360dialog' } as any)).toThrow(ValidationError)
  })

  test('passes client options to provider', () => {
    // Should not throw with valid options
    const wa = createWhatsApp({
      provider: 'cloud-api',
      phoneNumberId: TEST_DATA.config.cloudApi.phoneNumberId,
      accessToken: TEST_DATA.config.cloudApi.accessToken,
      timeout: 5000,
      retry: { maxRetries: 1, baseDelay: 100, maxDelay: 1000 },
      rateLimit: { maxRequestsPerSecond: 10 },
      includeRawResponse: true,
      includeRawWebhook: true,
    })

    expect(wa).toBeInstanceOf(WhatsAppClient)
  })

  test('passes includeRawWebhook through to parsed events', () => {
    const wa = createWhatsApp({
      provider: 'cloud-api',
      phoneNumberId: TEST_DATA.config.cloudApi.phoneNumberId,
      accessToken: TEST_DATA.config.cloudApi.accessToken,
      includeRawWebhook: true,
    })

    const payload = {
      object: 'whatsapp_business_account',
      entry: [
        {
          id: '1',
          changes: [
            {
              field: 'messages',
              value: {
                messaging_product: 'whatsapp',
                metadata: {
                  display_phone_number: '1',
                  phone_number_id: TEST_DATA.config.cloudApi.phoneNumberId,
                },
                messages: [
                  {
                    id: TEST_DATA.messageId.abc123,
                    from: TEST_DATA.phone.primaryNormalized,
                    timestamp: '1',
                    type: 'text',
                    text: { body: 'hi' },
                  },
                ],
              },
            },
          ],
        },
      ],
    }

    expect(wa.webhook.parse(payload)[0]?.metadata.raw).toEqual(payload)
  })
})

describe('createWhatsAppFromAdapter', () => {
  test('wraps a custom adapter in a WhatsAppClient', () => {
    const customAdapter: WhatsAppProviderAdapter = {
      name: 'custom',
      sendMessage: () => Promise.resolve({ messageId: 'c1', provider: 'cloud-api' }),
      markAsRead: () => Promise.resolve(),
      uploadMedia: () => Promise.resolve({ id: 'c-media' }),
      getMediaUrl: () => Promise.resolve({ url: 'https://cdn.test/f', mimeType: 'image/png' }),
      downloadMedia: () => Promise.resolve({ stream: new ReadableStream(), mimeType: 'image/png' }),
      deleteMedia: () => Promise.resolve(),
      parseWebhook: () => [],
      verifyWebhookSignature: () => Promise.resolve(false),
      supports: () => false,
    }

    const wa = createWhatsAppFromAdapter(customAdapter)

    expect(wa).toBeInstanceOf(WhatsAppClient)
    expect(wa.provider).toBe('custom')
  })
})

describe('feature detection', () => {
  test('cloud-api supports interactive buttons', () => {
    const wa = createWhatsApp({
      provider: 'cloud-api',
      phoneNumberId: TEST_DATA.config.cloudApi.phoneNumberId,
      accessToken: TEST_DATA.config.cloudApi.accessToken,
      webhookVerifyToken: TEST_DATA.config.cloudApi.webhookVerifyToken,
    })

    expect(wa.supports('interactive.button')).toBe(true)
    expect(wa.supports('interactive.list')).toBe(true)
    expect(wa.supports('media.upload')).toBe(true)
    expect(wa.supports('media.download')).toBe(true)
    expect(wa.supports('template.management')).toBe(true)
    expect(wa.supports('webhook.challenge')).toBe(true)
  })

  test('cloud-api webhook features require secrets', () => {
    const wa = createWhatsApp({
      provider: 'cloud-api',
      phoneNumberId: TEST_DATA.config.cloudApi.phoneNumberId,
      accessToken: TEST_DATA.config.cloudApi.accessToken,
    })

    expect(wa.supports('webhook.challenge')).toBe(false)
    expect(wa.supports('webhook.signature_verification')).toBe(false)
  })

  test('360dialog does not support webhook.challenge', () => {
    const wa = createWhatsApp({
      provider: '360dialog',
      apiKey: TEST_DATA.config.dialog360.apiKey,
    })

    expect(wa.supports('interactive.button')).toBe(true)
    expect(wa.supports('webhook.challenge')).toBe(false)
    expect(wa.supports('template.management')).toBe(false)
    expect(wa.supports('webhook.signature_verification')).toBe(false)
  })

  test('wati has limited feature support', () => {
    const wa = createWhatsApp({
      provider: 'wati',
      apiKey: TEST_DATA.config.wati.apiKey,
      baseUrl: TEST_DATA.config.wati.baseUrl,
      channelNumber: TEST_DATA.config.wati.channelNumber,
    })

    expect(wa.supports('interactive.button')).toBe(false)
    expect(wa.supports('interactive.list')).toBe(false)
    expect(wa.supports('media.upload')).toBe(false)
    expect(wa.supports('media.download')).toBe(false)
    expect(wa.supports('reaction')).toBe(false)
    // WATI does not natively sign webhooks — see WatiProvider for details.
    expect(wa.supports('webhook.signature_verification')).toBe(false)
  })
})
