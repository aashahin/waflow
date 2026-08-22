import { describe, test, expect } from 'bun:test'
import { normalizePhoneNumber } from '../../src/utils/phone.js'
import { ValidationError } from '../../src/core/errors.js'

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
    expect(() => normalizePhoneNumber('12345')).toThrow(ValidationError)
  })

  test('throws on numbers that are too long', () => {
    expect(() => normalizePhoneNumber('1234567890123456')).toThrow()
  })

  test('throws on non-numeric input', () => {
    expect(() => normalizePhoneNumber('abc')).toThrow()
  })

  test.each([
    ['+966\u200B501234567'],
    ['+966\u200C50\u200D1234567'],
    ['+966\u202A501234567\u202C'],
    ['+966\u202D50\u202E1234567'],
    ['+966\u2060501234567'],
    ['+966\uFEFF501234567'],
    ['+966\u00A0501234567'],
  ])('strips zero-width, bidi, BOM, and NBSP from %j', (input) => {
    expect(normalizePhoneNumber(input)).toBe('966501234567')
  })

  test('throws on leftover non-digit characters', () => {
    expect(() => normalizePhoneNumber('+966abc501234567')).toThrow(ValidationError)
  })
})
