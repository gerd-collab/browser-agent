import { MinimaxAPI } from './utils/minimax-api.js';

const API_KEY_STORAGE = 'minimax_api_key';
const CONTENT_SCRIPT_TIMEOUT = 10000;

class AgentController {
  constructor() {
    this.api = null;
    this.currentTabId = null;
    this.currentTab = null;
    this.isRunning = false;
    this.stepHistory = [];
    this.maxSteps = 20;
    this.goal = '';
    this.abortController = null;
  }

  async init() {
    const { [API_KEY_STORAGE]: key } = await chrome.storage.local.get(API_KEY_STORAGE);
    if (key) this.api = new MinimaxAPI(key);

    chrome.runtime.onMessage.addListener(this.handleMessage.bind(this));
    chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
    console.log('[MiniMax Agent] Background service worker initialized');
  }

  handleMessage(message, sender, sendResponse) {
    console.log('[MiniMax Agent] Received message:', message.type);
    switch (message.type) {
      case 'SET_API_KEY':
        this.setApiKey(message.key).then(() => sendResponse({ success: true }));
        return true;
      case 'START_AGENT':
        console.log('[MiniMax Agent] Starting agent for tab', message.tabId, 'goal:', message.goal);
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
      case 'GET_STATE':
        sendResponse({
          isRunning: this.isRunning,
          history: this.stepHistory,
          hasApiKey: !!this.api,
          goal: this.goal
        });
        return true;
    }
    return false;
  }

  async setApiKey(key) {
    this.api = new MinimaxAPI(key);
    await chrome.storage.local.set({ [API_KEY_STORAGE]: key });
  }

  async startAgent(tabId, goal) {
    if (!this.api) throw new Error('API Key not set. Please configure in side panel.');
    if (this.isRunning) throw new Error('Agent already running');
    if (!tabId) throw new Error('No tab ID provided');

    const tab = await chrome.tabs.get(tabId);
    if (!tab.url || tab.url.startsWith('chrome://') || tab.url.startsWith('edge://') || tab.url.startsWith('about:') || tab.url.startsWith('chrome-extension://')) {
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
    await this.runLoop();
  }

  async ensureContentScript(tabId) {
    // First check if content script is already responsive
    try {
      const response = await this.sendToContentScriptWithTabId(tabId, { type: 'PING' });
      if (response?.pong) {
        console.log('[MiniMax Agent] Content script already loaded');
        return;
      }
    } catch (e) {
      console.log('[MiniMax Agent] Content script not responsive, attempting injection:', e.message);
    }

    // Try to inject bundled content script (no ES module issues)
    try {
      console.log('[MiniMax Agent] Injecting bundled content script');
      await chrome.scripting.executeScript({ target: { tabId }, files: ['content-bundled.js'] });
      console.log('[MiniMax Agent] Bundled content script injected');

      await new Promise(r => setTimeout(r, 800));
      const response = await this.sendToContentScriptWithTabId(tabId, { type: 'PING' });
      if (response?.pong) {
        console.log('[MiniMax Agent] Content script verified and responding');
        return;
      }
      console.log('[MiniMax Agent] Bundled script injected but not responding');
    } catch (e) {
      console.warn('[MiniMax Agent] Bundled injection failed:', e.message);
    }

    // Fallback: try original content.js (works if manifest-declared script loads on refresh)
    try {
      console.log('[MiniMax Agent] Trying original content.js');
      await chrome.scripting.executeScript({ target: { tabId }, files: ['content.js'] });
      console.log('[MiniMax Agent] Original content.js injected');

      await new Promise(r => setTimeout(r, 800));
      const response = await this.sendToContentScriptWithTabId(tabId, { type: 'PING' });
      if (response?.pong) {
        console.log('[MiniMax Agent] Original content script verified');
        return;
      }
    } catch (e) {
      console.warn('[MiniMax Agent] Original injection failed:', e.message);
    }

    // Last resort: check if content script is declared in manifest and just needs page reload
    throw new Error('Content script injection failed. The page may block extension scripts (CSP). Try: 1) Refresh page, 2) Try a different site (e.g., example.com), 3) Check DevTools Console on the page for CSP errors.');
  }

  async sendToContentScriptWithTabId(tabId, message) {
    return Promise.race([
      new Promise((resolve, reject) => {
        chrome.tabs.sendMessage(tabId, message, (response) => {
          if (chrome.runtime.lastError) {
            const msg = chrome.runtime.lastError.message;
            if (msg.includes('Receiving end does not exist') || msg.includes('Could not establish connection')) {
              reject(new Error('Content script not loaded. Refresh the page or open a regular website (not chrome://, new tab, etc.)'));
            } else {
              reject(new Error(msg));
            }
          } else {
            resolve(response);
          }
        });
      }),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error('Content script timeout (10s)')), CONTENT_SCRIPT_TIMEOUT)
      )
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
    while (this.isRunning && this.stepHistory.length < this.maxSteps) {
      if (this.abortController?.signal.aborted) break;

      try {
        const screenshot = await this.captureTab();
        if (this.abortController?.signal.aborted) break;

        const { annotatedImage, elementMap } = await this.annotateDom(screenshot);
        if (this.abortController?.signal.aborted) break;

        const action = await this.api.getNextAction(annotatedImage, this.goal, this.stepHistory, elementMap);
        if (this.abortController?.signal.aborted) break;

        if (action.type === 'DONE') {
          this.stepHistory.push({ action, result: 'Goal achieved', timestamp: Date.now() });
          break;
        }

        const result = await this.executeAction(action);
        this.stepHistory.push({ action, result, timestamp: Date.now() });
        this.broadcastState();

        await this.sleep(1500, this.abortController?.signal);
      } catch (error) {
        if (this.abortController?.signal.aborted) break;
        console.error('[MiniMax Agent] Loop error:', error);
        this.stepHistory.push({ error: error.message, timestamp: Date.now() });
        await this.sleep(2000, this.abortController?.signal);
      }
    }

    this.isRunning = false;
    this.broadcastState();
  }

  async captureTab() {
    console.log('[MiniMax Agent] Capturing tab', this.currentTabId, 'window', this.currentTab?.windowId, 'url', this.currentTab?.url);
    const dataUrl = await chrome.tabs.captureVisibleTab(this.currentTab?.windowId, { format: 'png' });
    return dataUrl.split(',')[1];
  }

  async sendToContentScript(message) {
    if (!this.currentTabId) throw new Error('No tab ID');

    return Promise.race([
      new Promise((resolve, reject) => {
        chrome.tabs.sendMessage(this.currentTabId, message, (response) => {
          if (chrome.runtime.lastError) {
            const msg = chrome.runtime.lastError.message;
            if (msg.includes('Receiving end does not exist') || msg.includes('Could not establish connection')) {
              reject(new Error('Content script not loaded. Refresh the page or open a regular website (not chrome://, new tab, etc.)'));
            } else {
              reject(new Error(msg));
            }
          } else {
            resolve(response);
          }
        });
      }),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error('Content script timeout (10s)')), CONTENT_SCRIPT_TIMEOUT)
      )
    ]);
  }

  async annotateDom(base64Image) {
    return this.sendToContentScript({ type: 'ANNOTATE_DOM', image: base64Image });
  }

  async executeAction(action) {
    return this.sendToContentScript({ type: 'EXECUTE_ACTION', action });
  }

  broadcastState() {
    chrome.runtime.sendMessage({ type: 'STATE_UPDATE', state: this.getState() }).catch(() => {});
  }

  getState() {
    return { isRunning: this.isRunning, history: this.stepHistory, goal: this.goal, hasApiKey: !!this.api };
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