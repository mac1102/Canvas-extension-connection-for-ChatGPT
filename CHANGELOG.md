# Changelog

## 0.4.0 — 2026-10-08

- Fetch and send once per invocation; consume the tag and reuse retrieved data after an editor retry. Replace the review-only action with Fetch & Send; attached/edited data blocks never refetch.
- Restrict daily module discovery to matching dates so old week item lists and broad catalogs do not exhaust document retrieval budgets.
- Preserve page/assignment descriptions and source links; read linked PDF/notebook/YAML/HTML resources with per-file status, failure stage and completeness records.
- Support Canvas-issued signed S3/CloudFront and Canvas user-content file URLs without forwarding bearer tokens or cookies. Add authenticated public-URL fallback and bounded isolated-tab file transport. Storage host access is required; denied/locked resources remain unavailable.
- Parse notebook markdown/code sources without execution or stored outputs, plus YAML and text source files.
- Add seven-file retrieval regression, signed-host/authentication/limit coverage and one-shot composer/MV3 browser checks.

## 0.3.0 — 2026-10-08

- Select learning topics from explicit module date ranges and weekday sections, preserving module/item IDs, source links, resource types and incomplete evidence. Never infer class times or rooms from module titles.
- Rank and read resources referenced by the selected day even when their names do not resemble the conversational query; follow linked readings within retrieval limits.
- Recover module-linked file metadata through the canonical bearer-authenticated Files API after a course endpoint 403/404. Listing failures remain visible and do not discard module references.
- Handle the reported learn-todaay prompt, keep old announcements below current learning evidence, and distinguish posting dates from the day being requested.
- Add a visible Fetch Canvas action to attach context for review before manual Send, and show the installed content-script version.
- Add synthetic end-to-end regressions for many-week courses, empty calendars, inaccessible listings, partial items, wrong-day exclusion, direct resources and verified review/manual send.

## 0.2.3 — 2026-10-06

- Intercept Enter, Send pointer/click and form submission at window capture from document start, before the page can send an unmodified Canvas request.
- Insert rich-editor context through paste/native editing instead of a DOM-only replacement; wait for the full enriched draft to remain stable before auto-send.
- Preserve drafts when insertion is rejected or rolled back. Show a Copy Canvas prompt recovery action; never auto-send an unverified draft.
- Add Chromium regressions for delayed controlled-editor state, earlier page capture handlers, paste-only rich editors, rollback/rejection, form and pointer sends, and copy recovery.

## 0.2.2 — 2026-10-06

- GPT-OSS is the primary planner for every eligible request when enabled; local planning is fallback or explicit Local only mode.
- Respect AI-selected operations and assignment filters, including empty filters, without adding conversational keywords back into title searches.
- Add bounded course Calendar GETs so study/schedule queries can retrieve times, topics, locations and linked readings; distinguish missing calendar evidence from assignment deadlines.
- Handle missing/invalidated extension messaging after Reload, preserve drafts, and explain how to refresh the ChatGPT tab.
- Add regression coverage for the reported 37-assignments/zero-matches query, calendar scope/batching/failures, AI plan ownership and runtime recovery.

## 0.2.1 — 2026-10-06

- Recover service-worker API network failures through an existing Canvas tab in Chrome's isolated world, using the same bearer token and no session cookies.
- Keep token errors, timeouts, redirects, response-size limits and tab navigation bounded; report actionable connection errors.
- Show installed version and successful transport in Settings.
- Add unit coverage and a real Chromium reproduction for worker-only HTTPS failure, token isolation, cookie omission and missing-tab recovery.

## 0.2.0 — 2026-09-11

- Optional Groq hybrid planner using openai/gpt-oss-20b, strict structured plans, bounded validation retry and deterministic fallback.
- Pre-retrieval privacy firewall, trusted credential storage, separate key controls and safe planner inspector.
- Multi-intent assignment inventories, counts, individual evidence, details and rubrics.
- Current-course relevance and explicit historical-course selection.
- Local resource graph, HTML link traversal, deduplication and ranked metadata-first retrieval.
- Bundled PDF, DOCX, PPTX and text parsers with worker isolation and size/time limits.
- Ranked excerpts and whole-record JSON context budgeting.
- Safe pagination, bounded GET-only Canvas retries and signed-URL redaction. Redirected/off-origin downloads are refused.
- Composer adapter, preservation of changed drafts, manual-send fallback and extension API boundary checks.
- Expanded privacy, integration, module-contract, parser and real-browser CI checks; checked-in parser bundle reproduction.
## 0.1.0 — 2026-09-03

Initial release.

- Live `@Canvas` interception on ChatGPT.
- Fresh read-only Canvas UvA API fetching with `cache: no-store`.
- Intent routing for deadlines, assignment instructions, announcements, grades, files, modules, and general dashboard requests.
- Course and assignment fuzzy matching.
- Vietnamese and English intent keywords.
- Token-isolated Manifest V3 service worker architecture.
- Options page, connection test, token removal, and context controls.
- Popup connection status.
- Unit tests for routing helpers.
- Privacy and security documentation.
