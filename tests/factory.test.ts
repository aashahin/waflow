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
    })

    expect(wa).toBeInstanceOf(WhatsAppClient)
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
    })

    expect(wa.supports('interactive.button')).toBe(true)
    expect(wa.supports('interactive.list')).toBe(true)
    expect(wa.supports('media.upload')).toBe(true)
    expect(wa.supports('media.download')).toBe(true)
    expect(wa.supports('template.management')).toBe(true)
    expect(wa.supports('webhook.challenge')).toBe(true)
  })

  test('360dialog does not support webhook.challenge', () => {
    const wa = createWhatsApp({
      provider: '360dialog',
      apiKey: TEST_DATA.config.dialog360.apiKey,
    })

    expect(wa.supports('interactive.button')).toBe(true)
    expect(wa.supports('webhook.challenge')).toBe(false)
    expect(wa.supports('template.management')).toBe(false)
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
    expect(wa.supports('media.upload')).toBe(true)
    expect(wa.supports('media.download')).toBe(false)
    expect(wa.supports('reaction')).toBe(false)
    expect(wa.supports('webhook.signature_verification')).toBe(true)
  })
})
