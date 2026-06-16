import { MinimaxAPI, DEFAULT_MODEL } from './utils/minimax-api.js';

const API_KEY_STORAGE = 'minimax_api_key';
const MODEL_STORAGE = 'minimax_model';
const PERMISSIONS_STORAGE = 'site_permissions';   // { host: 'allow' | 'block' }
const WORKFLOWS_STORAGE = 'workflows';            // { name: { goal, actions: [...] } }
const CONTENT_SCRIPT_TIMEOUT = 10000;

// Hosts matching these substrings are treated as sensitive and require explicit opt-in
// before the agent will run (auto-block, à la Claude-for-Chrome's risky-site blocking).
const RISKY_HOST_PATTERNS = ['bank', 'paypal', 'stripe', 'coinbase', 'binance', 'wise.com', 'revolut', 'porn', 'xxx', 'casino', 'bet365'];

// If an action's target text/url matches these, ask the user to confirm before executing
// (purchases, publishing, destructive or outbound actions).
const RISKY_ACTION_PATTERNS = ['buy', 'purchase', 'checkout', 'pay ', 'payment', 'order now', 'place order', 'subscribe', 'delete', 'remove', 'send', 'publish', 'post ', 'transfer', 'confirm payment'];

class AgentController {
  constructor() {
    this.api = null;
    this.model = DEFAULT_MODEL;
    this.currentTabId = null;
    this.currentTab = null;
    this.isRunning = false;
    this.stepHistory = [];
    this.maxSteps = 20;
    this.goal = '';
    this.abortController = null;
    this.pending = null;          // { kind: 'ask' | 'confirm', question, action }
    this.pendingResolve = null;
  }

  init() {
    // Register listeners synchronously at startup. In MV3 the service worker is killed
    // when idle and restarted on an incoming message — if registration sat behind an
    // await, the waking message could be dropped. Config is loaded lazily instead.
    chrome.runtime.onMessage.addListener(this.handleMessage.bind(this));
    chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
    this.ensureApi();
    console.log('[MiniMax Agent] Background service worker initialized');
  }

  async ensureApi() {
    if (this.api) return this.api;
    const { [API_KEY_STORAGE]: key, [MODEL_STORAGE]: model } = await chrome.storage.local.get([API_KEY_STORAGE, MODEL_STORAGE]);
    if (model) this.model = model;
    if (key) this.api = new MinimaxAPI(key, this.model);
    return this.api;
  }

  handleMessage(message, sender, sendResponse) {
    console.log('[MiniMax Agent] Received message:', message.type);
    switch (message.type) {
      case 'SET_API_KEY':
        this.setApiKey(message.key).then(() => sendResponse({ success: true }));
        return true;
      case 'SET_MODEL':
        this.setModel(message.model).then(() => sendResponse({ success: true }));
        return true;
      case 'START_AGENT':
        this.startAgent(message.tabId, message.goal)
          .then(() => sendResponse({ success: true }))
          .catch(err => {
            console.error('[MiniMax Agent] Start failed:', err.message);
            this.stepHistory.push({ error: err.message, timestamp: Date.now() });
            this.broadcastState();
            sendResponse({ success: false, error: err.message });
          });
        return true;
      case 'STOP_AGENT':
        this.stopAgent();
        sendResponse({ success: true });
        return true;
      case 'RESUME_AGENT':       // answer to an ASK_USER pause
        this.resolvePending({ answer: message.answer });
        sendResponse({ success: true });
        return true;
      case 'CONFIRM_ACTION':     // approve/deny a risky-action gate
        this.resolvePending({ approved: !!message.approved });
        sendResponse({ success: true });
        return true;
      case 'GET_STATE':
        sendResponse(this.getState());
        return true;
      case 'GET_PERMISSIONS':
        chrome.storage.local.get(PERMISSIONS_STORAGE).then(r => sendResponse({ permissions: r[PERMISSIONS_STORAGE] || {} }));
        return true;
      case 'SET_PERMISSION':
        this.setPermission(message.host, message.value).then(p => sendResponse({ permissions: p }));
        return true;
      case 'WORKFLOW_LIST':
        this.listWorkflows().then(w => sendResponse({ workflows: w }));
        return true;
      case 'WORKFLOW_SAVE':
        this.saveWorkflow(message.name).then(w => sendResponse({ success: true, workflows: w })).catch(e => sendResponse({ success: false, error: e.message }));
        return true;
      case 'WORKFLOW_DELETE':
        this.deleteWorkflow(message.name).then(w => sendResponse({ workflows: w }));
        return true;
      case 'WORKFLOW_RUN':
        this.runWorkflow(message.name, message.tabId)
          .then(() => sendResponse({ success: true }))
          .catch(err => { this.stepHistory.push({ error: err.message, timestamp: Date.now() }); this.broadcastState(); sendResponse({ success: false, error: err.message }); });
        return true;
    }
    return false;
  }

