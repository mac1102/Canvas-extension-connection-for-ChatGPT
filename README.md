# Canvas Live for ChatGPT

A Manifest V3 Chrome extension for fresh, read-only Canvas UvA context in ChatGPT. Type `@Canvas` with a question: the extension plans a retrieval, fetches relevant resources, parses selected documents locally, and attaches compact evidence to your prompt.

**Groq plans retrieval. Groq does not receive raw Canvas course content.** Groq is optional; local planning works without a key and automatically takes over when Groq fails.

## Install or update

Requires Chrome 140 or newer. Browser automation is tested with Chromium 153.

```sh
git clone https://github.com/mac1102/Canvas-extension-connection-for-ChatGPT.git
```

Open `chrome://extensions`, enable Developer mode, choose **Load unpacked**, and select the folder containing `manifest.json`. Parser bundles are checked in: installation requires no Node, npm, Python, build step, or CDN.

For an existing installation, run `git pull`, click **Reload** on the extension, and refresh your ChatGPT tabs. Chrome may ask you to accept the new Groq host permission.

## Configure

1. In Canvas, open **Account → Settings → Approved Integrations → New Access Token**. Give it a descriptive name and an expiry. Your institution may restrict token creation.
2. Open the extension's **Settings**, paste the Canvas token, save, then **Test connection**. This build deliberately supports only `https://canvas.uva.nl`.
3. Optionally create a key in the [Groq console](https://console.groq.com/keys), paste it into **Groq AI Planner**, enable the planner, save, and **Test Groq connection**. The model is fixed to `openai/gpt-oss-20b`.
4. Leave mode at **Hybrid**: simple requests stay local; ambiguous, relationship and multi-intent requests may use Groq. **Local only** disables planner network calls; **AI planner preferred** tries Groq for each eligible request. Groq is disabled until you explicitly enable it.

Saved keys are never displayed or returned to the content script. Blank fields preserve existing keys. Each key has a separate removal button. A connection test saves entered settings first; the Groq test sends only a synthetic assignment-list request.

## Examples

```text
@Canvas CONNECTIONS có những assignment gì?
@Canvas deadline tuần này
@Canvas điểm hiện tại
@Canvas announcements
@Canvas check xem assignment nào là individual
@Canvas check xem tôi có bao nhiêu assignment, cái nào là individual và yêu cầu những gì?
@Canvas course manual CONNECTIONS nói gì về grading?
@Canvas xem tôi cần đọc gì để làm bài tuần sau
@Canvas HISTORY assignments
```

Explicit course names override current-course filtering, including historical courses. Broad queries prefer course dates, academic year, semester and activity signals. Counts describe the selected course scope, before assignment filters; partial inventories are explicitly marked. Individual work requires evidence in the assignment title or description; a missing group ID alone is not proof.

## How it works

```text
ChatGPT composer → request validation → deterministic plan + confidence
                                      ↘ optional Groq structured plan
                        validated RetrievalPlan
                                  ↓
Canvas metadata → local resource graph → ranked, bounded retrieval
                                  ↓
local document workers → ranked excerpts → JSON context budget → composer
```

The service worker is the only executor and credential holder. Groq receives no Canvas tools it can execute. Plans use a strict JSON Schema and a second local validator; unknown operations, arbitrary resource IDs and excessive limits are rejected. The planner normally makes one non-streaming request at temperature 0, low reasoning, and 700 completion tokens. Invalid output permits one medium-reasoning retry (1000 tokens). HTTP errors and an eight-second timeout fall back locally.

Assignment inventory and details run together when needed. Descriptions can lead to Canvas pages and files; cycles and duplicate resources are suppressed. Generic discovery ranks file/page/module metadata before downloading up to six candidates. Directly linked resources take priority. A request-local cache prevents duplicate GETs and is discarded after the request.

Document parsing happens in a local offscreen document's workers. PDF.js, ZIP extraction and an inert HTML/XML parser ship in `src/vendor`. Text is chunked and ranked lexically. The context budget drops whole low-priority records, preserves valid JSON, reports omitted records, and marks shortened excerpts. Retrieved content is treated as untrusted evidence, not instructions.

## Supported resources and formats

- Current user; courses and course details; syllabus.
- Assignments, details, assignment groups, rubrics where accessible, and your submission status/score.
- Announcements, enrollment grades, todo, modules and module items, pages and page bodies, files and folders.
- PDF text, DOCX paragraphs, PPTX slides/notes, TXT, Markdown, HTML, CSV, JSON and XML.

Canvas operations are GET-only. The extension does not submit assignments, change grades, upload, edit or delete Canvas data. It does not retrieve submission attachment bodies or external tools.

## Retrieval controls and limits

Settings control context size, document size, relationship depth, submitted assignments, current-course preference and debug metadata. Defaults: 18,000 context characters, 8 MB per document, depth 2 and 30 full-resource attempts. Hard limits include depth 3, 50 full resources, 180 HTTP attempts, 32 MB of accepted response bytes, 24 MB downloaded documents, 200,000 parsed text characters and a two-minute scheduling budget. Metadata lists stop after 30 pages; failures or caps mark them partial. Each Canvas call times out within 15 seconds; network/5xx errors may retry once. A 429 stops further calls in that request.

The popup's **Planner inspector** reports planner choice, local confidence, operations, fallback reason and execution counts. It contains no query text, course content, grades or keys and resets when the service worker restarts.

## Privacy

Canvas credentials stay in trusted extension storage and are transmitted only to Canvas for authentication. The Groq key is transmitted only to Groq in its authentication header. Neither key goes into planning messages or ChatGPT prompts.

With Groq enabled, a short user-written query and abstract operation names may go to Groq **before** Canvas retrieval. The payload builder accepts no Canvas objects or discovered metadata. It rejects multiline/pasted content, markup, URLs, known secrets and detected identifiers. No heuristic can recognize every private fact that a person types into natural language: keep private notes out of planning requests, or choose Local only.

Selected retrieved Canvas context **is sent to ChatGPT** in your message so ChatGPT can answer. This is not an entirely local data flow. See [PRIVACY.md](PRIVACY.md) and [SECURITY.md](SECURITY.md).

## Troubleshooting and limitations

- **401:** replace an expired or revoked Canvas token. **403/404:** the resource may be locked, unpublished, unavailable or outside your permissions; other resources can still succeed.
- **Groq key/rate limit/network/schema failure:** use the planner inspector to see the local fallback. Local only works without Groq.
- **Files requiring redirects or another host:** this build refuses redirects and off-origin downloads to keep credentials on Canvas UvA. It reports missing content and provides a safe Canvas UI link. Some institution-hosted or CDN-backed files therefore cannot be extracted. Do not expect a redirected file's requirements to appear until its download path is supported safely.
- **PDF:** no OCR, password entry, or visual chart interpretation. Scanned/encrypted/malformed PDFs can return no text. Extraction is capped at 150 pages; text and excerpts may omit later sections. Nonstandard fonts and layouts may extract imperfectly.
- **Office:** text extraction omits images, embedded objects, macros and formatting. Legacy DOC/PPT/XLS and XLSX are unsupported. ZIP expansion is bounded; corrupt files fail independently.
- **Matching:** lexical heuristics are not a complete semantic search engine. Courses with missing or ambiguous dates may be omitted or selected incorrectly; naming the course helps. Limits and inaccessible resources can make results partial.
- **ChatGPT UI changes:** reload the extension and refresh the tab. Multiple composer/send selectors are used. If auto-send does not work, the enriched draft remains ready for manual Send. Edits made during retrieval are preserved.
- **Long requests:** service-worker restarts or browser closure can interrupt work. No background sync or persistent course cache is used; retry the request.

## Development and validation

Node 24 is only needed for development:

```sh
npm ci
npm run check
npm run scan-secrets
npm test
npx playwright install chromium
npm run test:browser
npm run build
```

`npm run build` reproduces checked-in vendor assets from pinned dependencies. CI checks the resulting vendor diff, syntax, secrets, manifest paths, named ES module imports, unit/integration/privacy tests, actual MV3 registration, offscreen parsing and composer behavior. Fixtures include CONNECTIONS → Individual Contribution IV → Assessment Requirements → Course Manual.pdf and a 200-file course. Tests use synthetic credentials and mock Canvas/Groq HTTP; they do not contact your accounts.

## Manual Chrome check

After pulling and reloading, verify no extension registration errors, test Canvas and optionally Groq in Settings, then run the examples above in ChatGPT. Check the multi-intent response includes counts and evidence, the manual query includes grading excerpts, and disabling Groq still retrieves useful context. Check the popup inspector and compare answers to Canvas. Automated browser fixtures cannot verify your institution's live permissions, file hosting, or the current signed-in ChatGPT DOM.

## Implementation references

The client follows the official [Canvas API](https://developerdocs.instructure.com/services/canvas), including [pagination](https://developerdocs.instructure.com/services/canvas/basics/file.pagination), [files](https://developerdocs.instructure.com/services/canvas/resources/files), [assignments](https://developerdocs.instructure.com/services/canvas/resources/assignments), and [modules](https://developerdocs.instructure.com/services/canvas/resources/modules). Planner configuration uses Groq's [strict structured outputs](https://console.groq.com/docs/structured-outputs) and [reasoning](https://console.groq.com/docs/reasoning). Chrome documents [trusted storage access](https://developer.chrome.com/docs/extensions/reference/api/storage) and [offscreen workers](https://developer.chrome.com/docs/extensions/reference/api/offscreen).

MIT for project code; bundled dependencies retain their licenses in `src/vendor/LICENSES.txt`. This is an independent project, not an official Instructure, Groq or OpenAI product.
