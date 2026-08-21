let meta = #{
    name: "waflow-audit-fix-verify-gate",
    description: "Critic, fix, verify, and adversarially gate every waflow 0.6.0 production-audit finding",
    phases: [
        #{ title: "Critic", detail: "confirm each audit finding still present" },
        #{ title: "Implement", detail: "parallel non-overlapping fix streams" },
        #{ title: "Integrate", detail: "cross-stream wiring + typecheck" },
        #{ title: "Verify", detail: "typecheck + bun test + invariant greps" },
        #{ title: "Gate", detail: "adversarial re-check of critical fixes" },
        #{ title: "Remediate", detail: "fix blocking gate items if any" },
    ],
    when_to_use: "After the waflow deep production review; close every code-fixable finding",
};

let critic_schema = #{
    "type": "object",
    "required": ["confirmed", "already_fixed", "summary"],
    "properties": #{
        "confirmed": #{ "type": "array", "items": #{ "type": "string" }, "maxItems": 60 },
        "already_fixed": #{ "type": "array", "items": #{ "type": "string" }, "maxItems": 60 },
        "summary": #{ "type": "string" },
    },
};

let implement_schema = #{
    "type": "object",
    "required": ["ok", "files_changed", "summary"],
    "properties": #{
        "ok": #{ "type": "boolean" },
        "files_changed": #{ "type": "array", "items": #{ "type": "string" }, "maxItems": 50 },
        "summary": #{ "type": "string" },
        "notes": #{ "type": "string" },
    },
};

let verify_schema = #{
    "type": "object",
    "required": ["ok", "typecheck_ok", "tests_ok", "invariants_ok", "failures", "summary"],
    "properties": #{
        "ok": #{ "type": "boolean" },
        "typecheck_ok": #{ "type": "boolean" },
        "tests_ok": #{ "type": "boolean" },
        "invariants_ok": #{ "type": "boolean" },
        "failures": #{ "type": "array", "items": #{ "type": "string" }, "maxItems": 50 },
        "commands_run": #{ "type": "array", "items": #{ "type": "string" }, "maxItems": 30 },
        "summary": #{ "type": "string" },
    },
};

let gate_schema = #{
    "type": "object",
    "required": ["pass", "blocking", "non_blocking", "summary"],
    "properties": #{
        "pass": #{ "type": "boolean" },
        "blocking": #{ "type": "array", "items": #{ "type": "string" }, "maxItems": 40 },
        "non_blocking": #{ "type": "array", "items": #{ "type": "string" }, "maxItems": 50 },
        "summary": #{ "type": "string" },
        "report_path": #{ "type": "string" },
    },
};

let fix_schema = #{
    "type": "object",
    "required": ["ok", "fixed", "remaining"],
    "properties": #{
        "ok": #{ "type": "boolean" },
        "fixed": #{ "type": "array", "items": #{ "type": "string" }, "maxItems": 40 },
        "remaining": #{ "type": "array", "items": #{ "type": "string" }, "maxItems": 40 },
        "summary": #{ "type": "string" },
    },
};

let root = if args == () || args.root == () {
    "/home/shahin/Documents/projects/personal/packages/waflow"
} else {
    args.root
};

// ─── Critic ──────────────────────────────────────────────────────
phase("Critic");
log("Critic: confirming waflow production-audit findings in " + root);

let critic_common = "";
critic_common += "Repo root: " + root + "\n";
critic_common += "Package: waflow 0.6.0 — unified WhatsApp provider SDK (TypeScript, Bun tests, zero runtime deps).\n";
critic_common += "You are a skeptical critic. Use read_file and grep ONLY. Do not edit.\n";
critic_common += "For each item: CONFIRMED (still present, file:line) or ALREADY_FIXED (file:line evidence).\n";
critic_common += "Do not invent. Empty already_fixed is valid only after you have read the code.\n";
critic_common += "Read the actual source, not memory.\n";

let c_core = critic_common;
c_core += "SCOPE: src/core (url-guard, http, retry, rate-limiter) and src/utils/crypto.ts.\n";
c_core += "C1 SSRF: isPrivateHostname allows IPv4-compatible IPv6 loopback ::7f00:1 / [::127.0.0.1] (hostname becomes [::7f00:1]). Confirmed in prior bun probe.\n";
c_core += "C2 SSRF: 6to4 2002:7f00:1:: encoding 127.0.0.1 is allowed.\n";
c_core += "C3 SSRF: CGNAT 100.64.0.0/10 is allowed.\n";
c_core += "C4 SSRF: doFetch uses fetch() without redirect option (default follow) so 302 to 169.254.169.254 is not re-checked.\n";
c_core += "C5 SSRF overreach: assertSafeFetchUrl runs on EVERY absolute URL including configured baseUrl, so http://127.0.0.1 API hosts are rejected.\n";
c_core += "C6 Abort: retry.ts sleep() is bare setTimeout; withRetry ignores AbortSignal. RateLimiter.acquire() has no signal; waiters ignore caller abort.\n";
c_core += "C7 HMAC: verifyHmacSha256 does not lowercase the provided signature; uppercase hex fails. timingSafeEqual loops to max length with no 64-char cap.\n";
c_core += "Return confirmed[], already_fixed[], summary.\n";

