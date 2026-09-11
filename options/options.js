const $ = (id) => document.getElementById(id);
const booleans = ["includeDescriptions", "includeSubmitted", "currentCoursesOnly", "groqEnabled", "debug"];
const numbers = ["timeoutMs", "maxContextChars", "maxDocumentBytes", "maxDepth"];
async function message(type, payload) {
  const response = await chrome.runtime.sendMessage({ type, payload });
  if (!response?.ok) throw new Error(response?.error?.message || "Extension request failed.");
  return response;
}
function configured(response) {
  $("connectionBadge").textContent = response.configured ? "Canvas token saved" : "Canvas not configured";
  $("tokenState").textContent = response.configured ? "Token saved. Leave blank to keep it." : "No Canvas token saved.";
  $("groqState").textContent = response.groqConfigured ? "Groq key saved. Leave blank to keep it." : "No Groq key saved. Local planning remains available.";
}
async function load() {
  const response = await message("GET_STATUS");
  for (const key of booleans) $(key).checked = Boolean(response.settings[key]);
  for (const key of numbers) $(key).value = response.settings[key];
  $("plannerMode").value = response.settings.plannerMode;
  configured(response);
}
async function save() {
  for (const key of numbers) if (!$(key).checkValidity()) throw new Error(`Check the value for ${$(key).labels?.[0]?.textContent.trim() || key}.`);
  const settings = { plannerMode: $("plannerMode").value };
  for (const key of booleans) settings[key] = $(key).checked;
  for (const key of numbers) settings[key] = Number($(key).value);
  const response = await message("SAVE_SETTINGS", { settings, token: $("token").value.trim(), groqKey: $("groqKey").value.trim() });
  $("token").value = ""; $("groqKey").value = ""; configured(response);
  return "Settings saved.";
}
async function action(work) {
  for (const button of document.querySelectorAll("button")) button.disabled = true;
  $("status").textContent = "Working…";
  try { $("status").textContent = await work(); $("status").dataset.kind = "success"; }
  catch (error) { $("status").textContent = error.message; $("status").dataset.kind = "error"; }
  finally { for (const button of document.querySelectorAll("button")) button.disabled = false; }
}
$("save").onclick = () => action(save);
$("test").onclick = () => action(async () => { await save(); const r = await message("TEST_CONNECTION"); return `Connected as ${r.user?.name || "Canvas user"}.`; });
$("testGroq").onclick = () => action(async () => { await save(); const r = await message("TEST_GROQ"); return `Groq connected: ${r.model}. Structured retrieval plan validated.`; });
$("clearToken").onclick = () => action(async () => { await message("CLEAR_TOKEN"); $("token").value = ""; await load(); return "Canvas token removed."; });
$("clearGroq").onclick = () => action(async () => { await message("CLEAR_GROQ_KEY"); $("groqKey").value = ""; await load(); return "Groq key removed. Local planner is available."; });
$("toggleToken").onclick = () => { $("token").type = $("token").type === "password" ? "text" : "password"; $("toggleToken").textContent = $("token").type === "password" ? "Show" : "Hide"; };
await action(async () => { await load(); return "Settings loaded."; });
