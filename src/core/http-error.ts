import type { ProviderName } from '../types/common.js'
import { isRecord } from '../utils/assert.js'
import {
  AuthenticationError,
  ProviderError,
  RateLimitError,
  ValidationError,
} from './errors.js'

const AUTH_CODES = new Set([10, 102, 104, 190, 200])
const RATE_LIMIT_CODES = new Set([4, 32, 613, 80007, 130429, 133016])

export interface GraphErrorInfo {
  code: number | undefined
  message: string | undefined
  type: string | undefined
}

function asGraphCode(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && /^\d+$/.test(value)) return Number(value)
  return undefined
}

export function extractGraphError(raw: unknown): GraphErrorInfo | undefined {
  if (!isRecord(raw) || !isRecord(raw.error)) return undefined
  const err = raw.error
  return {
    code: asGraphCode(err.code),
    message: typeof err.message === 'string' ? err.message : undefined,
    type: typeof err.type === 'string' ? err.type : undefined,
  }
}

export function parseRetryAfter(header: string | null): number | undefined {
  if (!header) return undefined
  const asNumber = Number(header)
  if (Number.isFinite(asNumber) && asNumber >= 0) {
    return Math.ceil(asNumber)
  }
  const dateMs = Date.parse(header)
  if (Number.isNaN(dateMs)) return undefined
  return Math.max(0, Math.ceil((dateMs - Date.now()) / 1000))
}

function formatDetail(graph: GraphErrorInfo | undefined, fallbackInfo?: string): string {
  if (graph?.code !== undefined && graph.message) {
    return ` (#${graph.code}: ${graph.message})`
  }
  if (graph?.code !== undefined) {
    return ` (#${graph.code})`
  }
  if (graph?.message) {
    return `: ${graph.message}`
  }
  if (fallbackInfo) {
    return `: ${fallbackInfo}`
  }
  return ''
}

export function throwForHttpError(opts: {
  status: number
  method: string
  path: string
  provider: ProviderName
  raw: unknown
  retryAfterHeader: string | null
}): never {
  const graph = extractGraphError(opts.raw)
  const info = isRecord(opts.raw) && typeof opts.raw.info === 'string' ? opts.raw.info.trim() : ''
  const detail = formatDetail(graph, info || undefined)
  const context = {
    provider: opts.provider,
    statusCode: opts.status,
    raw: opts.raw,
  } as const
  const loc = `${opts.method} ${opts.path}`

  if (graph?.code !== undefined && AUTH_CODES.has(graph.code)) {
    throw new AuthenticationError({
      message: `Authentication failed: ${loc}${detail}`,
      ...context,
    })
  }

  if (
    opts.status === 429
    || (graph?.code !== undefined && RATE_LIMIT_CODES.has(graph.code))
  ) {
    throw new RateLimitError({
      message: `Rate limited: ${loc}${detail}`,
      ...context,
      retryAfter: parseRetryAfter(opts.retryAfterHeader),
    })
  }

  if (opts.status === 401) {
    throw new AuthenticationError({
      message: `Authentication failed: ${loc}${detail}`,
      ...context,
    })
  }

  if (opts.status === 403) {
    throw new AuthenticationError({
      message: `Access forbidden: ${loc}${detail}`,
      ...context,
    })
  }

  if (graph?.code !== undefined && graph.code >= 130000) {
    throw new ProviderError({
      message: `Provider error (${opts.status}): ${loc}${detail}`,
      ...context,
    })
  }

  if (opts.status === 400) {
    throw new ValidationError({
      message: `Validation failed: ${loc}${detail}`,
      ...context,
    })
  }

  throw new ProviderError({
    message: `Provider error (${opts.status}): ${loc}${detail}`,
    ...context,
  })
}
