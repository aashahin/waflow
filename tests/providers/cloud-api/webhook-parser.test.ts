import { describe, test, expect } from 'bun:test'
import { parseCloudApiWebhook } from '../../../src/providers/cloud-api/webhook-parser.js'
import { TEST_DATA } from '../../constants.js'

describe('parseCloudApiWebhook', () => {
  test('returns empty array for non-object input', () => {
    expect(parseCloudApiWebhook(null)).toEqual([])
    expect(parseCloudApiWebhook(undefined)).toEqual([])
    expect(parseCloudApiWebhook('string')).toEqual([])
    expect(parseCloudApiWebhook(42)).toEqual([])
  })

  test('returns empty array for payload with no entries', () => {
    expect(parseCloudApiWebhook({})).toEqual([])
    expect(parseCloudApiWebhook({ object: 'whatsapp_business_account' })).toEqual([])
  })

  test('parses incoming text message', () => {
    const payload = {
      object: 'whatsapp_business_account',
      entry: [
        {
          id: '123456',
          changes: [
            {
              value: {
                messaging_product: 'whatsapp',
                metadata: {
                  display_phone_number: TEST_DATA.phone.primary,
                  phone_number_id: TEST_DATA.config.cloudApi.phoneNumberId,
                },
                contacts: [
                  { profile: { name: 'Ahmad' }, wa_id: TEST_DATA.phone.primaryNormalized },
                ],
                messages: [
                  {
                    id: TEST_DATA.messageId.abc123,
                    from: TEST_DATA.phone.primaryNormalized,
                    timestamp: '1700000000',
                    type: 'text',
                    text: { body: 'Hello!' },
                  },
                ],
              },
              field: 'messages',
            },
          ],
        },
      ],
    }

    const events = parseCloudApiWebhook(payload, 'cloud-api')

    expect(events).toHaveLength(1)
    expect(events[0]?.type).toBe('message')
    if (events[0]?.type === 'message') {
      expect(events[0].messageId).toBe(TEST_DATA.messageId.abc123)
      expect(events[0].from).toBe(TEST_DATA.phone.primaryNormalized)
      expect(events[0].message.type).toBe('text')
      if (events[0].message.type === 'text') {
        expect(events[0].message.body).toBe('Hello!')
      }
      expect(events[0].contact?.name).toBe('Ahmad')
    }
  })

  test('parses incoming image message', () => {
    const payload = {
      object: 'whatsapp_business_account',
      entry: [
        {
          id: '123456',
          changes: [
            {
              value: {
                messaging_product: 'whatsapp',
                metadata: {
                  display_phone_number: TEST_DATA.phone.primary,
                  phone_number_id: TEST_DATA.config.cloudApi.phoneNumberId,
                },
                messages: [
                  {
                    id: TEST_DATA.messageId.img,
                    from: TEST_DATA.phone.primaryNormalized,
                    timestamp: '1700000000',
                    type: 'image',
                    image: {
                      id: TEST_DATA.mediaId.media456,
                      mime_type: 'image/jpeg',
                      sha256: 'abc',
                      caption: 'A photo',
                    },
                  },
                ],
              },
              field: 'messages',
            },
          ],
        },
      ],
    }

    const events = parseCloudApiWebhook(payload, 'cloud-api')

    expect(events).toHaveLength(1)
    if (events[0]?.type === 'message') {
      expect(events[0].message.type).toBe('image')
      if (events[0].message.type === 'image') {
        expect(events[0].message.mediaId).toBe(TEST_DATA.mediaId.media456)
        expect(events[0].message.mimeType).toBe('image/jpeg')
        expect(events[0].message.caption).toBe('A photo')
      }
    }
  })

  test('parses status updates', () => {
    const payload = {
      object: 'whatsapp_business_account',
      entry: [
        {
          id: '123456',
          changes: [
            {
              value: {
                messaging_product: 'whatsapp',
                metadata: {
                  display_phone_number: TEST_DATA.phone.primary,
                  phone_number_id: TEST_DATA.config.cloudApi.phoneNumberId,
                },
                statuses: [
                  {
                    id: TEST_DATA.messageId.status,
                    status: 'delivered',
                    timestamp: '1700000000',
                    recipient_id: TEST_DATA.phone.tertiary,
                  },
                ],
              },
              field: 'messages',
            },
          ],
        },
      ],
    }

    const events = parseCloudApiWebhook(payload, 'cloud-api')

    expect(events).toHaveLength(1)
    expect(events[0]?.type).toBe('status')
    if (events[0]?.type === 'status') {
      expect(events[0].messageId).toBe(TEST_DATA.messageId.status)
      expect(events[0].status).toBe('delivered')
      expect(events[0].recipientId).toBe(TEST_DATA.phone.tertiary)
    }
  })

  test('parses error events', () => {
    const payload = {
      object: 'whatsapp_business_account',
      entry: [
        {
          id: '123456',
          changes: [
            {
              value: {
                messaging_product: 'whatsapp',
                metadata: {
                  display_phone_number: TEST_DATA.phone.primary,
                  phone_number_id: TEST_DATA.config.cloudApi.phoneNumberId,
                },
                statuses: [
                  {
                    id: TEST_DATA.messageId.error,
                    status: 'failed',
                    timestamp: '1700000000',
                    recipient_id: TEST_DATA.phone.tertiary,
                    errors: [
                      {
                        code: 131047,
                        title: 'Message failed to send',
                        message: 'Re-engagement message',
                      },
                    ],
                  },
                ],
              },
              field: 'messages',
            },
          ],
        },
      ],
    }

    const events = parseCloudApiWebhook(payload, 'cloud-api')

    expect(events).toHaveLength(1)
    const statusEvent = events[0]
    expect(statusEvent?.type).toBe('status')
    if (statusEvent?.type === 'status') {
      expect(statusEvent.status).toBe('failed')
      expect(statusEvent.errors).toBeDefined()
      expect(statusEvent.errors![0].code).toBe(131047)
      expect(statusEvent.errors![0].message).toBe('Re-engagement message')
    }
  })

  test('parses top-level error events', () => {
    const payload = {
      object: 'whatsapp_business_account',
      entry: [
        {
          id: '123456',
          changes: [
            {
              value: {
                messaging_product: 'whatsapp',
                metadata: {
                  display_phone_number: TEST_DATA.phone.primary,
                  phone_number_id: TEST_DATA.config.cloudApi.phoneNumberId,
                },
                errors: [
                  {
                    code: 131047,
                    title: 'Message failed to send',
                    message: 'Re-engagement message',
                  },
                ],
              },
              field: 'messages',
            },
          ],
        },
      ],
    }

    const events = parseCloudApiWebhook(payload, 'cloud-api')

    expect(events).toHaveLength(1)
    const errorEvent = events[0]
    expect(errorEvent?.type).toBe('error')
    if (errorEvent?.type === 'error') {
      expect(errorEvent.code).toBe(131047)
      expect(errorEvent.title).toBe('Message failed to send')
      expect(errorEvent.message).toBe('Re-engagement message')
    }
  })
  test('includes metadata with provider name', () => {
    const payload = {
      object: 'whatsapp_business_account',
      entry: [
        {
          id: '123',
          changes: [
            {
              value: {
                messaging_product: 'whatsapp',
                metadata: { display_phone_number: TEST_DATA.phone.minimal, phone_number_id: TEST_DATA.config.cloudApi.phoneNumberId },
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

    const events = parseCloudApiWebhook(payload, '360dialog')
    expect(events[0]?.metadata.provider).toBe('360dialog')
  })
})