  async setApiKey(key) {
    this.api = new MinimaxAPI(key, this.model);
    await chrome.storage.local.set({ [API_KEY_STORAGE]: key });
  }

  async setModel(model) {
    this.model = model || DEFAULT_MODEL;
    if (this.api) this.api.model = this.model;
    await chrome.storage.local.set({ [MODEL_STORAGE]: this.model });
    this.broadcastState();
  }

  // ---- Pause / resume (human-in-the-loop) ----

  // Pause the loop and wait for a side-panel response. Rejects if the run is aborted.
  requestUserInput(pending) {
    this.pending = pending;
    this.broadcastState();
    return new Promise((resolve, reject) => {
      this.pendingResolve = (val) => {
        this.pending = null;
        this.pendingResolve = null;
        this.broadcastState();
        resolve(val);
      };
      if (this.abortController) {
        this.abortController.signal.addEventListener('abort', () => {
          this.pending = null;
          this.pendingResolve = null;
          reject(new DOMException('Aborted', 'AbortError'));
        }, { once: true });
      }
    });
  }

  resolvePending(value) {
    if (this.pendingResolve) this.pendingResolve(value);
  }

  // ---- Permissions ----

  async getPermissions() {
    const r = await chrome.storage.local.get(PERMISSIONS_STORAGE);
    return r[PERMISSIONS_STORAGE] || {};
  }

  async setPermission(host, value) {
    const perms = await this.getPermissions();
    if (value === null || value === undefined || value === 'reset') delete perms[host];
    else perms[host] = value;
    await chrome.storage.local.set({ [PERMISSIONS_STORAGE]: perms });
    return perms;
  }

  isRiskyHost(host) {
    return RISKY_HOST_PATTERNS.some(p => host.includes(p));
  }

  hostOf(url) {
    try { return new URL(url).hostname; } catch { return ''; }
  }

  // Returns true if the agent may operate on `host`. May pause to ask the user.
  async ensurePermission(host) {
    if (!host) return true;
    const perms = await this.getPermissions();
    if (perms[host] === 'block') {
      this.stepHistory.push({ error: `Blocked: "${host}" is on your block list. Allow it in side-panel settings to run here.`, timestamp: Date.now() });
      this.broadcastState();
      return false;
    }
    if (perms[host] === 'allow') return true;
    if (this.isRiskyHost(host)) {
      const { approved } = await this.requestUserInput({
        kind: 'confirm',
        question: `"${host}" looks like a sensitive site (banking/payments/adult). Allow the agent to run here?`,
        action: { type: 'SITE_PERMISSION', params: { host } }
      });
      await this.setPermission(host, approved ? 'allow' : 'block');
      if (!approved) {
        this.stepHistory.push({ note: `User blocked ${host}`, result: 'blocked', timestamp: Date.now() });
        this.broadcastState();
      }
      return approved;
    }
    return true;
  }

  // ---- Risk classification ----

  classifyRisk(action, elementMap) {
    const parts = [];
    if (action.params?.text) parts.push(action.params.text);
    if (action.params?.url) parts.push(action.params.url);
    const el = action.params?.elementId != null ? elementMap?.[action.params.elementId] : null;
    if (el) parts.push(el.text || '', el.href || '');
    const hay = parts.join(' ').toLowerCase();
    const match = RISKY_ACTION_PATTERNS.find(p => hay.includes(p));
    return match ? `Action looks risky (matched "${match.trim()}")` : null;
  }

  // ---- Agent lifecycle ----

