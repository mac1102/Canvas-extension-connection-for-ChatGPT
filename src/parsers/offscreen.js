chrome.runtime.onMessage.addListener((message, sender, respond) => {
  if (message?.target !== "parser" || sender.id !== chrome.runtime.id || sender.url !== chrome.runtime.getURL("src/background.js")) return;
  const worker = new Worker(new URL("./worker.js", import.meta.url), { type: "module" });
  const finish = (result) => { clearTimeout(timer); worker.terminate(); respond(result); };
  const timer = setTimeout(() => finish({ metadata: { error: "Document parser timed out" }, text: "" }), 12000);
  worker.onmessage = (event) => { if (event.data?.kind === "parsed-document") finish(event.data.result); };
  worker.onerror = () => finish({ metadata: { error: "Document parser failed" }, text: "" });
  const bytes = Uint8Array.from(atob(message.base64), (char) => char.charCodeAt(0));
  worker.postMessage({ ...message.options, bytes }, [bytes.buffer]);
  return true;
});
