<p align="center">
  <h1 align="center">waflow</h1>
  <p align="center">Unified WhatsApp Provider SDK — one interface, any provider.</p>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/runtime-Bun%20%7C%20Node%20%7C%20Deno%20%7C%20CF%20Workers-blue" alt="Runtime" />
  <img src="https://img.shields.io/badge/zero-dependencies-green" alt="Zero Dependencies" />
  <img src="https://img.shields.io/badge/TypeScript-strict-blue" alt="TypeScript Strict" />
  <img src="https://img.shields.io/badge/license-MIT-yellow" alt="License" />
</p>

---

Switch WhatsApp providers with a single config change — zero application code changes.

```typescript
import { createWhatsApp } from 'waflow'

const wa = createWhatsApp({
  provider: 'cloud-api',
  phoneNumberId: '123456789',
  accessToken: 'EAAx...',
})

await wa.message.text('+966501234567', 'Hello from waflow!')
```

## Features

- **🔌 Multi-Provider** — WhatsApp Cloud API, 360Dialog, Wati. More coming soon.
- **🔒 Type-Safe** — Strict TypeScript with discriminated unions. Zero `any`.
- **📦 Zero Dependencies** — Uses native `fetch`. No axios, no got.
- **🌍 Edge-Ready** — Works on Cloudflare Workers, Bun, Deno, and Node.js. No `node:crypto`, no `Buffer`.
- **🔁 Retry & Rate Limiting** — Exponential backoff with jitter, token bucket rate limiter, `Retry-After` support.
- **📥 Stream Downloads** — Media downloads return `ReadableStream` — pipe directly to R2/S3 without buffering.
- **🪝 Webhook Normalization** — Parse any provider's webhook into a unified event format.
- **🔐 Signature Verification** — Web Crypto API (HMAC SHA-256) with constant-time comparison.

## Install

```bash
bun add waflow
# or
npm install waflow
# or
pnpm add waflow
```

## Quick Start

### Send Messages

```typescript
import { createWhatsApp } from 'waflow'

const wa = createWhatsApp({
  provider: 'cloud-api',
  phoneNumberId: process.env.WA_PHONE_ID!,
  accessToken: process.env.WA_ACCESS_TOKEN!,
})

// Text
await wa.message.text('+966501234567', 'Hello!')

// Text with link preview
await wa.message.text('+966501234567', 'Check https://example.com', {
  previewUrl: true,
})

// Reply to a message
await wa.message.text('+966501234567', 'Got it!', {
  replyTo: 'wamid.abc123...',
})

// Template
await wa.message.template('+966501234567', {
  name: 'order_confirmation',
  language: 'en_US',
  components: [
    {
      type: 'body',
      parameters: [{ type: 'text', text: 'ORD-1234' }],
    },
  ],
})

// Image
await wa.message.image('+966501234567', { url: 'https://example.com/photo.jpg' }, {
  caption: 'Your receipt',
})

// Document
await wa.message.document(
  '+966501234567',
  { url: 'https://example.com/invoice.pdf' },
  { caption: 'Invoice #1234', filename: 'invoice.pdf' },
)

// Location
await wa.message.location('+966501234567', {
  latitude: 24.7136,
  longitude: 46.6753,
  name: 'Riyadh',
  address: 'Kingdom of Saudi Arabia',
})

// Reaction
await wa.message.reaction('+966501234567', 'wamid.abc123...', '👍')

// Mark as read
await wa.message.markAsRead('wamid.abc123...')
```

### Interactive Messages

```typescript
// Buttons (max 3)
await wa.message.interactive.buttons(
  '+966501234567',
  'Would you like to confirm your order?',
  [
    { id: 'confirm', title: '✅ Confirm' },
    { id: 'cancel', title: '❌ Cancel' },
  ],
  {
    header: { type: 'text', text: 'Order #1234' },
    footer: 'Reply within 24 hours',
  },
)

// List (max 10 sections)
await wa.message.interactive.list(
  '+966501234567',
  'Browse our menu:',
  'View Menu',
  [
    {
      title: 'Main Dishes',
      rows: [
        { id: 'kabsa', title: 'كبسة', description: 'Traditional Saudi rice dish' },
        { id: 'mandi', title: 'مندي', description: 'Slow-cooked meat and rice' },
      ],
    },
    {
      title: 'Drinks',
      rows: [
        { id: 'chai', title: 'شاي', description: 'Arabic tea' },
        { id: 'qahwa', title: 'قهوة', description: 'Saudi coffee' },
      ],
    },
  ],
)
```

