'use strict';

const CONTENT_SCRIPT_PATH = 'content/content.js';
const REFRESH_ALARM = 'version-check-refresh';
const MIN_REFRESH_SEC = 30;

function createWatchId() {
  return `w_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function normalizeUrl(url) {
  if (!url) return '';
  try {
    const u = new URL(url);
    return u.origin + u.pathname + u.search;
  } catch {
    return url;
  }
}

function urlsMatch(a, b) {
  return normalizeUrl(a) === normalizeUrl(b);
}

function migrateLegacyConfig(data) {
  if (Array.isArray(data.watches) && data.watches.length > 0) {
    return data.watches;
  }
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

async function getFullConfig() {
  const data = await chrome.storage.local.get([
    'watches',
    'watchUrl',
    'selector',
    'sampleText',
    'extractRule',
    'lastVersion',
    'feishuWebhook',
    'urgentAtAll',
    'autoRefresh',
    'refreshIntervalSec',
    'enabled',
    'pendingWatchLabel',
    'pendingExtractRule',
  ]);
  data.watches = migrateLegacyConfig(data);
  return data;
}

function getWatchesForUrl(watches, url) {
  return watches.filter((w) => urlsMatch(w.watchUrl, url));
}

async function saveWatches(watches) {
  await chrome.storage.local.set({ watches });
}

async function updateWatchVersion(watchId, newVersion) {
  const config = await getFullConfig();
  const watches = config.watches.map((w) =>
    w.id === watchId ? { ...w, lastVersion: newVersion } : w
  );
  await saveWatches(watches);
}

async function updateAutoRefreshAlarm() {
  await chrome.alarms.clear(REFRESH_ALARM);
  const config = await getFullConfig();
  if (!config.enabled || !config.autoRefresh || !config.refreshIntervalSec) return;

  const sec = Math.max(MIN_REFRESH_SEC, Number(config.refreshIntervalSec) || 900);
  chrome.alarms.create(REFRESH_ALARM, { delayInMinutes: sec / 60 });
}

async function reloadWatchingTabs() {
  const config = await getFullConfig();
  if (!config.enabled || !config.watches.length) return;

  const tabs = await chrome.tabs.query({});
  const reloaded = new Set();

  for (const tab of tabs) {
    if (!tab.id || !tab.url || tab.url.startsWith('chrome://')) continue;
    const matches = getWatchesForUrl(config.watches, tab.url);
    if (!matches.length || reloaded.has(tab.id)) continue;
    reloaded.add(tab.id);
    await chrome.tabs.reload(tab.id).catch(() => {});
  }
}

async function postWebhook(webhookUrl, payload) {
  const res = await fetch(webhookUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  const result = await res.json();
  if (result.code !== 0 && result.StatusCode !== 0) {
    throw new Error(result.msg || result.StatusMessage || '飞书通知发送失败');
  }
  return result;
}

async function sendAtAllText(webhookUrl, text) {
  return postWebhook(webhookUrl, {
    msg_type: 'text',
    content: { text: `<at user_id="all">所有人</at> ${text}` },
  });
}

async function injectContentScript(tabId) {
  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      files: [CONTENT_SCRIPT_PATH],
    });
    return true;
  } catch {
    return false;
  }
}

async function sendToTab(tabId, message) {
  try {
    await chrome.tabs.sendMessage(tabId, message);
    return true;
  } catch {
    const injected = await injectContentScript(tabId);
    if (!injected) return false;
    try {
      await chrome.tabs.sendMessage(tabId, message);
      return true;
    } catch {
      return false;
    }
  }
}

async function injectWatchesForTab(tabId, tabUrl) {
  const config = await getFullConfig();
  if (!config.enabled) return;

  const watches = getWatchesForUrl(config.watches, tabUrl);
  if (!watches.length) return;

  const ok = await sendToTab(tabId, {
    type: 'START_WATCHES',
    watches: watches.map((w) => ({
      id: w.id,
      label: w.label,
      selector: w.selector,
      extractRule: w.extractRule || { type: 'fullText' },
      lastVersion: w.lastVersion || null,
    })),
  });

  if (!ok) {
    console.warn('[version-check] 无法在标签页注入监听脚本:', tabId);
  }
}

async function startAllWatchingTabs() {
  const config = await getFullConfig();
  if (!config.enabled || !config.watches.length) return;

  const tabs = await chrome.tabs.query({});
  for (const tab of tabs) {
    if (!tab.id || !tab.url || tab.url.startsWith('chrome://')) continue;
    if (!getWatchesForUrl(config.watches, tab.url).length) continue;
    await injectWatchesForTab(tab.id, tab.url);
  }
}

async function stopAllWatchingTabs() {
  const tabs = await chrome.tabs.query({});
  for (const tab of tabs) {
    if (!tab.id) continue;
    await sendToTab(tab.id, { type: 'STOP_ALL_WATCHES' }).catch(() => {});
  }
}

async function sendFeishuNotification(webhookUrl, data) {
  const isTest = data.isTest;
  const urgentAtAll = data.urgentAtAll !== false;
  const title = data.label ? `【${data.label}】` : '';

  if (urgentAtAll) {
    const alertText = isTest
      ? '【版本监听器】测试通知 - 若手机收到推送说明强提醒已生效'
      : `${title}【版本变化】${data.oldVersion} → ${data.newVersion}`;
    await sendAtAllText(webhookUrl, alertText);
  }

  const atAllPrefix = urgentAtAll ? '<at id=all></at> ' : '';

  const cardContent = isTest
    ? [
        `${atAllPrefix}**状态**: 测试通知成功`,
        `**时间**: ${new Date().toLocaleString('zh-CN')}`,
        '插件已正确连接到飞书 Webhook。',
        urgentAtAll ? '已开启 @所有人 强提醒。' : '',
      ].filter(Boolean).join('\n')
    : [
        `${atAllPrefix}**名称**: ${data.label || '未命名'}`,
        `**页面**: ${data.url}`,
        `**选择器**: \`${data.selector}\``,
        `**旧版本**: ${data.oldVersion}`,
        `**新版本**: ${data.newVersion}`,
        `**时间**: ${new Date().toLocaleString('zh-CN')}`,
      ].join('\n');

  const payload = {
    msg_type: 'interactive',
    card: {
      header: {
        title: {
          tag: 'plain_text',
          content: isTest ? '版本监听器 - 测试通知' : `${data.label || '版本'}变化提醒`,
        },
        template: isTest ? 'blue' : 'orange',
      },
      elements: [{
        tag: 'div',
        text: { tag: 'lark_md', content: cardContent },
      }],
    },
  };

  if (!isTest && data.url) {
    payload.card.elements.push({
      tag: 'action',
      actions: [{
        tag: 'button',
        text: { tag: 'plain_text', content: '打开页面' },
        url: data.url,
        type: 'primary',
      }],
    });
  }

  await postWebhook(webhookUrl, payload);
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  (async () => {
    try {
      if (msg.type === 'ELEMENT_SELECTED') {
        const config = await getFullConfig();
        const label = config.pendingWatchLabel
          || msg.pageTitle?.slice(0, 40)
          || (() => {
            try {
              const u = new URL(msg.url);
              return u.hostname + u.pathname.slice(0, 20);
            } catch {
              return '未命名';
            }
          })();

        const watch = {
          id: createWatchId(),
          label,
          watchUrl: msg.url,
          selector: msg.selector,
          sampleText: msg.sampleText,
          extractRule: config.pendingExtractRule || { type: 'fullText' },
          lastVersion: null,
        };

        let watches = config.watches.filter(
          (w) => !(urlsMatch(w.watchUrl, watch.watchUrl) && w.selector === watch.selector)
        );
        watches.push(watch);
        await chrome.storage.local.set({
          watches,
          pendingWatchLabel: '',
          pendingExtractRule: null,
        });

        if (config.enabled && _sender.tab?.id) {
          await injectWatchesForTab(_sender.tab.id, msg.url);
        }
        sendResponse({ ok: true, watchId: watch.id });
      } else if (msg.type === 'VERSION_CHANGED') {
        const config = await getFullConfig();
        if (!config.feishuWebhook) {
          sendResponse({ ok: false, error: '未配置飞书 Webhook' });
          return;
        }
        if (msg.watchId) {
          await updateWatchVersion(msg.watchId, msg.newVersion);
        }
        await sendFeishuNotification(config.feishuWebhook, {
          ...msg,
          urgentAtAll: config.urgentAtAll !== false,
        });
        sendResponse({ ok: true });
      } else if (msg.type === 'TEST_NOTIFY') {
        const config = await getFullConfig();
        const webhook = msg.webhook || config.feishuWebhook;
        if (!webhook) {
          sendResponse({ ok: false, error: '未配置飞书 Webhook' });
          return;
        }
        await sendFeishuNotification(webhook, {
          isTest: true,
          urgentAtAll: msg.urgentAtAll !== false,
        });
        sendResponse({ ok: true });
      } else if (msg.type === 'START_ALL_WATCHING') {
        await startAllWatchingTabs();
        sendResponse({ ok: true });
      } else if (msg.type === 'STOP_ALL_WATCHING') {
        await stopAllWatchingTabs();
        sendResponse({ ok: true });
      } else if (msg.type === 'INJECT_TAB') {
        if (msg.tabId && msg.tabUrl) {
          await injectWatchesForTab(msg.tabId, msg.tabUrl);
        }
        sendResponse({ ok: true });
      } else if (msg.type === 'UPDATE_AUTO_REFRESH') {
        await updateAutoRefreshAlarm();
        sendResponse({ ok: true });
      } else {
        sendResponse({ ok: false, error: '未知消息类型' });
      }
    } catch (err) {
      sendResponse({ ok: false, error: err.message || String(err) });
    }
  })();
  return true;
});

chrome.tabs.onUpdated.addListener(async (tabId, info, tab) => {
  if (info.status !== 'complete' || !tab.url || tab.url.startsWith('chrome://')) return;
  await injectWatchesForTab(tabId, tab.url);
});

chrome.runtime.onInstalled.addListener(async () => {
  const config = await getFullConfig();
  if (config.watches.length) {
    await chrome.storage.local.set({ watches: config.watches });
  }
  await startAllWatchingTabs();
  await updateAutoRefreshAlarm();
});

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name !== REFRESH_ALARM) return;
  await reloadWatchingTabs();
  await updateAutoRefreshAlarm();
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local') return;
  if (changes.enabled || changes.autoRefresh || changes.refreshIntervalSec) {
    updateAutoRefreshAlarm();
  }
  if (changes.enabled?.newValue === true) {
    startAllWatchingTabs();
  }
  if (changes.enabled?.newValue === false) {
    stopAllWatchingTabs();
  }
  if (changes.watches) {
    startAllWatchingTabs();
  }
});
