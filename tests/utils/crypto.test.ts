import { describe, test, expect } from 'bun:test'
import { timingSafeEqual, verifyHmacSha256 } from '../../src/utils/crypto.js'

async function hmacHex(body: string, secret: string): Promise<string> {
  const encoder = new TextEncoder()
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const sig = await crypto.subtle.sign('HMAC', key, encoder.encode(body))
  return Array.from(new Uint8Array(sig))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('')
}

describe('verifyHmacSha256', () => {
  const secret = 'test-secret-key-32-chars-minimum'
  const body = '{"entry":[{"id":"123"}]}'

  test('verifies a valid signature', async () => {
    // Pre-compute a known-good HMAC SHA-256 for this body+secret
    const encoder = new TextEncoder()
    const key = await crypto.subtle.importKey(
      'raw',
      encoder.encode(secret),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign'],
    )
    const sig = await crypto.subtle.sign('HMAC', key, encoder.encode(body))
    const hex = Array.from(new Uint8Array(sig))
      .map(b => b.toString(16).padStart(2, '0'))
      .join('')

    expect(await verifyHmacSha256(body, hex, secret)).toBe(true)
  })

  test('verifies signature with sha256= prefix', async () => {
    const encoder = new TextEncoder()
    const key = await crypto.subtle.importKey(
      'raw',
      encoder.encode(secret),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign'],
    )
    const sig = await crypto.subtle.sign('HMAC', key, encoder.encode(body))
    const hex = Array.from(new Uint8Array(sig))
      .map(b => b.toString(16).padStart(2, '0'))
      .join('')

    expect(await verifyHmacSha256(body, `sha256=${hex}`, secret)).toBe(true)
  })

  test('rejects an invalid signature', async () => {
    expect(await verifyHmacSha256(body, 'invalid-signature', secret)).toBe(false)
  })

  test('rejects when body is different', async () => {
    const encoder = new TextEncoder()
    const key = await crypto.subtle.importKey(
      'raw',
      encoder.encode(secret),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign'],
    )
    const sig = await crypto.subtle.sign('HMAC', key, encoder.encode(body))
    const hex = Array.from(new Uint8Array(sig))
      .map(b => b.toString(16).padStart(2, '0'))
      .join('')

    // Different body should fail
    expect(await verifyHmacSha256('different-body', hex, secret)).toBe(false)
  })

  test('rejects signatures of different lengths', async () => {
    expect(await verifyHmacSha256(body, 'abc', secret)).toBe(false)
    expect(await verifyHmacSha256(body, '', secret)).toBe(false)
  })

  test('verifies an uppercase hex signature', async () => {
    const hex = await hmacHex(body, secret)
    expect(await verifyHmacSha256(body, hex.toUpperCase(), secret)).toBe(true)
  })

  test('verifies sha256= prefix with uppercase hex', async () => {
    const hex = await hmacHex(body, secret)
    expect(await verifyHmacSha256(body, `sha256=${hex.toUpperCase()}`, secret)).toBe(
      true,
    )
  })

  test('verifies SHA256= prefix', async () => {
    const hex = await hmacHex(body, secret)
    expect(await verifyHmacSha256(body, `SHA256=${hex}`, secret)).toBe(true)
  })

  test('rejects a 64-char non-hex signature', async () => {
    expect(await verifyHmacSha256(body, 'g'.repeat(64), secret)).toBe(false)
  })
})

describe('timingSafeEqual', () => {
  test('equal strings pass and unequal fail', () => {
    expect(timingSafeEqual('abc', 'abc')).toBe(true)
    expect(timingSafeEqual('', '')).toBe(true)
    expect(timingSafeEqual('abc', 'abd')).toBe(false)
    expect(timingSafeEqual('abc', 'ab')).toBe(false)
    expect(timingSafeEqual('', 'a')).toBe(false)
  })
})
