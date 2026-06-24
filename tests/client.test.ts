import { describe, test, expect, mock } from 'bun:test'
import { WhatsAppClient } from '../src/client.js'
import { UnsupportedFeatureError, ValidationError } from '../src/core/errors.js'
import type { WhatsAppProviderAdapter } from '../src/types/provider.js'
import { TEST_DATA } from './constants.js'

/** Create a mock adapter with all methods stubbed */
function createMockAdapter(overrides?: Partial<WhatsAppProviderAdapter>): WhatsAppProviderAdapter {
  return {
    name: 'cloud-api',
    sendMessage: mock(() => Promise.resolve({ messageId: TEST_DATA.messageId.test, provider: 'cloud-api' as const })),
    markAsRead: mock(() => Promise.resolve()),
    uploadMedia: mock(() => Promise.resolve({ id: TEST_DATA.mediaId.media123 })),
    getMediaUrl: mock(() => Promise.resolve({ url: 'https://cdn.example.com/file', mimeType: 'image/png' })),
    downloadMedia: mock(() => Promise.resolve({ stream: new ReadableStream(), mimeType: 'image/png' })),
    deleteMedia: mock(() => Promise.resolve()),
    parseWebhook: mock(() => []),
    verifyWebhookSignature: mock(() => Promise.resolve(true)),
    supports: mock(() => true),
    ...overrides,
  }
}

describe('WhatsAppClient', () => {
  test('exposes provider name', () => {
    const adapter = createMockAdapter()
    const client = new WhatsAppClient(adapter)
    expect(client.provider).toBe('cloud-api')
  })

  test('delegates supports() to adapter', () => {
    const adapter = createMockAdapter({
      supports: mock((feature) => feature === 'media.upload'),
    })
    const client = new WhatsAppClient(adapter)

    expect(client.supports('media.upload')).toBe(true)
    expect(client.supports('reaction')).toBe(false)
  })
})

describe('message namespace', () => {
  test('message.text() sends a text message', async () => {
    const adapter = createMockAdapter()
    const client = new WhatsAppClient(adapter)

    const result = await client.message.text(TEST_DATA.phone.primary, 'Hello!')

    expect(result.messageId).toBe(TEST_DATA.messageId.test)
    expect(adapter.sendMessage).toHaveBeenCalledWith({
      type: 'text',
      to: TEST_DATA.phone.primary,
      text: { body: 'Hello!', previewUrl: undefined },
    })
  })

  test('message.text() with options', async () => {
    const adapter = createMockAdapter()
    const client = new WhatsAppClient(adapter)

    await client.message.text(TEST_DATA.phone.primary, 'Check link', {
      previewUrl: true,
      replyTo: TEST_DATA.messageId.original,
    })

    expect(adapter.sendMessage).toHaveBeenCalledWith({
      type: 'text',
      to: TEST_DATA.phone.primary,
      text: { body: 'Check link', previewUrl: true },
      context: { messageId: TEST_DATA.messageId.original },
    })
  })

  test('message.template() sends a template', async () => {
    const adapter = createMockAdapter()
    const client = new WhatsAppClient(adapter)

    await client.message.template(TEST_DATA.phone.primary, {
      name: 'hello',
      language: 'en',
    })

    expect(adapter.sendMessage).toHaveBeenCalledWith({
      type: 'template',
      to: TEST_DATA.phone.primary,
      template: { name: 'hello', language: 'en' },
    })
  })

  test('message.image() sends an image', async () => {
    const adapter = createMockAdapter()
    const client = new WhatsAppClient(adapter)

    await client.message.image(TEST_DATA.phone.primary, { url: 'https://img.test/a.jpg' }, { caption: 'Photo' })

    expect(adapter.sendMessage).toHaveBeenCalledWith({
      type: 'image',
      to: TEST_DATA.phone.primary,
      image: { url: 'https://img.test/a.jpg', caption: 'Photo' },
    })
  })

  test('message.document() sends a document with filename', async () => {
    const adapter = createMockAdapter()
    const client = new WhatsAppClient(adapter)

    await client.message.document(
      TEST_DATA.phone.primary,
      { url: 'https://test.com/doc.pdf' },
      { caption: 'Invoice', filename: 'invoice.pdf' },
    )

    expect(adapter.sendMessage).toHaveBeenCalledWith({
      type: 'document',
      to: TEST_DATA.phone.primary,
      document: { url: 'https://test.com/doc.pdf', caption: 'Invoice', filename: 'invoice.pdf' },
    })
  })

  test('message.location() sends a location', async () => {
    const adapter = createMockAdapter()
    const client = new WhatsAppClient(adapter)

    await client.message.location(TEST_DATA.phone.primary, {
      latitude: 24.7,
      longitude: 46.6,
      name: 'Riyadh',
    })

    expect(adapter.sendMessage).toHaveBeenCalledWith({
      type: 'location',
      to: TEST_DATA.phone.primary,
      location: { latitude: 24.7, longitude: 46.6, name: 'Riyadh' },
    })
  })

  test('message.reaction() sends a reaction', async () => {
    const adapter = createMockAdapter()
    const client = new WhatsAppClient(adapter)

    await client.message.reaction(TEST_DATA.phone.primary, TEST_DATA.messageId.abc, '👍')

    expect(adapter.sendMessage).toHaveBeenCalledWith({
      type: 'reaction',
      to: TEST_DATA.phone.primary,
      reaction: { messageId: TEST_DATA.messageId.abc, emoji: '👍' },
    })
  })

  test('message.markAsRead() delegates to adapter', async () => {
    const adapter = createMockAdapter()
    const client = new WhatsAppClient(adapter)

    await client.message.markAsRead(TEST_DATA.messageId.abc)

    expect(adapter.markAsRead).toHaveBeenCalledWith(TEST_DATA.messageId.abc)
  })

  test('message.interactive.buttons() sends interactive buttons', async () => {
    const adapter = createMockAdapter()
    const client = new WhatsAppClient(adapter)

    await client.message.interactive.buttons(
      TEST_DATA.phone.primary,
      'Choose:',
      [{ id: 'yes', title: 'Yes' }],
      { footer: 'Reply now' },
    )

    expect(adapter.sendMessage).toHaveBeenCalledWith({
      type: 'interactive.button',
      to: TEST_DATA.phone.primary,
      body: 'Choose:',
      buttons: [{ id: 'yes', title: 'Yes' }],
      header: undefined,
      footer: 'Reply now',
    })
  })

  test('message.interactive.list() sends interactive list', async () => {
    const adapter = createMockAdapter()
    const client = new WhatsAppClient(adapter)

    await client.message.interactive.list(
      TEST_DATA.phone.primary,
      'Browse:',
      'View Menu',
      [{ title: 'Food', rows: [{ id: 'rice', title: 'Rice' }] }],
    )

    expect(adapter.sendMessage).toHaveBeenCalledWith({
      type: 'interactive.list',
      to: TEST_DATA.phone.primary,
      body: 'Browse:',
      buttonText: 'View Menu',
      sections: [{ title: 'Food', rows: [{ id: 'rice', title: 'Rice' }] }],
      header: undefined,
      footer: undefined,
    })
  })
})

