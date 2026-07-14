// Elements
const enableToggle = document.getElementById('enable-toggle');
const statusDesc = document.getElementById('status-desc');

const currentStatusBox = document.getElementById('current-status-box');
const currentStatusIconWrap = document.getElementById('current-status-icon-wrap');
const currentStatusIcon = document.getElementById('current-status-icon');
const currentStatusHeader = document.getElementById('current-status-header');
const currentStatusDetail = document.getElementById('current-status-detail');

const historyContainer = document.getElementById('history-container');
const emptyHistoryText = document.getElementById('empty-history-text');
const clearHistoryBtn = document.getElementById('clear-history-btn');

const ocrOrderList = document.getElementById('ocr-order-list');
const resetOrderBtn = document.getElementById('reset-order-btn');

const CAPTCHA_ICONS = {
  'Google reCAPTCHA': '🤖',
  'hCaptcha': '🛡️',
  'Cloudflare Turnstile': '🌀',
  'GeeTest': '⚙️',
  'Arkoselabs FunCaptcha': '🎮',
  'Generic Captcha': '🧩'
};

function timeAgo(timestamp) {
  const seconds = Math.floor((Date.now() - timestamp) / 1000);
  if (seconds < 60) return `${seconds}d lalu`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m lalu`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}j lalu`;
  const days = Math.floor(hours / 24);
  return `${days}h lalu`;
}

function renderCurrentStatus(enabled, count, types) {
  currentStatusBox.classList.remove('status-clear', 'status-alert', 'status-disabled');

  if (!enabled) {
    currentStatusBox.classList.add('status-disabled');
    currentStatusIcon.textContent = '⏸️';
    currentStatusHeader.textContent = 'Radar Nonaktif';
    currentStatusDetail.textContent = 'Deteksi captcha sedang dimatikan.';
    return;
  }

  if (count > 0) {
    currentStatusBox.classList.add('status-alert');
    currentStatusIcon.textContent = '⚠️';
    currentStatusHeader.textContent = `${count} Captcha Terdeteksi`;
    currentStatusDetail.textContent = types.join(', ');
  } else {
    currentStatusBox.classList.add('status-clear');
    currentStatusIcon.textContent = '✅';
    currentStatusHeader.textContent = 'Halaman Bersih';
    currentStatusDetail.textContent = 'Tidak ada captcha terdeteksi di tab aktif.';
  }
}

function renderHistory(history) {
  historyContainer.querySelectorAll('.history-item').forEach(el => el.remove());

  if (!history || history.length === 0) {
    emptyHistoryText.style.display = 'flex';
    return;
  }

  emptyHistoryText.style.display = 'none';

  history.forEach(entry => {
    const item = document.createElement('div');
    item.className = 'history-item';

    let hostname = entry.url;
    try {
      hostname = new URL(entry.url).hostname;
    } catch (e) {
      // keep raw url if parsing fails
    }

    item.innerHTML = `
      <div class="history-icon-type">${CAPTCHA_ICONS[entry.type] || CAPTCHA_ICONS['Generic Captcha']}</div>
      <div class="history-details">
        <div class="history-meta">
          <span class="history-type-name">${entry.type}</span>
          <span class="history-time">${timeAgo(entry.timestamp)}</span>
        </div>
        <span class="history-url" title="${hostname}">${hostname}</span>
      </div>
    `;

    historyContainer.appendChild(item);
  });
}

function loadPopupState() {
  chrome.storage.local.get({ extensionEnabled: true, detectionHistory: [] }, (data) => {
    enableToggle.checked = data.extensionEnabled;
    statusDesc.textContent = data.extensionEnabled
      ? 'Mendeteksi captcha di latar belakang'
      : 'Radar sedang dimatikan';

    renderHistory(data.detectionHistory);

    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const tabId = tabs[0] ? tabs[0].id : null;
      if (!tabId) {
        renderCurrentStatus(data.extensionEnabled, 0, []);
        return;
      }

      chrome.runtime.sendMessage({ action: 'getTabStatus', tabId }, (response) => {
        const count = response && response.count ? response.count : 0;
        const types = response && response.captchas ? response.captchas : [];
        renderCurrentStatus(data.extensionEnabled, count, types);
      });
    });
  });
}

enableToggle.addEventListener('change', () => {
  const enabled = enableToggle.checked;
  chrome.storage.local.set({ extensionEnabled: enabled }, () => {
    statusDesc.textContent = enabled
      ? 'Mendeteksi captcha di latar belakang'
      : 'Radar sedang dimatikan';
    loadPopupState();
  });
});

clearHistoryBtn.addEventListener('click', () => {
  chrome.storage.local.set({ detectionHistory: [] }, () => {
    renderHistory([]);
  });
});

// --- OCR strategy order settings ---
// Strategy metadata (id/label) comes from lib/ocr-strategies.js, loaded before this file.
const OCR_STRATEGY_LABELS = Object.fromEntries(OCR_STRATEGY_DEFS.map(s => [s.id, s.label]));

function saveOcrStrategyConfig(config) {
  chrome.storage.local.set({ ocrStrategyConfig: config });
}

function renderOcrOrderList(config) {
  ocrOrderList.innerHTML = '';

  config.forEach((entry, index) => {
    const item = document.createElement('div');
    item.className = 'ocr-order-item';
    item.dataset.id = entry.id;

    item.innerHTML = `
      <label class="switch switch-sm">
        <input type="checkbox" class="ocr-order-checkbox" ${entry.enabled ? 'checked' : ''}>
        <span class="slider round"></span>
      </label>
      <span class="ocr-order-rank">${index + 1}</span>
      <span class="ocr-order-label">${OCR_STRATEGY_LABELS[entry.id] || entry.id}</span>
      <div class="ocr-order-controls">
        <button class="order-btn" data-dir="up" title="Naikkan" ${index === 0 ? 'disabled' : ''}>▲</button>
        <button class="order-btn" data-dir="down" title="Turunkan" ${index === config.length - 1 ? 'disabled' : ''}>▼</button>
      </div>
    `;

    item.querySelector('.ocr-order-checkbox').addEventListener('change', (e) => {
      entry.enabled = e.target.checked;
      saveOcrStrategyConfig(config);
    });

    item.querySelectorAll('.order-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const dir = btn.dataset.dir === 'up' ? -1 : 1;
        const swapWith = index + dir;
        if (swapWith < 0 || swapWith >= config.length) return;
        [config[index], config[swapWith]] = [config[swapWith], config[index]];
        saveOcrStrategyConfig(config);
        renderOcrOrderList(config);
      });
    });

    ocrOrderList.appendChild(item);
  });
}

function loadOcrOrderSettings() {
  chrome.storage.local.get({ ocrStrategyConfig: OCR_STRATEGY_DEFAULT_ORDER }, (data) => {
    const config = data.ocrStrategyConfig && data.ocrStrategyConfig.length
      ? data.ocrStrategyConfig
      : OCR_STRATEGY_DEFAULT_ORDER.map(e => ({ ...e }));
    renderOcrOrderList(config);
  });
}

resetOrderBtn.addEventListener('click', () => {
  const defaults = OCR_STRATEGY_DEFAULT_ORDER.map(e => ({ ...e }));
  saveOcrStrategyConfig(defaults);
  renderOcrOrderList(defaults);
});

document.addEventListener('DOMContentLoaded', loadPopupState);
document.addEventListener('DOMContentLoaded', loadOcrOrderSettings);
loadPopupState();
