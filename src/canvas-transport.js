import { CanvasApiError } from "./canvas-client.js";

const BASE = "https://canvas.uva.nl";
const API_BYTE_LIMIT = 4 * 1024 * 1024;

// Serialized by chrome.scripting: keep this function self-contained. It executes
// in Chrome's isolated world, never the Canvas page's JavaScript world.
export async function fetchCanvasInTab({ url, authorization, deadline, maxBytes }) {
  let target;
  try { target = new URL(url); } catch { return { error: "destination" }; }
  if (location.origin !== "https://canvas.uva.nl" ||
      target.origin !== location.origin || target.username || target.password ||
      !target.pathname.startsWith("/api/v1/") ||
      typeof authorization !== "string" || !authorization.startsWith("Bearer ") ||
      !Number.isFinite(deadline) || !Number.isInteger(maxBytes) ||
      maxBytes < 0 || maxBytes > 4 * 1024 * 1024) {
    return { error: "destination" };
  }
  if (Date.now() >= deadline) return { error: "timeout" };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Math.min(15000, deadline - Date.now()));
  try {
    const response = await fetch(target.href, {
      method: "GET",
      headers: { Authorization: authorization, Accept: "application/json" },
      credentials: "omit",
      redirect: "manual",
      cache: "no-store",
      signal: controller.signal
    });
    if (response.type === "opaqueredirect" || response.status === 0 ||
        (response.status >= 300 && response.status < 400)) {
      await response.body?.cancel();
      return { error: "redirect" };
    }
    if (response.url && new URL(response.url).origin !== target.origin) {
      await response.body?.cancel();
      return { error: "destination" };
    }
    const headers = {};
    for (const name of ["content-type", "content-length", "link"]) {
      const value = response.headers.get(name);
      if (value !== null) headers[name] = value;
    }
    // Never copy or expose an HTTP error body.
    if (!response.ok) {
      await response.body?.cancel();
      return { status: response.status, url: target.href, headers, bytes: [] };
    }
    if (Number(response.headers.get("content-length")) > maxBytes) {
      await response.body?.cancel();
      return { error: "size" };
    }
    const reader = response.body?.getReader();
    const chunks = [];
    let size = 0;
    if (reader) {
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          size += value.byteLength;
          if (size > maxBytes) {
            await reader.cancel();
            return { error: "size" };
          }
          chunks.push(value);
        }
      } finally { reader.releaseLock(); }
    } else {
      const bytes = new Uint8Array(await response.arrayBuffer());
      size = bytes.byteLength;
      if (size > maxBytes) return { error: "size" };
      chunks.push(bytes);
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    return { status: response.status, url: target.href, headers, bytes: Array.from(bytes) };
  } catch (error) {
    return { error: error?.name === "AbortError" ? "timeout" : "network" };
  } finally { clearTimeout(timer); }
}

function abortable(work, signal) {
  if (!signal) return work;
  if (signal.aborted) return Promise.reject(new DOMException("Aborted", "AbortError"));
  return new Promise((resolve, reject) => {
    const abort = () => reject(new DOMException("Aborted", "AbortError"));
    signal.addEventListener("abort", abort, { once: true });
    work.then(resolve, reject).finally(() => signal.removeEventListener("abort", abort));
  });
}

export function createCanvasFetch({ fetchImpl = fetch, chromeApi = globalThis.chrome, timeoutMs = 15000 } = {}) {
  let tabId = null;
  const transport = async (input, init = {}) => {
    const url = new URL(input);
    const eligible = url.origin === BASE && !url.username && !url.password &&
      url.pathname.startsWith("/api/v1/") && init.method === "GET";
    const deadline = Date.now() + Math.min(15000, timeoutMs);
    const readInTab = async () => {
      if (!chromeApi?.scripting?.executeScript || !chromeApi?.tabs?.query) {
        throw new CanvasApiError("Canvas HTTPS request failed. Reload the updated extension, open canvas.uva.nl in Chrome, and test again.");
      }
      if (tabId === null) {
        let tabs;
        try { tabs = await chromeApi.tabs.query({ url: BASE + "/*" }); } catch {
          throw new CanvasApiError("Could not find a Canvas tab. Allow this extension access to canvas.uva.nl and test again.");
        }
        const tab = tabs.filter((item) => Number.isInteger(item.id) && item.url &&
          new URL(item.url).origin === BASE).sort((a, b) =>
          Number(Boolean(b.active)) - Number(Boolean(a.active)) || (b.lastAccessed || 0) - (a.lastAccessed || 0))[0];
        if (!tab) {
          throw new CanvasApiError("Direct Canvas HTTPS access failed. Open https://canvas.uva.nl in this Chrome profile, sign in, keep the tab open, then click Test connection again.");
        }
        tabId = tab.id;
      }
      if (init.signal?.aborted || Date.now() >= deadline) throw new DOMException("Aborted", "AbortError");
      let results;
      try {
        results = await chromeApi.scripting.executeScript({
          target: { tabId, frameIds: [0] },
          world: "ISOLATED",
          func: fetchCanvasInTab,
          args: [{
            url: url.href,
            authorization: init.headers.Authorization,
            deadline,
            maxBytes: API_BYTE_LIMIT
          }]
        });
      } catch {
        throw new CanvasApiError("Canvas tab access failed. Keep canvas.uva.nl open, allow site access, reload the extension, and test again.");
      }
      if (init.signal?.aborted) throw new DOMException("Aborted", "AbortError");
      const result = results?.find((entry) => entry.frameId === 0)?.result;
      if (result?.error === "timeout") throw new DOMException("Aborted", "AbortError");
      if (result?.error) {
        const messages = {
          destination: "Canvas tab navigated away or attempted an untrusted destination. Open canvas.uva.nl and test again.",
          redirect: "Canvas API redirected to a login page or another destination. Replace your Canvas access token in Settings and test again.",
          size: "Resource exceeds byte limit.",
          network: "Canvas HTTPS failed from both the extension and the Canvas tab. Check whether canvas.uva.nl opens normally, then check your VPN, proxy or network."
        };
        throw new CanvasApiError(messages[result.error] || "Canvas tab request failed.");
      }
      if (!result || !Number.isInteger(result.status) || result.status < 200 ||
          result.status > 599 || result.url !== url.href || !Array.isArray(result.bytes) ||
          result.bytes.length > API_BYTE_LIMIT) {
        throw new CanvasApiError("Invalid Canvas tab response.");
      }
      const response = new Response([204, 205, 304].includes(result.status) ? null : new Uint8Array(result.bytes), {
        status: result.status, headers: result.headers
      });
      Object.defineProperty(response, "url", { value: result.url });
      return response;
    };
    if (eligible && tabId !== null) return abortable(readInTab(), init.signal);
    try { return await fetchImpl(input, init); } catch (error) {
      // HTTP 401/403, timeouts and application errors never switch authentication.
      if (!eligible || error?.name !== "TypeError" || init.signal?.aborted) throw error;
      return abortable(readInTab(), init.signal);
    }
  };
  Object.defineProperty(transport, "transport", { get: () => tabId === null ? "direct" : "canvas-tab" });
  return transport;
}