describe('media namespace', () => {
  test('media.upload() delegates to adapter', async () => {
    const adapter = createMockAdapter()
    const client = new WhatsAppClient(adapter)

    const result = await client.media.upload({
      file: new Uint8Array([1, 2, 3]),
      mimeType: 'image/png',
      filename: 'test.png',
    })

    expect(result.id).toBe(TEST_DATA.mediaId.media123)
    expect(adapter.uploadMedia).toHaveBeenCalled()
  })

  test('media.getUrl() delegates to adapter', async () => {
    const adapter = createMockAdapter()
    const client = new WhatsAppClient(adapter)

    const result = await client.media.getUrl(TEST_DATA.mediaId.media123)

    expect(result.url).toBe('https://cdn.example.com/file')
    expect(adapter.getMediaUrl).toHaveBeenCalledWith(TEST_DATA.mediaId.media123)
  })

  test('media.download() delegates to adapter', async () => {
    const adapter = createMockAdapter()
    const client = new WhatsAppClient(adapter)

    const result = await client.media.download(TEST_DATA.mediaId.media123)

    expect(result.mimeType).toBe('image/png')
    expect(adapter.downloadMedia).toHaveBeenCalledWith(TEST_DATA.mediaId.media123)
  })

  test('media.delete() delegates to adapter', async () => {
    const adapter = createMockAdapter()
    const client = new WhatsAppClient(adapter)

    await client.media.delete(TEST_DATA.mediaId.media123)

    expect(adapter.deleteMedia).toHaveBeenCalledWith(TEST_DATA.mediaId.media123)
  })
})