let c_prov = critic_common;
c_prov += "SCOPE: providers (360dialog, cloud-api, wati), http-error, mappers, webhook parsers.\n";
c_prov += "P1 360dialog media.download fetches lookaside.fbsbx.com as-is and STRIPS D360-API-KEY (isTrustedMediaHost false for Meta CDNs on provider 360dialog). Official docs require rewriting host to waba-v2.360dialog.io and sending D360-API-KEY. Tests lock in the broken strip.\n";
c_prov += "P2 downloadMedia uses startsWith('http://')||startsWith('https://') not URL parse; HTTPS:// is treated as a media id.\n";
c_prov += "P3 Wati sendMessage with result:true and no messageId returns messageId '' instead of throwing ProviderError (Cloud API throws).\n";
c_prov += "P4 Wati parseWatiTimestamp: all-digit strings are always seconds; 13-digit epoch-ms becomes a far-future Date.\n";
c_prov += "P5 throwForHttpError maps ALL HTTP 403 to AuthenticationError, including non-auth Graph business errors.\n";
c_prov += "P6 getMediaUrl file_size: '0' is dropped because of truthy check before parseInt.\n";
c_prov += "P7 Cloud API webhook parser: field !== 'messages' drops other fields; nfm_reply becomes unknown (ok) but messages[].errors are ignored.\n";
c_prov += "P8 Interactive mapper does not enforce WhatsApp button title <=20 chars / list row title <=24.\n";
c_prov += "Return confirmed[], already_fixed[], summary.\n";

let c_docs = critic_common;
c_docs += "SCOPE: README, CHANGELOG, package.json, CI, types, unused errors, client hooks.\n";
c_docs += "D1 README claims AbortSignal.timeout() is used; code uses a custom unref timer in url-guard.ts.\n";
c_docs += "D2 README 360dialog media section does not describe lookaside host rewrite.\n";
c_docs += "D3 README does not warn that onRequest body can contain OTP codes.\n";
c_docs += "D4 .github/workflows/ci.yml uses bun-version: latest, does not run bun run build, bun.lock is gitignored.\n";
c_docs += "D5 package.json has no sideEffects: false.\n";
c_docs += "D6 TemplateError and WebhookVerificationError are exported but never thrown in src/ (only tests construct them).\n";
c_docs += "D7 SendResult.provider is ProviderName union so custom adapters cannot type their own name.\n";
c_docs += "D8 CHANGELOG has no Unreleased notes for these fixes.\n";
c_docs += "Return confirmed[], already_fixed[], summary.\n";

let critic_jobs = [
    #{ prompt: c_core, label: "critic:core-http-crypto", capability_mode: "read-only", output_schema: critic_schema },
    #{ prompt: c_prov, label: "critic:providers", capability_mode: "read-only", output_schema: critic_schema },
    #{ prompt: c_docs, label: "critic:docs-ci-types", capability_mode: "read-only", output_schema: critic_schema },
];
let critic_results = parallel(critic_jobs);

let already_fixed = [];
let confirmed = [];
let ci = 0;
while ci < critic_results.len() {
    let cr = critic_results[ci];
    if cr != () && cr.success && cr.output != () {
        if cr.output.already_fixed != () {
            let aj = 0;
            while aj < cr.output.already_fixed.len() {
                already_fixed.push(cr.output.already_fixed[aj]);
                aj += 1;
            }
        }
        if cr.output.confirmed != () {
            let cj = 0;
            while cj < cr.output.confirmed.len() {
                confirmed.push(cr.output.confirmed[cj]);
                cj += 1;
            }
        }
        log("Critic: " + cr.output.summary);
    } else {
        log("Critic slot " + ci.to_string() + " failed — treating items as still open");
    }
    ci += 1;
}
log("Critic confirmed=" + confirmed.len().to_string() + " already_fixed=" + already_fixed.len().to_string());
let already_json = json_encode(already_fixed);

