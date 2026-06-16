# MiniMax M3 Browser Agent

A Manifest V3 Chrome extension that automates your **real, logged-in browser session**
with a vision-driven agent. It captures the visible tab, annotates the interactive
elements with numbered badges, sends the screenshot to the [MiniMax M3](https://www.minimax.io/models/text/m3)
vision model, and executes the action the model returns — clicking, typing, scrolling —
looping until your goal is achieved.

Because it runs inside your actual Chrome profile, the agent reuses your existing logins
and cookies. No separate browser, no re-authentication.

> ⚠️ **Experimental & sensitive by design.** The model sees and can act on everything you
> can — including logged-in accounts. Read [SECURITY.md](SECURITY.md) before using it on
> any site that matters.

## Features

- **Natural-language goals** — describe what you want in plain language in the side panel.
- **Vision + numbered-element targeting** — elements are addressed by a stable 1-based
  index drawn onto the screenshot, not fragile pixel coordinates.
- **Session preservation** — acts inside your real, authenticated browser profile.
- **Live execution log** — every step (action, reasoning, final answer) streams into the
  side panel.
- **Stop control** — abort a run at any time.

Actions supported today: `CLICK`, `TYPE`, `SCROLL`, `WAIT`, `DONE`.

A feature-parity roadmap toward the capabilities of Anthropic's "Claude for Chrome"
(URL navigation, multi-tab, human-in-the-loop pauses, per-site permissions, workflow
recording, model selection) is tracked in [IMPLEMENTATION_PLAN.md](IMPLEMENTATION_PLAN.md).

## Install (unpacked)

This extension is **not** published to the Chrome Web Store — load it as an unpacked
developer extension:

1. Clone this repo.
2. Open `chrome://extensions`, enable **Developer mode** (top-right).
3. Click **Load unpacked** and select the repo folder.
4. Open the side panel via the toolbar icon.

## Usage

1. Get a MiniMax **Token Plan** key (`sk-cp-...`) from [api.minimax.io](https://api.minimax.io).
2. Paste it into the side panel and click **Save Key** (Start also auto-saves it).
3. Enter a goal, e.g. *"Search for a TypeScript tutorial on YouTube and play the first video."*
4. Click **Start Agent** and watch it work. Use **Stop Agent** to abort.

Only regular `http(s)` pages are supported — `chrome://`, `about:`, new-tab and extension
pages are rejected because they can't be captured or scripted.

## How it works

```
Side Panel ──goal──▶ Background Service Worker (agent loop)
                          │  1. captureVisibleTab() → PNG
                          ▼
                     Content Script ──annotate DOM──▶ numbered screenshot + element map
                          │  2. screenshot + goal + history
                          ▼
                     MiniMax M3 (Anthropic-compatible API) ──▶ { type, params, reasoning, answer }
                          │  3. execute action in the page
                          ▼
                     repeat until DONE / maxSteps / Stop
```

See [IMPLEMENTATION_PLAN.md](IMPLEMENTATION_PLAN.md) for the full design and
[CLAUDE.md](CLAUDE.md) for the architecture reference used by AI coding assistants.

## API note

The extension uses MiniMax's **Anthropic-compatible** Messages endpoint
(`https://api.minimax.io/anthropic/v1/messages`, model `MiniMax-M3`), which is what Token
Plan keys (`sk-cp-...`) authenticate against — not the standard pay-as-you-go endpoint.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). There is no build step — edit the files and reload
the unpacked extension.

## License

Released into the **public domain** under [The Unlicense](LICENSE). Do whatever you want
with it.
