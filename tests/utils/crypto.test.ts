import { describe, test, expect } from 'bun:test'
import { verifyHmacSha256 } from '../../src/utils/crypto.js'

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
})