### Media Operations

```typescript
// Upload
const { id: mediaId } = await wa.media.upload({
  file: new Uint8Array(buffer),
  mimeType: 'image/png',
  filename: 'photo.png',
})

// Send uploaded media
await wa.message.image('+966501234567', { id: mediaId })

// Get media URL
const { url, mimeType } = await wa.media.getUrl('media-id-123')

// Download as stream — pipe directly to R2/S3
const { stream, mimeType: type } = await wa.media.download('media-id-123')
await r2Bucket.put('downloads/file.pdf', stream, {
  httpMetadata: { contentType: type },
})

// Delete
await wa.media.delete('media-id-123')
```

### Webhooks

```typescript
// Parse webhook payload → normalized events
const events = wa.webhook.parse(requestBody)

for (const event of events) {
  switch (event.type) {
    case 'message':
      console.log(`From: ${event.from}`)
      if (event.message.type === 'text') {
        console.log(`Text: ${event.message.body}`)
      }
      break

    case 'status':
      console.log(`Message ${event.messageId}: ${event.status}`)
      // status: 'sent' | 'delivered' | 'read' | 'failed'
      break

    case 'error':
      console.error(`Error ${event.code}: ${event.message}`)
      break
  }
}
```

#### Webhook Verification (Elysia)

```typescript
import { createWhatsApp } from 'waflow'
import { Elysia } from 'elysia'

const wa = createWhatsApp({
  provider: 'cloud-api',
  phoneNumberId: process.env.WA_PHONE_ID!,
  accessToken: process.env.WA_ACCESS_TOKEN!,
  webhookVerifyToken: process.env.WA_VERIFY_TOKEN!,
  appSecret: process.env.WA_APP_SECRET!,
})

new Elysia()
  // Meta sends a GET to verify your webhook URL
  .get('/webhook', ({ query }) => {
    const challenge = wa.webhook.handleChallenge(query as Record<string, string>)
    if (!challenge) return new Response('Forbidden', { status: 403 })
    return challenge
  })
  // Incoming events are POSTed here
  .post('/webhook', async ({ body, request }) => {
    // Verify signature
    const rawBody = await request.text()
    const signature = request.headers.get('x-hub-signature-256') ?? ''
    const isValid = await wa.webhook.verify(rawBody, signature)
    if (!isValid) return new Response('Invalid signature', { status: 401 })

    // Parse and handle events
    const events = wa.webhook.parse(body)
    for (const event of events) {
      // ... handle events
    }
    return 'OK'
  })
  .listen(3000)
```

#### Webhook Verification (Hono / Cloudflare Workers)

```typescript
import { createWhatsApp } from 'waflow'
import { Hono } from 'hono'

const app = new Hono()

app.get('/webhook', (c) => {
  const wa = createWhatsApp({ /* ... */ })
  const challenge = wa.webhook.handleChallenge(
    Object.fromEntries(new URL(c.req.url).searchParams),
  )
  return challenge ? c.text(challenge) : c.text('Forbidden', 403)
})

app.post('/webhook', async (c) => {
  const wa = createWhatsApp({ /* ... */ })
  const rawBody = await c.req.text()
  const signature = c.req.header('x-hub-signature-256') ?? ''
  if (!(await wa.webhook.verify(rawBody, signature))) {
    return c.text('Invalid', 401)
  }
  const events = wa.webhook.parse(JSON.parse(rawBody))
  // ... handle events
  return c.text('OK')
})

export default app
```

## Providers

### WhatsApp Cloud API

Direct Meta Graph API integration. The reference provider — supports all features.

