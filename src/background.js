import { CanvasClient, CanvasApiError } from "./canvas-client.js";
import { normalizeText } from "./router.js";
import { DEFAULT_SETTINGS, sanitizeSettings } from "./settings.js";
import { planRequest } from "./planner/planner-router.js";
import { groqPlan, GROQ_MODEL } from "./planner/groq-planner.js";
import { executePlan } from "./retrieval/resource-executor.js";
import { parseLocally } from "./parsers/bridge.js";
import { plannerLog, redact } from "./privacy/redact.js";

const CANVAS_ORIGIN = "https://canvas.uva.nl/*";
const storageReady = initializeStorageSecurity();
let lastInspector = null;
let activeRequests = 0;

chrome.runtime.onInstalled.addListener(async ({ reason }) => {
  await storageReady;
  if (!(await chrome.storage.local.get("settings")).settings) await chrome.storage.local.set({ settings: DEFAULT_SETTINGS });
  if (reason === "install") await chrome.runtime.openOptionsPage();
});
chrome.runtime.onStartup.addListener(initializeStorageSecurity);
chrome.runtime.onMessage.addListener((message, sender, respond) => {
  if (message?.target === "parser") return;
  handleMessage(message, sender).then((result) => respond({ ok: true, ...result })).catch((error) => {
    respond({
      ok: false,
      error: {
        message: error instanceof CanvasApiError || error.safe ? error.message : "Extension request failed. Check Settings and try again.",
        status: error.status || null
      }
    });
  });
  return true;
});

async function initializeStorageSecurity() {
  if (chrome.storage.local.setAccessLevel) await chrome.storage.local.setAccessLevel({ accessLevel: "TRUSTED_CONTEXTS" });
}
function fail(message, status = null) {
  const error = new Error(message);
  error.safe = true;
  error.status = status;
  throw error;
}

async function hasCanvasHostAccess() {
  if (!chrome.permissions?.contains) return true;
  try {
    return await chrome.permissions.contains({ origins: [CANVAS_ORIGIN] });
  } catch {
    return true;
  }
}