// ─── Implement ───────────────────────────────────────────────────
phase("Implement");
log("Implementing audit fixes in " + root);

let common = "";
common += "Repo root: " + root + "\n";
common += "Package: waflow (TypeScript SDK, bun:test, tsup, zero runtime deps, edge-first Web APIs).\n";
common += "Rules: read files BEFORE edit; minimal surgical diffs; do NOT commit; do NOT push.\n";
common += "Match existing error types, test style (bun:test), and comments-explain-why only.\n";
common += "After edits re-read changed regions. Add/update tests for every behavior change.\n";
common += "Skip an item only if already fixed with evidence. Already-fixed list: " + already_json + "\n";
common += "Do not add runtime dependencies. Do not use node:crypto or Buffer.\n";
common += "Return JSON {ok, files_changed, summary, notes}.\n";

let p_a = "";
p_a += common;
p_a += "STREAM A — SSRF hostname classification. OWN FILES ONLY:\n";
p_a += "- " + root + "/src/core/url-guard.ts\n";
p_a += "- " + root + "/tests/core/url-guard.test.ts\n";
p_a += "Do NOT edit http.ts (Stream B) or providers.\n\n";
p_a += "TASKS:\n";
p_a += "C1) IPv4-compatible IPv6: after parseIpv6Hextets, if hextets[0..5] are 0 and hextets[6]/[7] form an IPv4 (not only the mapped ffff case), run isPrivateIpv4 on that address. Cover ::7f00:1 and hostname [::7f00:1] (strip brackets already). Also handle mixed ::127.0.0.1 via existing mixed parser then the compatible check.\n";
p_a += "C2) 6to4: if hextets[0]===0x2002, IPv4 is hextets[1] and hextets[2] as two 16-bit halves; if that v4 is private, return true. Cover 2002:7f00:1:: and 2002:7f00:0001::.\n";
p_a += "C3) Block CGNAT 100.64.0.0/10 in isPrivateIpv4 (a===100 && b>=64 && b<=127).\n";
p_a += "Optional: NAT64 well-known prefix 64:ff9b:0:0:0:0:x:x — if hextets match, treat trailing as IPv4.\n";
p_a += "Export a helper isSameOrigin(url, baseUrl): boolean (false on parse failure) for Stream B to use — keep it in url-guard.ts.\n";
p_a += "Keep existing checks (loopback, RFC1918, link-local, mapped ffff, decimal IPv4, leading-zero IPv4, .localhost/.local/.internal).\n";
p_a += "Tests: isPrivateHostname('::7f00:1') true; '[::7f00:1]' true; assertSafeFetchUrl('http://[::127.0.0.1]/') throws; 'http://[2002:7f00:1::]/' throws; 'http://100.64.0.1/' throws; public 8.8.8.8 and lookaside.fbsbx.com still false. Keep existing tests passing.\n";

let p_b = "";
p_b += common;
p_b += "STREAM B — HTTP client, redirects, abort plumbing. OWN FILES ONLY:\n";
p_b += "- " + root + "/src/core/http.ts\n";
p_b += "- " + root + "/src/core/retry.ts\n";
p_b += "- " + root + "/src/core/rate-limiter.ts\n";
p_b += "- " + root + "/tests/core/http.test.ts\n";
p_b += "- " + root + "/tests/core/retry.test.ts\n";
p_b += "- " + root + "/tests/core/rate-limiter.test.ts\n";
p_b += "You MAY import isSameOrigin from url-guard.ts once Stream A adds it; if missing when you run, implement a local origin compare identical to url-guard and Stream A will export the shared one — Integrate will dedupe.\n";
p_b += "Do NOT edit url-guard.ts or providers.\n\n";
p_b += "TASKS:\n";
p_b += "C5) doFetch: call assertSafeFetchUrl only when the URL is absolute AND its origin is NOT the configured baseUrl origin (isSameOrigin). API calls to http://127.0.0.1:4010 must proceed. Downloads to 127.0.0.1 when baseUrl is graph.facebook.com must still be refused.\n";
p_b += "C4) fetch with redirect: 'manual' (never 'follow'). If status is 301/302/303/307/308: read Location, resolve with new URL(location, currentUrl), if not same as baseUrl origin then assertSafeFetchUrl, compute headers via headersForUrl(resolvedHref, original headers), retry fetch up to 5 hops. 303/302 POST should become GET with no body (HTTP semantics). If Location missing/invalid, throw ProviderError or NetworkError. Do not forward stripped credentials to an untrusted hop.\n";
p_b += "C6 retry: withRetry accepts optional AbortSignal (add to RetryPolicy or a 5th arg — prefer extending RetryPolicy with signal?: AbortSignal). sleep must reject when aborted (listen abort, clearTimeout). Before each retry delay and before calling fn, if signal.aborted throw NetworkError retryable:false 'Request aborted'.\n";
p_b += "C6 limiter: acquire(signal?: AbortSignal): if signal already aborted, reject NetworkError-equivalent — RateLimiter should not import NetworkError if that creates a cycle; reject with TimeoutError or a small AbortError. Prefer throwing TimeoutError with message 'Rate limiter wait aborted' and retryable:false if TimeoutError supports retryable; else RateLimitError retryable:false. Listen to abort while queued; fail waiter. HttpClient.acquire() must pass opts.signal ?? config.signal into acquire AND into withRetry policy.\n";
p_b += "Tests: localhost baseUrl GET /messages is allowed (mock fetch, expect called); private absolute download still rejected when baseUrl is graph.facebook.com; redirect 302 to 127.0.0.1 does not call fetch on the private URL (or throws ValidationError before); abort during retry sleep does not wait full delay (use tiny delays); acquire aborted signal rejects without hanging.\n";
p_b += "Keep hook isolation tests. Keep credential strip tests.\n";

