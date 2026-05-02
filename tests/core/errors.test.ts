import { describe, test, expect } from 'bun:test'
import {
  WhatsAppError,
  AuthenticationError,
  RateLimitError,
  ValidationError,
  MediaError,
  TemplateError,
  ProviderError,
  UnsupportedFeatureError,
  NetworkError,
  TimeoutError,
  WebhookVerificationError,
} from '../../src/core/errors.js'

describe('WhatsAppError', () => {
  test('creates error with all properties', () => {
    const error = new WhatsAppError({
      code: 'PROVIDER_ERROR',
      message: 'Something went wrong',
      provider: 'cloud-api',
      statusCode: 500,
      raw: { detail: 'internal' },
    })

    expect(error).toBeInstanceOf(Error)
    expect(error).toBeInstanceOf(WhatsAppError)
    expect(error.name).toBe('WhatsAppError')
    expect(error.message).toBe('Something went wrong')
    expect(error.code).toBe('PROVIDER_ERROR')
    expect(error.provider).toBe('cloud-api')
    expect(error.statusCode).toBe(500)
    expect(error.raw).toEqual({ detail: 'internal' })
  })

  test('defaults provider to "unknown"', () => {
    const error = new WhatsAppError({ code: 'PROVIDER_ERROR', message: 'test' })
    expect(error.provider).toBe('unknown')
  })

  test('preserves cause chain', () => {
    const cause = new Error('original')
    const error = new WhatsAppError({
      code: 'NETWORK_ERROR',
      message: 'wrapper',
      cause,
    })
    expect(error.cause).toBe(cause)
  })
})

describe('Error subclasses', () => {
  test('AuthenticationError has correct code and name', () => {
    const error = new AuthenticationError({ message: 'bad token', provider: 'cloud-api' })
    expect(error.code).toBe('AUTH_FAILED')
    expect(error.name).toBe('AuthenticationError')
    expect(error).toBeInstanceOf(WhatsAppError)
  })

  test('RateLimitError includes retryAfter', () => {
    const error = new RateLimitError({
      message: 'rate limited',
      provider: 'cloud-api',
      retryAfter: 30,
    })
    expect(error.code).toBe('RATE_LIMITED')
    expect(error.retryAfter).toBe(30)
  })

  test('RateLimitError retryAfter defaults to undefined', () => {
    const error = new RateLimitError({ message: 'rate limited', provider: 'cloud-api' })
    expect(error.retryAfter).toBeUndefined()
  })

  test('ValidationError has correct code', () => {
    const error = new ValidationError({ message: 'invalid', provider: 'cloud-api' })
    expect(error.code).toBe('VALIDATION_FAILED')
    expect(error.name).toBe('ValidationError')
  })

  test('MediaError has correct code', () => {
    const error = new MediaError({ message: 'upload failed', provider: 'wati' })
    expect(error.code).toBe('MEDIA_ERROR')
  })

  test('TemplateError has correct code', () => {
    const error = new TemplateError({ message: 'not found', provider: 'cloud-api' })
    expect(error.code).toBe('TEMPLATE_ERROR')
  })

  test('UnsupportedFeatureError has correct code', () => {
    const error = new UnsupportedFeatureError({ message: 'no support', provider: 'wati' })
    expect(error.code).toBe('UNSUPPORTED_FEATURE')
  })

  test('NetworkError has correct code', () => {
    const error = new NetworkError({ message: 'offline' })
    expect(error.code).toBe('NETWORK_ERROR')
  })

  test('TimeoutError has correct code', () => {
    const error = new TimeoutError({ message: 'timed out' })
    expect(error.code).toBe('TIMEOUT')
  })

  test('WebhookVerificationError has correct code', () => {
    const error = new WebhookVerificationError({ message: 'bad sig' })
    expect(error.code).toBe('WEBHOOK_VERIFICATION_FAILED')
  })

  test('ProviderError has correct code', () => {
    const error = new ProviderError({ message: 'api error', statusCode: 503 })
    expect(error.code).toBe('PROVIDER_ERROR')
    expect(error.statusCode).toBe(503)
  })

  test('all subclasses are instanceof WhatsAppError', () => {
    const errors = [
      new AuthenticationError({ message: '' }),
      new RateLimitError({ message: '' }),
      new ValidationError({ message: '' }),
      new MediaError({ message: '' }),
      new TemplateError({ message: '' }),
      new ProviderError({ message: '' }),
      new UnsupportedFeatureError({ message: '' }),
      new NetworkError({ message: '' }),
      new TimeoutError({ message: '' }),
      new WebhookVerificationError({ message: '' }),
    ]

    for (const error of errors) {
      expect(error).toBeInstanceOf(WhatsAppError)
      expect(error).toBeInstanceOf(Error)
    }
  })
})
