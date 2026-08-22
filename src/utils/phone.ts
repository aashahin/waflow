// ---------------------------------------------------------------------------
// Phone number normalization utilities
// ---------------------------------------------------------------------------

import { ValidationError } from '../core/errors.js'

/**
 * Normalize a phone number to E.164-like format for WhatsApp API calls.
 *
 * WhatsApp APIs expect numbers without the "+" prefix
 * (e.g. "966501234567" not "+966501234567").
 *
 * This function:
 * - Strips "+", spaces, dashes, parentheses, NBSP, and bidi/zero-width chars
 * - Validates that the result is digits only
 * - Returns the cleaned number
 */
// Hoisted to module scope so they aren't reallocated on every send.
// Include bidi/zero-width/nbsp so copied numbers still normalize.
const STRIP_CHARS = /[\s\-()+\u200B-\u200D\u202A-\u202E\u2060\uFEFF\u00A0]/g
const E164_DIGITS = /^\d{7,15}$/

export function normalizePhoneNumber(phone: string, provider = 'unknown'): string {
  const cleaned = phone.replace(STRIP_CHARS, '')

  if (!E164_DIGITS.test(cleaned)) {
    throw new ValidationError({
      message: `Invalid phone number: "${phone}". Expected 7-15 digits in E.164 format (e.g. "+966501234567").`,
      provider,
    })
  }

  return cleaned
}