let p_c = "";
p_c += common;
p_c += "STREAM C — 360dialog media download. OWN FILES ONLY:\n";
p_c += "- " + root + "/src/providers/360dialog/index.ts\n";
p_c += "- " + root + "/tests/providers/360dialog/provider.test.ts\n";
p_c += "Do NOT edit http.ts, url-guard.ts, or cloud-api.\n\n";
p_c += "TASKS:\n";
p_c += "P1) Implement rewriteDialog360MediaUrl(downloadUrl, apiBaseUrl): if hostname is a Meta media CDN (lookaside.fbsbx.com, *.fbsbx.com, *.fbcdn.net, *.facebook.com except graph.facebook.com / graph.whatsapp.com, *.whatsapp.net), return a URL with origin replaced by apiBaseUrl origin (config.baseUrl or https://waba-v2.360dialog.io) keeping pathname+search+hash. Otherwise return downloadUrl unchanged.\n";
p_c += "In downloadMedia: resolve media id via getMediaUrl or use absolute URL; THEN rewrite; THEN rawRequest the rewritten URL so D360-API-KEY is kept (same origin as baseUrl).\n";
p_c += "P2) Detect absolute URLs via isAbsoluteUrl from url-guard (or new URL) not startsWith lowercase http.\n";
p_c += "P6) getMediaUrl fileSize: parse file_size when it is a non-empty string including '0' (check typeof string/number, not truthiness).\n";
p_c += "TESTS (replace the broken one):\n";
p_c += "- downloadMedia('https://lookaside.fbsbx.com/whatsapp_business/attachments/?mid=1&ext=1&hash=x') must fetch https://waba-v2.360dialog.io/whatsapp_business/attachments/?mid=1&ext=1&hash=x (or the configured baseUrl host) WITH D360-API-KEY set.\n";
p_c += "- downloadMedia(mediaId) after getMediaUrl returning lookaside URL must likewise rewrite + keep key (mock two fetches).\n";
p_c += "- untrusted https://cdn.example.com/photo.jpg still has D360-API-KEY stripped (http layer) — this may still pass if rewrite does not apply.\n";
p_c += "- private http://127.0.0.1/latest still rejected when baseUrl is waba-v2.360dialog.io.\n";
p_c += "Do not keep a test that expects the key stripped on lookaside — that was the bug.\n";

let p_d = "";
p_d += common;
p_d += "STREAM D — HMAC verification. OWN FILES ONLY:\n";
p_d += "- " + root + "/src/utils/crypto.ts\n";
p_d += "- " + root + "/tests/utils/crypto.test.ts\n\n";
p_d += "TASKS:\n";
p_d += "C7) After stripping sha256= prefix (case-insensitive prefix check: sha256= or SHA256=), lowercase the remaining hex. If length !== 64, return false without comparing huge strings (SHA-256 hex length is public).\n";
p_d += "Still use timingSafeEqual for the 64-char case.\n";
p_d += "Tests: uppercase hex succeeds; sha256=UPPER succeeds; 10_000-char junk returns false quickly; existing valid lowercase tests still pass.\n";