describe('webhook namespace', () => {
  test('webhook.parse() delegates to adapter', () => {
    const adapter = createMockAdapter({
      parseWebhook: mock(() => [
        { type: 'message' as const, messageId: 'w1', from: '1', timestamp: new Date(1700000000000), message: { type: 'text' as const, body: 'hi' }, metadata: { provider: 'cloud-api' as const, raw: {} } },
      ]),
    })
    const client = new WhatsAppClient(adapter)

    const events = client.webhook.parse({ some: 'payload' })

    expect(events).toHaveLength(1)
    expect(adapter.parseWebhook).toHaveBeenCalledWith({ some: 'payload' })
  })

  test('webhook.verify() delegates to adapter', async () => {
    const adapter = createMockAdapter()
    const client = new WhatsAppClient(adapter)

    const result = await client.webhook.verify('body', 'sha256=abc')

    expect(result).toBe(true)
    expect(adapter.verifyWebhookSignature).toHaveBeenCalledWith('body', 'sha256=abc')
  })

  test('webhook.handleChallenge() returns null when not supported', () => {
    const adapter = createMockAdapter()
    // Remove handleVerificationChallenge
    delete (adapter as unknown as Record<string, unknown>)['handleVerificationChallenge']
    const client = new WhatsAppClient(adapter)

    expect(client.webhook.handleChallenge({ 'hub.mode': 'subscribe' })).toBeNull()
  })

  test('webhook.handleChallenge() delegates when supported', () => {
    const adapter = createMockAdapter({
      handleVerificationChallenge: mock(() => 'challenge-token'),
    })
    const client = new WhatsAppClient(adapter)

    const result = client.webhook.handleChallenge({
      'hub.mode': 'subscribe',
      'hub.verify_token': 'token',
      'hub.challenge': 'challenge-token',
    })

    expect(result).toBe('challenge-token')
  })
})

describe('template namespace', () => {
  test('template.list() throws when not supported', async () => {
    const adapter = createMockAdapter()
    // Remove listTemplates
    delete (adapter as unknown as Record<string, unknown>)['listTemplates']
    const client = new WhatsAppClient(adapter)

    await expect(client.template.list()).rejects.toThrow(UnsupportedFeatureError)
  })

  test('template.list() delegates when supported', async () => {
    const mockTemplates = [{ id: '1', name: 'hello', language: 'en', status: 'APPROVED' as const, category: 'UTILITY' as const, components: [] }]
    const adapter = createMockAdapter({
      listTemplates: mock(() => Promise.resolve(mockTemplates)),
    })
    const client = new WhatsAppClient(adapter)

    const result = await client.template.list()

    expect(result).toEqual(mockTemplates)
  })

  test('template.create() throws when not supported', async () => {
    const adapter = createMockAdapter()
    delete (adapter as unknown as Record<string, unknown>)['createTemplate']
    const client = new WhatsAppClient(adapter)

    await expect(
      client.template.create({ name: 'test', language: 'en', category: 'UTILITY', components: [] }),
    ).rejects.toThrow(UnsupportedFeatureError)
  })

  test('template.delete() throws when not supported', async () => {
    const adapter = createMockAdapter()
    delete (adapter as unknown as Record<string, unknown>)['deleteTemplate']
    const client = new WhatsAppClient(adapter)

    await expect(client.template.delete('test')).rejects.toThrow(UnsupportedFeatureError)
  })
})

describe('otp namespace', () => {
  test('otp.send() builds an auth-template message with the code in body and button', async () => {
    const adapter = createMockAdapter()
    const client = new WhatsAppClient(adapter)

    await client.otp.send(TEST_DATA.phone.primary, '123456', { template: 'login_code' })

    expect(adapter.sendMessage).toHaveBeenCalledWith({
      type: 'template',
      to: TEST_DATA.phone.primary,
      template: {
        name: 'login_code',
        language: 'en_US',
        components: [
          { type: 'body', parameters: [{ type: 'text', text: '123456' }] },
          { type: 'button', sub_type: 'url', index: 0, parameters: [{ type: 'text', text: '123456' }] },
        ],
      },
    })
  })

  test('otp.send() can omit the button and honor a custom language', async () => {
    const adapter = createMockAdapter()
    const client = new WhatsAppClient(adapter)

    await client.otp.send(TEST_DATA.phone.primary, '999000', {
      template: 'login_code',
      language: 'ar',
      button: false,
    })

    expect(adapter.sendMessage).toHaveBeenCalledWith({
      type: 'template',
      to: TEST_DATA.phone.primary,
      template: {
        name: 'login_code',
        language: 'ar',
        components: [{ type: 'body', parameters: [{ type: 'text', text: '999000' }] }],
      },
    })
  })

  test('otp.send() rejects an empty code', async () => {
    const adapter = createMockAdapter()
    const client = new WhatsAppClient(adapter)

    await expect(
      client.otp.send(TEST_DATA.phone.primary, '   ', { template: 'login_code' }),
    ).rejects.toBeInstanceOf(ValidationError)
    expect(adapter.sendMessage).not.toHaveBeenCalled()
  })
})

describe('lifecycle', () => {
  test('destroy() delegates to the adapter', () => {
    const destroy = mock(() => {})
    const adapter = createMockAdapter({ destroy })
    const client = new WhatsAppClient(adapter)

    client.destroy()

    expect(destroy).toHaveBeenCalledTimes(1)
  })

  test('destroy() is a no-op when the adapter has none', () => {
    const adapter = createMockAdapter()
    delete (adapter as unknown as Record<string, unknown>)['destroy']
    const client = new WhatsAppClient(adapter)

    expect(() => client.destroy()).not.toThrow()
  })
})
