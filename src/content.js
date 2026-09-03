(() => {
  const MENTION_RE = /@canvas\b/i;
  const PARTIAL_MENTION_RE = /(?:^|\s)@(?:c|ca|can|canv|canva|canvas)$/i;
  const state = {
    processing: false,
    bypassOnce: false,
    armedText: null,
    hint: null,
    toast: null,
    lastComposer: null
  };

  document.addEventListener("keydown", onKeyDownCapture, true);
  document.addEventListener("click", onClickCapture, true);
  document.addEventListener("input", onInput, true);
  window.addEventListener("resize", refreshHintPosition, { passive: true });
  window.addEventListener("scroll", refreshHintPosition, { passive: true, capture: true });

  const observer = new MutationObserver(() => {
    const composer = findComposer();
    if (composer !== state.lastComposer) {
      state.lastComposer = composer;
      refreshHint();
    }
  });
  observer.observe(document.documentElement, { childList: true, subtree: true });

  async function onKeyDownCapture(event) {
    if (event.key !== "Enter" || event.shiftKey || event.altKey || event.ctrlKey || event.metaKey || event.isComposing) return;
    const composer = findComposerFromEvent(event) || findComposer();
    if (!composer) return;

    const text = getComposerText(composer);
    if (!MENTION_RE.test(text)) return;

    if (state.bypassOnce || state.armedText === text) {
      state.bypassOnce = false;
      state.armedText = null;
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();
    await processCanvasInvocation(composer, text);
  }

  async function onClickCapture(event) {
    const sendButton = event.target?.closest?.(
      'button[data-testid="send-button"], button[aria-label="Send prompt"], button[aria-label="Send message"], button[aria-label*="Send"]'
    );
    if (!sendButton) return;

    const composer = findComposer();
    if (!composer) return;
    const text = getComposerText(composer);
    if (!MENTION_RE.test(text)) return;

    if (state.bypassOnce || state.armedText === text) {
      state.bypassOnce = false;
      state.armedText = null;
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();
    await processCanvasInvocation(composer, text);
  }

  function onInput(event) {
    const composer = findComposerFromEvent(event);
    if (!composer) return;
    state.lastComposer = composer;
    refreshHint();
  }

  async function processCanvasInvocation(composer, originalText) {
    if (state.processing) return;
    state.processing = true;
    removeHint();
    showToast("Fetching fresh Canvas data…", "loading");

    try {
      const response = await chrome.runtime.sendMessage({
        type: "FETCH_CANVAS_CONTEXT",
        query: originalText
      });

      if (!response?.ok) throw new Error(response?.error?.message || "Canvas fetch failed.");

      const enriched = buildEnrichedPrompt(originalText, response.context, response.meta);
      setComposerText(composer, enriched);
      state.armedText = enriched;
      showToast(
        `Canvas fetched live${response.meta?.durationMs ? ` · ${response.meta.durationMs} ms` : ""}. Sending…`,
        "success"
      );

      const sendButton = await findEnabledSendButton(1800);
      if (sendButton) {
        state.bypassOnce = true;
        state.armedText = null;
        sendButton.click();
        setTimeout(() => hideToast(), 1600);
      } else {
        showToast("Fresh Canvas context attached. Press Send once to continue.", "success", 4500);
      }
    } catch (error) {
      setComposerText(composer, originalText);
      state.armedText = null;
      showToast(error?.message || "Could not fetch Canvas.", "error", 7000, true);
    } finally {
      state.processing = false;
      refreshHint();
    }
  }

  function buildEnrichedPrompt(originalText, context, meta) {
    const original = originalText.trim();
    const fetchedAt = meta?.fetchedAt || new Date().toISOString();
    return `${original}\n\n<<< CANVAS LIVE DATA — ${fetchedAt} >>>\n${context}\n<<< END CANVAS LIVE DATA >>>\n\nUse the freshly fetched Canvas data above to answer my @Canvas request. Treat Canvas as the source of truth for courses, deadlines, submission status, announcements, files, and grades. If the data does not contain what I asked for, say what is missing instead of guessing.`;
  }

  function findComposerFromEvent(event) {
    const target = event.target;
    if (!(target instanceof Element)) return null;
    if (isComposer(target)) return target;
    return target.closest?.('#prompt-textarea, [data-testid="prompt-textarea"], textarea');
  }

  function findComposer() {
    const candidates = [
      document.querySelector('#prompt-textarea'),
      document.querySelector('[data-testid="prompt-textarea"]'),
      document.querySelector('form textarea'),
      ...document.querySelectorAll('[contenteditable="true"]')
    ].filter(Boolean);

    return candidates.find((element) => isComposer(element) && isVisible(element)) || null;
  }

  function isComposer(element) {
    if (!(element instanceof HTMLElement)) return false;
    if (element.matches('#prompt-textarea, [data-testid="prompt-textarea"], textarea')) return true;
    if (element.getAttribute("contenteditable") === "true") {
      const form = element.closest("form");
      return Boolean(form && form.querySelector('button[data-testid="send-button"], button[aria-label*="Send"]'));
    }
    return false;
  }

  function isVisible(element) {
    const rect = element.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  }

  function getComposerText(composer) {
    if (composer instanceof HTMLTextAreaElement || composer instanceof HTMLInputElement) return composer.value || "";
    return composer.innerText || composer.textContent || "";
  }

  function setComposerText(composer, text) {
    composer.focus();

    if (composer instanceof HTMLTextAreaElement || composer instanceof HTMLInputElement) {
      const prototype = composer instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      const setter = Object.getOwnPropertyDescriptor(prototype, "value")?.set;
      setter?.call(composer, text);
      composer.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
      composer.dispatchEvent(new Event("change", { bubbles: true, composed: true }));
      return;
    }

    const selection = window.getSelection();
    const range = document.createRange();
    range.selectNodeContents(composer);
    selection?.removeAllRanges();
    selection?.addRange(range);

    let inserted = false;
    try {
      inserted = document.execCommand("insertText", false, text);
    } catch {
      inserted = false;
    }

    if (!inserted || getComposerText(composer) !== text) {
      composer.textContent = text;
      composer.dispatchEvent(new InputEvent("input", {
        bubbles: true,
        composed: true,
        inputType: "insertText",
        data: text
      }));
    }

    placeCaretAtEnd(composer);
  }

  function placeCaretAtEnd(element) {
    try {
      const range = document.createRange();
      range.selectNodeContents(element);
      range.collapse(false);
      const selection = window.getSelection();
      selection?.removeAllRanges();
      selection?.addRange(range);
    } catch {}
  }

  async function findEnabledSendButton(timeoutMs) {
    const started = performance.now();
    while (performance.now() - started < timeoutMs) {
      const button = document.querySelector(
        'button[data-testid="send-button"], button[aria-label="Send prompt"], button[aria-label="Send message"], button[aria-label*="Send"]'
      );
      if (button && !button.disabled && button.getAttribute("aria-disabled") !== "true" && isVisible(button)) return button;
      await nextFrame();
    }
    return null;
  }

  function nextFrame() {
    return new Promise((resolve) => requestAnimationFrame(() => resolve()));
  }

  function refreshHint() {
    const composer = findComposer();
    if (!composer || state.processing) return removeHint();
    const text = getComposerText(composer);

    if (PARTIAL_MENTION_RE.test(text.trim())) {
      showHint(composer, "autocomplete");
    } else if (MENTION_RE.test(text)) {
      showHint(composer, "active");
    } else {
      removeHint();
    }
  }

  function showHint(composer, mode) {
    if (!state.hint) {
      const hint = document.createElement("button");
      hint.type = "button";
      hint.className = "canvas-live-hint";
      hint.addEventListener("mousedown", (event) => event.preventDefault());
      hint.addEventListener("click", () => {
        const current = findComposer();
        if (!current) return;
        const text = getComposerText(current);
        if (PARTIAL_MENTION_RE.test(text.trim())) {
          setComposerText(current, text.replace(/@(?:c|ca|can|canv|canva|canvas)$/i, "@Canvas "));
        }
        current.focus();
        refreshHint();
      });
      document.body.appendChild(hint);
      state.hint = hint;
    }

    state.hint.dataset.mode = mode;
    state.hint.innerHTML = mode === "autocomplete"
      ? '<span class="canvas-live-dot"></span><strong>@Canvas</strong><span>Live LMS</span><kbd>↵</kbd>'
      : '<span class="canvas-live-dot"></span><strong>Canvas live</strong><span>Fresh fetch on send</span>';
    positionHint(composer);
  }

  function refreshHintPosition() {
    if (state.hint && state.lastComposer) positionHint(state.lastComposer);
  }

  function positionHint(composer) {
    if (!state.hint || !composer || !document.contains(composer)) return;
    const rect = composer.getBoundingClientRect();
    const hintRect = state.hint.getBoundingClientRect();
    const left = Math.max(12, Math.min(window.innerWidth - hintRect.width - 12, rect.left + 8));
    const top = Math.max(12, rect.top - hintRect.height - 8);
    state.hint.style.left = `${left}px`;
    state.hint.style.top = `${top}px`;
  }

  function removeHint() {
    state.hint?.remove();
    state.hint = null;
  }

  function showToast(message, kind = "info", duration = 0, showSettings = false) {
    if (!state.toast) {
      const toast = document.createElement("div");
      toast.className = "canvas-live-toast";
      toast.innerHTML = '<div class="canvas-live-toast__status"></div><div class="canvas-live-toast__message"></div><button class="canvas-live-toast__settings" type="button">Settings</button>';
      toast.querySelector(".canvas-live-toast__settings").addEventListener("click", async () => {
        try {
          await chrome.runtime.sendMessage({ type: "OPEN_OPTIONS" });
        } catch (error) {
          console.warn("Canvas Live: could not open extension settings", error);
        }
      });
      document.body.appendChild(toast);
      state.toast = toast;
    }

    state.toast.dataset.kind = kind;
    state.toast.querySelector(".canvas-live-toast__message").textContent = message;
    state.toast.querySelector(".canvas-live-toast__settings").hidden = !showSettings;
    state.toast.classList.add("canvas-live-toast--visible");

    clearTimeout(state.toast._hideTimer);
    if (duration) state.toast._hideTimer = setTimeout(hideToast, duration);
  }

  function hideToast() {
    if (!state.toast) return;
    state.toast.classList.remove("canvas-live-toast--visible");
  }
})();