let p_e = "";
p_e += common;
p_e += "STREAM E — Wati correctness. OWN FILES ONLY:\n";
p_e += "- " + root + "/src/providers/wati/index.ts\n";
p_e += "- " + root + "/src/providers/wati/webhook-parser.ts\n";
p_e += "- " + root + "/tests/providers/wati/provider.test.ts\n";
p_e += "- " + root + "/tests/providers/wati/webhook-parser.test.ts\n";
p_e += "Do not edit mapper.ts unless a test requires it.\n\n";
p_e += "TASKS:\n";
p_e += "P3) After result===true, if extractMessageId is empty, throw ProviderError (same message spirit as Cloud API: provider returned no message ID). Remove the warn-and-return-empty-id path. Update the test 'allows successful sends when Wati omits a message ID' to expect ProviderError.\n";
p_e += "P4) parseWatiTimestamp: if raw is all digits, let n=parseInt; if n >= 1e12 treat as milliseconds, else seconds. ISO path unchanged. Test 13-digit ms near a known epoch and 10-digit seconds.\n";

let p_f = "";
p_f += common;
p_f += "STREAM F — Cloud API + Graph errors + mapper. OWN FILES ONLY:\n";
p_f += "- " + root + "/src/providers/cloud-api/index.ts\n";
p_f += "- " + root + "/src/providers/cloud-api/mapper.ts\n";
p_f += "- " + root + "/src/providers/cloud-api/webhook-parser.ts\n";
p_f += "- " + root + "/src/core/http-error.ts\n";
p_f += "- " + root + "/tests/providers/cloud-api/provider.test.ts\n";
p_f += "- " + root + "/tests/providers/cloud-api/mapper.test.ts\n";
p_f += "- " + root + "/tests/providers/cloud-api/webhook-parser.test.ts\n";
p_f += "- " + root + "/tests/core/http-error.test.ts\n";
p_f += "Do not edit 360dialog or http.ts.\n\n";
p_f += "TASKS:\n";
p_f += "P2) downloadMedia: treat as URL if new URL succeeds with http(s) protocol (or isAbsoluteUrl after normalizing). Uppercase HTTPS://example.com must download that URL, not GET /HTTPS://...\n";
p_f += "P5) throwForHttpError: HTTP 403 is AuthenticationError only when graph code is in AUTH_CODES (or type OAuthException). Otherwise ProviderError (access forbidden / business error). Keep 401 as AuthenticationError. Add test: 403 + code 131047 => ProviderError; 403 + code 190 => AuthenticationError.\n";
p_f += "P6) fileSize: parse when file_size is '0' or 0 (not truthy check).\n";
p_f += "P7) webhook: if msg.errors array present on a message, still emit the message (unknown/text) but that is enough; additionally parse type nfm_reply as {type:'unknown', raw: msg} explicitly (already default — add a test). If field is smb_message_echoes or message_echoes and value.messages exists, parse like messages (do not continue-skip). Keep message_template_status_update.\n";
p_f += "P8) mapper interactive.button: throw ValidationError if any button.title length > 20 or buttons empty. interactive.list: throw if any row.title length > 24. Tests.\n";

let p_g = "";
p_g += common;
p_g += "STREAM G — docs, CI, package metadata, types. OWN FILES ONLY:\n";
p_g += "- " + root + "/README.md\n";
p_g += "- " + root + "/CHANGELOG.md\n";
p_g += "- " + root + "/package.json\n";
p_g += "- " + root + "/.github/workflows/ci.yml\n";
p_g += "- " + root + "/src/types/common.ts\n";
p_g += "- " + root + "/src/types/config.ts (hook JSDoc only)\n";
p_g += "- " + root + "/src/core/errors.ts (JSDoc only on unused classes)\n";
p_g += "Do not edit provider logic files.\n\n";
p_g += "TASKS:\n";
p_g += "D1) README Runtime Compatibility table: replace AbortSignal.timeout() with custom unref'd timeout via AbortController (makeRequestSignal).\n";
p_g += "D2) README 360dialog + Media Operations: document that 360dialog downloads rewrite lookaside.fbsbx.com -> configured baseUrl (waba-v2.360dialog.io) and send D360-API-KEY. Do not fetch Meta CDNs with the 360dialog key.\n";
p_g += "D3) Hooks section: warn onRequest.body may contain OTP/template parameters — do not log raw bodies in production.\n";
p_g += "Also document: SSRF checks apply to caller-supplied absolute URLs, not to the configured API baseUrl (so localhost mocks work). Caller abort cancels retry backoff and rate-limit wait. Wati throws ProviderError when the send is accepted without a message id (breaking vs 0.6.0). HMAC signatures are compared case-insensitively as hex.\n";
p_g += "D4) ci.yml: pin bun-version to '1.2.21' (or another stable 1.2.x if you confirm), add step bun run build after tests.\n";
p_g += "D5) package.json: add \"sideEffects\": false.\n";
p_g += "D6) errors.ts: JSDoc on TemplateError and WebhookVerificationError — reserved for consumers / future use; webhook.verify returns boolean and does not throw WebhookVerificationError.\n";
p_g += "D7) ProviderName: change to string union that still autocompletes known providers but allows custom: type ProviderName = 'cloud-api' | '360dialog' | 'wati' | (string & {}). If that breaks tests, use string. SendResult.provider follows.\n";
p_g += "D8) CHANGELOG: add ## Unreleased (0.7.0) with Breaking / Fixed matching the real behavior (360dialog rewrite, Wati empty id throw, SSRF scoped to non-baseUrl, IPv6/CGNAT/redirect hardening, abortable retry/limiter, HMAC case, 403 classification, interactive title limits).\n";
p_g += "Do not bump package.json version unless you also update CHANGELOG consistently — prefer Unreleased without version bump.\n";