```typescript
const wa = createWhatsApp({
  provider: 'cloud-api',
  phoneNumberId: '123456789', // in waty phoneNumberId equals phone number in E.164 format, e.g. '96611111111'
  accessToken: 'EAAx...',
  apiVersion: 'v25.0',               // optional, default: v25.0
  webhookVerifyToken: 'my-token',     // optional, for webhook challenge
  appSecret: 'abc123...',            // optional, for signature verification
  wabaId: '109876543210',            // optional, required for template management
})
```

### 360Dialog

Thin BSP wrapper over Cloud API. Same payload format, different auth.

```typescript
const wa = createWhatsApp({
  provider: '360dialog',
  apiKey: 'your-360dialog-api-key',
  baseUrl: 'https://waba-v2.360dialog.io', // optional, this is the default
  webhookSecret: 'your-secret',             // optional
})
```

### Wati

Completely different REST API surface. Supports text, templates, and media.

```typescript
const wa = createWhatsApp({
  provider: 'wati',
  apiKey: 'your-wati-bearer-token',
  baseUrl: 'https://live-mt-server.wati.io/300305', // required, tenant-specific
  channelNumber: '201012345678',                    // required for WATI template sends
  webhookSecret: 'your-secret',                      // optional
})
```

> **Note:** Wati does not support interactive messages, reactions, stickers, location, or contacts. Calling these will throw `UnsupportedFeatureError`. Use `wa.supports()` to check at runtime.

## Switch Providers

The entire point of waflow — switch providers, change nothing else:

```typescript
// Before: Cloud API
const wa = createWhatsApp({
  provider: 'cloud-api',
  phoneNumberId: '123456',
  accessToken: 'EAAx...',
})

// After: 360Dialog — same code works
const wa = createWhatsApp({
  provider: '360dialog',
  apiKey: 'your-api-key',
})

// All of this stays identical:
await wa.message.text('+966501234567', 'Hello!')
await wa.message.template('+966501234567', { name: 'hello', language: 'en' })
const events = wa.webhook.parse(body)
```

## Feature Detection

Not all providers support all features. Check at runtime:

```typescript
if (wa.supports('interactive.button')) {
  await wa.message.interactive.buttons(to, 'Choose:', buttons)
} else {
  // Fallback to text
  await wa.message.text(to, 'Reply 1 for Yes, 2 for No')
}
```

Available features:

| Feature | Cloud API | 360Dialog | Wati |
|---|:---:|:---:|:---:|
| `interactive.button` | ✅ | ✅ | ❌ |
| `interactive.list` | ✅ | ✅ | ❌ |
| `media.upload` | ✅ | ✅ | ✅ |
| `media.download` | ✅ | ✅ | ❌ |
| `media.delete` | ✅ | ✅ | ❌ |
| `template.management` | ✅ | ❌ | ❌ |
| `reaction` | ✅ | ✅ | ❌ |
| `read_receipts` | ✅ | ✅ | ❌ |
| `sticker` | ✅ | ✅ | ❌ |
| `location` | ✅ | ✅ | ❌ |
| `contacts` | ✅ | ✅ | ❌ |
| `webhook.signature_verification` | ✅ | ✅ | ✅ |
| `webhook.challenge` | ✅ | ❌ | ❌ |

## Configuration

### Retry

```typescript
const wa = createWhatsApp({
  provider: 'cloud-api',
  // ...credentials
  retry: {
    maxRetries: 3,     // default: 3
    baseDelay: 1000,   // default: 1000ms
    maxDelay: 30000,   // default: 30000ms
  },
})
```

Retries on: `429 Rate Limited`, `5xx Server Error`, network failures, timeouts.
Respects `Retry-After` header. Uses exponential backoff with ±25% jitter.

### Rate Limiting

```typescript
const wa = createWhatsApp({
  provider: 'cloud-api',
  // ...credentials
  rateLimit: {
    maxRequestsPerSecond: 80, // default: 80 (Cloud API limit)
  },
})
```

Token bucket algorithm. Queues requests when at capacity — no dropped requests.

