# Canvas Live for ChatGPT

A Manifest V3 Chrome extension that gives ChatGPT a **live, read-only bridge to Canvas UvA** when you type `@Canvas`.

Instead of syncing Canvas to a file or database, the extension fetches Canvas **at send time**. Every `@Canvas` invocation performs a fresh API request and then supplies only the relevant Canvas context to ChatGPT.

> This project is a workaround for personal ChatGPT plans that do not expose custom MCP apps/connectors. It is not an official OpenAI or Instructure product.

## What it feels like

Type in ChatGPT:

```text
@Canvas deadline tuần này là gì?
```

or:

```text
@Canvas đọc instruction Gold Foraging và giải thích tôi cần làm gì
```

or:

```text
@Canvas Robot Camp có announcement mới không?
```

The extension intercepts Send, queries Canvas UvA, adds fresh context to the prompt, and then submits the message to ChatGPT.

## Features

- **Live fetch on every invocation** — Canvas responses are not used from a sync file or extension cache.
- **Read-only by design** — the Canvas client contains GET operations only.
- **`@Canvas` detection** in the ChatGPT composer.
- **Autocomplete-style hint** while typing `@Can…`.
- **English + Vietnamese request routing**.
- **Deadline / todo queries**.
- **Assignment lists and submission status** when Canvas exposes it.
- **Assignment instruction/details lookup** with fuzzy title matching.
- **Announcements**.
- **Grades / enrollment score summaries**.
- **Course files**.
- **Modules and module items**.
- **Course fuzzy matching** so you can say a course name instead of finding its numeric Canvas ID.
- **Context minimization** to avoid dumping the entire Canvas account into every prompt.
- **Configurable timeout and context-size limit**.
- **Connection test** and compact toolbar popup.
- **No analytics, telemetry, ad SDK, CDN scripts, or extension-operated backend**.
- **Token isolation** from the ChatGPT content script using Chrome storage access controls.

## Architecture

```text
┌──────────────────────────────┐
│        chatgpt.com           │
│                              │
│  "@Canvas deadline..."      │
└──────────────┬───────────────┘
               │ content-script message
               │ (query only — no token)
               ▼
┌──────────────────────────────┐
│ Chrome MV3 service worker    │
│                              │
│ intent routing               │
│ course/assignment matching   │
│ context minimization         │
│ token access                 │
└──────────────┬───────────────┘
               │ HTTPS GET
               │ Authorization: Bearer <token>
               ▼
┌──────────────────────────────┐
│      canvas.uva.nl API       │
│                              │
│ courses / todo / assignments │
│ announcements / files        │
│ modules / enrollments        │
└──────────────┬───────────────┘
               │ fresh Canvas data
               ▼
┌──────────────────────────────┐
│ Context returned to          │
│ ChatGPT composer             │
└──────────────────────────────┘
```

The Canvas access token never needs to enter the ChatGPT page.

## Install

### 1. Clone or download this repository

```bash
git clone https://github.com/mac1102/Canvas-extension-connection-for-ChatGPT.git
```

You do **not** need to run `npm install` to use the extension.

### 2. Load it into Chrome

Open:

```text
chrome://extensions
```

Then:

1. Enable **Developer mode**.
2. Choose **Load unpacked**.
3. Select the repository folder containing `manifest.json`.

Chrome will open the extension settings page on first install.

### 3. Add your Canvas access token

In Canvas UvA:

```text
Account → Settings → Approved Integrations → New Access Token
```

Copy the token when Canvas shows it.

In the extension settings:

1. Paste the token into **Canvas access token**.
2. Choose **Save settings**.
3. Choose **Test connection**.
4. Confirm the extension shows the Canvas account name.

Do not put the token in this repository, a `.env` file committed to GitHub, screenshots, or ChatGPT messages.

### 4. Use `@Canvas`

Open or refresh `https://chatgpt.com` after installing the extension.

Examples:

```text
@Canvas tôi phải làm gì hôm nay?
```

```text
@Canvas deadline tuần này và cái nào chưa nộp?
```

```text
@Canvas đọc instruction của Individual Integral
```

```text
@Canvas tìm announcement mới của Robot Camp
```

```text
@Canvas điểm hiện tại của các course là bao nhiêu?
```

```text
@Canvas lấy các file mới nhất của Robot Camp
```

```text
@Canvas week 4 có module gì?
```

## What happens when you press Send

For a prompt containing `@Canvas`:

1. The content script catches the Send action.
2. It sends **only your request text** to the extension service worker.
3. The service worker reads the token from trusted extension storage.
4. The service worker gets the active course index from Canvas fresh.
5. The router detects what kind of data your request needs.
6. It narrows the request to likely courses/assignments where possible.
7. It fetches the relevant Canvas endpoints with `cache: "no-store"`.
8. It builds a size-limited live context block.
9. The content script places that context in the ChatGPT prompt.
10. ChatGPT receives the request plus the freshly fetched Canvas data.

There is no scheduled/background Canvas sync.

## Important Plus-plan limitation

A browser extension cannot create a private/native ChatGPT tool channel. On a personal plan, this extension therefore supplies Canvas data through the **message composer**.

That means the Canvas context selected for the invocation becomes part of the ChatGPT message and may be visible in the conversation. This is intentional: ChatGPT must receive the Canvas data to answer from it.

The **Canvas access token is never included** in that context.

