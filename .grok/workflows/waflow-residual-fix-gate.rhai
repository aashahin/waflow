let meta = #{
    name: "waflow-residual-fix-gate",
    description: "Critic, fix, verify, and adversarially gate the 2026-08-21 residual waflow review findings",
    phases: [
        #{ title: "Critic", detail: "confirm each residual finding still present" },
        #{ title: "Implement", detail: "parallel non-overlapping fix streams" },
        #{ title: "Integrate", detail: "cross-stream wiring + typecheck + tests" },
        #{ title: "Verify", detail: "typecheck + bun test + invariant greps" },
        #{ title: "Gate", detail: "adversarial re-check of residual fixes" },
        #{ title: "Remediate", detail: "fix blocking gate items if any" },
    ],
    when_to_use: "After the 2026-08-21 residual production review of waflow (post 0.7 unreleased hardening)",
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
log("Critic: confirming residual review findings in " + root);

let critic_common = "";
critic_common += "Repo root: " + root + "\n";
critic_common += "Package: waflow (unified WhatsApp SDK, TypeScript, bun:test, zero runtime deps).\n";
critic_common += "You are a skeptical critic. Use read_file and grep ONLY. Do not edit.\n";
critic_common += "For each item: CONFIRMED (still present, file:line) or ALREADY_FIXED (file:line evidence).\n";
critic_common += "Do not invent. Empty already_fixed is valid only after you have read the code.\n";
critic_common += "Read the actual source, not memory. These findings are from a 2026-08-21 residual review AFTER 0.7 unreleased SSRF/HMAC/abort hardening.\n";

let c_core = critic_common;
c_core += "SCOPE: src/core/url-guard.ts, src/core/http.ts, src/core/rate-limiter.ts.\n";
c_core += "R1 CRITICAL SSRF: isPrivateHostname does not strip trailing FQDN dots. Bun URL parser keeps trailing dots: hostname localhost. for http://localhost./ . Probe showed ALLOWED: http://localhost./ http://foo.localhost./ http://metadata.google.internal./ while the no-dot forms are blocked. Redirect hops use the same check.\n";
c_core += "R2 IMPORTANT: mergeAbortSignals polyfill (when AbortSignal.any missing) adds abort listeners to the long-lived client signal and never removes them. engines is node >=18; AbortSignal.any is Node 20.3+.\n";
c_core += "R3 IMPORTANT: doFetch cleanup() in finally cancels the timeout when headers arrive. request() then parseJsonBody/handleErrorResponse read the body with no abort. JSON/API timeout is TTFB-only, unlike documented download behavior.\n";
c_core += "R4 IMPORTANT: fetch AbortError without user/client signal aborted is always TimeoutError, even when timeout is 0 (no SDK timeout).\n";
c_core += "R5 IMPORTANT: HttpClient debug logs the full URL including query (signed Meta CDN tokens). this.log debug METHOD url.\n";
c_core += "R6 IMPORTANT: isTrustedMediaHost for cloud-api treats any *.facebook.com / *.whatsapp.net as trusted and forwards Authorization. www.facebook.com would get the bearer token.\n";
c_core += "R7 NIT: rate-limiter.ts comment says abort rejects with TimeoutError; acquire abort throws NetworkError. Do not change destroy() error type (TimeoutError is documented breaking in 0.5.0).\n";
c_core += "Return confirmed[], already_fixed[], summary.\n";