  async startAgent(tabId, goal) {
    await this.ensureApi();
    if (!this.api) throw new Error('API Key not set. Please configure in side panel.');
    if (this.isRunning) throw new Error('Agent already running');
    if (!tabId) throw new Error('No tab ID provided');

    const tab = await chrome.tabs.get(tabId);
    if (!this.isRunnableUrl(tab.url)) {
      throw new Error(`Cannot run on "${tab.url || 'empty URL'}". Open a regular website (http/https) and try again.`);
    }

    await this.ensureContentScript(tabId);

    this.currentTabId = tabId;
    this.currentTab = tab;
    this.isRunning = true;
    this.stepHistory = [];
    this.goal = goal;
    this.abortController = new AbortController();

    this.broadcastState();
    // Run detached so the START_AGENT response returns promptly and pauses don't block it.
    this.runLoop().catch(err => {
      if (err?.name !== 'AbortError') console.error('[MiniMax Agent] Loop crashed:', err);
    });
  }

  isRunnableUrl(url) {
    return !!url && !url.startsWith('chrome://') && !url.startsWith('edge://') && !url.startsWith('about:') && !url.startsWith('chrome-extension://') && !url.startsWith('chrome-extension:');
  }

  async ensureContentScript(tabId) {
    try {
      const response = await this.sendToContentScriptWithTabId(tabId, { type: 'PING' });
      if (response?.pong) return;
    } catch (e) {
      console.log('[MiniMax Agent] Content script not responsive, injecting:', e.message);
    }

    try {
      await chrome.scripting.executeScript({ target: { tabId }, files: ['content-bundled.js'] });
      await new Promise(r => setTimeout(r, 800));
      const response = await this.sendToContentScriptWithTabId(tabId, { type: 'PING' });
      if (response?.pong) return;
    } catch (e) {
      console.warn('[MiniMax Agent] Bundled injection failed:', e.message);
    }

    try {
      await chrome.scripting.executeScript({ target: { tabId }, files: ['content.js'] });
      await new Promise(r => setTimeout(r, 800));
      const response = await this.sendToContentScriptWithTabId(tabId, { type: 'PING' });
      if (response?.pong) return;
    } catch (e) {
      console.warn('[MiniMax Agent] Original injection failed:', e.message);
    }

    throw new Error('Content script injection failed. The page may block extension scripts (CSP). Try: 1) Refresh page, 2) Try a different site, 3) Check the page DevTools console for CSP errors.');
  }

  sendToContentScriptWithTabId(tabId, message) {
    return Promise.race([
      new Promise((resolve, reject) => {
        chrome.tabs.sendMessage(tabId, message, (response) => {
          if (chrome.runtime.lastError) {
            const msg = chrome.runtime.lastError.message;
            if (msg.includes('Receiving end does not exist') || msg.includes('Could not establish connection')) {
              reject(new Error('Content script not loaded. Refresh the page or open a regular website.'));
            } else reject(new Error(msg));
          } else resolve(response);
        });
      }),
      new Promise((_, reject) => setTimeout(() => reject(new Error('Content script timeout (10s)')), CONTENT_SCRIPT_TIMEOUT))
    ]);
  }

  stopAgent() {
    this.isRunning = false;
    if (this.abortController) this.abortController.abort();
    this.currentTabId = null;
    this.currentTab = null;
    this.abortController = null;
    this.broadcastState();
  }

  async runLoop() {
    const startHost = this.hostOf(this.currentTab?.url);
    if (!(await this.ensurePermission(startHost))) {
      this.isRunning = false;
      this.broadcastState();
      return;
    }

    while (this.isRunning && this.stepHistory.length < this.maxSteps) {
      if (this.aborted()) break;

      try {
        // Keep the working tab active so captureVisibleTab grabs the right page.
        await chrome.tabs.update(this.currentTabId, { active: true });

        // A click in the previous step may have navigated the page, which destroys the old
        // content script. Wait for any in-flight load and re-inject before interacting.
        try {
          const t = await chrome.tabs.get(this.currentTabId);
          this.currentTab = t;
          if (t.status && t.status !== 'complete') await this.waitForTabLoad(this.currentTabId);
        } catch {}
        await this.ensureContentScript(this.currentTabId);
        if (this.aborted()) break;

        const screenshot = await this.captureTab();
        if (this.aborted()) break;

        const { annotatedImage, elementMap, thumb } = await this.annotateDom(screenshot);
        if (this.aborted()) break;

        const context = await this.buildContext();
        const action = await this.api.getNextAction(annotatedImage, this.goal, this.stepHistory, elementMap, context);
        if (this.aborted()) break;

        if (action.type === 'DONE') {
          this.stepHistory.push({ action, result: action.answer || action.reasoning || 'Goal achieved', thumb, timestamp: Date.now() });
          this.broadcastState();
          break;
        }

        if (action.type === 'ASK_USER') {
          const { answer } = await this.requestUserInput({ kind: 'ask', question: action.params?.question || 'The agent needs your input.', action });
          this.stepHistory.push({ action, result: { userAnswer: answer }, thumb, timestamp: Date.now() });
          this.broadcastState();
          continue;
        }

        // Risky-action confirmation gate.
        const risk = this.classifyRisk(action, elementMap);
        if (risk) {
          const { approved } = await this.requestUserInput({ kind: 'confirm', question: `${risk}. Proceed with ${action.type}?`, action });
          if (!approved) {
            this.stepHistory.push({ action, result: 'Skipped by user (risky action declined)', thumb, timestamp: Date.now() });
            this.broadcastState();
            continue;
          }
        }

        const result = await this.dispatchAction(action);
        this.stepHistory.push({ action, result, thumb, timestamp: Date.now() });
        this.broadcastState();

        await this.sleep(1500, this.abortController?.signal);
      } catch (error) {
        if (this.aborted() || error?.name === 'AbortError') break;
        console.error('[MiniMax Agent] Loop error:', error);
        this.stepHistory.push({ error: error.message, timestamp: Date.now() });
        await this.sleep(2000, this.abortController?.signal).catch(() => {});
      }
    }

    this.isRunning = false;
    this.broadcastState();
  }

