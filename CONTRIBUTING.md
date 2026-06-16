# Contributing

Thanks for your interest! This project is in the public domain — contributions are
welcome and, by submitting them, you agree to release your work into the public domain
under [The Unlicense](LICENSE).

## Development setup

There is **no build system** — no `package.json`, no bundler, no tests. The extension is
plain ES modules loaded directly by Chrome.

1. `chrome://extensions` → enable **Developer mode** → **Load unpacked** → select this folder.
2. After **any** change, click the reload icon on the extension card. The background
   service worker does not hot-reload.
3. Logs are split across contexts and all prefixed `[MiniMax Agent]`:
   - service worker → the "service worker" link in `chrome://extensions`
   - content script → the **page's** DevTools console
   - side panel → the side panel's own DevTools

## Things to know before you change code

- **`content-bundled.js` is a hand-maintained inlined copy** of `content.js` +
  `utils/dom-annotator.js` + `utils/action-executor.js`. There is no generator — any change
  to those source files must be mirrored into the bundle by hand, or the injected script
  silently drifts.
- **Element-index invariant:** the model addresses elements by their 1-based position in
  the filtered list. `DOMAnnotator.findInteractiveElements()` and
  `ActionExecutor.findInteractiveElements()` must use the identical selector, filters and
  50-element cap, or the agent acts on the wrong element.
- The model's reply is parsed as bare JSON — don't change the prompt in ways that make it
  wrap output in markdown.

See [CLAUDE.md](CLAUDE.md) for the full architecture reference.

## Pull requests

- Keep changes focused and describe what you tested manually (which site, which goal).
- Match the surrounding code style.
- Update `CLAUDE.md` / `IMPLEMENTATION_PLAN.md` if you change architecture or the action set.
