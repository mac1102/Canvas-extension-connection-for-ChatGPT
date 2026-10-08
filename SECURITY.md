# Security

## Credential and context boundary

Canvas PAT and Groq key are stored separately in trusted `chrome.storage.local`, never in source, sync storage, logs or content-script responses. Storage access is restricted before use; failure to establish the supported storage restriction prevents requests. No settings message returns key values. Canvas and Groq use distinct modules and authentication headers. Raw server error bodies are never exposed to the page or console.

The worker validates sender extension ID, exact trusted options/popup URLs, and top-frame ChatGPT origins. ChatGPT content scripts can only request context, check configured status or ask the worker to open Options. They cannot save settings, test credentials, clear credentials or read the inspector. No externally-connectable or page `postMessage` bridge exists. Parser messages accept only the same extension's service worker URL.

## Permissions and outbound destinations

Host permissions cover Canvas UvA, Groq, `*.amazonaws.com`, `*.cloudfront.net` and `*.canvas-user-content.com` for Canvas-issued document downloads. The executor further restricts AWS hosts to signed S3 URLs and CloudFront hosts to signed distribution URLs; it does not crawl arbitrary links on these hosts. Storage and offscreen permissions support credentials and local parsing. Scripting supports Canvas API/file recovery after a worker network error. ChatGPT content scripts match only the two declared ChatGPT origins. There are no all-host, tabs or downloads permissions. Existing Canvas access permits querying matching tabs; injected requests target frame 0 in Chrome's ISOLATED world.

Canvas requests are GET-only, HTTPS, no-store and omit browser cookies. Paths are constructed locally from validated numeric IDs or encoded page slugs. Pagination revalidates each next-page origin before attaching Authorization. Raw planner URLs and arbitrary resource IDs cannot become requests.

Native Canvas fetch follows redirects and validates the final URL before consuming the body; browser fetch strips Authorization across origins. API destinations remain on Canvas. File URLs must come from authenticated Canvas metadata or its access-checked `public_url` endpoint, and may use a validated Canvas file path, signed S3/CloudFront URL or Canvas user-content host. Explicit storage fetches omit Authorization and use `redirect: "error"`. The isolated fallback refuses API redirects; file redirects must end at one of the validated file destinations. All requests omit cookies. Signed parameters stay inside local download requests; serializers use Canvas UI links and strip URL queries. No signed URLs enter Groq or chat data.

If direct Canvas API/file fetch throws a browser network TypeError, the worker may pass the same bearer header temporarily to an isolated function in an existing Canvas tab. The function checks page and destination origins, accepts only constructed Canvas API/file GETs, omits cookies, enforces four-MB API and up-to-sixteen-MB file limits plus a shared deadline, and returns no HTTP error bodies. It never reads the page DOM or exposes credentials in the MAIN world, DOM, URLs or ChatGPT messages. Token errors/timeouts do not initiate tab fallback. File metadata 403/404 may try canonical metadata and the separately access-checked public-URL API, without changing identity or bypassing locked files. Navigation or lost tab access fails safely.

Groq POST requests go only to the fixed completions endpoint; no tool execution or Canvas callback is exposed. The privacy firewall takes only the pre-retrieval user query, rejects unknown fields and suspicious content, and never has access to retrieved Canvas objects. Model output is untrusted: a strict schema and a local validator reject extra fields, unknown/write operations, malformed filters, unresolved resource IDs and excessive limits. Local multi-intent requirements cannot be suppressed by an AI plan. Provider errors and timeouts fall back deterministically.

## Parser and HTML attack surface

All code is shipped locally. PDF.js and ZIP/XML parsers run in an offscreen document's worker. PDF.js uses its own local nested worker, disables eval and does not render documents. Each parser worker is terminated after 12 seconds or completion. HTML is parsed inertly with bundled LinkeDOM; scripts, styles, embeds, frames, SVG and forms are removed from readable text. Canvas markup is never inserted into the ChatGPT DOM. XML DTD/entity declarations are rejected. Office archives extract only expected text entries, with entry/decompressed-size caps. Notebook markdown/code cell sources are data only; code is never executed and stored outputs/images are omitted. YAML/source files are plain text.

Limits constrain individual downloads, aggregate bytes, parsed text, PDF pages, graph nodes, resource attempts, traversal depth, pagination, network attempts and scheduling duration. Chunk excerpts and budget omissions are explicit. Scanned, corrupt, locked, unsupported or oversized resources fail independently; their absence must not be interpreted as absence of requirements.

Document text can contain prompt injection. Context marks it as untrusted source data; this is a mitigation, not a guarantee about ChatGPT's behavior. No model-provided action can change the GET-only Canvas executor.

## Reliability and verification

CI checks syntax, manifest paths, every bundled module import/export graph, actual service-worker registration in Chromium, privacy payloads, sender restrictions, bounded retries, safe pagination, document parsing, fixture retrieval and composer recovery. Parser bundles are generated from pinned lockfile dependencies and reproducibility-checked. The secret scanner examines tracked and new files for common key/private-key patterns and prints filenames only. It is a heuristic and cannot prove the absence of every possible secret.

Local request caches expire with the request; no private Canvas data is persisted indefinitely. Multiple requests are capped. Course relevance and lexical matching can be imperfect. No authenticated live account or current production ChatGPT DOM is part of CI.

## Reporting

Report vulnerabilities with the extension/Chrome version and a synthetic reproduction. Never put real keys, signed URLs, private course documents, grades or student information in a public issue. If a key may have been exposed, revoke it at its provider and replace it locally.