  aborted() {
    return !this.isRunning || !!this.abortController?.signal.aborted;
  }

  // Route an action: tab/navigation actions run in the background, page actions in the content script.
  async dispatchAction(action) {
    switch (action.type) {
      case 'NAVIGATE':
        return this.navigate(action.params?.url);
      case 'OPEN_TAB':
        return this.openTab(action.params?.url);
      case 'SWITCH_TAB':
        return this.switchTab(action.params?.index);
      default:
        return this.executeAction(action);
    }
  }

  async navigate(url) {
    if (!url) throw new Error('NAVIGATE requires a url');
    const full = /^https?:\/\//i.test(url) ? url : `https://${url}`;
    const host = this.hostOf(full);
    if (!(await this.ensurePermission(host))) throw new Error(`Navigation to ${host} not permitted`);
    await chrome.tabs.update(this.currentTabId, { url: full });
    await this.waitForTabLoad(this.currentTabId);
    this.currentTab = await chrome.tabs.get(this.currentTabId);
    await this.ensureContentScript(this.currentTabId);
    return { navigated: true, url: full };
  }

  async openTab(url) {
    if (!url) throw new Error('OPEN_TAB requires a url');
    const full = /^https?:\/\//i.test(url) ? url : `https://${url}`;
    const host = this.hostOf(full);
    if (!(await this.ensurePermission(host))) throw new Error(`Opening ${host} not permitted`);
    const tab = await chrome.tabs.create({ url: full, active: true });
    this.currentTabId = tab.id;
    await this.waitForTabLoad(tab.id);
    this.currentTab = await chrome.tabs.get(tab.id);
    await this.ensureContentScript(tab.id);
    return { openedTab: true, url: full, tabId: tab.id };
  }

  async switchTab(index) {
    const tabs = await chrome.tabs.query({ currentWindow: true });
    const tab = tabs[index];
    if (!tab) throw new Error(`No tab at index ${index}`);
    if (!this.isRunnableUrl(tab.url)) throw new Error(`Tab ${index} is not a runnable page (${tab.url})`);
    const host = this.hostOf(tab.url);
    if (!(await this.ensurePermission(host))) throw new Error(`Tab ${index} (${host}) not permitted`);
    this.currentTabId = tab.id;
    await chrome.tabs.update(tab.id, { active: true });
    this.currentTab = await chrome.tabs.get(tab.id);
    await this.ensureContentScript(tab.id);
    return { switchedTab: index, url: tab.url };
  }

  waitForTabLoad(tabId, timeout = 15000) {
    return new Promise((resolve) => {
      let elapsed = 0;
      const step = 300;
      const poll = async () => {
        if (this.aborted()) return resolve();
        try {
          const t = await chrome.tabs.get(tabId);
          if (t.status === 'complete') return resolve();
        } catch { return resolve(); }
        elapsed += step;
        if (elapsed >= timeout) return resolve();
        setTimeout(poll, step);
      };
      setTimeout(poll, step);
    });
  }

