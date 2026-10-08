import { build } from "esbuild";

// A genuine upstream editor model, bundled only for browser tests. The sender's
// cache intentionally lags the rendered editor to exercise synchronization.
export async function prosemirrorFixture() {
  const result = await build({ bundle: true, write: false, minify: true, platform: "browser", format: "iife",
    stdin: { resolveDir: process.cwd(), contents: `
      import { schema } from "prosemirror-schema-basic";
      import { EditorState } from "prosemirror-state";
      import { EditorView } from "prosemirror-view";
      window.sent = 0; window.editorState = "";
      const view = new EditorView(document.querySelector("#editor-root"), {
        state: EditorState.create({ schema }), attributes: { id: "prompt-textarea" },
        dispatchTransaction(transaction) {
          view.updateState(view.state.apply(transaction));
          const next = view.state.doc.textBetween(0, view.state.doc.content.size, "\\n");
          setTimeout(() => { window.editorState = next; }, 180);
        }
      });
      const send = () => {
        window.sent++; window.sentText = window.editorState;
        view.dispatch(view.state.tr.delete(0, view.state.doc.content.size));
        window.editorState = "";
      };
      document.addEventListener("keydown", (event) => {
        if (view.dom.contains(event.target) && event.key === "Enter") {
          event.preventDefault(); event.stopImmediatePropagation(); send();
        }
      }, true);
      document.querySelector('[data-testid="send-button"]').onclick = send;
    ` } });
  return `<!doctype html><style>.ProseMirror { min-height: 40px; white-space: pre-wrap; }</style>
    <form><div id="editor-root"></div><button data-testid="send-button" type="button">Send</button></form>
    <script>${result.outputFiles[0].text.replace(/<\/script/gi, "<\\/script")}</script>`;
}