### Timeout

```typescript
const wa = createWhatsApp({
  provider: 'cloud-api',
  // ...credentials
  timeout: 30_000, // default: 30 seconds
})
```

### Logger

Bring your own logger. Must implement `debug`, `info`, `warn`, `error`:

```typescript
import { createWhatsApp, type Logger } from 'waflow'

const logger: Logger = {
  debug: (msg, meta) => console.debug(msg, meta),
  info:  (msg, meta) => console.info(msg, meta),
  warn:  (msg, meta) => console.warn(msg, meta),
  error: (msg, meta) => console.error(msg, meta),
}

const wa = createWhatsApp({
  provider: 'cloud-api',
  // ...credentials
  logger,
})
```

### Hooks

Lifecycle hooks for observability:

```typescript
const wa = createWhatsApp({
  provider: 'cloud-api',
  // ...credentials
  hooks: {
    onRequest: ({ url, method }) => {
      console.log(`→ ${method} ${url}`)
    },
    onResponse: ({ url, status, durationMs }) => {
      console.log(`← ${status} ${url} (${durationMs}ms)`)
    },
    onError: (error) => {
      Sentry.captureException(error)
    },
  },
})
```

### Raw Response

Include the raw provider response in `SendResult` for debugging:

```typescript
const wa = createWhatsApp({
  provider: 'cloud-api',
  // ...credentials
  includeRawResponse: true,
})

const result = await wa.message.text('+966501234567', 'Hello')
console.log(result.raw) // full Meta API response
```

## Error Handling

All errors extend `WhatsAppError` with structured context:

```typescript
import {
  WhatsAppError,
  AuthenticationError,
  RateLimitError,
  ValidationError,
  UnsupportedFeatureError,
  NetworkError,
  TimeoutError,
} from 'waflow'

try {
  await wa.message.text('+966501234567', 'Hello')
} catch (error) {
  if (error instanceof RateLimitError) {
    console.log(`Rate limited. Retry after ${error.retryAfter}s`)
  } else if (error instanceof AuthenticationError) {
    console.log('Check your access token')
  } else if (error instanceof UnsupportedFeatureError) {
    console.log(`${error.provider} doesn't support this feature`)
  } else if (error instanceof WhatsAppError) {
    console.log(`[${error.code}] ${error.message}`)
    console.log(`Provider: ${error.provider}`)
    console.log(`Status: ${error.statusCode}`)
    console.log(`Raw: ${JSON.stringify(error.raw)}`)
  }
}
```

## Custom Providers

Implement `WhatsAppProviderAdapter` to add your own provider:

```typescript
import { createWhatsAppFromAdapter, type WhatsAppProviderAdapter } from 'waflow'

class MyProvider implements WhatsAppProviderAdapter {
  readonly name = 'my-provider'

  async sendMessage(message) { /* ... */ }
  async markAsRead(messageId) { /* ... */ }
  async uploadMedia(params) { /* ... */ }
  async getMediaUrl(mediaId) { /* ... */ }
  async downloadMedia(mediaIdOrUrl) { /* ... */ }
  async deleteMedia(mediaId) { /* ... */ }
  parseWebhook(body) { /* ... */ }
  async verifyWebhookSignature(body, signature) { /* ... */ }
  supports(feature) { /* ... */ }
}

const wa = createWhatsAppFromAdapter(new MyProvider())
await wa.message.text('+966501234567', 'Hello from custom provider!')
```

## Runtime Compatibility

waflow is designed edge-first. It uses only standard Web APIs:

| API Used | Why |
|---|---|
| `fetch` | HTTP requests |
| `crypto.subtle` | HMAC SHA-256 signature verification |
| `ReadableStream` | Stream-based media downloads |
| `FormData` | Multipart media uploads |
| `TextEncoder` | String → Uint8Array conversion |
| `AbortSignal.timeout()` | Request timeouts |

**Banned** (not used anywhere):
- ❌ `node:crypto`
- ❌ `Buffer`
- ❌ `node:stream`
- ❌ `process.env` (config passed via constructor)

## License

MIT
