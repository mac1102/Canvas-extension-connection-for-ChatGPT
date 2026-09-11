(() => {
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


  globalThis.CanvasComposer = { findComposerFromEvent, findComposer, getComposerText, setComposerText, findEnabledSendButton };
})();