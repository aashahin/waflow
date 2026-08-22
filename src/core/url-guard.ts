import type { ProviderName } from '../types/common.js'
import { ValidationError } from './errors.js'

// Media CDNs only — facebook.com / whatsapp.net must not inherit API credentials
const META_CDN_SUFFIXES = ['.fbcdn.net', '.fbsbx.com'] as const
const META_CDN_HOSTS = new Set(['lookaside.fbsbx.com', 'fbsbx.com', 'fbcdn.net'])
const D360_SUFFIXES = ['.360dialog.io', '.360dialog.com'] as const
const D360_HOSTS = new Set(['360dialog.io', '360dialog.com'])

export function isAbsoluteUrl(path: string): boolean {
  return path.startsWith('http://') || path.startsWith('https://')
}

/**
 * Treat a media-download input as an http(s) URL, folding scheme case
 * (`HTTPS://…` → `https://…`). HttpClient only treats lowercase `http://` /
 * `https://` as absolute; otherwise it would GET `/HTTPS://…` on the API base.
 */
export function resolveHttpDownloadUrl(mediaIdOrUrl: string): string | undefined {
  const candidate = mediaIdOrUrl.trim()
  try {
    const parsed = new URL(candidate)
    if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
      return parsed.href
    }
  } catch {
    // URL() is strict; a scheme-folded string may still be an absolute http URL
  }
  const schemeNormalized = candidate.replace(/^[A-Za-z][A-Za-z+\-.]*:/, scheme =>
    scheme.toLowerCase(),
  )
  return isAbsoluteUrl(schemeNormalized) ? schemeNormalized : undefined
}

const noopCleanup = (): void => {}

/**
 * Combine abort signals. Call `cleanup` so polyfill listeners are not left on a
 * long-lived client signal. Native `AbortSignal.any` needs no cleanup.
 */
export function bindAbortSignals(
  signals: Array<AbortSignal | undefined>,
): { signal?: AbortSignal; cleanup: () => void } {
  const present: AbortSignal[] = []
  for (const signal of signals) {
    if (signal !== undefined && !present.includes(signal)) present.push(signal)
  }
  if (present.length === 0) return { signal: undefined, cleanup: noopCleanup }
  if (present.length === 1) return { signal: present[0], cleanup: noopCleanup }
  if (typeof AbortSignal.any === 'function') {
    return { signal: AbortSignal.any(present), cleanup: noopCleanup }
  }
  const alreadyAborted = present.find(signal => signal.aborted)
  if (alreadyAborted) return { signal: alreadyAborted, cleanup: noopCleanup }
  const controller = new AbortController()
  const onAbort = () => {
    controller.abort(present.find(signal => signal.aborted)?.reason)
  }
  for (const signal of present) {
    signal.addEventListener('abort', onAbort, { once: true })
  }
  return {
    signal: controller.signal,
    cleanup: () => {
      for (const signal of present) {
        signal.removeEventListener('abort', onAbort)
      }
    },
  }
}

/** Combine caller + client abort signals. `undefined` if neither is set. */
export function mergeAbortSignals(
  ...signals: Array<AbortSignal | undefined>
): AbortSignal | undefined {
  return bindAbortSignals(signals).signal
}

export function isSameOrigin(url: string, baseUrl: string): boolean {
  try {
    return new URL(url).origin === new URL(baseUrl).origin
  } catch {
    return false
  }
}

function isGraphApiHost(host: string): boolean {
  return host === 'graph.facebook.com' || host === 'graph.whatsapp.com'
}

function hostMatches(host: string, hosts: Set<string>, suffixes: readonly string[]): boolean {
  if (hosts.has(host)) return true
  return suffixes.some(suffix => host.endsWith(suffix))
}

