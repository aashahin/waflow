# Changelog

All notable changes to this project are documented here. This project adheres to
[Semantic Versioning](https://semver.org/) (pre-1.0: breaking changes bump the minor).

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
