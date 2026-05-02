import { describe, test, expect } from 'bun:test'
import { mapOutboundToCloudApi } from '../../../src/providers/cloud-api/mapper.js'
import { ValidationError } from '../../../src/core/errors.js'
import { TEST_DATA } from '../../constants.js'

describe('mapOutboundToCloudApi', () => {
  describe('text messages', () => {
    test('maps a simple text message', () => {
      const result = mapOutboundToCloudApi({
        type: 'text',
        to: TEST_DATA.phone.primary,
        text: { body: 'Hello!' },
      })

      expect(result).toEqual({
        messaging_product: 'whatsapp',
        recipient_type: 'individual',
        to: TEST_DATA.phone.primaryNormalized,
        type: 'text',
        text: { body: 'Hello!', preview_url: false },
      })
    })

    test('maps text with preview_url enabled', () => {
      const result = mapOutboundToCloudApi({
        type: 'text',
        to: TEST_DATA.phone.primary,
        text: { body: 'Check https://example.com', previewUrl: true },
      })

      expect(result['text']).toEqual({
        body: 'Check https://example.com',
        preview_url: true,
      })
    })

    test('includes reply context when provided', () => {
      const result = mapOutboundToCloudApi({
        type: 'text',
        to: TEST_DATA.phone.primary,
        text: { body: 'Reply' },
        context: { messageId: TEST_DATA.messageId.abc123 },
      })

      expect(result['context']).toEqual({ message_id: TEST_DATA.messageId.abc123 })
    })
  })

  describe('template messages', () => {
    test('maps a template message', () => {
      const result = mapOutboundToCloudApi({
        type: 'template',
        to: TEST_DATA.phone.primary,
        template: {
          name: 'order_confirmation',
          language: 'en_US',
          components: [
            { type: 'body', parameters: [{ type: 'text', text: 'ORD-1234' }] },
          ],
        },
      })

      expect(result['type']).toBe('template')
      expect(result['template']).toEqual({
        name: 'order_confirmation',
        language: { code: 'en_US' },
        components: [
          { type: 'body', parameters: [{ type: 'text', text: 'ORD-1234' }] },
        ],
      })
    })

    test('maps template without components', () => {
      const result = mapOutboundToCloudApi({
        type: 'template',
        to: TEST_DATA.phone.primary,
        template: { name: 'hello', language: 'en' },
      })

      expect(result['template']).toEqual({
        name: 'hello',
        language: { code: 'en' },
      })
    })
  })

  describe('media messages', () => {
    test('maps image with URL', () => {
      const result = mapOutboundToCloudApi({
        type: 'image',
        to: TEST_DATA.phone.primary,
        image: { url: 'https://example.com/photo.jpg', caption: 'A photo' },
      })

      expect(result['type']).toBe('image')
      expect(result['image']).toEqual({
        link: 'https://example.com/photo.jpg',
        caption: 'A photo',
      })
    })

    test('maps image with media ID', () => {
      const result = mapOutboundToCloudApi({
        type: 'image',
        to: TEST_DATA.phone.primary,
        image: { id: TEST_DATA.mediaId.media123 },
      })

      expect(result['image']).toEqual({ id: TEST_DATA.mediaId.media123 })
    })

    test('maps video with URL and caption', () => {
      const result = mapOutboundToCloudApi({
        type: 'video',
        to: TEST_DATA.phone.primary,
        video: { url: 'https://example.com/video.mp4', caption: 'Watch this' },
      })

      expect(result['type']).toBe('video')
      expect(result['video']).toEqual({
        link: 'https://example.com/video.mp4',
        caption: 'Watch this',
      })
    })

    test('maps audio with URL', () => {
      const result = mapOutboundToCloudApi({
        type: 'audio',
        to: TEST_DATA.phone.primary,
        audio: { url: 'https://example.com/audio.ogg' },
      })

      expect(result['type']).toBe('audio')
      expect(result['audio']).toEqual({ link: 'https://example.com/audio.ogg' })
    })

    test('maps document with URL, caption, and filename', () => {
      const result = mapOutboundToCloudApi({
        type: 'document',
        to: TEST_DATA.phone.primary,
        document: {
          url: 'https://example.com/doc.pdf',
          caption: 'Invoice',
          filename: 'invoice.pdf',
        },
      })

      expect(result['document']).toEqual({
        link: 'https://example.com/doc.pdf',
        caption: 'Invoice',
        filename: 'invoice.pdf',
      })
    })

    test('maps sticker with media ID', () => {
      const result = mapOutboundToCloudApi({
        type: 'sticker',
        to: TEST_DATA.phone.primary,
        sticker: { id: TEST_DATA.mediaId.sticker123 },
      })

      expect(result['type']).toBe('sticker')
      expect(result['sticker']).toEqual({ id: TEST_DATA.mediaId.sticker123 })
    })
  })

  describe('location messages', () => {
    test('maps a full location', () => {
      const result = mapOutboundToCloudApi({
        type: 'location',
        to: TEST_DATA.phone.primary,
        location: {
          latitude: 24.7136,
          longitude: 46.6753,
          name: 'Riyadh',
          address: 'KSA',
        },
      })

      expect(result['type']).toBe('location')
      expect(result['location']).toEqual({
        latitude: 24.7136,
        longitude: 46.6753,
        name: 'Riyadh',
        address: 'KSA',
      })
    })

    test('maps location without name/address', () => {
      const result = mapOutboundToCloudApi({
        type: 'location',
        to: TEST_DATA.phone.primary,
        location: { latitude: 0, longitude: 0 },
      })

      expect(result['location']).toEqual({ latitude: 0, longitude: 0 })
    })
  })

  describe('reaction messages', () => {
    test('maps a reaction', () => {
      const result = mapOutboundToCloudApi({
        type: 'reaction',
        to: TEST_DATA.phone.primary,
        reaction: { messageId: TEST_DATA.messageId.abc, emoji: '👍' },
      })

      expect(result['type']).toBe('reaction')
      expect(result['reaction']).toEqual({
        message_id: TEST_DATA.messageId.abc,
        emoji: '👍',
      })
    })
  })

  describe('interactive messages', () => {
    test('maps interactive buttons', () => {
      const result = mapOutboundToCloudApi({
        type: 'interactive.button',
        to: TEST_DATA.phone.primary,
        body: 'Choose an option:',
        buttons: [
          { id: 'yes', title: 'Yes' },
          { id: 'no', title: 'No' },
        ],
      })

      expect(result['type']).toBe('interactive')
      const interactive = result['interactive'] as Record<string, unknown>
      expect(interactive['type']).toBe('button')
      expect(interactive['body']).toEqual({ text: 'Choose an option:' })
    })

    test('throws ValidationError when buttons exceed 3', () => {
      expect(() =>
        mapOutboundToCloudApi({
          type: 'interactive.button',
          to: TEST_DATA.phone.primary,
          body: 'Choose:',
          buttons: [
            { id: '1', title: 'A' },
            { id: '2', title: 'B' },
            { id: '3', title: 'C' },
            { id: '4', title: 'D' },
          ],
        }),
      ).toThrow(ValidationError)
    })

    test('allows exactly 3 buttons', () => {
      expect(() =>
        mapOutboundToCloudApi({
          type: 'interactive.button',
          to: TEST_DATA.phone.primary,
          body: 'Choose:',
          buttons: [
            { id: '1', title: 'A' },
            { id: '2', title: 'B' },
            { id: '3', title: 'C' },
          ],
        }),
      ).not.toThrow()
    })

    test('maps interactive list', () => {
      const result = mapOutboundToCloudApi({
        type: 'interactive.list',
        to: TEST_DATA.phone.primary,
        body: 'Browse:',
        buttonText: 'View',
        sections: [
          {
            title: 'Section 1',
            rows: [{ id: 'item1', title: 'Item 1' }],
          },
        ],
      })

      expect(result['type']).toBe('interactive')
      const interactive = result['interactive'] as Record<string, unknown>
      expect(interactive['type']).toBe('list')
    })

    test('throws ValidationError when sections exceed 10', () => {
      const sections = Array.from({ length: 11 }, (_, i) => ({
        title: `Section ${i}`,
        rows: [{ id: `item${i}`, title: `Item ${i}` }],
      }))

      expect(() =>
        mapOutboundToCloudApi({
          type: 'interactive.list',
          to: TEST_DATA.phone.primary,
          body: 'Browse:',
          buttonText: 'View',
          sections,
        }),
      ).toThrow(ValidationError)
    })
  })

  describe('phone normalization', () => {
    test('strips + prefix and formatting from phone in payload', () => {
      const result = mapOutboundToCloudApi({
        type: 'text',
        to: '+966 50-123-4567',
        text: { body: 'test' },
      })

      expect(result['to']).toBe(TEST_DATA.phone.primaryNormalized)
    })
  })
})
