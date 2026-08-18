import { describe, test, expect } from 'bun:test'
import {
  assertSafeFetchUrl,
  isPrivateHostname,
  isTrustedMediaHost,
  makeRequestSignal,
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

  test('does not trust graph.facebook.com even as same origin', () => {
    expect(
      isTrustedMediaHost(
        'https://graph.facebook.com/v25.0/123',
        'https://graph.facebook.com/v25.0',
        'cloud-api',
      ),
    ).toBe(false)
    expect(
      isTrustedMediaHost(
        'https://graph.whatsapp.com/v25.0/123',
        'https://graph.whatsapp.com/v25.0',
        'cloud-api',
      ),
    ).toBe(false)
  })

  test('cloud-api trusts Meta CDNs but not 360dialog hosts', () => {
    expect(
      isTrustedMediaHost(
        'https://scontent.xx.fbcdn.net/v/t1.jpg',
        'https://graph.facebook.com/v25.0',
        'cloud-api',
      ),
    ).toBe(true)
    expect(
      isTrustedMediaHost(
        'https://waba-v2.360dialog.io/media/1',
        'https://graph.facebook.com/v25.0',
        'cloud-api',
      ),
    ).toBe(false)
  })

  test('360dialog trusts only 360dialog hosts, not Meta CDNs', () => {
    expect(
      isTrustedMediaHost(
        'https://waba-v2.360dialog.io/media/1',
        'https://waba-v2.360dialog.io',
        '360dialog',
      ),
    ).toBe(true)
    expect(
      isTrustedMediaHost(
        'https://media.360dialog.com/file',
        'https://waba.360dialog.io',
        '360dialog',
      ),
    ).toBe(true)
    expect(
      isTrustedMediaHost(
        'https://lookaside.fbsbx.com/whatsapp_business/attachments/?mid=1',
        'https://waba-v2.360dialog.io',
        '360dialog',
      ),
    ).toBe(false)
  })

  test('wati trusts only same origin', () => {
    expect(
      isTrustedMediaHost(
        'https://live-server.wati.io/media/1',
        'https://live-server.wati.io',
        'wati',
      ),
    ).toBe(true)
    expect(
      isTrustedMediaHost(
        'https://lookaside.fbsbx.com/whatsapp_business/attachments/?mid=1',
        'https://live-server.wati.io',
        'wati',
      ),
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

  test('flags expanded IPv6 loopback and unspecified', () => {
    expect(isPrivateHostname('0:0:0:0:0:0:0:1')).toBe(true)
    expect(isPrivateHostname('0000:0000:0000:0000:0000:0000:0000:0001')).toBe(true)
    expect(isPrivateHostname('::')).toBe(true)
    expect(isPrivateHostname('[::1]')).toBe(true)
  })

  test('flags IPv4-mapped IPv6 hex', () => {
    expect(isPrivateHostname('::ffff:7f00:1')).toBe(true)
    expect(isPrivateHostname('0:0:0:0:0:ffff:7f00:1')).toBe(true)
    expect(isPrivateHostname('::ffff:a00:1')).toBe(true)
    expect(isPrivateHostname('::ffff:808:808')).toBe(false)
  })

  test('flags decimal IPv4 hostnames', () => {
    expect(isPrivateHostname('2130706433')).toBe(true)
    expect(isPrivateHostname('3232235777')).toBe(true)
    expect(isPrivateHostname('134744072')).toBe(false)
  })

  test('flags IPv4 with leading zeros as unsafe', () => {
    expect(isPrivateHostname('0177.0.0.1')).toBe(true)
    expect(isPrivateHostname('01.2.3.4')).toBe(true)
  })

  test('flags localhost suffixes, unspecified IPv4, and IPv6 ULA/link-local', () => {
    expect(isPrivateHostname('foo.localhost')).toBe(true)
    expect(isPrivateHostname('printer.local')).toBe(true)
    expect(isPrivateHostname('svc.internal')).toBe(true)
    expect(isPrivateHostname('0.0.0.0')).toBe(true)
    expect(isPrivateHostname('fe80::1')).toBe(true)
    expect(isPrivateHostname('fc00::1')).toBe(true)
    expect(isPrivateHostname('fd12:3456::1')).toBe(true)
    expect(isPrivateHostname('172.32.0.1')).toBe(false)
  })

  test('refuses private URLs', () => {
    expect(() => assertSafeFetchUrl('http://127.0.0.1/latest', 'cloud-api')).toThrow(
      ValidationError,
    )
    expect(() => assertSafeFetchUrl('http://2130706433/latest', 'cloud-api')).toThrow(
      ValidationError,
    )
    expect(() => assertSafeFetchUrl('http://[::1]/latest', 'cloud-api')).toThrow(
      ValidationError,
    )
    expect(() => assertSafeFetchUrl('http://[::ffff:7f00:1]/latest', 'cloud-api')).toThrow(
      ValidationError,
    )
  })

  test('refuses non-HTTP schemes and invalid URLs', () => {
    expect(() => assertSafeFetchUrl('file:///etc/passwd', 'cloud-api')).toThrow(ValidationError)
    expect(() => assertSafeFetchUrl('not a url', 'cloud-api')).toThrow(ValidationError)
  })
})

describe('makeRequestSignal', () => {
  test('timeout <= 0 with a user signal returns that signal', () => {
    const user = new AbortController()
    const { signal, cleanup } = makeRequestSignal(0, user.signal)
    expect(signal).toBe(user.signal)
    expect(signal.aborted).toBe(false)
    cleanup()
  })

  test('timeout <= 0 without a user signal never aborts', async () => {
    const { signal, cleanup } = makeRequestSignal(0)
    expect(signal.aborted).toBe(false)
    await new Promise(r => setTimeout(r, 20))
    expect(signal.aborted).toBe(false)
    cleanup()
  })

  test('cleanup prevents the timeout from firing', async () => {
    const { signal, cleanup } = makeRequestSignal(30)
    cleanup()
    await new Promise(r => setTimeout(r, 50))
    expect(signal.aborted).toBe(false)
  })

  test('timeout aborts the signal', async () => {
    const { signal, cleanup } = makeRequestSignal(20)
    await new Promise(r => setTimeout(r, 50))
    expect(signal.aborted).toBe(true)
    cleanup()
  })

  test('user abort is reflected on the combined signal', () => {
    const user = new AbortController()
    const { signal, cleanup } = makeRequestSignal(10_000, user.signal)
    user.abort()
    expect(signal.aborted).toBe(true)
    cleanup()
  })
})
