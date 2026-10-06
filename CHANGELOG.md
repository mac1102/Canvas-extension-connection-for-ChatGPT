# Changelog

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
