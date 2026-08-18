import type { ProviderName } from '../types/common.js'
import { ValidationError } from './errors.js'

const META_CDN_SUFFIXES = ['.facebook.com', '.fbcdn.net', '.fbsbx.com', '.whatsapp.net'] as const
const META_CDN_HOSTS = new Set(['facebook.com', 'fbcdn.net', 'fbsbx.com', 'whatsapp.net'])
const D360_SUFFIXES = ['.360dialog.io', '.360dialog.com'] as const
const D360_HOSTS = new Set(['360dialog.io', '360dialog.com'])

export function isAbsoluteUrl(path: string): boolean {
  return path.startsWith('http://') || path.startsWith('https://')
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

  try {
    if (parsed.origin === new URL(baseUrl).origin && !isGraphApiHost(host)) return true
  } catch {
    // invalid base is not trusted by origin match
  }

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
  if (a === 169 && b === 254) return true
  if (a === 192 && b === 168) return true
  return a === 172 && b >= 16 && b <= 31
}

function decimalToIpv4(host: string): string | undefined {
  if (!/^\d+$/.test(host)) return undefined
  const n = Number(host)
  if (!Number.isInteger(n) || n < 0 || n > 0xFFFFFFFF) return undefined
  const x = n >>> 0
  return `${(x >>> 24) & 255}.${(x >>> 16) & 255}.${(x >>> 8) & 255}.${x & 255}`
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
    input = `${mixed[1]}:${((a << 8) | b).toString(16)}:${((c << 8) | d).toString(16)}`
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

function ipv4FromMappedHextets(hextets: number[]): string | undefined {
  if (
    hextets.length !== 8
    || hextets[0] !== 0
    || hextets[1] !== 0
    || hextets[2] !== 0
    || hextets[3] !== 0
    || hextets[4] !== 0
    || hextets[5] !== 0xffff
  ) {
    return undefined
  }
  const hi = hextets[6] ?? 0
  const lo = hextets[7] ?? 0
  return `${(hi >> 8) & 255}.${hi & 255}.${(lo >> 8) & 255}.${lo & 255}`
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
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, '')
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

  if (isPrivateIpv4(host)) return true

  if (host.includes(':')) {
    const mixed = host.match(/:(\d{1,3}(?:\.\d{1,3}){3})$/)
    if (mixed?.[1] && hasLeadingZeroIpv4(mixed[1])) return true

    const hextets = parseIpv6Hextets(host)
    if (hextets) {
      if (isIpv6LoopbackOrUnspecified(hextets)) return true
      const fromMapped = ipv4FromMappedHextets(hextets)
      if (fromMapped) return isPrivateIpv4(fromMapped)
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
