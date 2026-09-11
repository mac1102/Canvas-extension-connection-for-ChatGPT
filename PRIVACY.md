# Privacy

## Canvas ↔ Chrome extension

On an explicit `@Canvas` request or connection test, the service worker sends HTTPS GET requests to `canvas.uva.nl`. Your Canvas token is used only as its Authorization header. The response may contain private course material, assignment descriptions, grades and submission status. The extension reads and processes that material locally; selected files are parsed in bundled workers. No periodic synchronization runs.

Canvas tokens stay in local trusted extension storage, apart from transmission to Canvas for authentication. The request-local response cache is held in memory and discarded after retrieval. Course material, file bytes, submission contents and grades are not stored persistently. Safe status timestamps and user-selected settings are stored; the connection test displays your name but does not persist it.

## Chrome extension → Groq planner

Groq is disabled initially. With it enabled, Hybrid uses local planning for simple queries and considers Groq for complex or ambiguous queries. Local only sends no planner requests; AI planner preferred attempts eligible requests using Groq.

The only planning payload inputs are a short natural-language user query and a fixed list of abstract operation names. A fixed system instruction and JSON Schema describe the retrieval plan. Planning happens before any Canvas content retrieval. The payload builder rejects extra fields, raw objects, multiline/pasted text, markup, URLs, known keys and detected identifiers. There is no second metadata/content planning stage.

The extension never supplies Canvas assignment descriptions, grades, feedback, submission bodies, student IDs/emails, private page/announcement bodies, signed URLs or extracted document text to Groq. Groq does not access Canvas or execute operations. The Groq key stays in trusted local storage, apart from transmission to Groq in its authentication header; it is never in the model's messages.

Your own query is still an external data disclosure. Detection cannot identify every sensitive fact written in ordinary language. Do not paste private notes into queries with AI planning enabled. Use Local only if the user query itself must not go to Groq. Groq applies its own service policies to requests. Testing the Groq connection sends only a synthetic assignment-list query.

## Chrome extension → ChatGPT

The extension appends selected Canvas evidence to your original prompt and attempts to send it through the ChatGPT composer. This selected context can include assignment requirements, document excerpts, announcements, submission status or grades when requested. **It is sent to ChatGPT because ChatGPT needs it to answer.** ChatGPT applies its own account and data policies.

Neither credential is injected. Known credentials are redacted from retrieved strings before JSON serialization, and prompts containing a saved credential are rejected. Signed download parameters are removed; file references use Canvas UI URLs. The content script receives only compact context and safe execution metadata, never credential values or raw API objects.

## Local storage, logs and removal

`chrome.storage.local.setAccessLevel({accessLevel: "TRUSTED_CONTEXTS"})` restricts storage to trusted extension contexts before credential reads/writes. Chrome profile storage is persistent, not a hardware-backed vault; protect the local device and profile.

Debug logs and the popup inspector contain only planner type, confidence, operations, fallback category, resource counts and duration. They omit query text and private content. The inspector is memory-only and resets with the worker. No analytics, tracking SDK, extension-operated backend or remote parser code is used.

Settings offers separate **Remove token** and **Remove Groq key** actions. Removing the Canvas token also clears connection metadata. Removing the extension clears its extension storage. This does not delete previously sent ChatGPT messages or data already processed by Groq; manage those through the respective services. Revoke keys with the provider if exposed.
