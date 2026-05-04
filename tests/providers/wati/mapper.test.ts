import { describe, test, expect } from 'bun:test'
import { mapOutboundToWati } from '../../../src/providers/wati/mapper.js'
import { UnsupportedFeatureError } from '../../../src/core/errors.js'
import { TEST_DATA } from '../../constants.js'

describe('mapOutboundToWati', () => {
  describe('text messages', () => {
    test('maps text to sendSessionMessage endpoint', () => {
      const result = mapOutboundToWati({
        type: 'text',
        to: TEST_DATA.phone.primary,
        text: { body: 'Hello!' },
      })

      expect(result.method).toBe('POST')
      expect(result.path).toBe(`/api/v1/sendSessionMessage/${TEST_DATA.phone.primaryNormalized}`)
      expect(result.body).toEqual({ messageText: 'Hello!' })
    })
  })

  describe('template messages', () => {
    test('maps template to sendTemplateMessage endpoint', () => {
      const result = mapOutboundToWati({
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

      expect(result.method).toBe('POST')
      expect(result.path).toBe('/api/v2/sendTemplateMessage')
      expect(result.query).toEqual({ whatsappNumber: TEST_DATA.phone.primaryNormalized })
      expect(result.body?.['template_name']).toBe('order_confirm')
      expect(result.body?.['parameters']).toEqual([
        { name: '1', value: 'ORD-1' },
      ])
    })

    test('flattens multiple template body parameters', () => {
      const result = mapOutboundToWati({
        type: 'template',
        to: TEST_DATA.phone.primary,
        template: {
          name: 'test',
          language: 'en',
          components: [
            {
              type: 'body',
              parameters: [
                { type: 'text', text: 'first' },
                { type: 'text', text: 'second' },
              ],
            },
          ],
        },
      })

      expect(result.body?.['parameters']).toEqual([
        { name: '1', value: 'first' },
        { name: '2', value: 'second' },
      ])
    })

    test('preserves explicit Wati parameter names when provided', () => {
      const result = mapOutboundToWati({
        type: 'template',
        to: TEST_DATA.phone.primary,
        template: {
          name: 'named_params',
          language: 'en',
          components: [
            {
              type: 'body',
              parameters: [
                { type: 'text', text: 'Ahmed', name: 'name' },
                { type: 'text', text: 'ORD-1', name: 'order_id' },
              ],
            },
          ],
        },
      })

      expect(result.body?.['parameters']).toEqual([
        { name: 'name', value: 'Ahmed' },
        { name: 'order_id', value: 'ORD-1' },
      ])
    })

    test('ignores non-body components', () => {
      const result = mapOutboundToWati({
        type: 'template',
        to: TEST_DATA.phone.primary,
        template: {
          name: 'test',
          language: 'en',
          components: [
            { type: 'header', parameters: [{ type: 'text', text: 'header-val' }] },
            { type: 'body', parameters: [{ type: 'text', text: 'body-val' }] },
          ],
        },
      })

      // Only body parameters should be flattened
      expect(result.body?.['parameters']).toEqual([
        { name: '1', value: 'body-val' },
      ])
    })
  })

  describe('media messages', () => {
    test('maps image with URL to sendSessionFile', () => {
      const result = mapOutboundToWati({
        type: 'image',
        to: TEST_DATA.phone.primary,
        image: { url: 'https://example.com/img.jpg', caption: 'Photo' },
      })

      expect(result.path).toBe(`/api/v1/sendSessionFile/${TEST_DATA.phone.primaryNormalized}`)
      expect(result.body?.['url']).toBe('https://example.com/img.jpg')
      expect(result.body?.['caption']).toBe('Photo')
    })

    test('throws UnsupportedFeatureError for image with ID', () => {
      expect(() =>
        mapOutboundToWati({
          type: 'image',
          to: TEST_DATA.phone.primary,
          image: { id: TEST_DATA.mediaId.media123 },
        }),
      ).toThrow(UnsupportedFeatureError)
    })

    test('maps video with URL', () => {
      const result = mapOutboundToWati({
        type: 'video',
        to: TEST_DATA.phone.primary,
        video: { url: 'https://example.com/vid.mp4', caption: 'Video' },
      })

      expect(result.body?.['url']).toBe('https://example.com/vid.mp4')
    })

    test('throws for video with ID', () => {
      expect(() =>
        mapOutboundToWati({
          type: 'video',
          to: TEST_DATA.phone.primary,
          video: { id: TEST_DATA.mediaId.media123 },
        }),
      ).toThrow(UnsupportedFeatureError)
    })

    test('maps audio with URL', () => {
      const result = mapOutboundToWati({
        type: 'audio',
        to: TEST_DATA.phone.primary,
        audio: { url: 'https://example.com/audio.ogg' },
      })

      expect(result.body?.['url']).toBe('https://example.com/audio.ogg')
    })

    test('maps document with URL, caption, and filename', () => {
      const result = mapOutboundToWati({
        type: 'document',
        to: TEST_DATA.phone.primary,
        document: {
          url: 'https://example.com/doc.pdf',
          caption: 'Invoice',
          filename: 'invoice.pdf',
        },
      })

      expect(result.body?.['url']).toBe('https://example.com/doc.pdf')
      expect(result.body?.['caption']).toBe('Invoice')
      expect(result.body?.['filename']).toBe('invoice.pdf')
    })
  })

  describe('unsupported message types', () => {
    test('throws for sticker', () => {
      expect(() =>
        mapOutboundToWati({
          type: 'sticker',
          to: TEST_DATA.phone.primary,
          sticker: { url: 'https://example.com/sticker.webp' },
        }),
      ).toThrow(UnsupportedFeatureError)
    })

    test('throws for location', () => {
      expect(() =>
        mapOutboundToWati({
          type: 'location',
          to: TEST_DATA.phone.primary,
          location: { latitude: 0, longitude: 0 },
        }),
      ).toThrow(UnsupportedFeatureError)
    })

    test('throws for reaction', () => {
      expect(() =>
        mapOutboundToWati({
          type: 'reaction',
          to: TEST_DATA.phone.primary,
          reaction: { messageId: TEST_DATA.messageId.abc, emoji: '👍' },
        }),
      ).toThrow(UnsupportedFeatureError)
    })

    test('throws for interactive.button', () => {
      expect(() =>
        mapOutboundToWati({
          type: 'interactive.button',
          to: TEST_DATA.phone.primary,
          body: 'Choose:',
          buttons: [{ id: 'a', title: 'A' }],
        }),
      ).toThrow(UnsupportedFeatureError)
    })

    test('throws for interactive.list', () => {
      expect(() =>
        mapOutboundToWati({
          type: 'interactive.list',
          to: TEST_DATA.phone.primary,
          body: 'Browse:',
          buttonText: 'View',
          sections: [{ title: 'S', rows: [{ id: 'r', title: 'R' }] }],
        }),
      ).toThrow(UnsupportedFeatureError)
    })
  })
})
