# Security

## Security model

Canvas Live for ChatGPT follows a deliberately narrow model:

1. **Read-only Canvas access.** The code issues GET requests only. There are no submission, grading, editing, deleting, or other Canvas write actions.
2. **Least-privilege host permission.** The packaged manifest requests host access only to `https://canvas.uva.nl/*` rather than all websites.
3. **Token isolation.** The Canvas token lives in extension storage and is read only by trusted extension pages/service workers. The content script on `chatgpt.com` never receives it.
4. **No remote code.** The extension contains no CDN scripts, remote JavaScript, analytics SDKs, or dynamically executed downloaded code.
5. **No Canvas-response cache.** Academic data fetched for a request is held in memory only long enough to build the live context.
6. **Fresh reads.** Canvas fetch calls use `cache: "no-store"`.

## Important limitation

`chrome.storage.local` is persistent extension storage. Restricting it to trusted extension contexts reduces exposure to content scripts, but it is not a hardware-backed secrets vault. Anyone with sufficient access to the user's local Chrome profile/device may be able to recover extension data.

If a token may have been exposed, revoke it in Canvas and generate a replacement.

## Reporting a vulnerability

Do not include real Canvas access tokens, student records, grades, or other private academic data in a public GitHub issue.

When reporting a security bug, provide:

- extension version;
- Chrome version;
- affected file/function;
- reproduction steps using dummy/redacted values;
- expected and actual behavior.