export function isTrustedMediaHost(url: string, baseUrl: string, provider?: string): boolean {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return false
  }

  const host = parsed.hostname.toLowerCase()

  if (isSameOrigin(url, baseUrl) && !isGraphApiHost(host)) return true

  if (provider === '360dialog') {
    return hostMatches(host, D360_HOSTS, D360_SUFFIXES)
  }

  if (provider === 'wati') {
    return false
  }

  if (isGraphApiHost(host)) return false
  return hostMatches(host, META_CDN_HOSTS, META_CDN_SUFFIXES)
}

function hasLeadingZeroIpv4(host: string): boolean {
  const parts = host.split('.')
  if (parts.length !== 4) return false
  return parts.every(p => /^\d+$/.test(p)) && parts.some(p => p.length > 1 && p.startsWith('0'))
}

function isPrivateIpv4(host: string): boolean {
  if (hasLeadingZeroIpv4(host)) return true
  const ipv4 = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/)
  if (!ipv4) return false
  const octets = ipv4.slice(1).map(Number)
  if (octets.some(n => n > 255)) return false
  const [a, b] = octets as [number, number]
  if (a === 0 || a === 10 || a === 127) return true
  if (a === 100 && b >= 64 && b <= 127) return true
  if (a === 169 && b === 254) return true
  if (a === 192 && b === 168) return true
  return a === 172 && b >= 16 && b <= 31
}

function u32ToIpv4(n: number): string | undefined {
  if (!Number.isInteger(n) || n < 0 || n > 0xFFFFFFFF) return undefined
  const x = n >>> 0
  return `${(x >>> 24) & 255}.${(x >>> 16) & 255}.${(x >>> 8) & 255}.${x & 255}`
}

function decimalToIpv4(host: string): string | undefined {
  if (/^0x[0-9a-f]+$/i.test(host)) return u32ToIpv4(Number(host))
  if (!/^\d+$/.test(host)) return undefined
  return u32ToIpv4(Number(host))
}

/**
 * inet_aton-style dotted IPv4 (1–4 parts). getaddrinfo accepts `127.1` /
 * `10.1` / `192.168.1` even when the WHATWG URL parser is not used.
 * Leading zeros on any part are treated as private (ambiguous octal).
 */
function parseIpv4Part(part: string): number | 'unsafe' | undefined {
  if (part.length > 1 && /^0[0-7]*$/.test(part)) return 'unsafe'
  if (/^0x[0-9a-f]+$/i.test(part)) {
    const n = Number(part)
    return Number.isInteger(n) && n >= 0 ? n : undefined
  }
  if (!/^\d+$/.test(part)) return undefined
  const n = Number(part)
  return Number.isInteger(n) && n >= 0 ? n : undefined
}

function expandDottedIpv4(host: string): string | undefined {
  const parts = host.split('.')
  if (parts.length < 2 || parts.length > 4) return undefined
  const parsed: number[] = []
  for (const part of parts) {
    const n = parseIpv4Part(part)
    if (n === undefined) return undefined
    if (n === 'unsafe') return '127.0.0.1'
    parsed.push(n)
  }

  if (parts.length === 4) {
    if (parsed.some(n => n > 255)) return undefined
    return parsed.join('.')
  }
  if (parts.length === 2) {
    const a = parsed[0] ?? 0
    const b = parsed[1] ?? 0
    if (a > 255 || b > 0xffffff) return undefined
    return `${a}.${(b >>> 16) & 255}.${(b >>> 8) & 255}.${b & 255}`
  }
  const a = parsed[0] ?? 0
  const b = parsed[1] ?? 0
  const c = parsed[2] ?? 0
  if (a > 255 || b > 255 || c > 0xffff) return undefined
  return `${a}.${b}.${(c >>> 8) & 255}.${c & 255}`
}

