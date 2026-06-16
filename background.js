import { MinimaxAPI } from './utils/minimax-api.js';

const API_KEY_STORAGE = 'minimax_api_key';
const AGENT_STATE_STORAGE = 'agent_state';

class AgentController {
  constructor() {
    this.api = null;
    this.currentTabId = null;
    this.isRunning = false;
    this.stepHistory = [];
    this.maxSteps = 20;
    this.goal = '';
  }

  async init() {
    const { [API_KEY_STORAGE]: key } = await chrome.storage.local.get(API_KEY_STORAGE);
    if (key) this.api = new MinimaxAPI(key);

    chrome.runtime.onMessage.addListener(this.handleMessage.bind(this));
    chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
    console.log('[MiniMax Agent] Background service worker initialized');
  }

  handleMessage(message, sender, sendResponse) {
    switch (message.type) {
      case 'SET_API_KEY':
        this.setApiKey(message.key).then(() => sendResponse({ success: true }));
        return true;
      case 'START_AGENT':
        this.startAgent(message.tabId, message.goal).then(() => sendResponse({ success: true })).catch(err => sendResponse({ success: false, error: err.message }));
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
    API(key);
    await chrome.storage.local.set({ [API_KEY_STORAGE]: key });
  }

  async startAgent(tabId, goal) {
    if (!this.api) throw new Error('API Key not set. Please configure in side panel.');
    if (this.isRunning) throw new Error('Agent already running');
    if (!tabId) throw new Error('No tab ID provided');

    this.currentTabId = tabId;
    this.isRunning = true;
    this.stepHistory = [];
    this.goal = goal;

    this.broadcastState();
    await this.runLoop();
  }

  stopAgent() {
    this.isRunning = false;
    this.currentTabId = null;
    this.broadcastState();
  }

  async runLoop() {
    while (this.isRunning && this.stepHistory.length < this.maxSteps) {
      try {
        const screenshot = await this.captureTab();
        const { annotatedImage, elementMap } = await this.annotateDom(screenshot);
        const action = await this.api.getNextAction(annotatedImage, this.goal, this.stepHistory, elementMap);

        if (action.type === 'DONE') {
          this.stepHistory.push({ action, result: 'Goal achieved', timestamp: Date.now() });
          break;
        }

        const result = await this.executeAction(action);
        this.stepHistory.push({ action, result, timestamp: Date.now() });
        this.broadcastState();

        await this.sleep(1500);
      } catch (error) {
        console.error('[MiniMax Agent] Loop error:', error);
        this.stepHistory.push({ error: error.message, timestamp: Date.now() });
        await this.sleep(2000);
      }
    }

    this.isRunning = false;
    this.broadcastState();
  }

  async captureTab() {
    const dataUrl = await chrome.tabs.captureVisibleTab(null, { format: 'png' });
    return dataUrl.split(',')[1];
  }

  async annotateDom(base64Image) {
    return new Promise((resolve, reject) => {
      if (!this.currentTabId) return reject(new Error('No tab ID'));
      chrome.tabs.sendMessage(this.currentTabId, { type: 'ANNOTATE_DOM', image: base64Image }, (response) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
        } else {
          resolve(response);
        }
      });
    });
  }

  async executeAction(action) {
    return new Promise((resolve, reject) => {
      if (!this.currentTabId) return reject(new Error('No tab ID'));
      chrome.tabs.sendMessage(this.currentTabId, { type: 'EXECUTE_ACTION', action }, (response) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
        } else {
          resolve(response);
        }
      });
    });
  }

  broadcastState() {
    chrome.runtime.sendMessage({ type: 'STATE_UPDATE', state: this.getState() }).catch(() => {});
  }

  getState() {
    return { isRunning: this.isRunning, history: this.stepHistory, goal: this.goal, hasApiKey: !!this.api };
  }

  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

const controller = new AgentController();
controller.init();