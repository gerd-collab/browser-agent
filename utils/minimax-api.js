export class MinimaxAPI {
  constructor(apiKey) {
    this.apiKey = apiKey;
    this.baseUrl = 'https://api.minimax.io/v1/text/chatcompletion_v2';
    this.model = 'MiniMax-M3';
  }

  async getNextAction(base64Image, goal, history, elementMap) {
    const systemPrompt = this.buildSystemPrompt(goal, history, elementMap);

    const payload = {
      model: this.model,
      messages: [{
        role: 'user',
        content: [
          { type: 'text', text: systemPrompt },
          { type: 'image_url', image_url: { url: `data:image/png;base64,${base64Image}` }}
        ]
      }],
      temperature: 0.1,
      max_tokens: 1500,
      response_format: { type: 'json_object' }
    };

    const response = await fetch(this.baseUrl, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload)
    });

    if (!response.ok) {
      const err = await response.text();
      throw new Error(`MiniMax API error: ${response.status} - ${err}`);
    }

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content;

    if (!content) throw new Error('Empty response from MiniMax M3');

    return JSON.parse(content);
  }

  buildSystemPrompt(goal, history, elementMap) {
    const historyStr = history.length > 0
      ? history.map((h, i) => `${i + 1}. ${h.action?.type || 'error'}: ${JSON.stringify(h.action?.params || h.error || h.result)}`).join('\n')
      : '(none)';

    const elementMapStr = Object.entries(elementMap)
      .map(([id, el]) => `#${id}: <${el.tag}${el.type ? ` type="${el.type}"` : ''}> ${el.text || el.placeholder || el.href || ''}`)
      .join('\n');

    return `You are a browser automation agent controlling a real user's browser session.
The user is already logged into all their accounts (Google, GitHub, banking, etc.).

GOAL: ${goal}

INTERACTIVE ELEMENTS (use these IDs in your actions):
${elementMapStr}

EXECUTION HISTORY:
${historyStr}

RULES:
- Respond ONLY with valid JSON matching the schema below
- Use element IDs from the list above for CLICK and TYPE actions
- Prefer clicking links/buttons over typing when possible
- For TYPE actions, the element must be an input, textarea, or contenteditable
- Use SCROLL to reveal more content
- Use WAIT for page loads or animations
- Use DONE when the goal is achieved
- Be concise in reasoning

RESPONSE SCHEMA:
{
  "type": "CLICK" | "TYPE" | "SCROLL" | "WAIT" | "DONE",
  "params": {
    "elementId": number,
    "text": string
  } | {
    "direction": "up" | "down",
    "amount": number
  } | {
    "ms": number
  } | {},
  "reasoning": "brief explanation"
}`;
  }
}