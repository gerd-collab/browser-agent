import { MINIMAX_MODELS, DEFAULT_MODEL } from './utils/minimax-api.js';

const $ = id => document.getElementById(id);
const apiKeyInput = $('apiKey');
const saveKeyBtn = $('saveKey');
const modelSelect = $('model');
const goalInput = $('goal');
const startBtn = $('startBtn');
const stopBtn = $('stopBtn');
const statusEl = $('status');
const logEl = $('log');
const stepCountEl = $('stepCount');
const pendingSection = $('pendingSection');
const pendingQuestion = $('pendingQuestion');
const pendingAsk = $('pendingAsk');
const pendingConfirm = $('pendingConfirm');
const pendingAnswer = $('pendingAnswer');

// ---- Model dropdown ----
MINIMAX_MODELS.forEach(m => {
  const opt = document.createElement('option');
  opt.value = m; opt.textContent = m;
  modelSelect.appendChild(opt);
});
modelSelect.value = DEFAULT_MODEL;
modelSelect.onchange = () => chrome.runtime.sendMessage({ type: 'SET_MODEL', model: modelSelect.value });

// ---- Init ----
chrome.storage.local.get('minimax_api_key', ({ minimax_api_key }) => {
  if (minimax_api_key) apiKeyInput.value = minimax_api_key;
  requestState();
});
refreshWorkflows();
refreshPermissions();

// ---- Key + start/stop ----
saveKeyBtn.onclick = () => {
  const key = apiKeyInput.value.trim();
  if (!key) return alert('Enter API key');
  chrome.runtime.sendMessage({ type: 'SET_API_KEY', key }, () => log('API Key saved', 'success'));
};

startBtn.onclick = async () => {
  const goal = goalInput.value.trim();
  if (!goal) return alert('Enter a goal');
  const key = apiKeyInput.value.trim();
  if (!key) return alert('Enter API key and Save it first');
  await new Promise(resolve => chrome.runtime.sendMessage({ type: 'SET_API_KEY', key }, resolve));
  await new Promise(resolve => chrome.runtime.sendMessage({ type: 'SET_MODEL', model: modelSelect.value }, resolve));

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab) return alert('No active tab');

  chrome.runtime.sendMessage({ type: 'START_AGENT', tabId: tab.id, goal }, (response) => {
    if (response?.success) setUIRunning(true);
    else { const err = response?.error || 'Unknown error'; log(`Start failed: ${err}`, 'error'); setStatus('error', `Start failed: ${err}`); }
  });
};

stopBtn.onclick = () => {
  chrome.runtime.sendMessage({ type: 'STOP_AGENT' }, (response) => {
    if (response?.success) { setUIRunning(false); setStatus('stopped', 'Agent stopped by user'); hidePending(); }
    else log(`Stop failed: ${response?.error || 'Unknown error'}`, 'error');
  });
};

// ---- Human-in-the-loop ----
$('submitAnswer').onclick = () => {
  chrome.runtime.sendMessage({ type: 'RESUME_AGENT', answer: pendingAnswer.value });
  pendingAnswer.value = '';
  hidePending();
};
$('approveBtn').onclick = () => { chrome.runtime.sendMessage({ type: 'CONFIRM_ACTION', approved: true }); hidePending(); };
$('denyBtn').onclick = () => { chrome.runtime.sendMessage({ type: 'CONFIRM_ACTION', approved: false }); hidePending(); };

// ---- Workflows ----
$('saveWorkflow').onclick = () => {
  const name = $('workflowName').value.trim();
  if (!name) return alert('Enter a workflow name');
  chrome.runtime.sendMessage({ type: 'WORKFLOW_SAVE', name }, (r) => {
    if (r?.success) { log(`Workflow "${name}" saved`, 'success'); $('workflowName').value = ''; renderWorkflows(r.workflows); }
    else alert(r?.error || 'Could not save workflow');
  });
};

function refreshWorkflows() {
  chrome.runtime.sendMessage({ type: 'WORKFLOW_LIST' }, (r) => renderWorkflows(r?.workflows || []));
}

function renderWorkflows(names) {
  const list = $('workflowList');
  list.innerHTML = names.length ? '' : '<div class="hint">No saved workflows yet.</div>';
  names.forEach(name => {
    const item = document.createElement('div');
    item.className = 'list-item';
    const label = document.createElement('span');
    label.textContent = name;
    const runBtn = document.createElement('button');
    runBtn.className = 'primary'; runBtn.textContent = 'Replay';
    runBtn.onclick = async () => {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      chrome.runtime.sendMessage({ type: 'WORKFLOW_RUN', name, tabId: tab?.id }, (r) => {
        if (r?.success) setUIRunning(true); else log(`Replay failed: ${r?.error || 'error'}`, 'error');
      });
    };
    const delBtn = document.createElement('button');
    delBtn.className = 'danger'; delBtn.textContent = '✕';
    delBtn.onclick = () => chrome.runtime.sendMessage({ type: 'WORKFLOW_DELETE', name }, (r) => renderWorkflows(r?.workflows || []));
    item.append(label, runBtn, delBtn);
    list.appendChild(item);
  });
}

