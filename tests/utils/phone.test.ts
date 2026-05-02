import { describe, test, expect } from 'bun:test'
import { normalizePhoneNumber } from '../../src/utils/phone.js'

describe('normalizePhoneNumber', () => {
  test('strips + prefix from E.164 numbers', () => {
    expect(normalizePhoneNumber('+966501234567')).toBe('966501234567')
  })

  test('strips spaces and dashes', () => {
    expect(normalizePhoneNumber('+966 50 123 4567')).toBe('966501234567')
    expect(normalizePhoneNumber('+966-50-123-4567')).toBe('966501234567')
  })

  test('strips parentheses', () => {
    expect(normalizePhoneNumber('+966(50)1234567')).toBe('966501234567')
  })

  test('returns digits-only from number without + prefix', () => {
    expect(normalizePhoneNumber('966501234567')).toBe('966501234567')
  })

  test('handles number with only digits', () => {
    expect(normalizePhoneNumber('1234567890')).toBe('1234567890')
  })

  test('throws on numbers that are too short', () => {
    expect(() => normalizePhoneNumber('12345')).toThrow()
  })

  test('throws on numbers that are too long', () => {
    expect(() => normalizePhoneNumber('1234567890123456')).toThrow()
  })

  test('throws on non-numeric input', () => {
    expect(() => normalizePhoneNumber('abc')).toThrow()
  })
})
