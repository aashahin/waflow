# Changelog

All notable changes to this project are documented here. This project adheres to
[Semantic Versioning](https://semver.org/) (pre-1.0: breaking changes bump the minor).

## Unreleased (0.7.0)

Download rewrite, abort, SSRF, webhook HMAC, and classification hardening.

### Breaking

- **Wati throws `ProviderError`** when a send is accepted (`result: true`)
  without a message id (0.6.0 returned `messageId: ''`). Cloud API / 360dialog
  already threw on an empty id.
- **360dialog `media.download`** rewrites Meta `lookaside.fbsbx.com` (and other
  Meta CDN) URLs onto the configured `baseUrl` (default
  `https://waba-v2.360dialog.io`) and sends `D360-API-KEY` there. Meta CDNs are
  never fetched with the 360dialog key.

### Fixed

- SSRF checks apply to **caller-supplied absolute URLs**, not the configured API
  `baseUrl`, so localhost mocks work.
- SSRF hardening: private IPv6 (loopback / link-local / ULA), IPv4-mapped /
  compatible / 6to4 / NAT64 encodings of private IPv4, CGNAT (`100.64.0.0/10`),
  and redirect-target checks. Credentials are stripped on `https` → `http` hops.
  Public IPv6 is not blocked. Hostnames are not DNS-resolved.
- Caller abort cancels retry backoff sleep and the rate-limiter wait queue.
- Webhook HMAC SHA-256 signatures are compared **case-insensitively as hex**
  (optional `sha256=` prefix is also case-insensitive).
- **HTTP 403** is `ProviderError` unless Graph already classified an auth
  code (`#190`, etc.). `type: OAuthException` is **not** treated as auth —
  Meta uses that type on 13xxxx business errors too.
- Interactive **button titles ≤ 20** characters and **list section/row titles ≤ 24**
  characters are validated.
- Per-request and client-level `AbortSignal`s are merged (either can cancel).
  Abort while waiting for a rate-limit token is `NetworkError` (`retryable: false`),
  not `TimeoutError`.
- HMAC signatures must be 64 hex characters (non-hex of that length is rejected).

### Added

- `ProviderName` still autocompletes `'cloud-api' | '360dialog' | 'wati'` and
  also accepts custom adapter names (`string & {}`). `SendResult.provider`
  follows.

## 0.6.0

Second production audit: downloads, Wati correctness, retry/SSRF hardening.

### Breaking

- **Wati `media.upload` is unsupported.** There is no Wati upload API;
  `supports('media.upload')` is `false` and `uploadMedia` throws
  `UnsupportedFeatureError`. Pass a public URL to sends.
- **Wati `sendSessionFile` sends the file URL as a query param**, not a JSON body.
- **Wati `broadcast_name` is unique per send** again (`waflow_${name}_${ts}_${rand}`)
  so repeat OTP/template sends to the same number are not dropped.
- **`supports('webhook.signature_verification')` / `supports('webhook.challenge')`**
  are false unless the matching secret/token is configured.
- **Graph `#131048` / `#131056`** are `ProviderError` (not retried), not
  `RateLimitError`.
- **`media.download` defaults to no SDK timeout** so the body stream is not
  aborted at 30s. Pass `{ timeout }` to cap TTFB.

### Fixed

- User abort is a non-retryable `NetworkError`, not `TimeoutError`.
- Timeout detection no longer requires `instanceof DOMException`.
- Local rate-limiter queue-full is not retried.
- `downloadMedia` does not forward Cloud API tokens to `graph.facebook.com` or
  360dialog API keys to Meta CDNs.
- SSRF guard rejects expanded IPv6 loopback, IPv4-mapped hex, decimal IPv4,
  and leading-zero IPv4.
- Wati inbound webhooks with `statusString: "SENT"` and no `eventType` parse as
  messages, not status events.
- Wati template flatten includes header text params; `language` and
  `replyContextId` are forwarded.
- Wati missing timestamps use epoch, not `Date.now()`.
- Empty upload / getMediaUrl / createTemplate bodies throw typed errors.
- Webhook challenge compare is constant-time and no longer logs the token.
- Request timeout timers are unref'd; `makeRequestSignal` cleans up listeners.

## 0.5.0

Production audit: correctness, webhook resilience, and credential hygiene.

### Breaking

- **`destroy()` rejects queued rate-limiter waiters** with `TimeoutError` instead of
  granting them (no post-shutdown request burst).
- **`rateLimit.maxRequestsPerSecond` must be >= 1.** Values in `(0, 1)` previously
  deadlocked (`tokens` could never reach 1).
- **Invalid phones and empty media sources throw `ValidationError`** instead of a
  generic `Error`.
- **HTTP 400s are classified from Graph `error.code`.** `#190` is
  `AuthenticationError`; `#130429` / `#131056` are `RateLimitError` (and therefore
  retried); WhatsApp 13xxxx business errors are `ProviderError`.
- **Unknown Wati status strings no longer become `'sent'`** — they are dropped.
- **Wati `broadcast_name` is stable** (`waflow_${templateName}`) instead of a
  unique `Date.now()` campaign per send.

### Fixed

- **`includeRawWebhook` is now passed through `createWhatsApp()`.**
- **Cloud/360 webhook parse never throws** on malformed `entry` / `changes` / `value`.
- **Template send maps `url` → `link` and `name` → `parameter_name`.**
- **`downloadMedia(url)` strips provider credentials** unless the host is the API
  origin or a known Meta/360dialog media CDN, and refuses private/link-local URLs.
- **Inbound template quick-reply `type: "button"`** is parsed as `button_reply`.
- **Inbound reply `context`** is exposed on message events.
- **`message_template_status_update`** is parsed as `template_status`.
- **`listTemplates` pagination** no longer crashes when `cursors` is missing and
  stops if the cursor does not advance. OTP buttons are no longer mapped to
  `QUICK_REPLY`.
- **Empty/malformed send responses** no longer throw `TypeError`.
- **360dialog validation errors** report `provider: '360dialog'`.
- **Wati webhooks** fall back to `whatsappMessageId` / `id` / `data`.
- **`Retry-After` HTTP-date** values are parsed.
- **Lifecycle hooks that throw** no longer fail the request.

### Added

- `CreateTemplateInput.parameterFormat` (`positional` | `named`).
- `template.delete(name, language?)` to delete a single language.
- `ClientOptions.signal` and `MediaUpload.timeout`.
- `OtpSendOptions` is exported from the public type barrel.
- CJS `require` conditions on provider subpath exports.
- `LICENSE` file.

## 0.4.0

Release tag existed without notes. See 0.3.0 for the last documented feature set
and 0.5.0 for the audit follow-up.

## 0.3.0

Correctness, reliability, and performance hardening for production OTP/messaging use.

### Breaking

- **Retry is now idempotency-aware.** Network errors, timeouts, and `5xx` are no
  longer retried for non-idempotent operations (message sends, template creation,
  uploads) by default, preventing duplicate delivery (e.g. duplicate OTPs). `429`
  is still always retried. Opt back in with `retry.retryNonIdempotent: true` if you
  have your own dedup. (Reads/deletes are still retried on `5xx`/network/timeout.)
- **Webhook `metadata.raw` is now opt-in.** Set `includeRawWebhook: true` to populate
  it; otherwise it is `undefined` so parsed events don't each retain the full body.
- **Wati no longer reports `webhook.signature_verification` support** — Wati does not
  natively sign webhooks. `supports('webhook.signature_verification')` returns `false`.
  The `verifyWebhookSignature` method still works if you front Wati with a signing gateway.
- **Wati `markAsRead` now throws `UnsupportedFeatureError`** instead of silently no-op'ing.
- **Cloud API / 360dialog sends throw `ProviderError`** when the provider returns no
  message ID (previously returned an empty `messageId` silently).
- **`webhook.parse(body)` / `parseWebhook(body)` dropped the unused `headers` parameter.**

### Fixed

- **`5xx` responses are now retried** for idempotent requests (previously they were
  classified as non-retryable and never retried, contradicting the docs).
- **`createTemplate` now sends the correct UPPERCASE** `category` / component `type` /
  `format` / button `type` to Meta's create endpoint (lowercasing caused `(#100)` errors).
- **`onError` hook** now fires once, after retries are exhausted, with the actual thrown
  error (covering network/timeout), instead of the raw response body on every attempt.
- **`onRequest` / `onResponse` hooks** now also cover media upload/download.
- **Empty / non-JSON `2xx` bodies** surface as a typed `ProviderError` instead of an
  unhandled `SyntaxError`.
- **`Retry-After`** is capped at `maxDelay` (a huge value can no longer park an edge
  function past its time budget) and parsed NaN-safely.
- **Interactive list** validation now enforces WhatsApp's real limit of ≤10 rows total
  across sections (previously only checked ≤10 sections).
- **Wati `media.upload`** returns `{ id, url }` so the URL can be passed to sends (Wati
  sends require a URL, not a media ID).

### Performance / memory

- **Rate limiter:** bounded wait queue (rejects with `RateLimitError` on overflow rather
  than growing memory), per-waiter timeout (`queueTimeoutMs`, rejects with `TimeoutError`
  so a request never hangs before its fetch starts), FIFO fairness (newcomers no longer
  jump queued waiters), and config validation (non-positive `maxRequestsPerSecond` /
  sizes now throw instead of dead-locking).
- **`destroy()` is now reachable** — `wa.destroy()` (and provider/`HttpClient` `destroy()`)
  release the limiter's pending timer and queued waiters. Documented for per-request clients.
- **Upload memory:** removed a redundant full-buffer copy in `uploadMedia`.
- **Webhook parsing:** Cloud API indexes contacts once per change instead of an O(messages×contacts) scan.
- **Signature verification:** hex encoding uses a lookup table; phone-normalization regexes hoisted to module scope.

### Added

- **`wa.otp.send(to, code, { template, language?, button? })`** — builds the correct
  authentication-template payload (code in the body and copy-code / one-tap button).
- **OTP/authentication template types** — `TemplateButtonDef` now supports `OTP` buttons
  (`otp_type`, `autofill_text`, `package_name`, `signature_hash`) and `TemplateComponentDef`
  supports `add_security_recommendation` / `code_expiration_minutes`, so auth templates are
  expressible via `template.create()`.
- **Factory config validation** — `createWhatsApp` fails fast with a clear `ValidationError`
  when required credentials are missing.
- **`rateLimit.maxQueueSize` / `rateLimit.queueTimeoutMs`** and **`retry.retryNonIdempotent`**
  / **`includeRawWebhook`** options.