let jobs = [
    #{ prompt: p_a, label: "fix:ssrf-url-guard", capability_mode: "all", output_schema: implement_schema },
    #{ prompt: p_b, label: "fix:http-retry-limiter", capability_mode: "all", output_schema: implement_schema },
    #{ prompt: p_c, label: "fix:360dialog-media", capability_mode: "all", output_schema: implement_schema },
    #{ prompt: p_d, label: "fix:hmac-crypto", capability_mode: "all", output_schema: implement_schema },
    #{ prompt: p_e, label: "fix:wati", capability_mode: "all", output_schema: implement_schema },
    #{ prompt: p_f, label: "fix:cloud-api-errors", capability_mode: "all", output_schema: implement_schema },
    #{ prompt: p_g, label: "fix:docs-ci-types", capability_mode: "all", output_schema: implement_schema },
];

let impl_results = parallel(jobs);
let impl_ok_count = 0;
let impl_fail_count = 0;
let impl_i = 0;
while impl_i < impl_results.len() {
    let r = impl_results[impl_i];
    if r != () && r.success && r.output != () && r.output.ok == true {
        impl_ok_count += 1;
        log("OK implement: " + r.output.summary);
    } else {
        impl_fail_count += 1;
        log("FAIL implement slot " + impl_i.to_string());
    }
    impl_i += 1;
}
log("Implement done ok=" + impl_ok_count.to_string() + " fail=" + impl_fail_count.to_string());

// ─── Integrate ───────────────────────────────────────────────────
phase("Integrate");
let p_int = "";
p_int += "Integrate waflow audit fixes in " + root + ". Do NOT commit.\n";
p_int += "Cross-stream wiring plus compile/test breakage. You may edit any file.\n";
p_int += "1) If both url-guard and http.ts define origin compare, keep a single isSameOrigin export from url-guard and use it in http.ts. Import must resolve.\n";
p_int += "2) HttpClient must pass per-request and client-level AbortSignal into rateLimiter.acquire and withRetry. Confirm acquire signature matches callers.\n";
p_int += "3) 360dialog rewrite + http same-origin skip + credential keep must compose: rewritten waba URL keeps D360-API-KEY.\n";
p_int += "4) Wati ProviderError on empty id must still compile; tests updated.\n";
p_int += "5) ProviderName type change must compile across providers and tests.\n";
p_int += "6) Redirect-manual must not break JSON request tests (200 with no Location).\n";
p_int += "7) cd " + root + " && bun run typecheck\n";
p_int += "8) cd " + root + " && bun test\n";
p_int += "9) Fix TypeScript or test failures you can see until both pass, or report remaining errors honestly.\n";
p_int += "Return {ok, files_changed, summary, notes}.\n";

let int_result = agent(p_int, #{
    label: "integrate:wire-typecheck-tests",
    capability_mode: "all",
    output_schema: implement_schema,
});
if int_result == () || !int_result.success || int_result.output.ok != true {
    log("Integrate reported issues — verify will surface details");
} else {
    log("Integrate OK: " + int_result.output.summary);
}

