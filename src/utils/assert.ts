// ---------------------------------------------------------------------------
// Type guard utilities
// ---------------------------------------------------------------------------

/** Exhaustive check utility — causes compile error if a case is missed */
export function assertNever(x: never): never {
  throw new Error(`Unhandled case: ${JSON.stringify(x)}`)
}

/** Type guard: checks if value is a non-null object */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Type guard: checks if value has a specific string property */
export function hasStringProp<K extends string>(
  value: unknown,
  key: K,
): value is Record<K, string> {
  return isRecord(value) && typeof value[key] === 'string'
}

/** Type guard: checks if value has a specific property */
export function hasProp<K extends string>(
  value: unknown,
  key: K,
): value is Record<K, unknown> {
  return isRecord(value) && key in value
}