// ---- Permissions ----
$('allowHost').onclick = () => setPermission($('permHost').value.trim(), 'allow');
$('blockHost').onclick = () => setPermission($('permHost').value.trim(), 'block');

function setPermission(host, value) {
  if (!host) return alert('Enter a host (e.g. example.com)');
  chrome.runtime.sendMessage({ type: 'SET_PERMISSION', host, value }, (r) => { $('permHost').value = ''; renderPermissions(r?.permissions || {}); });
}

function refreshPermissions() {
  chrome.runtime.sendMessage({ type: 'GET_PERMISSIONS' }, (r) => renderPermissions(r?.permissions || {}));
}

function renderPermissions(perms) {
  const list = $('permList');
  const hosts = Object.keys(perms);
  list.innerHTML = hosts.length ? '' : '<div class="hint">No site rules yet.</div>';
  hosts.forEach(host => {
    const item = document.createElement('div');
    item.className = 'list-item';
    const label = document.createElement('span');
    label.textContent = `${host} — ${perms[host]}`;
    const resetBtn = document.createElement('button');
    resetBtn.className = 'secondary'; resetBtn.textContent = 'Reset';
    resetBtn.onclick = () => chrome.runtime.sendMessage({ type: 'SET_PERMISSION', host, value: 'reset' }, (r) => renderPermissions(r?.permissions || {}));
    item.append(label, resetBtn);
    list.appendChild(item);
  });
}

// ---- State rendering ----
chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type === 'STATE_UPDATE') renderState(msg.state);
});

function requestState() {
  chrome.runtime.sendMessage({ type: 'GET_STATE' }, (state) => { if (state) renderState(state); });
}

function renderState(state) {
  const { isRunning, history, goal, model, pending } = state;
  setUIRunning(isRunning);
  if (goal) goalInput.value = goal;
  if (model) modelSelect.value = model;
  stepCountEl.textContent = `(${history.length} steps)`;
  renderLog(history);
  if (pending) showPending(pending); else hidePending();
}

function showPending(pending) {
  pendingSection.classList.remove('hidden');
  pendingQuestion.textContent = pending.question || 'The agent needs your input.';
  const isAsk = pending.kind === 'ask';
  pendingAsk.classList.toggle('hidden', !isAsk);
  pendingConfirm.classList.toggle('hidden', isAsk);
  setStatus('paused', isAsk ? 'Waiting for your input…' : 'Waiting for your confirmation…');
  if (isAsk) pendingAnswer.focus();
}

function hidePending() {
  pendingSection.classList.add('hidden');
}

function setUIRunning(running) {
  startBtn.classList.toggle('hidden', running);
  stopBtn.classList.toggle('hidden', !running);
  goalInput.disabled = running;
  if (!pendingSection.classList.contains('hidden')) return; // keep "paused" status while pending
  setStatus(running ? 'running' : 'stopped', running ? 'Agent running…' : 'Agent stopped');
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
      const type = h.action.type;
      const badgeClass = type.toLowerCase();
      if (type === 'DONE') {
        const answer = h.action.answer || h.action.reasoning || h.result || 'Goal achieved';
        log(`<span class="step-badge done">DONE</span>`, 'success');
        log(`<div class="answer">${escapeHtml(answer)}</div>`, 'success');
      } else {
        const params = h.action.params && Object.keys(h.action.params).length
          ? ` ${escapeHtml(JSON.stringify(h.action.params))}` : '';
        log(`<span class="step-badge ${badgeClass}">${escapeHtml(type)}</span>${params}`, 'success');
        if (h.action.reasoning) log(`  → ${escapeHtml(h.action.reasoning)}`, 'info');
        if (h.result && typeof h.result === 'string') log(`  ${escapeHtml(h.result)}`, 'info');
      }
    } else if (h.error) {
      log(`Error: ${escapeHtml(h.error)}`, 'error');
    } else if (h.note) {
      log(escapeHtml(h.note), 'warning');
    } else if (h.result) {
      log(`Result: ${escapeHtml(typeof h.result === 'string' ? h.result : JSON.stringify(h.result))}`, 'info');
    }
  });
}

function log(html, type = 'info') {
  const entry = document.createElement('div');
  entry.className = `log-entry ${type}`;
  entry.innerHTML = `[${new Date().toLocaleTimeString()}] ${html}`;
  logEl.prepend(entry);
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