  async buildContext() {
    let tabs = [];
    try {
      const all = await chrome.tabs.query({ currentWindow: true });
      tabs = all.map((t, i) => ({ index: i, active: t.id === this.currentTabId, title: (t.title || '').slice(0, 60), url: t.url || '' }));
    } catch {}
    return { url: this.currentTab?.url || '', tabs };
  }

  async captureTab() {
    // Re-claim our working tab right before capturing, so a mid-run user tab-switch or click
    // elsewhere doesn't make us screenshot the wrong page and derail the agent.
    try { await chrome.tabs.update(this.currentTabId, { active: true }); } catch {}
    const dataUrl = await chrome.tabs.captureVisibleTab(this.currentTab?.windowId, { format: 'png' });
    return dataUrl.split(',')[1];
  }

  sendToContentScript(message) {
    if (!this.currentTabId) throw new Error('No tab ID');
    return this.sendToContentScriptWithTabId(this.currentTabId, message);
  }

  annotateDom(base64Image) {
    return this.sendToContentScript({ type: 'ANNOTATE_DOM', image: base64Image });
  }

  executeAction(action) {
    return this.sendToContentScript({ type: 'EXECUTE_ACTION', action });
  }

  // ---- Workflows (record executed actions, replay without the model) ----

  async listWorkflows() {
    const r = await chrome.storage.local.get(WORKFLOWS_STORAGE);
    return Object.keys(r[WORKFLOWS_STORAGE] || {});
  }

  async saveWorkflow(name) {
    if (!name) throw new Error('Workflow name required');
    const actions = this.stepHistory.filter(h => h.action && h.action.type !== 'DONE' && h.action.type !== 'ASK_USER').map(h => h.action);
    if (!actions.length) throw new Error('No actions in the current run to save');
    const r = await chrome.storage.local.get(WORKFLOWS_STORAGE);
    const workflows = r[WORKFLOWS_STORAGE] || {};
    workflows[name] = { goal: this.goal, actions };
    await chrome.storage.local.set({ [WORKFLOWS_STORAGE]: workflows });
    return Object.keys(workflows);
  }

  async deleteWorkflow(name) {
    const r = await chrome.storage.local.get(WORKFLOWS_STORAGE);
    const workflows = r[WORKFLOWS_STORAGE] || {};
    delete workflows[name];
    await chrome.storage.local.set({ [WORKFLOWS_STORAGE]: workflows });
    return Object.keys(workflows);
  }

  async runWorkflow(name, tabId) {
    if (this.isRunning) throw new Error('Agent already running');
    const r = await chrome.storage.local.get(WORKFLOWS_STORAGE);
    const wf = (r[WORKFLOWS_STORAGE] || {})[name];
    if (!wf) throw new Error(`Workflow "${name}" not found`);

    const tab = await chrome.tabs.get(tabId);
    if (!this.isRunnableUrl(tab.url)) throw new Error(`Cannot replay on "${tab.url}". Open a regular website.`);
    await this.ensureContentScript(tabId);

    this.currentTabId = tabId;
    this.currentTab = tab;
    this.isRunning = true;
    this.stepHistory = [];
    this.goal = `▶ Replay: ${name}`;
    this.abortController = new AbortController();
    this.broadcastState();

    (async () => {
      for (const action of wf.actions) {
        if (this.aborted()) break;
        try {
          const result = await this.dispatchAction(action);
          this.stepHistory.push({ action, result, timestamp: Date.now() });
        } catch (error) {
          this.stepHistory.push({ action, error: error.message, timestamp: Date.now() });
        }
        this.broadcastState();
        await this.sleep(1200, this.abortController?.signal).catch(() => {});
      }
      this.stepHistory.push({ result: `Replay of "${name}" finished`, timestamp: Date.now() });
      this.isRunning = false;
      this.broadcastState();
    })();
  }

  broadcastState() {
    chrome.runtime.sendMessage({ type: 'STATE_UPDATE', state: this.getState() }).catch(() => {});
  }

  getState() {
    return {
      isRunning: this.isRunning,
      history: this.stepHistory,
      goal: this.goal,
      hasApiKey: !!this.api,
      model: this.model,
      pending: this.pending
    };
  }

  sleep(ms, signal) {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(resolve, ms);
      if (signal) {
        signal.addEventListener('abort', () => {
          clearTimeout(timeout);
          reject(new DOMException('Aborted', 'AbortError'));
        }, { once: true });
      }
    });
  }
}

const controller = new AgentController();
controller.init();
