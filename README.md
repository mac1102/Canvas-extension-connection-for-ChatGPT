# Canvas Live for ChatGPT

A Manifest V3 Chrome extension for fresh, read-only Canvas UvA context in ChatGPT. Type `@Canvas` with a question: the extension plans a retrieval, fetches relevant resources, parses selected documents locally, and attaches compact evidence to your prompt.

**Groq plans retrieval. Groq does not receive raw Canvas course content.** Groq is optional; local planning works without a key and automatically takes over when Groq fails.

## Install or update

Requires Chrome 140 or newer. Browser automation is tested with Chromium 153.

```sh
git clone https://github.com/mac1102/Canvas-extension-connection-for-ChatGPT.git
```

Open `chrome://extensions`, enable Developer mode, choose **Load unpacked**, and select the folder containing `manifest.json`. Parser bundles are checked in: installation requires no Node, npm, Python, build step, or CDN.

For an existing installation, run `git pull`, click **Reload** on the extension, and refresh your ChatGPT tabs. Chrome may ask you to accept updated permissions for Canvas file storage. Settings and the composer action show version **0.4.0**. Keep your existing extension folder and use Reload to preserve saved tokens.

## Configure

1. In Canvas, open **Account → Settings → Approved Integrations → New Access Token**. Give it a descriptive name and an expiry. Your institution may restrict token creation.
2. Open the extension's **Settings**, paste the Canvas token, save, then **Test connection**. This build deliberately supports only `https://canvas.uva.nl`. If direct HTTPS access fails, open Canvas in the same Chrome profile, sign in, keep that tab open, and test again. The extension can then make the same bearer-authenticated API requests in an isolated environment inside that tab.
3. Optionally create a key in the [Groq console](https://console.groq.com/keys), paste it into **Groq AI Planner**, enable the planner, save, and **Test Groq connection**. The model is fixed to `openai/gpt-oss-20b`.
4. Choose **AI planner with local fallback** and enable Groq. GPT-OSS decides resources and filters for every eligible request, including simple requests. The local planner is used if AI planning is unavailable, invalid, or blocked by the query privacy guard. **Local only** disables planner network calls. Previously saved Hybrid/AI-preferred modes both migrate to this AI-first behavior. Groq is disabled until you explicitly enable it.

Saved keys are never displayed or returned to the content script. Blank fields preserve existing keys. Each key has a separate removal button. A connection test saves entered settings first; the Groq test sends only a synthetic assignment-list request.

## Fetch and send

Type an `@Canvas` question in ChatGPT, then press Enter/Send or click **Fetch & Send**. The extension fetches once, attaches and verifies the descriptions/document excerpts, and sends automatically. It consumes the invocation tag; an attached data block cannot trigger another fetch, even if edited. Retrying insertion after an editor rollback reuses the fetched result. A new question/tag after sending gets fresh data. Merely typing an unfinished tag does not send a question. The composer is empty after ChatGPT accepts the message. If ChatGPT disables Send or rejects insertion, the extension preserves the draft and offers **Copy Canvas prompt**; sending the attached/copied prompt does not refetch.

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
@Canvas fetch what I'm gonna study today
```

Explicit course names override current-course filtering, including historical courses. Broad queries prefer course dates, academic year, semester and activity signals. Counts describe the selected course scope, before assignment filters; partial inventories are explicitly marked. Individual work requires evidence in the assignment title or description; a missing group ID alone is not proof.

## How it works

```text
ChatGPT composer → request validation → GPT-OSS structured retrieval plan
                                      ↘ local fallback if unavailable
                        validated operations and filters
                                  ↓
Canvas API → course calendar and metadata → bounded linked-resource retrieval
                                  ↓
local document workers → ranked excerpts → JSON context budget → composer
```

The service worker stores credentials and controls retrieval. If direct Canvas API or file HTTPS fetch fails with a browser network error, it can dispatch a bounded GET to a top-frame Canvas tab using Chrome's isolated world. That temporary request uses the same saved bearer token, omits browser cookies, and never runs in the page's JavaScript world. It does not switch to the logged-in session or bypass token errors. After recovery, remaining Canvas calls in that retrieval use the working tab. Storage requests omit the bearer token. Groq receives no Canvas tools it can execute. Plans use a strict JSON Schema and a second local validator; unknown operations, arbitrary resource IDs and excessive limits are rejected. A validated AI plan controls the operations and filters without keyword operations being merged back in. An empty AI assignment-title filter remains empty. Routing context and the popup inspector identify the planner used. The planner normally makes one non-streaming request at temperature 0, low reasoning, and 700 completion tokens. Invalid output permits one medium-reasoning retry (1000 tokens). HTTP errors and an eight-second timeout fall back locally.

Assignment inventory and details run together when needed. Descriptions can lead to Canvas pages and files; cycles and duplicate resources are suppressed. Generic discovery ranks file/page/module metadata before downloading up to six candidates. Directly linked resources take priority. A request-local cache prevents duplicate GETs and is discarded after the request.

Document parsing happens in a local offscreen document's workers. PDF.js, ZIP extraction and an inert HTML/XML parser ship in `src/vendor`. Text is chunked and ranked lexically. The context budget drops whole low-priority records, preserves valid JSON, reports omitted records, and marks shortened excerpts. Retrieved content is treated as untrusted evidence, not instructions.

## Supported resources and formats

- Current user; courses and course details; syllabus; course calendar events with times, locations and descriptions. Calendar contexts are batched in groups of ten.
- Assignments, details, assignment groups, rubrics where accessible, and your submission status/score.
- Announcements, enrollment grades, todo, modules and module items, pages and page bodies, files and folders.
- PDF text, DOCX paragraphs, PPTX slides/notes, Jupyter notebook cell sources, YAML, Python/SQL/R source text, TXT, Markdown, HTML, CSV, JSON and XML.

Canvas operations are GET-only. The extension does not submit assignments, change grades, upload, edit or delete Canvas data. It does not retrieve submission attachment bodies or external tools.

## Retrieval controls and limits

Settings control context size, document size, relationship depth, submitted assignments, current-course preference and debug metadata. Defaults: 18,000 context characters, 8 MB per document, depth 2 and 30 full-resource attempts. Hard limits include depth 3, 50 full resources, 180 HTTP attempts, 32 MB of accepted response bytes, 24 MB downloaded documents, 200,000 parsed text characters and a two-minute scheduling budget. Metadata lists stop after 30 pages; failures or caps mark them partial. Each Canvas call times out within 15 seconds; network/5xx errors may retry once. A 429 stops further calls in that request.

The popup's **Planner inspector** reports planner choice, local confidence, operations, fallback reason and execution counts. It contains no query text, course content, grades or keys and resets when the service worker restarts.

## Privacy

Canvas credentials stay in trusted extension storage and are transmitted only to Canvas for authentication. The Groq key is transmitted only to Groq in its authentication header. Neither key goes into planning messages or ChatGPT prompts.

With Groq enabled, a short user-written query and abstract operation names may go to Groq **before** Canvas retrieval. The payload builder accepts no Canvas objects or discovered metadata. It rejects multiline/pasted content, markup, URLs, known secrets and detected identifiers. No heuristic can recognize every private fact that a person types into natural language: keep private notes out of planning requests, or choose Local only.

Selected retrieved Canvas context **is sent to ChatGPT** in your message so ChatGPT can answer. This is not an entirely local data flow. See [PRIVACY.md](PRIVACY.md) and [SECURITY.md](SECURITY.md).

## Troubleshooting and limitations

- **Fetch succeeds but context is missing:** use version 0.2.3 or newer, Reload the extension, and refresh the ChatGPT tab. The extension waits for the full enriched draft to remain stable before clicking Send. If the editor refuses or removes it, auto-send stops and **Copy Canvas prompt** lets you paste the fetched prompt manually.
- **Missing runtime / extension context invalidated:** after reloading or updating the extension, refresh every open ChatGPT tab. Existing page scripts may lose extension messaging. Requests preserve the draft and display a refresh instruction rather than an undefined `sendMessage` error.
- **What am I studying today?** AI planning selects Calendar and dated module sections with linked pages/files. When Calendar is empty, explicit month/day ranges and weekday headers can identify planned learning topics. Module records preserve dates, parent relationships, resource types and source links; they do not prove class times, rooms, attendance or timetable changes. Week numbers alone and ambiguous multi-week headings do not establish a daily schedule. A study date does not automatically become an assignment deadline filter. Announcements retain their posting date, so an old “today” notice does not become today's schedule.

- **HTTPS/network failure:** use version 0.2.1 or newer, allow Canvas site access, and keep a Canvas tab open in the same Chrome profile. A recovered connection says **using the Canvas tab**. If both request paths fail, check that Canvas opens normally and check your VPN/proxy/network. An API redirect to login requires a valid token; the fallback never uses session cookies.
- **Files/Pages listing 403/404:** accessible module references can still identify specific pages and files. Direct file metadata can also use Canvas's canonical `/api/v1/files/:id` endpoint with the same saved token. Resources that remain unavailable are reported; this does not grant extra permissions.
- **401:** replace an expired or revoked Canvas token. **403/404:** the resource may be locked, unpublished, unavailable or outside your permissions; other resources can still succeed.
- **Groq key/rate limit/network/schema failure:** use the planner inspector to see the local fallback. Local only works without Groq.
- **Linked files:** date-scoped requests skip unrelated module item lists and broad Page/File catalogs. Page/assignment descriptions retain source links and linked resource IDs. Files use course metadata, canonical metadata and, when needed, Canvas's authenticated `public_url` endpoint. Worker and isolated Canvas-tab downloads are bounded. Canvas-issued signed S3/CloudFront URLs and Canvas user-content hosts are supported; storage requests carry no Canvas bearer token or cookies. Other hosts remain unsupported. `file_detail` and `file_summary` distinguish read, failed, no-text and budget-skipped files. Genuine Canvas access denials cannot be repaired by the extension.
- **PDF:** no OCR, password entry, or visual chart interpretation. Scanned/encrypted/malformed PDFs can return no text. Extraction is capped at 150 pages; text and excerpts may omit later sections. Nonstandard fonts and layouts may extract imperfectly.
- **Office:** text extraction omits images, embedded objects, macros and formatting. Legacy DOC/PPT/XLS and XLSX are unsupported. ZIP expansion is bounded; corrupt files fail independently.
- **Notebooks and source files:** Jupyter notebooks extract ordered markdown/code cell sources without executing code or copying stored outputs/images. YAML, Python, SQL and R files are read as text. Context excerpts are bounded; a parsed file does not mean its full binary is uploaded as a ChatGPT attachment.
- **Matching:** lexical heuristics are not a complete semantic search engine. Courses with missing or ambiguous dates may be omitted or selected incorrectly; naming the course helps. Limits and inaccessible resources can make results partial.
- **ChatGPT UI changes:** reload the extension and refresh the tab. Multiple composer/send selectors are used. If no Send button is available, a verified enriched draft remains ready for manual Send. If context insertion fails, use **Copy Canvas prompt**, paste it into the composer, then Send. Edits made during retrieval are preserved.
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

`npm run build` reproduces checked-in vendor assets from pinned dependencies. CI checks the resulting vendor diff, syntax, secrets, manifest paths, named ES module imports, unit/integration/privacy tests, actual MV3 registration, isolated Canvas-tab API/file HTTPS recovery, real signed-storage redirects, offscreen parsing, empty-calendar module-day retrieval and one fetch/send per tag. Composer tests cover rapid repeated sends, duplicate installation, cached insertion retries, edited attached data and a genuinely new invocation. Fixtures include three daily pages → two assignments → seven files despite inaccessible catalogs and 200 unrelated modules. Tests use synthetic credentials and mock Canvas/Groq HTTP; they do not contact your accounts.

## Manual Chrome check

After pulling and reloading, verify no extension registration errors, test Canvas and optionally Groq in Settings, then run the examples above in ChatGPT. Check the multi-intent response includes counts and evidence, the manual query includes grading excerpts, and disabling Groq still retrieves useful context. Check the popup inspector and compare answers to Canvas. Automated browser fixtures cannot verify your institution's live permissions, file hosting, or the current signed-in ChatGPT DOM.

## Implementation references

The client follows the official [Canvas API](https://developerdocs.instructure.com/services/canvas), including [pagination](https://developerdocs.instructure.com/services/canvas/basics/file.pagination), [files](https://developerdocs.instructure.com/services/canvas/resources/files), [assignments](https://developerdocs.instructure.com/services/canvas/resources/assignments), and [modules](https://developerdocs.instructure.com/services/canvas/resources/modules). Planner configuration uses Groq's [strict structured outputs](https://console.groq.com/docs/structured-outputs) and [reasoning](https://console.groq.com/docs/reasoning). Chrome documents [trusted storage access](https://developer.chrome.com/docs/extensions/reference/api/storage) and [offscreen workers](https://developer.chrome.com/docs/extensions/reference/api/offscreen).

MIT for project code; bundled dependencies retain their licenses in `src/vendor/LICENSES.txt`. This is an independent project, not an official Instructure, Groq or OpenAI product.