// ─── Verify ──────────────────────────────────────────────────────
phase("Verify");
let p_ver = "";
p_ver += "Verify waflow audit fixes in " + root + " with command and file-read evidence.\n";
p_ver += "Use run_terminal_command, grep, read_file. Do not edit unless a one-line import is clearly broken — prefer reporting failures.\n";
p_ver += "1) cd " + root + " && bun run typecheck\n";
p_ver += "2) cd " + root + " && bun test\n";
p_ver += "3) Invariant greps / reads (must hold):\n";
p_ver += "   - url-guard.ts classifies ::7f00:1 or IPv4-compatible hextets as private (read isPrivateHostname / parseIpv6)\n";
p_ver += "   - isPrivateIpv4 treats 100.64-127 as private\n";
p_ver += "   - http.ts fetch uses redirect: 'manual' or equivalent non-follow\n";
p_ver += "   - assertSafeFetchUrl is skipped or not applied when origin matches baseUrl (read doFetch)\n";
p_ver += "   - retry.ts sleep/withRetry observes AbortSignal\n";
p_ver += "   - rate-limiter acquire accepts a signal or abort path\n";
p_ver += "   - 360dialog downloadMedia rewrites lookaside/fbsbx to baseUrl (read the provider file)\n";
p_ver += "   - tests must NOT expect D360-API-KEY stripped on lookaside.fbsbx.com\n";
p_ver += "   - crypto.ts lowercases signature hex; rejects length !== 64 after strip\n";
p_ver += "   - Wati sendMessage throws when message id missing (no return of empty messageId after result true)\n";
p_ver += "   - http-error.ts 403 is not unconditionally AuthenticationError\n";
p_ver += "   - README mentions 360dialog host rewrite\n";
p_ver += "   - ci.yml contains bun run build\n";
p_ver += "   - package.json has sideEffects\n";
p_ver += "4) Do not publish. Do not npm publish.\n";
p_ver += "Return typecheck_ok, tests_ok, invariants_ok, failures[], commands_run[], summary, ok=all three true.\n";

let ver = agent(p_ver, #{
    label: "verify:typecheck-tests-invariants",
    capability_mode: "all",
    output_schema: verify_schema,
});

let typecheck_ok = false;
let tests_ok = false;
let invariants_ok = false;
let ver_failures = [];
if ver != () && ver.success && ver.output != () {
    typecheck_ok = ver.output.typecheck_ok == true;
    tests_ok = ver.output.tests_ok == true;
    invariants_ok = ver.output.invariants_ok == true;
    if ver.output.failures != () {
        ver_failures = ver.output.failures;
    }
    log("Verify: " + ver.output.summary);
} else {
    log("Verify agent failed");
    ver_failures.push("verify agent failed or empty");
}

// ─── Gate ────────────────────────────────────────────────────────
phase("Gate");
let p_gate = "";
p_gate += "Adversarially gate the waflow audit remediation in " + root + ".\n";
p_gate += "You are a skeptical reviewer. Read the actual code with read_file/grep. Do NOT trust summaries or agent notes.\n";
p_gate += "Check each original finding:\n";
p_gate += "CRITICAL: 360dialog lookaside rewrite + API key on waba host; IPv4-compatible IPv6 blocked; 6to4 blocked; CGNAT blocked; fetch does not follow redirects blindly; private baseUrl allowed for API origin only.\n";
p_gate += "IMPORTANT: abort cancels retry sleep and limiter wait; Wati empty id throws; HMAC case-insensitive 64-hex; 403 not always AUTH; downloadMedia accepts HTTPS uppercase; file_size 0 parsed; interactive title limits; docs/CI/changelog honest.\n";
p_gate += "Mark blocking only if a CRITICAL or IMPORTANT item is still broken, typecheck would fail, or bun test would fail on the touched behavior.\n";
p_gate += "Write a markdown report via write_scratch_file('waflow-audit-gate-report.md', content).\n";
p_gate += "Return pass (true only if no blocking), blocking[], non_blocking[], summary, report_path.\n";

let gate = agent(p_gate, #{
    label: "gate:adversarial",
    capability_mode: "all",
    output_schema: gate_schema,
});

let gate_pass = false;
let blocking = [];
let non_blocking = [];
let gate_summary = "gate incomplete";
if gate != () && gate.success && gate.output != () {
    gate_pass = gate.output.pass == true;
    if gate.output.blocking != () { blocking = gate.output.blocking; }
    if gate.output.non_blocking != () { non_blocking = gate.output.non_blocking; }
    gate_summary = gate.output.summary;
    log("Gate: pass=" + gate_pass.to_string() + " " + gate_summary);
} else {
    blocking.push("gate agent failed");
    log("Gate agent failed");
}

