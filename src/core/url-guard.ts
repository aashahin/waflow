import type { ProviderName } from '../types/common.js'
import { ValidationError } from './errors.js'

const TRUSTED_MEDIA_SUFFIXES = [
  '.facebook.com',
  '.fbcdn.net',
  '.fbsbx.com',
  '.whatsapp.net',
  '.360dialog.io',
  '.360dialog.com',
] as const

const TRUSTED_MEDIA_HOSTS = new Set([
  'facebook.com',
  'fbcdn.net',
  'fbsbx.com',
  'whatsapp.net',
  '360dialog.io',
  '360dialog.com',
  'lookaside.fbsbx.com',
  'graph.facebook.com',
  'graph.whatsapp.com',
])

export function isAbsoluteUrl(path: string): boolean {
  return path.startsWith('http://') || path.startsWith('https://')
}

export function isTrustedMediaHost(url: string, baseUrl: string): boolean {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return false
  }

  try {
    if (parsed.origin === new URL(baseUrl).origin) return true
  } catch {
    // invalid base is not trusted by origin match
  }

  const host = parsed.hostname.toLowerCase()
  if (TRUSTED_MEDIA_HOSTS.has(host)) return true
  return TRUSTED_MEDIA_SUFFIXES.some(suffix => host.endsWith(suffix))
}

function isPrivateIpv4(host: string): boolean {
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
  if (isPrivateIpv4(host)) return true

  if (host.includes(':')) {
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

export function makeRequestSignal(timeoutMs: number, user?: AbortSignal): AbortSignal {
  const timeout = AbortSignal.timeout(timeoutMs)
  if (!user) return timeout
  if (typeof AbortSignal.any === 'function') {
    return AbortSignal.any([timeout, user])
  }
  if (user.aborted) return user
  if (timeout.aborted) return timeout
  const controller = new AbortController()
  const onAbort = () => controller.abort(user.aborted ? user.reason : timeout.reason)
  user.addEventListener('abort', onAbort, { once: true })
  timeout.addEventListener('abort', onAbort, { once: true })
  return controller.signal
}
