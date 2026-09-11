# Changelog

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
