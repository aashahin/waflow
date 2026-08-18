import { describe, test, expect } from 'bun:test'
import {
  extractGraphError,
  parseRetryAfter,
  throwForHttpError,
} from '../../src/core/http-error.js'
import {
  AuthenticationError,
  ProviderError,
  RateLimitError,
  ValidationError,
} from '../../src/core/errors.js'

describe('extractGraphError', () => {
  test('reads Meta error envelope', () => {
    expect(
      extractGraphError({
        error: { code: 190, message: 'expired', type: 'OAuthException' },
      }),
    ).toEqual({ code: 190, message: 'expired', type: 'OAuthException' })
    expect(
      extractGraphError({
        error: { code: '190', message: 'expired' },
      }),
    ).toEqual({ code: 190, message: 'expired', type: undefined })
  })

  test('returns undefined for non-graph bodies', () => {
    expect(extractGraphError({ info: 'nope' })).toBeUndefined()
    expect(extractGraphError(null)).toBeUndefined()
  })
})

describe('parseRetryAfter', () => {
  test('parses integer seconds', () => {
    expect(parseRetryAfter('12')).toBe(12)
  })

  test('parses HTTP-date', () => {
    const future = new Date(Date.now() + 60_000).toUTCString()
    const parsed = parseRetryAfter(future)
    expect(parsed).toBeGreaterThanOrEqual(59)
    expect(parsed).toBeLessThanOrEqual(61)
  })

  test('returns undefined for garbage', () => {
    expect(parseRetryAfter(null)).toBeUndefined()
    expect(parseRetryAfter('soon')).toBeUndefined()
  })
})

describe('throwForHttpError', () => {
  test('maps Graph 190 on HTTP 400 to AuthenticationError', () => {
    expect(() =>
      throwForHttpError({
        status: 400,
        method: 'POST',
        path: '/messages',
        provider: 'cloud-api',
        raw: { error: { code: 190, message: 'Access token has expired' } },
        retryAfterHeader: null,
      }),
    ).toThrow(AuthenticationError)
  })

  test('maps Graph 130429 on HTTP 400 to RateLimitError', () => {
    try {
      throwForHttpError({
        status: 400,
        method: 'POST',
        path: '/messages',
        provider: 'cloud-api',
        raw: { error: { code: 130429, message: 'Rate limit hit' } },
        retryAfterHeader: '8',
      })
      throw new Error('expected throw')
    } catch (error) {
      expect(error).toBeInstanceOf(RateLimitError)
      expect((error as RateLimitError).retryAfter).toBe(8)
      expect((error as RateLimitError).message).toContain('#130429')
    }
  })

  test('maps WhatsApp 131047 to ProviderError, not ValidationError', () => {
    expect(() =>
      throwForHttpError({
        status: 400,
        method: 'POST',
        path: '/messages',
        provider: 'cloud-api',
        raw: { error: { code: 131047, message: 'Re-engagement message' } },
        retryAfterHeader: null,
      }),
    ).toThrow(ProviderError)
  })

  test('keeps generic HTTP 400 as ValidationError', () => {
    expect(() =>
      throwForHttpError({
        status: 400,
        method: 'POST',
        path: '/messages',
        provider: 'cloud-api',
        raw: { error: { message: 'Invalid parameter', code: 100 } },
        retryAfterHeader: null,
      }),
    ).toThrow(ValidationError)
  })
})
