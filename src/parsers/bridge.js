let creating;
export async function parseLocally(options) {
  const url = chrome.runtime.getURL("src/parsers/offscreen.html");
  if (!(await chrome.runtime.getContexts({ contextTypes: ["OFFSCREEN_DOCUMENT"], documentUrls: [url] })).length) {
    creating ||= chrome.offscreen.createDocument({ url: "src/parsers/offscreen.html", reasons: ["WORKERS"], justification: "Parse selected Canvas documents locally in a time-bounded worker." }).finally(() => { creating = null; });
    await creating;
  }
  const { bytes, ...rest } = options; let binary = "";
  for (let i = 0; i < bytes.length; i += 8192) binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
  return chrome.runtime.sendMessage({ target: "parser", base64: btoa(binary), options: rest });
}
