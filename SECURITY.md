# Security Policy

This extension drives a **real, authenticated browser session** with an AI agent. That
makes it powerful and inherently risky. Please read this before using or extending it.

## Threat model

- **The model sees everything you see.** Screenshots of the active tab — including any
  visible personal data, messages, or account details — are sent to the MiniMax API.
- **Prompt injection.** A malicious page can embed hidden text instructing the agent to
  take harmful actions (exfiltrate data, click destructive buttons, make purchases). The
  agent currently has **no prompt-injection defenses** and **no human-in-the-loop
  confirmation** for sensitive actions. Treat every run as fully trusting the page.
- **Broad permissions.** The extension requests `<all_urls>`, `scripting`, `tabs`, and
  `activeTab` — it can read and manipulate any page you point it at.

## Recommended precautions

- Only run the agent on sites you trust, with goals you can supervise in real time.
- Do not run it on banking, payment, or other high-stakes sites.
- Watch the live execution log and use **Stop Agent** the moment it does something
  unexpected.
- Keep your MiniMax API key private; it is stored in `chrome.storage.local`.

## Reporting a vulnerability

If you discover a security issue, please open a GitHub issue **without** including
sensitive details, or contact the maintainer privately to arrange disclosure. Since this
is an experimental public-domain project, there is no formal SLA, but reports are
appreciated and will be addressed on a best-effort basis.

## Hardening roadmap

Planned safeguards (see [IMPLEMENTATION_PLAN.md](IMPLEMENTATION_PLAN.md)) include
per-site permissions, automatic blocking of high-risk sites, human-in-the-loop
confirmation for purchases/publishing/credential entry, and prompt-injection mitigations.
