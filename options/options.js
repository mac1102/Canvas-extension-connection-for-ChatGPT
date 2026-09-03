const els = {
  connectionBadge: document.querySelector("#connectionBadge"),
  token: document.querySelector("#token"),
  tokenState: document.querySelector("#tokenState"),
  toggleToken: document.querySelector("#toggleToken"),
  save: document.querySelector("#save"),
  test: document.querySelector("#test"),
  clearToken: document.querySelector("#clearToken"),
  timeoutMs: document.querySelector("#timeoutMs"),
  maxContextChars: document.querySelector("#maxContextChars"),
  includeDescriptions: document.querySelector("#includeDescriptions"),
  includeSubmitted: document.querySelector("#includeSubmitted"),
  debug: document.querySelector("#debug"),
  status: document.querySelector("#status")
};

await loadStatus();

els.toggleToken.addEventListener("click", () => {
  const showing = els.token.type === "text";
  els.token.type = showing ? "password" : "text";
  els.toggleToken.textContent = showing ? "Show" : "Hide";
});

els.save.addEventListener("click", saveSettings);
els.test.addEventListener("click", testConnection);
els.clearToken.addEventListener("click", clearToken);

async function loadStatus() {
  setBusy(true);
  try {
    const response = await chrome.runtime.sendMessage({ type: "GET_STATUS" });
    if (!response?.ok) throw new Error(response?.error?.message || "Could not read extension settings.");

    els.timeoutMs.value = String(response.settings?.timeoutMs ?? 15000);
    els.maxContextChars.value = String(response.settings?.maxContextChars ?? 18000);
    els.includeDescriptions.checked = response.settings?.includeDescriptions !== false;
    els.includeSubmitted.checked = response.settings?.includeSubmitted !== false;
    els.debug.checked = Boolean(response.settings?.debug);
    updateConfiguredState(response.configured, response.lastConnection);
  } catch (error) {
    showStatus(error.message, "error");
  } finally {
    setBusy(false);
  }
}

async function saveSettings() {
  setBusy(true);
  showStatus("Saving…", "info");
  try {
    const payload = {
      settings: {
        timeoutMs: Number(els.timeoutMs.value),
        maxContextChars: Number(els.maxContextChars.value),
        includeDescriptions: els.includeDescriptions.checked,
        includeSubmitted: els.includeSubmitted.checked,
        debug: els.debug.checked
      }
    };
    if (els.token.value.trim()) payload.token = els.token.value.trim();

    const response = await chrome.runtime.sendMessage({ type: "SAVE_SETTINGS", payload });
    if (!response?.ok) throw new Error(response?.error?.message || "Could not save settings.");

    els.token.value = "";
    updateConfiguredState(response.configured);
    showStatus("Settings saved. Use Test connection to verify the token.", "success");
  } catch (error) {
    showStatus(error.message, "error");
  } finally {
    setBusy(false);
  }
}

async function testConnection() {
  if (els.token.value.trim()) await saveSettings();
  setBusy(true);
  showStatus("Contacting Canvas UvA…", "info");
  try {
    const response = await chrome.runtime.sendMessage({ type: "TEST_CONNECTION" });
    if (!response?.ok) throw new Error(response?.error?.message || "Canvas connection failed.");
    updateConfiguredState(true, { ok: true, at: response.checkedAt, user: response.user });
    showStatus(`Connected as ${response.user?.name || response.user?.short_name || "Canvas user"}.`, "success");
  } catch (error) {
    showStatus(error.message, "error");
    els.connectionBadge.textContent = "Connection failed";
    els.connectionBadge.dataset.kind = "error";
  } finally {
    setBusy(false);
  }
}

async function clearToken() {
  if (!confirm("Remove the saved Canvas token from this browser extension?")) return;
  setBusy(true);
  try {
    const response = await chrome.runtime.sendMessage({ type: "CLEAR_TOKEN" });
    if (!response?.ok) throw new Error(response?.error?.message || "Could not remove token.");
    els.token.value = "";
    updateConfiguredState(false);
    showStatus("Canvas token removed.", "success");
  } catch (error) {
    showStatus(error.message, "error");
  } finally {
    setBusy(false);
  }
}

function updateConfiguredState(configured, lastConnection = null) {
  els.connectionBadge.textContent = configured ? "Token saved" : "Not configured";
  els.connectionBadge.dataset.kind = configured ? "success" : "neutral";
  els.tokenState.textContent = configured
    ? "A token is saved. Leave the field blank to keep it, or paste a new token to replace it."
    : "No token saved yet.";

  if (lastConnection?.ok && lastConnection?.user?.name) {
    els.connectionBadge.textContent = `Connected · ${lastConnection.user.name}`;
  }
}

function setBusy(busy) {
  for (const button of [els.save, els.test, els.clearToken]) button.disabled = busy;
}

function showStatus(message, kind) {
  els.status.textContent = message;
  els.status.dataset.kind = kind;
}
