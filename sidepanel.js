const apiKeyInput = document.getElementById('apiKey');
const saveKeyBtn = document.getElementById('saveKey');
const goalInput = document.getElementById('goal');
const startBtn = document.getElementById('startBtn');
const stopBtn = document.getElementById('stopBtn');
const statusEl = document.getElementById('status');
const logEl = document.getElementById('log');
const stepCountEl = document.getElementById('stepCount');

chrome.storage.local.get('minimax_api_key', ({ minimax_api_key }) => {
  if (minimax_api_key) apiKeyInput.value = minimax_api_key;
  requestState();
});

saveKeyBtn.onclick = () => {
  const key = apiKeyInput.value.trim();
  if (!key) return alert('Enter API key');
  chrome.runtime.sendMessage({ type: 'SET_API_KEY', key }, () => {
    log('API Key saved', 'success');
  });
};

startBtn.onclick = async () => {
  const goal = goalInput.value.trim();
  if (!goal) return alert('Enter a goal');

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab) return alert('No active tab');

  chrome.runtime.sendMessage({ type: 'START_AGENT', tabId: tab.id, goal }, (response) => {
    if (response?.success) {
      setUIRunning(true);
    } else {
      const err = response?.error || 'Unknown error';
      log(`Start failed: ${err}`, 'error');
      setStatus('error', `Start failed: ${err}`);
    }
  });
};

stopBtn.onclick = () => {
  chrome.runtime.sendMessage({ type: 'STOP_AGENT' }, (response) => {
    if (response?.success) {
      setUIRunning(false);
      setStatus('stopped', 'Agent stopped by user');
    } else {
      log(`Stop failed: ${response?.error || 'Unknown error'}`, 'error');
    }
  });
};

chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type === 'STATE_UPDATE') {
    renderState(msg.state);
  }
});

function requestState() {
  chrome.runtime.sendMessage({ type: 'GET_STATE' }, (state) => {
    if (state) renderState(state);
  });
}

function renderState(state) {
  const { isRunning, history, goal, hasApiKey } = state;
  setUIRunning(isRunning);
  if (goal) goalInput.value = goal;
  stepCountEl.textContent = `(${history.length} steps)`;
  renderLog(history);
}

function setUIRunning(running) {
  startBtn.classList.toggle('hidden', running);
  stopBtn.classList.toggle('hidden', !running);
  goalInput.disabled = running;
  setStatus(running ? 'running' : 'stopped', running ? 'Agent running...' : 'Agent stopped');
}

function setStatus(state, text) {
  statusEl.className = `status ${state}`;
  statusEl.textContent = text;
}

function renderLog(history) {
  logEl.innerHTML = '';
  if (history.length === 0) {
    logEl.innerHTML = '<div style="color:#888;text-align:center;padding:20px;">No steps yet</div>';
    return;
  }
  history.slice().reverse().forEach(h => {
    if (h.action) {
      const badgeClass = h.action.type.toLowerCase();
      const paramsStr = h.action.params ? ` ${JSON.stringify(h.action.params)}` : '';
      log(`<span class="step-badge ${badgeClass}">${h.action.type}</span>${paramsStr}`, 'success');
      if (h.action.reasoning) log(`  → ${h.action.reasoning}`, 'info');
    } else if (h.error) {
      log(`Error: ${h.error}`, 'error');
    } else if (h.result) {
      log(`Result: ${JSON.stringify(h.result)}`, 'info');
    }
  });
}

function log(html, type = 'info') {
  const entry = document.createElement('div');
  entry.className = `log-entry ${type}`;
  entry.innerHTML = `[${new Date().toLocaleTimeString()}] ${html}`;
  logEl.prepend(entry);
}