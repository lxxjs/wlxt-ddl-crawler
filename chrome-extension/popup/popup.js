/**
 * Popup script: renders homework list, handles settings and export.
 */

import { getSettings, saveSettings, clampInterval } from '../lib/storage.js';
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

const VERSION = chrome.runtime.getManifest().version;
// Deadlines are shown in Beijing time; say so when this machine is elsewhere.
const TZ_NOTE = new Date().getTimezoneOffset() === -480 ? '' : ' 北京时间';

function formatUpdatedAt(timestamp) {
  const time = new Date(timestamp).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
  return `v${VERSION} · 更新: ${time}`;
}

/**
 * Explain anything that makes the list on screen less than fully current.
 */
function showFetchWarnings({ lastError, failedCourses }) {
  if (lastError === 'logging_in') {
    showStatus('会话已过期，正在后台自动登录…');
  } else if (lastError === 'network') {
    showStatus('无法连接网络学堂 — 以下为上次获取的数据', true);
  } else if (lastError === 'session_expired') {
    loginPrompt.classList.remove('hidden');
    showStatus('会话已过期 — 以下为上次获取的数据', true);
  } else if (lastError) {
    showStatus(`上次刷新失败，以下为旧数据: ${lastError}`, true);
  } else if (failedCourses?.length) {
    showStatus(`${failedCourses.length} 门课程获取失败，已保留旧数据: ${failedCourses.join('、')}`, true);
  }
}

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
  showFetchWarnings(response);

  updatedAtEl.textContent = response.updatedAt ? formatUpdatedAt(response.updatedAt) : `v${VERSION}`;
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

  if (result?.success) {
    currentHomework = result.homework;
    renderHomework(currentHomework);
    updatedAtEl.textContent = formatUpdatedAt(Date.now());
    showFetchWarnings(result);
  } else if (result?.error === 'logging_in') {
    showStatus('会话已过期，正在后台自动登录…');
  } else if (result?.error === 'network') {
    showStatus('无法连接网络学堂，请检查网络后重试', true);
  } else if (result?.error === 'session_expired') {
    loginPrompt.classList.remove('hidden');
    showStatus('会话已过期 — 请登录网络学堂，登录后会自动刷新', true);
  } else {
    // The list on screen (if any) is the previous successful fetch.
    showStatus(`获取失败: ${result?.error ?? '未知错误'}`, true);
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
  const deadlineText = hw.deadlineStr ? `${hw.deadlineStr}${TZ_NOTE}` : '无截止日期';
  const staleHtml = hw.stale ? ' <span class="stale-tag" title="本次刷新未能获取该课程，显示的是旧数据">旧</span>' : '';

  card.innerHTML = `
    <div class="homework-header">
      <span class="homework-title">${escapeHtml(hw.title)}${staleHtml}</span>
      <span class="homework-deadline ${deadlineClass}">
        ${escapeHtml(deadlineText)} ${timeLeftHtml}
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

// --- Saved credentials (status only — the popup never sees the password) ---

let savedUsername = '';

async function loadCredentialStatus() {
  const status = (await chrome.runtime.sendMessage({ type: 'GET_CREDENTIAL_STATUS' }))
    || { saved: false, username: '' };
  savedUsername = status.username;

  $('#input-password').placeholder = status.saved ? '已保存（留空则不修改）' : '密码';
  $('#credential-status').textContent = status.saved ? '账号已加密保存在本机' : '未保存账号';
  $('#btn-clear-credentials').classList.toggle('hidden', !status.saved);
  return status;
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
      // Populate fields. The saved password is never sent to the popup; the
      // field stays empty and "leave blank to keep" is the way to not change it.
      const [status, settings] = await Promise.all([loadCredentialStatus(), getSettings()]);
      $('#input-username').value = status.username;
      $('#input-password').value = '';
      $('#input-interval').value = settings.refreshInterval;
      $('#input-notifications').checked = settings.notifications;
      $('#input-autologin').checked = settings.autoLogin;
    }
  });

  // Save settings
  $('#btn-save-settings').addEventListener('click', async () => {
    const username = $('#input-username').value.trim();
    const password = $('#input-password').value;
    const interval = clampInterval($('#input-interval').value);
    const notifications = $('#input-notifications').checked;
    const autoLogin = $('#input-autologin').checked;

    if (password) {
      if (!username) {
        showStatus('请填写用户名', true);
        return;
      }
      const saved = await chrome.runtime.sendMessage({ type: 'SAVE_CREDENTIALS', username, password });
      if (!saved?.ok) {
        showStatus('账号保存失败', true);
        return;
      }
    } else if (username !== savedUsername) {
      // Without the password we cannot re-encrypt under a different username.
      showStatus(username ? '修改用户名时请同时输入密码' : '如需删除已保存的账号，请点击"清除账号"', true);
      return;
    }
    $('#input-password').value = '';

    await saveSettings({ refreshInterval: interval, notifications, autoLogin });
    chrome.runtime.sendMessage({ type: 'UPDATE_ALARM', interval });

    settingsPanel.classList.add('hidden');
    showStatus('设置已保存');
    setTimeout(hideStatus, 2000);
  });

  // Cancel settings
  $('#btn-cancel-settings').addEventListener('click', () => {
    $('#input-password').value = '';
    settingsPanel.classList.add('hidden');
  });

  // Delete the saved credentials
  $('#btn-clear-credentials').addEventListener('click', async () => {
    await chrome.runtime.sendMessage({ type: 'CLEAR_CREDENTIALS' });
    $('#input-password').value = '';
    $('#input-username').value = (await loadCredentialStatus()).username;
    showStatus('已清除保存的账号');
    setTimeout(hideStatus, 2000);
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
      updatedAtEl.textContent = formatUpdatedAt(Date.now());
      showFetchWarnings(message);
    }
  });
}
