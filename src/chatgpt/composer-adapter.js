(() => {
  const SEND_SELECTOR = 'button[data-testid="send-button"], button[data-testid="composer-submit-button"], button[aria-label="Send prompt"], button[aria-label="Send message"], button[aria-label*="Send"]';
  function findComposerFromEvent(event) {
    const target = event.target;
    if (!(target instanceof Element)) return null;
    const candidate = target.closest?.('#prompt-textarea, [data-testid="prompt-textarea"], textarea, [contenteditable="true"]');
    return candidate && isComposer(candidate) ? candidate : null;
  }
  function findComposer() {
    const focused = document.activeElement;
    const active = focused instanceof Element ? findComposerFromEvent({ target: focused }) : null;
    if (active && isVisible(active)) return active;
    const candidates = [
      document.querySelector('#prompt-textarea'),
      document.querySelector('[data-testid="prompt-textarea"]'),
      document.querySelector('form textarea'),
      ...document.querySelectorAll('[contenteditable="true"]')
    ].filter(Boolean);
    return candidates.find((element) => isComposer(element) && isVisible(element)) || null;
  }
  function isComposer(element) {
    if (!(element instanceof HTMLElement) || element.closest(".canvas-live-toast, .canvas-live-hint")) return false;
    if (element instanceof HTMLTextAreaElement && (element.readOnly || element.disabled)) return false;
    if (element.matches('#prompt-textarea, [data-testid="prompt-textarea"], textarea')) return true;
    if (element.getAttribute("contenteditable") === "true") {
      const form = element.closest("form");
      return Boolean(form && form.querySelector(SEND_SELECTOR + ', button[type="submit"]'));
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
  function sameComposerText(actual, expected) {
    // Rich editors may represent paragraph boundaries with repeated newlines.
    // Do not normalize spaces or alter the JSON context.
    const normalize = (text) => String(text).replace(/\r\n?/g, "\n").replace(/\n+/g, "\n").trim();
    return normalize(actual) === normalize(expected);
  }
  function selectContents(composer) {
    composer.focus();
    const range = document.createRange();
    range.selectNodeContents(composer);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
  }
  async function setComposerText(composer, text) {
    if (!composer?.isConnected) return false;
    composer.focus();
    if (composer instanceof HTMLTextAreaElement || composer instanceof HTMLInputElement) {
      if (composer.readOnly || composer.disabled) return false;
      const prototype = composer instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      const setter = Object.getOwnPropertyDescriptor(prototype, "value")?.set;
      if (!setter) return false;
      setter.call(composer, text);
      composer.dispatchEvent(new InputEvent("input", { bubbles: true, composed: true, inputType: "insertText", data: text }));
      composer.dispatchEvent(new Event("change", { bubbles: true, composed: true }));
      return true;
    }
    if (!composer.isContentEditable) return false;
    const previous = getComposerText(composer);
    selectContents(composer);
    // Rich editors synchronize their model selection on selectionchange. Give
    // that native event a turn before paste, or paste may append at the old caret.
    await new Promise((resolve) => setTimeout(resolve, 25));
    if (!composer.isConnected || !sameComposerText(getComposerText(composer), previous) ||
      !sameComposerText(window.getSelection()?.toString() || "", previous)) return false;
    // Let rich editors process paste through their own document/state transaction.
    // A DOM-only textContent replacement can leave their send payload unchanged.
    try {
      const clipboardData = new DataTransfer();
      clipboardData.setData("text/plain", text);
      const paste = new ClipboardEvent("paste", { clipboardData, bubbles: true, composed: true, cancelable: true });
      composer.dispatchEvent(paste);
      if (paste.defaultPrevented) return true;
    } catch {}
    try {
      if (document.execCommand("insertText", false, text)) return true;
    } catch {}
    return false;
  }
  async function waitForComposerText(expected, { timeoutMs = 2000, settleMs = 350, composer = null } = {}) {
    const started = performance.now();
    let stableSince = null, stableComposer = null;
    while (performance.now() - started < timeoutMs) {
      const current = composer?.isConnected ? composer : findComposer();
      if (current && sameComposerText(getComposerText(current), expected)) {
        if (current !== stableComposer || stableSince === null) {
          stableComposer = current;
          stableSince = performance.now();
        }
        if (performance.now() - stableSince >= settleMs) return current;
      } else { stableSince = null; stableComposer = null; }
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    return null;
  }
  function isSendButton(button, composer = findComposer()) {
    if (!(button instanceof Element) || !composer) return false;
    const form = composer.closest("form");
    if (form && button.closest("form") !== form) return false;
    return button.matches(SEND_SELECTOR) || Boolean(form && button.matches('button[type="submit"]'));
  }
  async function findEnabledSendButton(timeoutMs, composer = findComposer()) {
    const started = performance.now();
    while (performance.now() - started < timeoutMs) {
      const current = composer?.isConnected ? composer : findComposer();
      const form = current?.closest("form");
      const root = form || document;
      const buttons = [...root.querySelectorAll(SEND_SELECTOR + (form ? ', button[type="submit"]' : ""))];
      const button = buttons.find((item) => !item.disabled && item.getAttribute("aria-disabled") !== "true" && isVisible(item));
      if (button) return button;
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    return null;
  }
  globalThis.CanvasComposer = {
    findComposerFromEvent, findComposer, getComposerText, setComposerText,
    sameComposerText, waitForComposerText, isSendButton, findEnabledSendButton
  };
})();
