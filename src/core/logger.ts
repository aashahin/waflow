// ---------------------------------------------------------------------------
// Pluggable logger interface — consumers bring their own
// ---------------------------------------------------------------------------

export interface Logger {
  debug(msg: string, meta?: Record<string, unknown>): void
  info(msg: string, meta?: Record<string, unknown>): void
  warn(msg: string, meta?: Record<string, unknown>): void
  error(msg: string, meta?: Record<string, unknown>): void
}

/** No-op logger used when no logger is provided */
export const noopLogger: Logger = {
  debug() {},
  info() {},
  warn() {},
  error() {},
}
