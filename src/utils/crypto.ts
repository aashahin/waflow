// ---------------------------------------------------------------------------
// Web Crypto API helpers — no node:crypto imports
// ---------------------------------------------------------------------------

/**
 * Compute HMAC SHA-256 and compare with a signature string.
 * Uses the Web Crypto API (crypto.subtle) for Cloudflare Workers compatibility.
 *
 * @param body - The raw request body string
 * @param signature - The signature to verify (with or without "sha256=" prefix)
 * @param secret - The shared secret key
 * @returns true if signatures match
 */
export async function verifyHmacSha256(
  body: string,
  signature: string,
  secret: string,
): Promise<boolean> {
  const encoder = new TextEncoder()

  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )

  const sig = await crypto.subtle.sign('HMAC', key, encoder.encode(body))
  const computed = arrayBufferToHex(sig)

  // Strip "sha256=" prefix if present
  const expected = signature.startsWith('sha256=')
    ? signature.slice(7)
    : signature

  return timingSafeEqual(computed, expected)
}

/** Precomputed byte → 2-char hex lookup (avoids per-byte toString/padStart) */
const HEX_TABLE: readonly string[] = Array.from({ length: 256 }, (_, i) =>
  i.toString(16).padStart(2, '0'),
)

/** Convert an ArrayBuffer to a lowercase hex string. Runs on every webhook
 *  signature verification, so it uses a lookup table and a single join. */
function arrayBufferToHex(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer)
  const out = new Array<string>(bytes.length)
  for (let i = 0; i < bytes.length; i++) {
    out[i] = HEX_TABLE[bytes[i] ?? 0] as string
  }
  return out.join('')
}

/**
 * Constant-time string comparison to prevent timing attacks.
 * Compares both length and content without early exit to avoid
 * leaking information through timing side-channels.
 *
 * Uses charCodeAt (not codePointAt) since we only compare ASCII hex digests.
 * charCodeAt returns NaN for out-of-bounds, which becomes 0 via bitwise OR.
 */
function timingSafeEqual(a: string, b: string): boolean {
  const maxLen = Math.max(a.length, b.length)
  // XOR lengths — non-zero if different, contributing to final result
  let result = a.length ^ b.length
  for (let i = 0; i < maxLen; i++) {
    result |= (a.charCodeAt(i) | 0) ^ (b.charCodeAt(i) | 0)
  }
  return result === 0
}