function parseIpv6Hextets(host: string): number[] | undefined {
  if (!host.includes(':')) return undefined

  let input = host
  const mixed = input.match(/^(.+):(\d{1,3}(?:\.\d{1,3}){3})$/)
  if (mixed?.[1] && mixed[2]) {
    if (hasLeadingZeroIpv4(mixed[2])) return undefined
    const octets = mixed[2].split('.').map(Number)
    if (octets.length !== 4 || octets.some(n => n > 255)) return undefined
    const [a, b, c, d] = octets as [number, number, number, number]
    const tail = `${((a << 8) | b).toString(16)}:${((c << 8) | d).toString(16)}`
    // `::a.b.c.d` captures the prefix as `:` (last colon is the IPv4 separator)
    input = mixed[1] === ':' ? `::${tail}` : `${mixed[1]}:${tail}`
  }

  let parts: string[]
  if (input.includes('::')) {
    if (input.indexOf('::') !== input.lastIndexOf('::')) return undefined
    const [left = '', right = ''] = input.split('::')
    const leftParts = left ? left.split(':') : []
    const rightParts = right ? right.split(':') : []
    const missing = 8 - leftParts.length - rightParts.length
    if (missing < 0) return undefined
    parts = [...leftParts, ...Array<string>(missing).fill('0'), ...rightParts]
  } else {
    parts = input.split(':')
  }

  if (parts.length !== 8) return undefined
  if (parts.some(p => !/^[0-9a-f]{1,4}$/i.test(p))) return undefined
  return parts.map(p => parseInt(p, 16))
}

function ipv4FromHextetPair(hi: number, lo: number): string {
  return `${(hi >> 8) & 255}.${hi & 255}.${(lo >> 8) & 255}.${lo & 255}`
}

function ipv4FromEmbeddedHextets(hextets: number[]): string | undefined {
  if (hextets.length !== 8) return undefined
  const h0 = hextets[0] ?? 0
  const h1 = hextets[1] ?? 0
  const h2 = hextets[2] ?? 0
  const h3 = hextets[3] ?? 0
  const h4 = hextets[4] ?? 0
  const h5 = hextets[5] ?? 0
  const h6 = hextets[6] ?? 0
  const h7 = hextets[7] ?? 0

  // IPv4-mapped (::ffff:x:x) and deprecated IPv4-compatible (::x:x / ::7f00:1)
  if (h0 === 0 && h1 === 0 && h2 === 0 && h3 === 0 && h4 === 0 && (h5 === 0xffff || h5 === 0)) {
    return ipv4FromHextetPair(h6, h7)
  }
  // 6to4 2002:<ipv4>::
  if (h0 === 0x2002) return ipv4FromHextetPair(h1, h2)
  // NAT64 well-known prefix 64:ff9b::/96
  if (h0 === 0x64 && h1 === 0xff9b && h2 === 0 && h3 === 0 && h4 === 0 && h5 === 0) {
    return ipv4FromHextetPair(h6, h7)
  }
  return undefined
}

function isIpv6LoopbackOrUnspecified(hextets: number[]): boolean {
  if (hextets.length !== 8) return false
  if (!hextets.every(n => n === 0 || Number.isFinite(n))) return false
  if (hextets.every(n => n === 0)) return true
  return hextets[0] === 0
    && hextets[1] === 0
    && hextets[2] === 0
    && hextets[3] === 0
    && hextets[4] === 0
    && hextets[5] === 0
    && hextets[6] === 0
    && hextets[7] === 1
}

export function isPrivateHostname(hostname: string): boolean {
  // FQDN trailing dots (`localhost.`) must not bypass suffix checks
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, '').replace(/\.+$/, '')
  if (
    host === 'localhost'
    || host === '0.0.0.0'
    || host === '::'
    || host === '::1'
    || host.endsWith('.localhost')
    || host.endsWith('.local')
    || host.endsWith('.internal')
  ) {
    return true
  }

  const mapped = host.match(/^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/)
  if (mapped?.[1]) return isPrivateIpv4(mapped[1])

  const dottedDecimal = decimalToIpv4(host)
  if (dottedDecimal) return isPrivateIpv4(dottedDecimal)

  const dottedShorthand = expandDottedIpv4(host)
  if (dottedShorthand) return isPrivateIpv4(dottedShorthand)

  if (isPrivateIpv4(host)) return true

  if (host.includes(':')) {
    const mixed = host.match(/:(\d{1,3}(?:\.\d{1,3}){3})$/)
    if (mixed?.[1] && hasLeadingZeroIpv4(mixed[1])) return true

    const hextets = parseIpv6Hextets(host)
    if (hextets) {
      if (isIpv6LoopbackOrUnspecified(hextets)) return true
      const prefix = hextets[0] ?? 0
      if ((prefix & 0xffc0) === 0xfe80) return true
      const embeddedIpv4 = ipv4FromEmbeddedHextets(hextets)
      if (embeddedIpv4) return isPrivateIpv4(embeddedIpv4)
    }

    return host.startsWith('fe80:') || host.startsWith('fc') || host.startsWith('fd')
  }

  return false
}

