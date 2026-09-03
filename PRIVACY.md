# Privacy

Canvas Live for ChatGPT is designed as a local browser extension with no analytics, advertising, telemetry service, or extension-operated backend.

## Data the extension stores

The extension stores the following in `chrome.storage.local`:

- the Canvas access token supplied by the user;
- extension settings (timeout, context-size limit, and display/fetch preferences);
- small connection metadata such as the last successful connection time and, after an explicit connection test, the Canvas display name.

Canvas API responses such as assignment descriptions, grades, announcements, files, and course lists are **not cached** in extension storage.

The service worker asks Chrome to restrict `storage.local` to trusted extension contexts using `chrome.storage.local.setAccessLevel({ accessLevel: "TRUSTED_CONTEXTS" })` when supported. This prevents the ChatGPT content script from directly reading the stored token.

## Network traffic

The extension makes read-only HTTPS GET requests directly from the Chrome extension service worker to:

- `https://canvas.uva.nl`

The token is sent to Canvas in the standard `Authorization: Bearer ...` request header.

The extension does not send the Canvas token to ChatGPT.

When a user invokes `@Canvas`, the Canvas data needed for that request is appended as context to the ChatGPT prompt. This is necessary for ChatGPT to answer from the freshly fetched Canvas data. Therefore, the selected Canvas data for that invocation is sent to ChatGPT as part of the user's message.

## No background synchronization

The extension does not periodically sync Canvas. Canvas is queried only when the user explicitly invokes `@Canvas`, tests the connection, or opens functionality that requires a live connection check.

## Removing data

Open the extension settings and choose **Remove token**, or remove the extension from Chrome. Removing the extension clears its `chrome.storage.local` data.
