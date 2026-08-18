import { describe, test, expect } from 'bun:test'
import {
  assertSafeFetchUrl,
  isPrivateHostname,
  isTrustedMediaHost,
} from '../../src/core/url-guard.js'
import { ValidationError } from '../../src/core/errors.js'

describe('isTrustedMediaHost', () => {
  test('trusts same origin as the API base', () => {
    expect(
      isTrustedMediaHost(
        'https://waba-v2.360dialog.io/media/1',
        'https://waba-v2.360dialog.io',
      ),
    ).toBe(true)
  })

  test('trusts Meta media CDNs', () => {
    expect(
      isTrustedMediaHost(
        'https://lookaside.fbsbx.com/whatsapp_business/attachments/?mid=1',
        'https://graph.facebook.com/v25.0',
      ),
    ).toBe(true)
  })

  test('rejects arbitrary hosts', () => {
    expect(
      isTrustedMediaHost('https://evil.example/steal', 'https://graph.facebook.com/v25.0'),
    ).toBe(false)
  })
})

describe('isPrivateHostname / assertSafeFetchUrl', () => {
  test('flags loopback, RFC1918, and link-local', () => {
    expect(isPrivateHostname('127.0.0.1')).toBe(true)
    expect(isPrivateHostname('10.0.0.5')).toBe(true)
    expect(isPrivateHostname('192.168.1.1')).toBe(true)
    expect(isPrivateHostname('172.16.0.1')).toBe(true)
    expect(isPrivateHostname('169.254.169.254')).toBe(true)
    expect(isPrivateHostname('localhost')).toBe(true)
    expect(isPrivateHostname('::1')).toBe(true)
    expect(isPrivateHostname('::ffff:127.0.0.1')).toBe(true)
    expect(isPrivateHostname('lookaside.fbsbx.com')).toBe(false)
    expect(isPrivateHostname('fcbarcelona.com')).toBe(false)
  })

  test('refuses private URLs', () => {
    expect(() => assertSafeFetchUrl('http://127.0.0.1/latest', 'cloud-api')).toThrow(
      ValidationError,
    )
  })
})