If OpenAI later exposes native custom MCP/apps for the plan you use, the service-worker Canvas client/router in this project can be adapted into a native connector so Canvas data can travel through a dedicated tool channel instead.

## Intent routing

The router supports overlapping intents. A single prompt can request more than one category.

| Intent | Example | Canvas data |
| --- | --- | --- |
| Dashboard | `@Canvas check Canvas` | courses + todo |
| Deadlines | `@Canvas deadline tuần này` | todo + targeted assignments |
| Assignment details | `@Canvas hướng dẫn Gold Foraging` | assignment list → fuzzy match → full assignment |
| Announcements | `@Canvas thông báo mới` | course announcements |
| Grades | `@Canvas điểm hiện tại` | student enrollments / scores |
| Files | `@Canvas lecture slides` | recently updated course files |
| Modules | `@Canvas week 3 module` | modules + module items |

The keyword router includes common English and Vietnamese forms. Course and assignment names are matched separately, so named entities such as `Robot Camp` or `Gold Foraging` do not need to be hard-coded.

## Read-only Canvas endpoints

The implementation uses Canvas GET endpoints in these families:

```text
GET /api/v1/users/self
GET /api/v1/courses
GET /api/v1/users/self/todo
GET /api/v1/courses/:course_id/assignments
GET /api/v1/courses/:course_id/assignments/:assignment_id
GET /api/v1/announcements
GET /api/v1/courses/:course_id/files
GET /api/v1/courses/:course_id/modules
GET /api/v1/users/self/enrollments
```

No POST, PUT, PATCH, or DELETE Canvas request is implemented.

## Security model

### Token boundary

The token is stored in `chrome.storage.local`. The service worker calls:

```js
chrome.storage.local.setAccessLevel({
  accessLevel: "TRUSTED_CONTEXTS"
});
```

where supported. This prevents the content script running on `chatgpt.com` from directly reading local extension storage.

The content script asks the service worker for **Canvas context**, never for credentials.

### Least-privilege host permission

`manifest.json` requests only:

```json
"host_permissions": [
  "https://canvas.uva.nl/*"
]
```

It does not request broad `https://*/*` access.

### No remote code

All JavaScript and CSS ships inside the repository. There is no remote code execution or dynamically downloaded script.

### Local-storage limitation

Chrome extension local storage is not a hardware-backed secrets vault. Protect your local Chrome profile/device. If you suspect token exposure, revoke the token in Canvas and issue a new one.

See [SECURITY.md](SECURITY.md) and [PRIVACY.md](PRIVACY.md).

## Settings

Open the extension toolbar popup → **Settings**, or Chrome's extension details → **Extension options**.

Available settings:

- request timeout: 8–30 seconds;
- maximum Canvas context: 10k–30k characters;
- include assignment/announcement descriptions;
- include submitted assignments;
- debug routing logs.

The Canvas instance is fixed to `https://canvas.uva.nl` in this build to keep Chrome host permissions narrow.

## Development

Runtime dependencies: **none**.

Node.js is used only for local validation/tests.

```bash
npm test
npm run check
```

Test coverage currently focuses on the pure routing layer:

- Vietnamese normalization;
- intent recognition;
- named-course matching;
- named-assignment matching;
- time-window parsing.

## Project structure

```text
.
├── manifest.json
├── src/
│   ├── background.js       # trusted service worker + context builder
│   ├── canvas-client.js    # read-only Canvas API client
│   ├── router.js           # intent/time/fuzzy routing helpers
│   ├── content.js          # ChatGPT @Canvas integration
│   └── content.css         # hint + live fetch status UI
├── options/
│   ├── options.html
│   ├── options.js
│   └── options.css
├── popup/
│   ├── popup.html
│   ├── popup.js
│   └── popup.css
├── tests/
│   └── router.test.mjs
├── PRIVACY.md
├── SECURITY.md
├── CHANGELOG.md
├── LICENSE
└── README.md
```

## Troubleshooting

### `Canvas access token is not configured`

Open extension settings, paste the token, save, then test the connection.

### `Canvas rejected the access token`

The token may be expired/revoked or copied incorrectly. Generate a fresh token in Canvas and replace the stored token.

### `Canvas denied access to this resource`

Your Canvas user/token does not have permission to view that endpoint/resource, or the course restricts that content.

### `@Canvas` does not trigger

1. Confirm the extension is enabled in `chrome://extensions`.
2. Refresh the ChatGPT tab after installing/reloading the extension.
3. Make sure the message contains the exact mention `@Canvas`.
4. Test Canvas from the toolbar popup.
5. Check the extension service-worker console for errors if Debug logging is enabled.

### Canvas data fetches but the message does not auto-send

ChatGPT's DOM can change independently of this extension. The extension attempts several current send-button/composer selectors. If it cannot safely find an enabled Send button after attaching context, it leaves the enriched prompt in the composer and asks you to press Send once.

### ChatGPT UI update breaks the extension

This project integrates with the public ChatGPT web UI rather than an official browser-extension API. DOM changes can therefore require selector updates in `src/content.js`.

## Current scope / non-goals

This first release intentionally does **not**:

- submit Canvas assignments;
- upload files to Canvas;
- edit courses;
- mark items read/unread;
- change grades;
- run periodic Canvas sync jobs;
- send the Canvas token to ChatGPT;
- use an extension-operated backend;
- pretend to be a native ChatGPT MCP connector.

## License

MIT. See [LICENSE](LICENSE).
