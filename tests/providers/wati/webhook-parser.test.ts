import { describe, test, expect } from 'bun:test'
import { parseWatiWebhook } from '../../../src/providers/wati/webhook-parser.js'
import { TEST_DATA } from '../../constants.js'

describe('parseWatiWebhook', () => {
  test('returns empty array for non-object input', () => {
    expect(parseWatiWebhook(null)).toEqual([])
    expect(parseWatiWebhook(undefined)).toEqual([])
    expect(parseWatiWebhook('string')).toEqual([])
    expect(parseWatiWebhook(42)).toEqual([])
    expect(parseWatiWebhook([])).toEqual([])
  })

  test('returns empty array for empty object', () => {
    expect(parseWatiWebhook({})).toEqual([])
  })

  describe('message events', () => {
    test('parses text message with eventType', () => {
      const events = parseWatiWebhook({
        eventType: 'message',
        waId: TEST_DATA.phone.primaryNormalized,
        senderName: 'Ahmad',
        text: 'Hello!',
        type: 'text',
        timestamp: '2024-01-01T00:00:00Z',
        messageId: TEST_DATA.messageId.wati123,
      })

      expect(events).toHaveLength(1)
      expect(events[0]?.type).toBe('message')
      if (events[0]?.type === 'message') {
        expect(events[0].from).toBe(TEST_DATA.phone.primaryNormalized)
        expect(events[0].messageId).toBe(TEST_DATA.messageId.wati123)
        expect(events[0].message.type).toBe('text')
        if (events[0].message.type === 'text') {
          expect(events[0].message.body).toBe('Hello!')
        }
        expect(events[0].contact?.name).toBe('Ahmad')
        expect(events[0].contact?.waId).toBe(TEST_DATA.phone.primaryNormalized)
        expect(events[0].metadata.provider).toBe('wati')
      }
    })

    test('detects message from payload shape (no eventType)', () => {
      const events = parseWatiWebhook({
        waId: TEST_DATA.phone.primaryNormalized,
        text: 'Auto-detected',
        type: 'text',
      })

      expect(events).toHaveLength(1)
      expect(events[0]?.type).toBe('message')
    })

    test('parses image message', () => {
      const events = parseWatiWebhook({
        eventType: 'message',
        waId: TEST_DATA.phone.primaryNormalized,
        type: 'image',
        mediaUrl: 'https://cdn.wati.io/image.jpg',
        mimeType: 'image/jpeg',
        caption: 'A photo',
        messageId: TEST_DATA.messageId.img,
      })

      expect(events).toHaveLength(1)
      if (events[0]?.type === 'message') {
        expect(events[0].message.type).toBe('image')
        if (events[0].message.type === 'image') {
          expect(events[0].message.mediaId).toBe('https://cdn.wati.io/image.jpg')
          expect(events[0].message.mimeType).toBe('image/jpeg')
          expect(events[0].message.caption).toBe('A photo')
        }
      }
    })

    test('parses document message', () => {
      const events = parseWatiWebhook({
        eventType: 'message',
        waId: TEST_DATA.phone.primaryNormalized,
        type: 'document',
        mediaUrl: 'https://cdn.wati.io/doc.pdf',
        mimeType: 'application/pdf',
        filename: 'invoice.pdf',
        messageId: 'msg-doc',
      })

      expect(events).toHaveLength(1)

      if (events[0]?.type === 'message') {
        expect(events[0].message.type).toBe('document')
        if (events[0].message.type === 'document') {
          expect(events[0].message.filename).toBe('invoice.pdf')
        }
      }
    })

    test('parses location message', () => {
      const events = parseWatiWebhook({
        eventType: 'message',
        waId: TEST_DATA.phone.primaryNormalized,
        type: 'location',
        latitude: 24.7136,
        longitude: 46.6753,
        locationName: 'Riyadh',
        locationAddress: 'KSA',
        messageId: 'msg-loc',
      })

      expect(events).toHaveLength(1)

      if (events[0]?.type === 'message') {
        expect(events[0].message.type).toBe('location')
        if (events[0].message.type === 'location') {
          expect(events[0].message.latitude).toBe(24.7136)
          expect(events[0].message.longitude).toBe(46.6753)
          expect(events[0].message.name).toBe('Riyadh')
        }
      }
    })

    test('returns empty for message without waId', () => {
      const events = parseWatiWebhook({
        eventType: 'message',
        text: 'No sender',
        type: 'text',
      })

      expect(events).toEqual([])
    })

    test('falls back to text for unknown message type with text content', () => {
      const events = parseWatiWebhook({
        eventType: 'message',
        waId: TEST_DATA.phone.primaryNormalized,
        type: 'unknown_type',
        text: 'Fallback text',
        messageId: 'msg-fb',
      })

      expect(events).toHaveLength(1)

      if (events[0]?.type === 'message') {
        expect(events[0].message.type).toBe('text')
        if (events[0].message.type === 'text') {
          expect(events[0].message.body).toBe('Fallback text')
        }
      }
    })
  })

  describe('status events', () => {
    test('parses status update with eventType', () => {
      const events = parseWatiWebhook({
        eventType: 'status',
        statusString: 'delivered',
        localMessageId: TEST_DATA.messageId.local,
        waId: TEST_DATA.phone.primaryNormalized,
        timestamp: '2024-01-01T00:00:00Z',
      })

      expect(events).toHaveLength(1)
      expect(events[0]?.type).toBe('status')
      if (events[0]?.type === 'status') {
        expect(events[0].status).toBe('delivered')
        expect(events[0].messageId).toBe(TEST_DATA.messageId.local)
        expect(events[0].recipientId).toBe(TEST_DATA.phone.primaryNormalized)
      }
    })

    test('detects status from payload shape', () => {
      const events = parseWatiWebhook({
        statusString: 'read',
        localMessageId: 'local-456',
      })

      expect(events).toHaveLength(1)
      expect(events[0]?.type).toBe('status')
    })

    test('maps "error" statusString to "failed"', () => {
      const events = parseWatiWebhook({
        eventType: 'status',
        statusString: 'error',
        localMessageId: 'local-789',
      })

      expect(events).toHaveLength(1)

      if (events[0]?.type === 'status') {
        expect(events[0].status).toBe('failed')
      }
    })

    test('defaults to "sent" for unknown status', () => {
      const events = parseWatiWebhook({
        eventType: 'status',
        statusString: 'unknown_status',
        localMessageId: 'local-000',
      })

      expect(events).toHaveLength(1)

      if (events[0]?.type === 'status') {
        expect(events[0].status).toBe('sent')
      }
    })
  })

  describe('error events', () => {
    test('parses error event with eventType', () => {
      const events = parseWatiWebhook({
        eventType: 'error',
        errorCode: 400,
        errorMessage: 'Invalid request',
      })

      expect(events).toHaveLength(1)
      expect(events[0]?.type).toBe('error')
      if (events[0]?.type === 'error') {
        expect(events[0].code).toBe(400)
        expect(events[0].message).toBe('Invalid request')
      }
    })

    test('detects error from payload shape (errorCode present)', () => {
      const events = parseWatiWebhook({
        errorCode: 500,
        errorMessage: 'Server error',
      })

      expect(events).toHaveLength(1)
      expect(events[0]?.type).toBe('error')
    })
  })

  describe('metadata', () => {
    test('always sets provider to wati', () => {
      const events = parseWatiWebhook({
        eventType: 'message',
        waId: TEST_DATA.phone.minimal,
        type: 'text',
        text: 'hi',
      })

      expect(events[0]?.metadata.provider).toBe('wati')
    })

    test('includes raw payload in metadata', () => {
      const payload = {
        eventType: 'message',
        waId: TEST_DATA.phone.minimal,
        type: 'text',
        text: 'hi',
      }
      const events = parseWatiWebhook(payload)

      expect(events[0]?.metadata.raw).toEqual(payload)
    })
  })
})
