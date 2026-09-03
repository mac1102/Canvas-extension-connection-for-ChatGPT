const state = document.querySelector("#state");
const detail = document.querySelector("#detail");
const test = document.querySelector("#test");
const settings = document.querySelector("#settings");

settings.addEventListener("click", () => chrome.runtime.openOptionsPage());
test.addEventListener("click", runTest);

await refresh();

async function refresh() {
  const response = await chrome.runtime.sendMessage({ type: "GET_STATUS" });
  if (!response?.ok) return render("Error", response?.error?.message || "Could not read status.", "error");
  if (!response.configured) return render("Not connected", "Open Settings and save a Canvas access token.", "neutral");

  const last = response.lastConnection;
  if (last?.ok && last.user?.name) {
    render("Connected", `${last.user.name} · ${formatTime(last.at)}`, "success");
  } else if (last?.ok && last.at) {
    render("Ready", `Last live fetch ${formatTime(last.at)}`, "success");
  } else {
    render("Token saved", "Run Test Canvas to verify the connection.", "neutral");
  }
}

async function runTest() {
  test.disabled = true;
  render("Testing…", "Contacting Canvas UvA directly.", "loading");
  try {
    const response = await chrome.runtime.sendMessage({ type: "TEST_CONNECTION" });
    if (!response?.ok) throw new Error(response?.error?.message || "Connection failed.");
    render("Connected", `${response.user?.name || "Canvas user"} · just now`, "success");
  } catch (error) {
    render("Connection failed", error.message, "error");
  } finally {
    test.disabled = false;
  }
}

function render(title, message, kind) {
  state.textContent = title;
  state.dataset.kind = kind;
  detail.textContent = message;
}

function formatTime(value) {
  if (!value) return "";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "" : new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(date);
}
