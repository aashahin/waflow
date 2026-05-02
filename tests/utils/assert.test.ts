import { describe, test, expect } from 'bun:test'
import { isRecord, hasStringProp, assertNever } from '../../src/utils/assert.js'

describe('isRecord', () => {
  test('returns true for plain objects', () => {
    expect(isRecord({})).toBe(true)
    expect(isRecord({ key: 'value' })).toBe(true)
  })

  test('returns false for null', () => {
    expect(isRecord(null)).toBe(false)
  })

  test('returns false for undefined', () => {
    expect(isRecord(undefined)).toBe(false)
  })

  test('returns false for primitives', () => {
    expect(isRecord('string')).toBe(false)
    expect(isRecord(42)).toBe(false)
    expect(isRecord(true)).toBe(false)
  })

  test('returns false for arrays', () => {
    expect(isRecord([])).toBe(false)
    expect(isRecord([1, 2, 3])).toBe(false)
  })
})

describe('hasStringProp', () => {
  test('returns true when property exists and is a string', () => {
    expect(hasStringProp({ name: 'test' }, 'name')).toBe(true)
  })

  test('returns false when property does not exist', () => {
    expect(hasStringProp({}, 'name')).toBe(false)
  })

  test('returns false when property is not a string', () => {
    expect(hasStringProp({ name: 42 }, 'name')).toBe(false)
    expect(hasStringProp({ name: null }, 'name')).toBe(false)
  })
})

describe('assertNever', () => {
  test('throws an error for any value', () => {
    expect(() => assertNever('unexpected' as never)).toThrow()
  })
})
