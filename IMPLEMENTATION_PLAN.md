# MiniMax M3 Browser Agent - Implementation Plan

## Overview
Chrome Extension (Manifest V3) that uses MiniMax M3 Vision API to automate browser tasks while preserving the user's existing browser session (cookies, logins, sessions).

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                     Chrome Extension                         │
├─────────────────────────────────────────────────────────────┤
│  Background Service Worker (background.js)                  │
│  ├── MiniMaxAPI wrapper                                     │
│  ├── Agent loop controller                                  │
│  ├── State management                                       │
│  └── chrome.runtime messaging                               │
├─────────────────────────────────────────────────────────────┤
│  Content Script (content.js) - injected in every tab        │
│  ├── DOMAnnotator - finds & annotates interactive elements  │
│  ├── ActionExecutor - performs clicks, typing, scrolling    │
│  └── Message handler                                        │
├─────────────────────────────────────────────────────────────┤
│  Side Panel (sidepanel.html + sidepanel.js)                 │
│  ├── API Key input & storage                                │
│  ├── Goal input                                             │
│  ├── Start/Stop controls                                    │
│  └── Live execution log                                     │
└─────────────────────────────────────────────────────────────┘
```

## File Structure
```
minimax-browser-agent/
├── manifest.json
├── background.js
├── content.js
├── sidepanel.html
├── sidepanel.js
├── utils/
│   ├── minimax-api.js
│   ├── dom-annotator.js
│   └── action-executor.js
└── icons/
    ├── icon16.png
    ├── icon48.png
    └── icon128.png
```

## Core Workflow (Agent Loop)

1. **Capture** - `chrome.tabs.captureVisibleTab()` → base64 PNG
2. **Annotate** - Content script finds interactive elements, draws numbered badges on screenshot
3. **Send to M3** - Image + goal + history + element map → MiniMax M3 API
4. **Parse Action** - M3 returns structured JSON: `{type, params, reasoning}`
5. **Execute** - Content script performs action via DOM events
6. **Wait** - 1.5s for DOM updates
7. **Repeat** until DONE or maxSteps (20)

## Key Technical Decisions

### Element Identification
- **Not pixel coordinates** - Too fragile across resolutions
- **Element IDs** - Annotator assigns 1-50 to visible interactive elements
- **M3 sees annotated screenshot** - Red numbered circles on clickable elements
- **M3 responds with element ID** - Precise, resolution-independent

### Session Preservation
- Extension runs in user's **actual browser profile**
- Content script executes in **page context** - full access to cookies, localStorage, sessions
- No separate browser instance needed

### Security
- API Key stored in `chrome.storage.local` (encrypted at rest)
- Extension **not published to Web Store** - load as unpacked developer extension
- M3 sees everything user sees - treat as sensitive

## MiniMax API Integration

**Endpoint**: `https://api.minimax.io/v1/text/chatcompletion_v2`
**Model**: `MiniMax-M3` (or exact model name from dashboard)
**Auth**: `Bearer <api_key>`
**Format**: OpenAI-compatible chat completion with `response_format: {type: "json_object"}`

## Action Types

| Type | Params | Description |
|------|--------|-------------|
| CLICK | `{elementId}` | Click button, link, or any clickable |
| TYPE | `{elementId, text}` | Fill input/textarea/contenteditable |
| SCROLL | `{direction: "up"|"down", amount}` | Scroll page |
| WAIT | `{ms}` | Pause for loading |
| DONE | `{}` | Goal achieved |

## Installation

```bash
# 1. Clone/create project folder
# 2. Add your MiniMax API key in side panel
# 3. Chrome → Extensions → Developer mode → Load unpacked → select folder
# 4. Open side panel (toolbar icon or Ctrl+Shift+Y)
# 5. Enter goal → Start Agent
```

## Configuration

| Setting | Default | Description |
|---------|---------|-------------|
| `maxSteps` | 20 | Safety limit per run |
| `stepDelay` | 1500ms | Wait between steps |
| `maxElements` | 50 | Elements annotated per step |
| `temperature` | 0.1 | M3 determinism |

## Future Enhancements

- [ ] Structured Outputs enforcement (when M3 supports)
- [ ] Multi-tab task support
- [ ] Human-in-the-loop confirmation for sensitive actions
- [ ] Flow recording/replay
- [ ] Step summarization for long contexts
- [ ] Custom element filters per site

## Troubleshooting

| Issue | Solution |
|-------|----------|
| "API Key not set" | Enter key in side panel, click Save |
| "Element not found" | Page changed, agent will retry next loop |
| M3 returns invalid JSON | Check model name, API key validity |
| Extension not loading | Check Manifest V3, reload unpacked |
| Side panel empty | Refresh extension, reopen panel |

## Cost Estimation

- M3 Vision: ~$0.50-2.00 per 1M tokens (check current pricing)
- Typical task: 5-15 steps × ~2K tokens = ~$0.01-0.05 per task
- Very cost-effective vs GPT-4o/Claude