export function assertSafeFetchUrl(url: string, provider: ProviderName): void {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    throw new ValidationError({
      message: `Invalid URL: ${url}`,
      provider,
    })
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new ValidationError({
      message: `Refusing to fetch non-HTTP URL: ${parsed.protocol}`,
      provider,
    })
  }

  if (isPrivateHostname(parsed.hostname)) {
    throw new ValidationError({
      message: `Refusing to fetch private/local address: ${parsed.hostname}`,
      provider,
    })
  }
}

const BLOCKED_MEDIA_IDS = new Set(['me', 'debug_token', 'app'])

/** Encode a media id for path use; reject empty, traversal, and query characters. */
export function assertSafeMediaId(id: string, provider: ProviderName): string {
  const trimmed = id.trim()
  if (!trimmed) {
    throw new ValidationError({
      message: 'Media id must be a non-empty string',
      provider,
    })
  }
  if (BLOCKED_MEDIA_IDS.has(trimmed.toLowerCase())) {
    throw new ValidationError({
      message: `Refusing reserved media id: ${trimmed}`,
      provider,
    })
  }
  if (trimmed.includes('/') || trimmed.includes('?') || trimmed.includes('#') || trimmed.includes('..')) {
    throw new ValidationError({
      message: `Refusing media id with path or query characters: ${trimmed}`,
      provider,
    })
  }
  return encodeURIComponent(trimmed)
}

function createTimeoutSignal(ms: number): { signal: AbortSignal; cleanup: () => void } {
  const controller = new AbortController()
  const timer = setTimeout(() => {
    const err = new Error('The operation timed out')
    err.name = 'TimeoutError'
    controller.abort(err)
  }, ms)
  if (typeof timer === 'object' && timer !== null && 'unref' in timer) {
    (timer as { unref: () => void }).unref()
  }
  return {
    signal: controller.signal,
    cleanup: () => {
      clearTimeout(timer)
    },
  }
}

export function makeRequestSignal(timeoutMs: number, user?: AbortSignal): { signal: AbortSignal; cleanup: () => void } {
  if (timeoutMs <= 0) {
    if (user) return { signal: user, cleanup: () => {} }
    return { signal: new AbortController().signal, cleanup: () => {} }
  }

  const timeout = createTimeoutSignal(timeoutMs)
  if (!user) return timeout

  if (typeof AbortSignal.any === 'function') {
    return {
      signal: AbortSignal.any([timeout.signal, user]),
      cleanup: timeout.cleanup,
    }
  }

  if (user.aborted) {
    timeout.cleanup()
    return { signal: user, cleanup: () => {} }
  }
  if (timeout.signal.aborted) {
    return timeout
  }

  const controller = new AbortController()
  const onAbort = () => {
    controller.abort(user.aborted ? user.reason : timeout.signal.reason)
  }
  user.addEventListener('abort', onAbort, { once: true })
  timeout.signal.addEventListener('abort', onAbort, { once: true })
  return {
    signal: controller.signal,
    cleanup: () => {
      user.removeEventListener('abort', onAbort)
      timeout.signal.removeEventListener('abort', onAbort)
      timeout.cleanup()
    },
  }
}