// ─── Remediate ───────────────────────────────────────────────────
phase("Remediate");
if blocking.len() > 0 || typecheck_ok != true || tests_ok != true || invariants_ok != true {
    log("Remediating blocking issues");
    let p_fix = "";
    p_fix += "Fix remaining blocking waflow audit issues in " + root + ".\n";
    p_fix += "Typecheck ok was: " + typecheck_ok.to_string() + "\n";
    p_fix += "Tests ok was: " + tests_ok.to_string() + "\n";
    p_fix += "Invariants ok was: " + invariants_ok.to_string() + "\n";
    p_fix += "Blocking list:\n";
    let bi = 0;
    while bi < blocking.len() {
        p_fix += "- " + blocking[bi] + "\n";
        bi += 1;
    }
    let fi = 0;
    while fi < ver_failures.len() {
        p_fix += "- verify failure: " + ver_failures[fi] + "\n";
        fi += 1;
    }
    p_fix += "Read code, fix, re-run bun run typecheck and bun test. Do not commit.\n";
    p_fix += "Return {ok, fixed, remaining, summary}.\n";

    let rem = agent(p_fix, #{
        label: "remediate:blocking",
        capability_mode: "all",
        output_schema: fix_schema,
    });

    let p_ver2 = "";
    p_ver2 += "Re-verify after remediation in " + root + ".\n";
    p_ver2 += "Run bun run typecheck and bun test. Re-check invariants: 360dialog rewrite, redirect manual, IPv6 compatible private, CGNAT, baseUrl skip SSRF, abortable retry/limiter, HMAC lowercase+64, Wati throws on empty id, 403 not always AUTH.\n";
    p_ver2 += "Return typecheck_ok, tests_ok, invariants_ok, failures, commands_run, summary, ok.\n";
    let ver2 = agent(p_ver2, #{
        label: "verify:post-remediate",
        capability_mode: "all",
        output_schema: verify_schema,
    });
    if ver2 != () && ver2.success && ver2.output != () {
        typecheck_ok = ver2.output.typecheck_ok == true;
        tests_ok = ver2.output.tests_ok == true;
        invariants_ok = ver2.output.invariants_ok == true;
        if ver2.output.failures != () { ver_failures = ver2.output.failures; }
        log("Post-remediate verify: " + ver2.output.summary);
    }

    let p_gate2 = "";
    p_gate2 += "Quick re-gate of " + root + " after remediation. Read code for remaining CRITICAL/IMPORTANT gaps only. ";
    p_gate2 += "Return pass, blocking, non_blocking, summary.\n";
    let gate2 = agent(p_gate2, #{
        label: "gate:post-remediate",
        capability_mode: "read-only",
        output_schema: gate_schema,
    });
    if gate2 != () && gate2.success && gate2.output != () {
        gate_pass = gate2.output.pass == true;
        if gate2.output.blocking != () { blocking = gate2.output.blocking; } else { blocking = []; }
        if gate2.output.non_blocking != () { non_blocking = gate2.output.non_blocking; }
        gate_summary = gate2.output.summary;
    }
    if rem != () && rem.success && rem.output != () {
        log("Remediate: " + rem.output.summary);
    }
} else {
    log("No remediation needed");
}

let final_pass = gate_pass == true && typecheck_ok == true && tests_ok == true && invariants_ok == true;
let report = "";
report += "# waflow audit-fix-verify-gate result\n\n";
report += "- final_pass: " + final_pass.to_string() + "\n";
report += "- typecheck_ok: " + typecheck_ok.to_string() + "\n";
report += "- tests_ok: " + tests_ok.to_string() + "\n";
report += "- invariants_ok: " + invariants_ok.to_string() + "\n";
report += "- gate_pass: " + gate_pass.to_string() + "\n";
report += "- implement ok/fail: " + impl_ok_count.to_string() + "/" + impl_fail_count.to_string() + "\n";
report += "- critic confirmed: " + confirmed.len().to_string() + " already_fixed: " + already_fixed.len().to_string() + "\n";
report += "- gate summary: " + gate_summary + "\n";
report += "\n## Blocking\n";
if blocking.len() == 0 {
    report += "(none)\n";
} else {
    let bj = 0;
    while bj < blocking.len() {
        report += "- " + blocking[bj] + "\n";
        bj += 1;
    }
}
report += "\n## Non-blocking\n";
if non_blocking.len() == 0 {
    report += "(none)\n";
} else {
    let nj = 0;
    while nj < non_blocking.len() {
        report += "- " + non_blocking[nj] + "\n";
        nj += 1;
    }
}

let report_path = write_scratch_file("waflow-audit-fix-result.md", report);
log("Wrote " + report_path);

complete(#{
    final_pass: final_pass,
    typecheck_ok: typecheck_ok,
    tests_ok: tests_ok,
    invariants_ok: invariants_ok,
    gate_pass: gate_pass,
    implement_ok: impl_ok_count,
    implement_fail: impl_fail_count,
    blocking: blocking,
    non_blocking: non_blocking,
    report_path: report_path,
    summary: gate_summary,
});
