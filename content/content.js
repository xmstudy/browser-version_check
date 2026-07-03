(() => {
  'use strict';

  function isContextValid() {
    try {
      return Boolean(chrome.runtime?.id);
    } catch {
      return false;
    }
  }

  function safeChrome(label, fn) {
    if (!isContextValid()) {
      handleContextInvalidated(label);
      return null;
    }
    try {
      return fn();
    } catch (err) {
      const msg = String(err?.message || err);
      if (msg.includes('invalidated') || !isContextValid()) {
        handleContextInvalidated(label);
      } else {
        console.warn('[版本监听器]', label, err);
      }
      return null;
    }
  }

  function showReloadBanner() {
    if (document.getElementById('version-check-reload-banner')) return;
    const bar = document.createElement('div');
    bar.id = 'version-check-reload-banner';
    bar.textContent = '版本监听器：插件已更新，请刷新本页后重新开始监听';
    Object.assign(bar.style, {
      position: 'fixed',
      top: '0',
      left: '0',
      right: '0',
      zIndex: '2147483647',
      padding: '10px 16px',
      background: '#fff3cd',
      color: '#664d03',
      fontSize: '14px',
      textAlign: 'center',
      boxShadow: '0 2px 8px rgba(0,0,0,0.15)',
      fontFamily: 'system-ui, sans-serif',
    });
    document.documentElement.appendChild(bar);
  }

  function handleContextInvalidated(from) {
    if (globalThis.__VERSION_CHECK_INVALID__) return;
    globalThis.__VERSION_CHECK_INVALID__ = true;
    stopAllWatches();
    removeMessageListener();
    disconnectPort();
    delete globalThis.__VERSION_CHECK_TEARDOWN__;
    showReloadBanner();
    console.warn(`[版本监听器] 插件已更新或重载（${from}），请刷新页面后重新开始监听`);
  }

  if (typeof globalThis.__VERSION_CHECK_TEARDOWN__ === 'function') {
    globalThis.__VERSION_CHECK_TEARDOWN__();
  }
  delete globalThis.__VERSION_CHECK_INVALID__;

  const DEBOUNCE_MS = 300;
  const watchSessions = new Map();
  let pickMode = false;
  let highlightedEl = null;
  let messageListener = null;
  let keepAlivePort = null;

  function connectPort() {
    if (keepAlivePort) return;
    if (!isContextValid()) return;
    try {
      keepAlivePort = chrome.runtime.connect({ name: 'version-check-watch' });
      keepAlivePort.onDisconnect.addListener(() => {
        if (!isContextValid()) handleContextInvalidated('port-disconnect');
      });
    } catch {
      handleContextInvalidated('connectPort');
    }
  }

  function disconnectPort() {
    try {
      keepAlivePort?.disconnect();
    } catch {
      /* ignore */
    }
    keepAlivePort = null;
  }

  function generateSelector(el) {
    if (el.id) return `#${CSS.escape(el.id)}`;
    for (const attr of el.attributes) {
      if (attr.name.startsWith('data-') && attr.value) {
        return `[${attr.name}="${CSS.escape(attr.value)}"]`;
      }
    }
    const path = [];
    let node = el;
    while (node && node.nodeType === Node.ELEMENT_NODE && path.length < 4) {
      let part = node.nodeName.toLowerCase();
      if (node.classList.length > 0) {
        part += '.' + [...node.classList].slice(0, 2).map((c) => CSS.escape(c)).join('.');
      }
      const parent = node.parentElement;
      if (parent) {
        const siblings = [...parent.children].filter((c) => c.nodeName === node.nodeName);
        if (siblings.length > 1) part += `:nth-of-type(${siblings.indexOf(node) + 1})`;
      }
      path.unshift(part);
      node = node.parentElement;
    }
    return path.join(' > ');
  }

  function extractVersion(el, rule) {
    const text = (el.innerText || el.textContent || '').trim();
    if (!text) return '';
    if (rule?.type === 'regex' && rule.pattern) {
      try {
        const match = text.match(new RegExp(rule.pattern));
        return match ? (match[1] || match[0]) : text;
      } catch {
        return text;
      }
    }
    return text;
  }

  function waitForElement(selector, timeout = 15000) {
    return new Promise((resolve, reject) => {
      const existing = document.querySelector(selector);
      if (existing) {
        resolve(existing);
        return;
      }
      let waitObserver = null;
      const timer = setTimeout(() => {
        waitObserver?.disconnect();
        reject(new Error(`元素等待超时: ${selector}`));
      }, timeout);
      waitObserver = new MutationObserver(() => {
        const found = document.querySelector(selector);
        if (found) {
          clearTimeout(timer);
          waitObserver.disconnect();
          resolve(found);
        }
      });
      waitObserver.observe(document.documentElement, { childList: true, subtree: true });
    });
  }

  function stopWatchSession(session) {
    clearTimeout(session.debounceTimer);
    session.observer?.disconnect();
  }

  function stopAllWatches() {
    for (const session of watchSessions.values()) {
      stopWatchSession(session);
    }
    watchSessions.clear();
    disconnectPort();
  }

  function notifyVersionChange(session, oldVersion, newVersion, source) {
    if (!oldVersion || !newVersion || oldVersion === newVersion) return;
    if (newVersion === session.lastNotifiedVersion) return;

    session.lastNotifiedVersion = newVersion;
    const label = session.config.label || '未命名';
    console.info(`[版本监听器][${label}] 版本变化 (${source}):`, oldVersion, '→', newVersion);

    safeChrome('sendMessage', () => {
      chrome.runtime.sendMessage({
        type: 'VERSION_CHANGED',
        watchId: session.config.id,
        label,
        oldVersion,
        newVersion,
        url: location.href,
        selector: session.config.selector,
        source,
      });
    });
  }

  function checkVersion(session) {
    if (!session.el || !isContextValid()) {
      if (!isContextValid()) handleContextInvalidated('checkVersion');
      return;
    }

    const newVersion = extractVersion(session.el, session.config.extractRule);
    if (!newVersion || newVersion === session.lastVersion) return;

    const oldVersion = session.lastVersion;
    session.lastVersion = newVersion;
    if (!oldVersion) return;

    notifyVersionChange(session, oldVersion, newVersion, 'dom');
  }

  async function startWatch(config) {
    stopWatchSession(watchSessions.get(config.id) || {});
    watchSessions.delete(config.id);

    const el = await waitForElement(config.selector);
    const currentVersion = extractVersion(el, config.extractRule);
    const previousVersion = config.lastVersion || null;

    const session = {
      config,
      el,
      lastVersion: currentVersion,
      lastNotifiedVersion: currentVersion,
      observer: null,
      debounceTimer: null,
    };

    if (previousVersion && currentVersion && previousVersion !== currentVersion) {
      session.lastNotifiedVersion = previousVersion;
      notifyVersionChange(session, previousVersion, currentVersion, 'refresh');
    }

    session.observer = new MutationObserver(() => {
      clearTimeout(session.debounceTimer);
      session.debounceTimer = setTimeout(() => checkVersion(session), DEBOUNCE_MS);
    });
    session.observer.observe(el, {
      childList: true,
      subtree: true,
      characterData: true,
    });

    watchSessions.set(config.id, session);
  }

  async function startWatches(watches) {
    if (!watches?.length) return;
    if (!isContextValid()) {
      handleContextInvalidated('startWatches');
      return;
    }

    connectPort();
    const incomingIds = new Set(watches.map((w) => w.id));

    for (const id of watchSessions.keys()) {
      if (!incomingIds.has(id)) {
        stopWatchSession(watchSessions.get(id));
        watchSessions.delete(id);
      }
    }

    for (const watch of watches) {
      try {
        await startWatch(watch);
      } catch (err) {
        console.warn(`[版本监听器][${watch.label || watch.id}] 启动失败:`, err.message);
      }
    }
  }

  function cleanupPicker() {
    pickMode = false;
    document.body.style.cursor = '';
    if (highlightedEl) {
      highlightedEl.style.outline = '';
      highlightedEl = null;
    }
  }

  function startElementPicker() {
    if (pickMode) return;
    pickMode = true;
    document.body.style.cursor = 'crosshair';

    const onMouseOver = (e) => {
      if (!pickMode) return;
      if (highlightedEl && highlightedEl !== e.target) highlightedEl.style.outline = '';
      highlightedEl = e.target;
      highlightedEl.style.outline = '2px solid #e74c3c';
    };

    const onClick = (e) => {
      if (!pickMode) return;
      e.preventDefault();
      e.stopPropagation();

      const target = e.target;
      const selector = generateSelector(target);
      const sampleText = (target.innerText || target.textContent || '').trim().slice(0, 200);

      cleanupPicker();
      document.removeEventListener('mouseover', onMouseOver, true);
      document.removeEventListener('click', onClick, true);

      safeChrome('sendMessage', () => {
        chrome.runtime.sendMessage({
          type: 'ELEMENT_SELECTED',
          selector,
          sampleText,
          url: location.href,
          pageTitle: document.title,
        });
      });
    };

    document.addEventListener('mouseover', onMouseOver, true);
    document.addEventListener('click', onClick, true);
  }

  function onRuntimeMessage(msg, _sender, sendResponse) {
    if (!isContextValid()) {
      handleContextInvalidated('onMessage');
      sendResponse({ ok: false, error: 'context invalidated' });
      return true;
    }

    if (msg.type === 'START_PICK') {
      startElementPicker();
      sendResponse({ ok: true });
    } else if (msg.type === 'START_WATCHES') {
      startWatches(msg.watches);
      sendResponse({ ok: true });
    } else if (msg.type === 'STOP_ALL_WATCHES') {
      stopAllWatches();
      sendResponse({ ok: true });
    }
    return true;
  }

  function removeMessageListener() {
    if (messageListener) {
      try {
        chrome.runtime.onMessage.removeListener(messageListener);
      } catch {
        /* ignore */
      }
      messageListener = null;
    }
  }

  messageListener = onRuntimeMessage;
  chrome.runtime.onMessage.addListener(messageListener);
  window.addEventListener('pagehide', stopAllWatches, { once: true });

  globalThis.__VERSION_CHECK_TEARDOWN__ = () => {
    stopAllWatches();
    cleanupPicker();
    removeMessageListener();
  };
})();