export function validateSender(type, sender) {
  if (sender?.id !== chrome.runtime.id) fail("Unauthorized extension sender.");
  const url = sender.url || "";
  const own = chrome.runtime.getURL("");
  if (["options/options.html", "popup/popup.html"].some((path) => url === own + path)) return true;
  if (/^https:\/\/(chatgpt\.com|chat\.openai\.com)\//.test(url) && sender.frameId === 0 && ["FETCH_CANVAS_CONTEXT", "GET_STATUS", "OPEN_OPTIONS"].includes(type)) return false;
  fail("Rejected message from an unauthorized context.");
}

async function config() {
  await storageReady;
  const stored = await chrome.storage.local.get(["canvasToken", "groqKey", "settings", "lastConnection"]);
  return {
    token: stored.canvasToken || "",
    apiKey: stored.groqKey || "",
    settings: sanitizeSettings(stored.settings),
    lastConnection: stored.lastConnection || null
  };
}

function groqTestError(error) {
  const message = String(error?.message || "");
  const status = Number(message.match(/^Groq HTTP (\d{3})$/)?.[1] || 0);
  if (status === 401 || status === 403) return `Groq rejected the API key (HTTP ${status}). Replace the key and try again.`;
  if (status === 429) return "Groq rate limit reached (HTTP 429). Wait briefly and try again.";
  if (status >= 500) return `Groq service is unavailable (HTTP ${status}). Try again later.`;
  if (message === "Groq timeout") return "Groq connection timed out. Check your network and try again.";
  return "Groq responded, but the structured retrieval plan was invalid. Try again or use Local only mode.";
}

export async function handleMessage(message, sender) {
  if (!message || typeof message.type !== "string") fail("Invalid extension message.");
  const trusted = validateSender(message.type, sender);
  const stored = await config();

  if (message.type === "OPEN_OPTIONS") {
    await chrome.runtime.openOptionsPage();
    return { opened: true };
  }
  if (message.type === "GET_STATUS") {
    return trusted ? {
      configured: Boolean(stored.token),
      groqConfigured: Boolean(stored.apiKey),
      settings: stored.settings,
      baseUrl: stored.settings.baseUrl,
      lastConnection: stored.lastConnection,
      inspector: lastInspector,
      model: GROQ_MODEL,
      canvasHostAccess: await hasCanvasHostAccess()
    } : { configured: Boolean(stored.token) };
  }
  if (message.type === "SAVE_SETTINGS") {
    const payload = message.payload || {};
    const updates = { settings: sanitizeSettings({ ...stored.settings, ...payload.settings }) };
    for (const [input, key] of [["token", "canvasToken"], ["groqKey", "groqKey"]]) {
      if (!payload[input]) continue;
      if (typeof payload[input] !== "string" || payload[input].length > 512 || /\s/.test(payload[input].trim())) fail("Credential must be a single token without spaces.");
      updates[key] = payload[input].trim();
    }
    await chrome.storage.local.set(updates);
    return {
      configured: Boolean(updates.canvasToken || stored.token),
      groqConfigured: Boolean(updates.groqKey || stored.apiKey),
      settings: updates.settings
    };
  }
  if (message.type === "CLEAR_TOKEN") {
    await chrome.storage.local.remove(["canvasToken", "lastConnection"]);
    lastInspector = null;
    return { configured: false };
  }
  if (message.type === "CLEAR_GROQ_KEY") {
    await chrome.storage.local.remove("groqKey");
    return { groqConfigured: false };
  }
  if (message.type === "TEST_GROQ") {
    if (!stored.apiKey) fail("Save a Groq key first.");
    try {
      await groqPlan({ query: "List assignments", apiKey: stored.apiKey, secrets: [stored.token] });
    } catch (error) {
      fail(groqTestError(error));
    }
    return { model: GROQ_MODEL };
  }

  if (["TEST_CONNECTION", "FETCH_CANVAS_CONTEXT"].includes(message.type) && !(await hasCanvasHostAccess())) {
    fail("Chrome is blocking Canvas site access. Open Settings, click Test connection, and allow access to canvas.uva.nl.");
  }

  const client = new CanvasClient({ token: stored.token, ...stored.settings });
  if (message.type === "TEST_CONNECTION") {
    const user = await client.getCurrentUser();
    const checkedAt = new Date().toISOString();
    const safeName = redact(user?.name || "Canvas user", [stored.token, stored.apiKey]);
    await chrome.storage.local.set({ lastConnection: { ok: true, at: checkedAt, user: { name: safeName } } });
    return { user: { name: safeName }, checkedAt };
  }
  if (message.type !== "FETCH_CANVAS_CONTEXT") fail("Unsupported extension message.");

  const query = message.query;
  if (typeof query !== "string" || !normalizeText(query.replace(/@canvas/ig, "")) || query.length > 8000) fail("Enter a Canvas request of 1–8000 characters.");
  if ([stored.token, stored.apiKey].filter(Boolean).some((secret) => query.includes(secret))) fail("Remove credentials from your prompt. Keys belong only in Settings.");
  if (activeRequests >= 2) fail("Canvas is busy. Wait for the current request.");

  activeRequests += 1;
  const started = Date.now();
  try {
    const planning = await planRequest(query, stored.settings, { apiKey: stored.apiKey, secrets: [stored.token] });
    const result = await executePlan({
      query,
      plan: planning.plan,
      client,
      settings: stored.settings,
      parseDocument: parseLocally,
      secrets: [stored.token, stored.apiKey]
    });
    const meta = {
      ...planning.meta,
      ...result.stats,
      operations: planning.plan.operations.map((op) => op.type),
      durationMs: Date.now() - started,
      fetchedAt: new Date().toISOString()
    };
    lastInspector = plannerLog(meta);
    if (stored.settings.debug) console.info("Canvas planner", lastInspector);
    await chrome.storage.local.set({ lastConnection: { ok: true, at: meta.fetchedAt } });
    return { context: result.context, meta };
  } finally {
    activeRequests -= 1;
  }
}
