// ---------------------------------------------------------------------------
// Phone number normalization utilities
// ---------------------------------------------------------------------------

/**
 * Normalize a phone number to E.164-like format for WhatsApp API calls.
 *
 * WhatsApp APIs expect numbers without the "+" prefix
 * (e.g. "966501234567" not "+966501234567").
 *
 * This function:
 * - Strips "+", spaces, dashes, parentheses
 * - Validates that the result is digits only
 * - Returns the cleaned number
 */
// Hoisted to module scope so they aren't reallocated on every send.
const STRIP_CHARS = /[\s\-()+]/g
const E164_DIGITS = /^\d{7,15}$/

export function normalizePhoneNumber(phone: string): string {
  const cleaned = phone.replace(STRIP_CHARS, '')

  if (!E164_DIGITS.test(cleaned)) {
    throw new Error(
      `Invalid phone number: "${phone}". Expected 7-15 digits in E.164 format (e.g. "+966501234567").`,
    )
  }

  return cleaned
}