let c_prov = critic_common;
c_prov += "SCOPE: providers cloud-api, 360dialog, wati mapper, webhook parser, types/webhooks.ts, phone.ts.\n";
c_prov += "R8 IMPORTANT: getMediaUrl/deleteMedia interpolate mediaId into path with `/${mediaId}` (cloud-api and 360dialog). No encodeURIComponent. IDs with /, ?, #, or .. path-traverse Graph/360dialog with credentials (e.g. getUrl('me')).\n";
c_prov += "R9 IMPORTANT: parseCloudApiWebhook treats smb_message_echoes and message_echoes as inbound type:message with NO echo flag on IncomingMessageEvent. Coexistence bots can auto-reply to own echoes.\n";
c_prov += "R10 IMPORTANT: mapOutboundToWati flattenTemplateParameters only copies header/body text params. Image/video/document/currency/button params are silently dropped.\n";
c_prov += "R11 IMPORTANT: 360dialog rewriteDialog360MediaUrl rewrites ANY Meta-CDN URL path onto api origin with D360-API-KEY. Restrict to WhatsApp attachment paths (pathname contains /whatsapp_business/ or /attachments).\n";
c_prov += "R12 IMPORTANT: listTemplates has no fields= or limit=; loads every page into memory.\n";
c_prov += "R13 IMPORTANT: uploadMedia uses client timeout default 30s (params.timeout ?? config.timeout). Large uploads fail unless caller sets timeout.\n";
c_prov += "R14 NIT: contentLength: parseInt(content-length) can be NaN (cloud-api and 360dialog downloadMedia).\n";
c_prov += "R15 NIT: normalizePhoneNumber STRIP_CHARS is only [\\s\\-()+]. Zero-width / bidi marks fail validation.\n";
c_prov += "R16 NIT: interactive mapper does not cap button.id (256), body (1024), row.description (72), or reject empty sections/zero rows.\n";
c_prov += "Return confirmed[], already_fixed[], summary.\n";

let c_docs = critic_common;
c_docs += "SCOPE: README.md, CHANGELOG.md, src/index.ts factory, package.json.\n";
c_docs += "R17 IMPORTANT: createWhatsApp in src/index.ts imports all three providers so default import cannot tree-shake. Docs should show createWhatsAppFromAdapter + subpath import as the edge bundle path.\n";
c_docs += "R18 docs: README SSRF section does not mention trailing-dot hostnames or that redirect-to-localhost. bypasses the guard.\n";
c_docs += "R19 docs: CHANGELOG Unreleased has no notes for this residual pass.\n";
c_docs += "R20 docs: README does not warn debug logs / onRequest.url may include signed media query strings.\n";
c_docs += "Return confirmed[], already_fixed[], summary.\n";

