/**
 * Popup script: renders homework list, handles settings and export.
 */

import { getCredentials, saveCredentials, getSettings, saveSettings } from '../lib/storage.js';
import { generateTextList, downloadICS } from '../lib/export.js';

// DOM elements
const $ = (sel) => document.querySelector(sel);
const statUrgent = $('#stat-urgent');
const statActive = $('#stat-active');
const statExpired = $('#stat-expired');
const statusBar = $('#status-bar');
const loginPrompt = $('#login-prompt');
const homeworkListEl = $('#homework-list');
const emptyState = $('#empty-state');
const updatedAtEl = $('#updated-at');
const settingsPanel = $('#settings-panel');

let currentHomework = [];

// --- Init ---

document.addEventListener('DOMContentLoaded', async () => {
  await loadHomework();
  setupListeners();
});

async function loadHomework() {
  const response = await chrome.runtime.sendMessage({ type: 'GET_HOMEWORK' });

  if (!response || response.homework === null) {
    // No cache yet — auto-refresh so the user doesn't have to click manually
    await doRefresh();
    return;
  }

  currentHomework = response.homework;
  renderHomework(currentHomework);

  if (response.updatedAt) {
    const date = new Date(response.updatedAt);
    updatedAtEl.textContent = `更新: ${date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}`;
  }
}

/**
 * Trigger a homework refresh. Used both on initial load (no cache) and when
 * the user clicks the refresh button.
 */
async function doRefresh() {
  const btn = $('#btn-refresh');
  btn.classList.add('spinning');
  showStatus('正在获取作业...');

  const result = await chrome.runtime.sendMessage({ type: 'REFRESH' });

  btn.classList.remove('spinning');

  if (result.success) {
    currentHomework = result.homework;
    renderHomework(currentHomework);
    updatedAtEl.textContent = `v1.1.0 · 更新: ${new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}`;
    hideStatus();
  } else if (result.error === 'session_expired') {
    loginPrompt.classList.remove('hidden');
    showStatus('会话已过期 — 请在浏览器中登录网络学堂，然后点击刷新', true);
  } else {
    showStatus(`获取失败: ${result.error}`, true);
  }

  return result;
}

// --- Render ---

function renderHomework(homework) {
  // Split into active and expired
  const active = homework.filter(hw => hw.urgency > 0);
  const expired = homework.filter(hw => hw.urgency === 0);

  // Stats
  const urgentCount = homework.filter(hw => hw.urgency === 1).length;
  statUrgent.textContent = urgentCount;
  statActive.textContent = active.length;
  statExpired.textContent = expired.length;

  // Clear
  homeworkListEl.innerHTML = '';
  hideStatus();
  loginPrompt.classList.add('hidden');

  if (active.length === 0 && expired.length === 0) {
    emptyState.classList.remove('hidden');
    return;
  }
  emptyState.classList.add('hidden');

  // Render active
  for (const hw of active) {
    homeworkListEl.appendChild(createCard(hw));
  }

  // Render expired (collapsed section)
  if (expired.length > 0) {
    const divider = document.createElement('div');
    divider.className = 'section-divider';
    divider.textContent = `已过期 (${expired.length})`;
    homeworkListEl.appendChild(divider);

    for (const hw of expired) {
      homeworkListEl.appendChild(createCard(hw));
    }
  }
}

function createCard(hw) {
  const card = document.createElement('div');
  card.className = 'homework-card';

  // Urgency class
  if (hw.urgency === 0) card.classList.add('expired');
  else if (hw.urgency === 1) card.classList.add('urgent');
  else if (hw.urgency === 2) card.classList.add('warning');
  else if (hw.urgency <= 3) card.classList.add('normal');

  const deadlineClass = hw.urgency === 1 ? 'urgent' : hw.urgency === 2 ? 'warning' : '';
  const timeLeftHtml = hw.timeLeft ? `<span class="time-left">(${escapeHtml(hw.timeLeft)})</span>` : '';

  card.innerHTML = `
    <div class="homework-header">
      <span class="homework-title">${escapeHtml(hw.title)}</span>
      <span class="homework-deadline ${deadlineClass}">
        ${escapeHtml(hw.deadlineStr || '无截止日期')} ${timeLeftHtml}
      </span>
    </div>
    <div class="homework-course">${escapeHtml(hw.courseName)}</div>
  `;

  return card;
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str || '';
  return div.innerHTML;
}

// --- Status helpers ---

function showStatus(msg, isError = false) {
  statusBar.textContent = msg;
  statusBar.classList.remove('hidden', 'error');
  if (isError) statusBar.classList.add('error');
}

function hideStatus() {
  statusBar.classList.add('hidden');
}

// --- Event listeners ---

function setupListeners() {
  // Refresh
  $('#btn-refresh').addEventListener('click', () => doRefresh());

  // Login
  $('#btn-login').addEventListener('click', () => {
    chrome.runtime.sendMessage({ type: 'OPEN_LOGIN' });
  });

  // Settings toggle
  $('#btn-settings').addEventListener('click', async () => {
    const isHidden = settingsPanel.classList.contains('hidden');
    settingsPanel.classList.toggle('hidden');

    if (isHidden) {
      // Populate fields
      const creds = await getCredentials();
      const settings = await getSettings();
      $('#input-username').value = creds?.username || '';
      $('#input-password').value = creds?.password || '';
      $('#input-interval').value = settings.refreshInterval;
      $('#input-notifications').checked = settings.notifications;
    }
  });

  // Save settings
  $('#btn-save-settings').addEventListener('click', async () => {
    const username = $('#input-username').value.trim();
    const password = $('#input-password').value;
    const interval = parseInt($('#input-interval').value) || 30;
    const notifications = $('#input-notifications').checked;

    if (username && password) {
      await saveCredentials(username, password);
    }

    await saveSettings({ refreshInterval: interval, notifications });
    chrome.runtime.sendMessage({ type: 'UPDATE_ALARM', interval });

    settingsPanel.classList.add('hidden');
    showStatus('设置已保存');
    setTimeout(hideStatus, 2000);
  });

  // Cancel settings
  $('#btn-cancel-settings').addEventListener('click', () => {
    settingsPanel.classList.add('hidden');
  });

  // Copy to clipboard
  $('#btn-copy').addEventListener('click', async () => {
    if (!currentHomework.length) return;
    const text = generateTextList(currentHomework);
    await navigator.clipboard.writeText(text);
    showStatus('已复制到剪贴板');
    setTimeout(hideStatus, 2000);
  });

  // Export ICS
  $('#btn-ics').addEventListener('click', () => {
    if (!currentHomework.length) return;
    downloadICS(currentHomework);
  });

  // Listen for login success from background
  chrome.runtime.onMessage.addListener((message) => {
    if (message.type === 'LOGIN_SUCCESS' && message.success) {
      currentHomework = message.homework || [];
      renderHomework(currentHomework);
      loginPrompt.classList.add('hidden');
      hideStatus();
    }
  });
}
