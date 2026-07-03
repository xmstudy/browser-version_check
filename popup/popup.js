'use strict';

const pickBtn = document.getElementById('pickBtn');
const watchLabelInput = document.getElementById('watchLabel');
const watchListEl = document.getElementById('watchList');
const extractType = document.getElementById('extractType');
const regexField = document.getElementById('regexField');
const regexPattern = document.getElementById('regexPattern');
const webhookInput = document.getElementById('webhook');
const urgentAtAllInput = document.getElementById('urgentAtAll');
const autoRefreshInput = document.getElementById('autoRefresh');
const refreshIntervalField = document.getElementById('refreshIntervalField');
const refreshIntervalInput = document.getElementById('refreshIntervalSec');
const testBtn = document.getElementById('testBtn');
const toggleBtn = document.getElementById('toggleBtn');
const statusEl = document.getElementById('status');

const MIN_REFRESH_SEC = 30;
const DEFAULT_REFRESH_SEC = 900;

let watches = [];
let enabled = false;

function createWatchId() {
  return `w_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function normalizeUrl(url) {
  try {
    const u = new URL(url);
    return u.origin + u.pathname + u.search;
  } catch {
    return url || '';
  }
}

function urlsMatch(a, b) {
  return normalizeUrl(a) === normalizeUrl(b);
}

function migrateLegacyConfig(data) {
  if (Array.isArray(data.watches) && data.watches.length) return data.watches;
  if (data.watchUrl && data.selector) {
    return [{
      id: createWatchId(),
      label: '默认监听',
      watchUrl: data.watchUrl,
      selector: data.selector,
      sampleText: data.sampleText || '',
      extractRule: data.extractRule || { type: 'fullText' },
      lastVersion: data.lastVersion || null,
    }];
  }
  return [];
}

function shortUrl(url) {
  try {
    const u = new URL(url);
    const path = u.pathname.length > 24 ? u.pathname.slice(0, 24) + '…' : u.pathname;
    return u.hostname + path;
  } catch {
    return url || '';
  }
}

function getExtractRule() {
  if (extractType.value === 'regex') {
    return { type: 'regex', pattern: regexPattern.value.trim() };
  }
  return { type: 'fullText' };
}

function renderWatchList() {
  if (!watches.length) {
    watchListEl.innerHTML = '<p class="empty-hint">暂无监听项，打开 EA 页面后点击上方按钮添加</p>';
    return;
  }

  watchListEl.innerHTML = watches.map((w) => `
    <div class="watch-item" data-id="${w.id}">
      <div class="watch-item-head">
        <strong>${escapeHtml(w.label || '未命名')}</strong>
        <button type="button" class="btn-remove" data-id="${w.id}" title="删除">×</button>
      </div>
      <div class="watch-item-meta">${escapeHtml(shortUrl(w.watchUrl))}</div>
      <div class="watch-item-meta">${escapeHtml(w.selector)}</div>
      <div class="watch-item-meta">样本: ${escapeHtml(w.sampleText || '-')} · 版本: ${escapeHtml(w.lastVersion || '-')}</div>
    </div>
  `).join('');

  watchListEl.querySelectorAll('.btn-remove').forEach((btn) => {
    btn.addEventListener('click', () => removeWatch(btn.dataset.id));
  });
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

async function saveWatches() {
  await chrome.storage.local.set({ watches });
  renderWatchList();
  updateUI();
}

async function removeWatch(id) {
  watches = watches.filter((w) => w.id !== id);
  await saveWatches();
  if (enabled) {
    chrome.runtime.sendMessage({ type: 'START_ALL_WATCHING' });
  }
}

async function loadState() {
  const data = await chrome.storage.local.get([
    'watches', 'watchUrl', 'selector', 'sampleText', 'extractRule', 'lastVersion',
    'feishuWebhook', 'urgentAtAll', 'autoRefresh', 'refreshIntervalSec', 'refreshIntervalMin', 'enabled',
  ]);

  watches = migrateLegacyConfig(data);
  enabled = !!data.enabled;

  webhookInput.value = data.feishuWebhook || window.DEFAULT_FEISHU_WEBHOOK || '';
  urgentAtAllInput.checked = data.urgentAtAll !== false;
  autoRefreshInput.checked = !!data.autoRefresh;

  let refreshSec = data.refreshIntervalSec;
  if (!refreshSec && data.refreshIntervalMin) refreshSec = data.refreshIntervalMin * 60;
  refreshIntervalInput.value = String(refreshSec || DEFAULT_REFRESH_SEC);

  if (data.extractRule?.type === 'regex') {
    extractType.value = 'regex';
    regexPattern.value = data.extractRule.pattern || '';
  }

  if (watches.length && !data.watches) {
    await chrome.storage.local.set({ watches });
  }

  updateRefreshVisibility();
  updateRegexVisibility();
  renderWatchList();
  updateUI();
}

function updateRefreshVisibility() {
  refreshIntervalField.classList.toggle('hidden', !autoRefreshInput.checked);
}

function updateRegexVisibility() {
  regexField.classList.toggle('hidden', extractType.value !== 'regex');
}

function getRefreshIntervalSec() {
  if (!autoRefreshInput.checked) return 0;
  const sec = parseInt(refreshIntervalInput.value, 10);
  if (!Number.isFinite(sec) || sec < MIN_REFRESH_SEC) return MIN_REFRESH_SEC;
  return sec;
}

function formatRefreshHint(sec) {
  if (sec >= 60 && sec % 60 === 0) return ` · 每 ${sec / 60} 分钟刷新`;
  return ` · 每 ${sec} 秒刷新`;
}

function canStart() {
  return watches.length > 0 && webhookInput.value.trim();
}

function updateUI() {
  toggleBtn.disabled = !canStart();

  if (enabled) {
    toggleBtn.textContent = '停止全部监听';
    toggleBtn.className = 'btn danger';
    const refreshHint = autoRefreshInput.checked ? formatRefreshHint(getRefreshIntervalSec()) : '';
    statusEl.textContent = `监听中 · ${watches.length} 个目标${refreshHint}`;
    statusEl.className = 'status active';
  } else if (canStart()) {
    toggleBtn.textContent = '开始全部监听';
    toggleBtn.className = 'btn success';
    statusEl.textContent = `已就绪 · ${watches.length} 个目标，点击开始`;
    statusEl.className = 'status';
  } else {
    toggleBtn.textContent = '开始全部监听';
    toggleBtn.className = 'btn success';
    statusEl.textContent = '请添加至少一个监听项并填写 Webhook';
    statusEl.className = 'status';
  }
}

async function getActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

async function injectAndSend(tabId, message) {
  try {
    await chrome.tabs.sendMessage(tabId, message);
  } catch {
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ['content/content.js'],
    });
    await chrome.tabs.sendMessage(tabId, message);
  }
}

pickBtn.addEventListener('click', async () => {
  const tab = await getActiveTab();
  if (!tab?.id) return;

  try {
    await chrome.storage.local.set({
      pendingWatchLabel: watchLabelInput.value.trim(),
      pendingExtractRule: getExtractRule(),
    });
    await injectAndSend(tab.id, { type: 'START_PICK' });
    statusEl.textContent = '请在页面上点击版本号元素…';
    statusEl.className = 'status';
    window.close();
  } catch {
    statusEl.textContent = '无法注入脚本，请刷新页面后重试';
    statusEl.className = 'status error';
  }
});

testBtn.addEventListener('click', async () => {
  const webhook = webhookInput.value.trim();
  if (!webhook) {
    statusEl.textContent = '请先填写 Webhook URL';
    statusEl.className = 'status error';
    return;
  }

  testBtn.disabled = true;
  statusEl.textContent = '发送测试通知中…';
  chrome.storage.local.set({ urgentAtAll: urgentAtAllInput.checked });

  chrome.runtime.sendMessage({
    type: 'TEST_NOTIFY',
    webhook,
    urgentAtAll: urgentAtAllInput.checked,
  }, (res) => {
    testBtn.disabled = false;
    if (chrome.runtime.lastError || !res?.ok) {
      statusEl.textContent = `测试失败: ${res?.error || chrome.runtime.lastError?.message}`;
      statusEl.className = 'status error';
    } else {
      statusEl.textContent = '测试通知已发送，请查看飞书';
      statusEl.className = 'status active';
    }
  });
});

toggleBtn.addEventListener('click', async () => {
  if (enabled) {
    await chrome.storage.local.set({ enabled: false, autoRefresh: false, refreshIntervalSec: 0 });
    chrome.runtime.sendMessage({ type: 'STOP_ALL_WATCHING' });
    chrome.runtime.sendMessage({ type: 'UPDATE_AUTO_REFRESH' });
    enabled = false;
    updateUI();
    return;
  }

  if (!canStart()) return;

  const refreshIntervalSec = getRefreshIntervalSec();
  refreshIntervalInput.value = String(refreshIntervalSec);

  await chrome.storage.local.set({
    watches,
    feishuWebhook: webhookInput.value.trim(),
    urgentAtAll: urgentAtAllInput.checked,
    autoRefresh: autoRefreshInput.checked,
    refreshIntervalSec,
    enabled: true,
  });

  enabled = true;
  chrome.runtime.sendMessage({ type: 'START_ALL_WATCHING' });
  chrome.runtime.sendMessage({ type: 'UPDATE_AUTO_REFRESH' });
  statusEl.textContent = `监听已启动 · ${watches.length} 个目标`;
  statusEl.className = 'status active';
  updateUI();
});

extractType.addEventListener('change', updateRegexVisibility);
webhookInput.addEventListener('input', updateUI);
urgentAtAllInput.addEventListener('change', () => {
  chrome.storage.local.set({ urgentAtAll: urgentAtAllInput.checked });
});
autoRefreshInput.addEventListener('change', () => {
  updateRefreshVisibility();
  const refreshIntervalSec = getRefreshIntervalSec();
  refreshIntervalInput.value = String(refreshIntervalSec);
  chrome.storage.local.set({ autoRefresh: autoRefreshInput.checked, refreshIntervalSec });
  chrome.runtime.sendMessage({ type: 'UPDATE_AUTO_REFRESH' });
  updateUI();
});
refreshIntervalInput.addEventListener('input', () => {
  const refreshIntervalSec = getRefreshIntervalSec();
  chrome.storage.local.set({ refreshIntervalSec });
  chrome.runtime.sendMessage({ type: 'UPDATE_AUTO_REFRESH' });
  updateUI();
});
regexPattern.addEventListener('input', updateUI);

loadState();