let critic_jobs = [
    #{ prompt: c_core, label: "critic:core-http-ssrf", capability_mode: "read-only", output_schema: critic_schema },
    #{ prompt: c_prov, label: "critic:providers-webhooks", capability_mode: "read-only", output_schema: critic_schema },
    #{ prompt: c_docs, label: "critic:docs-bundle", capability_mode: "read-only", output_schema: critic_schema },
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
log("Implementing residual review fixes in " + root);

let common = "";
common += "Repo root: " + root + "\n";
common += "Package: waflow (TypeScript SDK, bun:test, tsup, zero runtime deps, edge-first Web APIs).\n";
common += "Rules: read files BEFORE edit; minimal surgical diffs; do NOT commit; do NOT push.\n";
common += "Match existing error types, test style (bun:test), and comments-explain-why only.\n";
common += "After edits re-read changed regions. Add/update tests for every behavior change.\n";
common += "Skip an item only if already fixed with evidence. Already-fixed list: " + already_json + "\n";
common += "Do not add runtime dependencies. Do not use node:crypto or Buffer.\n";
common += "Do not bump package.json version.\n";
common += "Return JSON {ok, files_changed, summary, notes}.\n";

let p_a = "";
p_a += common;
p_a += "STREAM A — SSRF hostname + trusted hosts + abort-signal cleanup helper. OWN FILES ONLY:\n";
p_a += "- " + root + "/src/core/url-guard.ts\n";
p_a += "- " + root + "/tests/core/url-guard.test.ts\n";
p_a += "Do NOT edit http.ts or providers.\n\n";
p_a += "TASKS:\n";
p_a += "R1) In isPrivateHostname, after lowercasing and stripping brackets, also strip trailing dots: replace(/\\.+$/, '') before suffix checks. localhost. foo.localhost. x.local. metadata.google.internal. must be private. Keep existing IPv6/CGNAT/mapped checks working on the stripped host.\n";
p_a += "R6) Narrow Meta CDN trust for credential forwarding. META_CDN_HOSTS / suffixes must NOT include facebook.com or whatsapp.net or .facebook.com / .whatsapp.net. Keep lookaside.fbsbx.com, fbsbx.com, .fbsbx.com, fbcdn.net, .fbcdn.net. graph.facebook.com / graph.whatsapp.com stay untrusted. 360dialog branch unchanged (360dialog hosts only).\n";
p_a += "R2) Add export bindAbortSignals(signals) => { signal?: AbortSignal, cleanup: () => void }. When AbortSignal.any exists, wrap present signals and cleanup is a no-op (or abort the wrapper if you create one). When it does not, polyfill with AbortController, add abort listeners, and cleanup MUST remove those listeners. Keep mergeAbortSignals as a thin wrapper that returns only .signal (tests/callers). Do not leak listeners on a long-lived client signal.\n";
p_a += "Also export assertSafeMediaId(id, provider): string for Streams C/D. Trim. Reject empty. Reject if the raw id contains /, ?, #, or '..' (path traversal / query injection). Return encodeURIComponent(trimmed). Throw ValidationError with a clear message.\n";
p_a += "TESTS: assertSafeFetchUrl('http://localhost./') throws; 'http://foo.localhost./' throws; 'http://metadata.google.internal./' throws; 'http://x.local./' throws. Existing no-dot cases still throw. isTrustedMediaHost('https://www.facebook.com/x', graph base, 'cloud-api') is false. isTrustedMediaHost lookaside.fbsbx.com and scontent.xx.fbcdn.net stay true for cloud-api. assertSafeMediaId('abc') returns 'abc'; 'me' ok (no slash); '../v19.0/me' throws; '123?fields=id' throws; 'a/b' throws. Keep prior SSRF tests passing.\n";

let p_b = "";
p_b += common;
p_b += "STREAM B — HTTP timeout-until-body, AbortError class, log redaction, bindAbortSignals. OWN FILES ONLY:\n";
p_b += "- " + root + "/src/core/http.ts\n";
p_b += "- " + root + "/src/core/rate-limiter.ts\n";
p_b += "- " + root + "/tests/core/http.test.ts\n";
p_b += "- " + root + "/tests/core/rate-limiter.test.ts\n";
p_b += "Do NOT edit url-guard.ts. You MAY import bindAbortSignals and mergeAbortSignals from url-guard. If bindAbortSignals is missing when you start, keep mergeAbortSignals and add a local cleanup no-op; Integrate will switch the import.\n\n";
p_b += "TASKS:\n";
p_b += "R3) JSON/API body must stay under the request timeout. doFetch currently cleanup()s the timeout in finally when headers return, then request() calls parseJsonBody with no abort. Change so request() and uploadRequest() keep the timeout signal alive until AFTER parseJsonBody / handleErrorResponse. rawRequest (streams) MUST still release the timeout after headers so download bodies are not killed (documented TTFB-only for media.download). Suggested shape: doFetch returns { response, cleanup } OR take a holdTimeout flag. Do not break redirect loop cleanup (always cleanup timers eventually, including errors).\n";
p_b += "R4) Classify abort: if init.signal or config.signal is aborted => NetworkError retryable false. Else if timeoutMs > 0 AND (error.name is TimeoutError OR abort reason name is TimeoutError) => TimeoutError. Else => NetworkError retryable false. Never call a no-timeout (timeout<=0) fetch failure a TimeoutError.\n";
p_b += "R5) Debug logs must not include URL query/hash. Add redactUrlForLog: origin+pathname only (URL parse, fallback split on ?). Use it in this.log debug lines. Do not change onRequest hook url (callers may need the full URL); only logger output.\n";
p_b += "Use bindAbortSignals instead of mergeAbortSignals in request/rawRequest/uploadRequest and call cleanup in those methods' finally so Node 18 listeners are removed.\n";
p_b += "R7) Fix the stale JSDoc on RateLimiter.acquire (abort is NetworkError not TimeoutError). Do NOT change destroy() rejection type.\n";
p_b += "TESTS: AbortError with timeout 0 is NetworkError not TimeoutError. Existing user-abort and timeout-named tests still pass. Optional: a Response whose text() hangs is aborted when timeout is small (if easy with a mock body). Log redaction: if you can spy logger, assert query not present; otherwise skip log spy. Keep redirect, credential-strip, localhost-baseUrl tests.\n";

let p_c = "";
p_c += common;
p_c += "STREAM C — Cloud API mediaId safety, listTemplates paging, upload timeout, contentLength. OWN FILES ONLY:\n";
p_c += "- " + root + "/src/providers/cloud-api/index.ts\n";
p_c += "- " + root + "/tests/providers/cloud-api/provider.test.ts\n";
p_c += "Do NOT edit url-guard.ts, http.ts, 360dialog, or webhook-parser.\n";
p_c += "Import assertSafeMediaId from url-guard if present; else inline the same ValidationError rules (reject / ? # .. ; encodeURIComponent).\n\n";
p_c += "TASKS:\n";
p_c += "R8) getMediaUrl and deleteMedia: path = '/' + assertSafeMediaId(mediaId, this.name). downloadMedia still treats absolute http(s) URLs via resolveHttpDownloadUrl; media-id branch uses getMediaUrl (so it is protected).\n";
p_c += "R12) listTemplates: pass query limit='100' and fields='id,name,language,status,category,components' on every page. Keep cursor pagination and the nextCursor===after stop.\n";
p_c += "R13) uploadMedia: pass timeout: params.timeout ?? 120_000 so large uploads are not killed at the JSON 30s default. Caller params.timeout still wins.\n";
p_c += "R14) downloadMedia contentLength: parseInt then Number.isFinite; otherwise undefined. Never return NaN.\n";
p_c += "TESTS: getMediaUrl('../v19.0/me') or deleteMedia('123?x=1') throws ValidationError and does not fetch. listTemplates fetch URL contains fields= and limit=. uploadMedia without params.timeout: inspect fetch AbortSignal/timeout path if practical; at least that uploadRequest is called with timeout 120000 if you can spy. content-length: abc yields undefined contentLength. Keep existing send/upload/download tests.\n";

let p_d = "";
p_d += common;
p_d += "STREAM D — 360dialog mediaId safety, rewrite path allowlist, contentLength. OWN FILES ONLY:\n";
p_d += "- " + root + "/src/providers/360dialog/index.ts\n";
p_d += "- " + root + "/tests/providers/360dialog/provider.test.ts\n";
p_d += "Do NOT edit http.ts, url-guard.ts, or cloud-api.\n";
p_d += "Import assertSafeMediaId from url-guard if present; else inline.\n\n";
p_d += "TASKS:\n";
p_d += "R8) getMediaUrl and deleteMedia: use assertSafeMediaId on the path segment.\n";
p_d += "R11) rewriteDialog360MediaUrl: still detect Meta media CDN hosts (lookaside / fbsbx / fbcdn, excluding graph.facebook.com / graph.whatsapp.com). ONLY rewrite when pathname includes '/whatsapp_business/' OR '/attachments'. Other Meta-CDN paths return downloadUrl unchanged (http layer will strip D360-API-KEY off-origin).\n";
p_d += "R14) contentLength Number.isFinite as in Cloud API.\n";
p_d += "TESTS: keep lookaside .../whatsapp_business/attachments/?mid=1 rewrite to waba-v2.360dialog.io WITH D360-API-KEY. downloadMedia('https://lookaside.fbsbx.com/not-media/secret') must NOT rewrite to waba (fetch lookaside or untrusted host WITHOUT D360-API-KEY). getMediaUrl('../x') throws ValidationError. Keep private URL reject tests.\n";

let p_e = "";
p_e += common;
p_e += "STREAM E — webhook echo flag. OWN FILES ONLY:\n";
p_e += "- " + root + "/src/types/webhooks.ts\n";
p_e += "- " + root + "/src/providers/cloud-api/webhook-parser.ts\n";
p_e += "- " + root + "/tests/providers/cloud-api/webhook-parser.test.ts\n";
p_e += "Do NOT edit provider index files.\n\n";
p_e += "TASKS:\n";
p_e += "R9) IncomingMessageEvent: add optional echo?: boolean. Parser: when change.field is smb_message_echoes or message_echoes, set echo: true on message events. Inbound field messages omit echo (undefined). Status/error events unchanged. Keep parsing echoes (do not drop them) so clients can inspect history; they must be distinguishable.\n";
p_e += "TESTS: update smb_message_echoes and message_echoes tests to expect echo === true. A normal messages field text event must not have echo true (undefined or false).\n";

let p_f = "";
p_f += common;
p_f += "STREAM F — Wati template param drop, phone strip, extra interactive limits. OWN FILES ONLY:\n";
p_f += "- " + root + "/src/providers/wati/mapper.ts\n";
p_f += "- " + root + "/tests/providers/wati/mapper.test.ts\n";
p_f += "- " + root + "/src/utils/phone.ts\n";
p_f += "- " + root + "/tests/utils/phone.test.ts\n";
p_f += "- " + root + "/src/providers/cloud-api/mapper.ts\n";
p_f += "- " + root + "/tests/providers/cloud-api/mapper.test.ts\n";
p_f += "Do NOT edit provider index files or webhook parsers.\n\n";
p_f += "TASKS:\n";
p_f += "R10) flattenTemplateParameters: after walking components, if any component is type button, or any parameter type is not text, throw UnsupportedFeatureError (Wati templates only support text header/body params). Footer components: if they have parameters, throw; footer with no params can be skipped. Existing header+body text flattening stays. Tests: image header param throws; button component throws; header+body text still flattens.\n";
p_f += "R15) phone STRIP_CHARS: also remove bidi/zero-width: include \\u200B-\\u200D \\u202A-\\u202E \\u2060 \\uFEFF and NBSP \\u00A0. A number like +966\\u200B501234567 must normalize. Keep invalid non-digit throw.\n";
p_f += "R16) Cloud API interactive mapper extra checks: button.id length 1-256; body length 1-1024 for button and list; list row description <=72 if present; at least one section and at least one row total (totalRows===0 throws). Do not weaken existing 20/24/10 limits.\n";

let p_g = "";
p_g += common;
p_g += "STREAM G — README + CHANGELOG only. OWN FILES ONLY:\n";
p_g += "- " + root + "/README.md\n";
p_g += "- " + root + "/CHANGELOG.md\n";
p_g += "Do not edit src except you may not edit src at all.\n\n";
p_g += "TASKS:\n";
p_g += "R17) Feature-detection or Runtime section: default createWhatsApp bundles all providers. For a smaller edge bundle, import CloudApiProvider from 'waflow/providers/cloud-api' and createWhatsAppFromAdapter. Do not claim the main entry tree-shakes unused providers.\n";
p_g += "R18) URL safety note: hostnames are not DNS-resolved; trailing-dot FQDNs (localhost.) are treated as local and refused. Do not pass untrusted URLs to media.download.\n";
p_g += "R20) Logger/hooks: debug logs print origin+path only (no query). onRequest.url may still be the full URL — do not log it for media downloads in production.\n";
p_g += "R9) Webhooks: smb_message_echoes / message_echoes parse as message events with echo: true. Ignore echo events in auto-reply bots.\n";
p_g += "R13) media.upload default timeout 120s if the caller does not pass timeout (JSON API default remains 30s).\n";
p_g += "R19) CHANGELOG Unreleased (0.7.0): add a Residual review subsection — trailing-dot SSRF, mediaId path allowlist, echo flag, JSON body timeout, AbortError vs TimeoutError, trusted-host narrowing, Wati non-text template params throw, listTemplates fields/limit, upload default 120s, log query redaction. Mark any breaking bits (Wati throw on media template params; echo field added; facebook.com no longer gets bearer token on download; mediaId with / throws).\n";
p_g += "Do not bump package.json version.\n";

let jobs = [
    #{ prompt: p_a, label: "fix:ssrf-url-guard", capability_mode: "all", output_schema: implement_schema },
    #{ prompt: p_b, label: "fix:http-timeout-abort-log", capability_mode: "all", output_schema: implement_schema },
    #{ prompt: p_c, label: "fix:cloud-api-media-list", capability_mode: "all", output_schema: implement_schema },
    #{ prompt: p_d, label: "fix:360dialog-rewrite-id", capability_mode: "all", output_schema: implement_schema },
    #{ prompt: p_e, label: "fix:webhook-echo", capability_mode: "all", output_schema: implement_schema },
    #{ prompt: p_f, label: "fix:wati-phone-interactive", capability_mode: "all", output_schema: implement_schema },
    #{ prompt: p_g, label: "fix:docs-changelog", capability_mode: "all", output_schema: implement_schema },
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
p_int += "Integrate waflow residual fixes in " + root + ". Do NOT commit.\n";
p_int += "You may edit any file. Cross-stream wiring plus compile/test breakage.\n";
p_int += "1) url-guard must export isPrivateHostname trailing-dot strip, bindAbortSignals with cleanup, assertSafeMediaId, narrowed META CDN list.\n";
p_int += "2) http.ts must import bindAbortSignals (or mergeAbortSignals + cleanup) and call cleanup after JSON body read for request/uploadRequest; rawRequest still releases after headers. AbortError with timeout 0 is NetworkError.\n";
p_int += "3) cloud-api and 360dialog getMediaUrl/deleteMedia must use assertSafeMediaId. If duplicated helpers exist, keep the url-guard export and delete copies.\n";
p_int += "4) IncomingMessageEvent.echo optional; parser sets it for echo fields; tests updated.\n";
p_int += "5) Wati mapper throws UnsupportedFeatureError on non-text template params.\n";
p_int += "6) cd " + root + " && bun run typecheck\n";
p_int += "7) cd " + root + " && bun test\n";
p_int += "8) Fix TypeScript or test failures until both pass, or report remaining errors honestly.\n";
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
p_ver += "Verify waflow residual fixes in " + root + " with command and file-read evidence.\n";
p_ver += "Use run_terminal_command, grep, read_file. Do not edit unless a one-line import is clearly broken — prefer reporting failures.\n";
p_ver += "1) cd " + root + " && bun run typecheck\n";
p_ver += "2) cd " + root + " && bun test\n";
p_ver += "3) Invariant greps / reads (must hold):\n";
p_ver += "   - isPrivateHostname strips trailing dots (replace trailing dots) before localhost/.local/.internal checks\n";
p_ver += "   - META CDN trusted list does not include facebook.com or whatsapp.net as credential hosts\n";
p_ver += "   - bindAbortSignals or equivalent cleanup removes abort listeners\n";
p_ver += "   - request()/uploadRequest do not cleanup timeout before parseJsonBody; rawRequest still TTFB-only\n";
p_ver += "   - timeout<=0 AbortError is not classified as TimeoutError\n";
p_ver += "   - debug log uses origin+pathname or strips query\n";
p_ver += "   - assertSafeMediaId used (or equivalent reject of / ? # ..) in cloud-api and 360dialog getMediaUrl/deleteMedia\n";
p_ver += "   - IncomingMessageEvent has echo?; parser sets echo true for smb_message_echoes / message_echoes\n";
p_ver += "   - Wati flatten throws on non-text template params\n";
p_ver += "   - 360dialog rewrite requires whatsapp_business or attachments in pathname\n";
p_ver += "   - listTemplates query includes fields and limit\n";
p_ver += "   - upload timeout default 120000 when params.timeout omitted\n";
p_ver += "   - README mentions echo flag and trailing-dot SSRF and tree-shake via subpath adapter\n";
p_ver += "   - CHANGELOG Unreleased mentions residual review items\n";
p_ver += "4) Do not publish.\n";
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
p_gate += "Adversarially gate the waflow residual remediation in " + root + ".\n";
p_gate += "You are a skeptical reviewer. Read the actual code with read_file/grep. Do NOT trust summaries or agent notes.\n";
p_gate += "Check each original residual finding:\n";
p_gate += "CRITICAL: trailing-dot SSRF blocked (localhost. metadata.google.internal. foo.localhost.) including as redirect targets.\n";
p_gate += "IMPORTANT: mediaId path injection blocked; echo flag on webhook echoes; JSON body under timeout; AbortError vs TimeoutError; bindAbortSignals cleanup; Wati non-text params throw; 360dialog rewrite path-limited; listTemplates fields/limit; upload 120s default; trusted hosts exclude facebook.com; debug logs strip query.\n";
p_gate += "NITS: contentLength finite; phone bidi strip; extra interactive limits; rate-limiter comment.\n";
p_gate += "Mark blocking only if a CRITICAL or IMPORTANT item is still broken, typecheck would fail, or bun test would fail on the touched behavior.\n";
p_gate += "Write a markdown report via write_scratch_file('waflow-residual-gate-report.md', content).\n";
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
    p_fix += "Fix remaining blocking waflow residual-review issues in " + root + ".\n";
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
    p_ver2 += "Run bun run typecheck and bun test. Re-check invariants: trailing-dot SSRF, mediaId allowlist, echo flag, JSON body timeout, AbortError classification, trusted-host narrowing, Wati throw, 360dialog path-limited rewrite, listTemplates fields, log query redaction.\n";
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
report += "# waflow residual-fix-gate result\n\n";
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

let report_path = write_scratch_file("waflow-residual-fix-result.md", report);
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
