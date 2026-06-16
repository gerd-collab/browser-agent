# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A Manifest V3 Chrome extension ("MiniMax M3 Browser Agent") that automates the user's
**real, logged-in browser session** via a vision-driven agent loop. It captures the
visible tab, has the page annotate interactive elements with numbered red badges, sends
the screenshot + element map to the MiniMax M3 vision model, and executes the action the
model returns. There is **no build system** — no `package.json`, no bundler, no tests.
Plain ES modules loaded directly by Chrome.

`IMPLEMENTATION_PLAN.md` is the design-of-record and explains the rationale (action types,
token economics, security model). Read it before changing the agent loop or API contract.

## Running / debugging

There are no build/lint/test commands. To run:

1. `chrome://extensions` → enable Developer mode → **Load unpacked** → select this folder.
2. After **any** code change, click the reload icon on the extension card. The service
   worker (`background.js`) does not hot-reload.
3. Open the side panel (toolbar icon). Enter the MiniMax **Token Plan** key (`sk-cp-...`),
   save, enter a goal, Start.
4. Debug surfaces are separate: service-worker logs are under the extension's "service
   worker" link in `chrome://extensions`; content-script logs are in the **page's** DevTools
   console; side-panel logs are in the side panel's own DevTools. All logs are prefixed
   `[MiniMax Agent]`.

## Architecture (the agent loop)

Three isolated execution contexts communicate only via `chrome.runtime` / `chrome.tabs`
messaging — there are no shared imports across them.

- **`background.js`** — service worker, the orchestrator. `AgentController.runLoop()` is the
  heart: capture tab (`chrome.tabs.captureVisibleTab` → base64 PNG) → ask content script to
  annotate → call `MinimaxAPI.getNextAction()` → execute the returned action in the content
  script → `sleep(1500)` → repeat. Stops on `DONE`, `maxSteps` (20), abort, or error. State
  (`isRunning`, `stepHistory`, `goal`) lives here and is pushed to the side panel via
  `broadcastState()` (`STATE_UPDATE` messages). Stop uses an `AbortController` checked
  between every loop stage.

- **`utils/minimax-api.js`** — `MinimaxAPI`. **Anthropic-compatible** Messages API, not the
  standard MiniMax endpoint. Endpoint `https://api.minimax.io/anthropic/v1/messages`, auth
  via `x-api-key` + `anthropic-version: 2023-06-01` headers, model `MiniMax-M3`. The entire
  task framing (goal, element map, history, JSON response schema) is assembled in
  `buildSystemPrompt()`. The model's reply is expected to be a **bare JSON object** parsed
  with `JSON.parse` — there is no markdown/codefence stripping, so prompt changes that make
  the model wrap its output will break parsing.

- **`content.js` + `utils/dom-annotator.js` + `utils/action-executor.js`** — the content
  script, runs in the page. `DOMAnnotator.findInteractiveElements()` selects visible,
  in-viewport interactive elements (capped at 50) and `annotateScreenshot()` draws numbered
  badges onto the screenshot via canvas. `ActionExecutor` performs CLICK/TYPE/SCROLL/WAIT by
  dispatching synthetic DOM events.

- **`sidepanel.html` + `sidepanel.js`** — UI only. Sends `SET_API_KEY` / `START_AGENT` /
  `STOP_AGENT` / `GET_STATE`, renders `STATE_UPDATE` history. No agent logic here.

### Element identification contract (critical invariant)

Elements are addressed by **1-based index**, never pixel coordinates. The number the model
sees on a badge is the element's position in the filtered list. This only works because the
annotator and the executor reproduce the **same ordering**: same selector, same
visible+in-viewport filter, same order. `DOMAnnotator.findInteractiveElements()` and
`ActionExecutor.findInteractiveElements()` are intentionally kept in lockstep — if you change
the selector or filters in one, change the other identically or the model will click the
wrong thing. (Note: the annotator slices to 50 and includes `[role="menuitem"]`/`[role="tab"]`;
the executor currently does neither — divergences like this are latent bugs.)

## The content-bundled.js convention (read before editing content scripts)

`content-bundled.js` is a **hand-maintained, inlined copy** of `content.js` +
`dom-annotator.js` + `action-executor.js` flattened into one non-module file. It exists
because `chrome.scripting.executeScript({files})` injection of ES modules is unreliable, so
`ensureContentScript()` in `background.js` injects this bundle first (then falls back to the
manifest-declared `content.js`). There is no tool that regenerates it — **any change to the
`utils/` modules or `content.js` must be mirrored by hand into `content-bundled.js`**, and
the two will silently drift otherwise.

⚠️ `content-bundled.js` is currently broken and out of sync: line ~77 reads
`handleAnnotate(msg.image(msg.image)` (malformed), and it defines `handleAnnot`/`handleExec`
while the message handler calls `handleAnnotate`/`handleExec`. The injected bundle therefore
throws on `ANNOTATE_DOM`. When touching content scripts, fix the bundle to match `content.js`.

## Conventions & constraints

- **Session preservation is the whole point.** The extension acts inside the user's actual
  profile; the model sees and can act on everything the user can (logged-in Google, GitHub,
  banking, etc.). `IMPLEMENTATION_PLAN.md` flags this as a sensitive-by-design system; there
  is no human-in-the-loop confirmation yet.
- **API key** is stored in `chrome.storage.local` under `minimax_api_key`. Used as the
  storage key in both `background.js` and `sidepanel.js` — keep them in sync.
- **`chrome://`, `about:`, `chrome-extension://`, `edge://` tabs are rejected** in
  `startAgent()` — capture/injection don't work there. Test against real http(s) sites.
- Tuning constants are inline, not configurable at runtime: `maxSteps` (20) and step delay
  (1500ms) in `background.js`; `max_tokens` (1500) and `temperature` (0.1) in
  `minimax-api.js`; element cap (50) in the annotator.
- Action set is fixed: `CLICK {elementId}`, `TYPE {elementId, text}`,
  `SCROLL {direction, amount}`, `WAIT {ms}`, `DONE {}`. Adding an action means updating the
  response schema in `buildSystemPrompt()` **and** the `switch` in `ActionExecutor.execute()`
  **and** the bundle.
