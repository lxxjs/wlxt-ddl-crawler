/**
 * Background service worker.
 * Handles alarm-based refresh, message routing, badge updates, and login detection.
 */

import { isSessionValid, LOGIN_SUCCESS_PATH, LOGIN_URL } from '../lib/auth.js';
import { getAllHomework } from '../lib/api.js';
import { saveHomeworkCache, getHomeworkCache, getSettings } from '../lib/storage.js';
import { urgencyLevel, formatTimeLeft } from '../lib/models.js';

const ALARM_NAME = 'refreshHomework';

// --- Alarm setup ---

chrome.runtime.onInstalled.addListener(async () => {
  const settings = await getSettings();
  chrome.alarms.create(ALARM_NAME, { periodInMinutes: settings.refreshInterval });
  await refreshHomework();
});

chrome.runtime.onStartup.addListener(async () => {
  const settings = await getSettings();
  chrome.alarms.create(ALARM_NAME, { periodInMinutes: settings.refreshInterval });
  await refreshHomework();
});

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === ALARM_NAME) {
    await refreshHomework();
  }
});

// --- Core refresh logic ---

async function refreshHomework() {
  try {
    const valid = await isSessionValid();

    if (!valid) {
      updateBadge('!', '#ff4757');
      return { success: false, error: 'session_expired' };
    }

    // Session is valid and CSRF token is now cached by isSessionValid()
    const homework = await getAllHomework();
    await saveHomeworkCache(homework);
    updateBadgeFromHomework(homework);
    await checkUrgentNotifications(homework);

    return { success: true, homework };
  } catch (e) {
    console.error('Refresh failed:', e);
    updateBadge('!', '#ff4757');
    return { success: false, error: e.message };
  }
}

// --- Badge ---

function updateBadge(text, color) {
  chrome.action.setBadgeText({ text: String(text) });
  chrome.action.setBadgeBackgroundColor({ color });
}

function updateBadgeFromHomework(homework) {
  const urgentCount = homework.filter(hw => {
    if (!hw.deadline) return false;
    return urgencyLevel(new Date(hw.deadline)) === 1;
  }).length;

  if (urgentCount > 0) {
    updateBadge(String(urgentCount), '#ff4757');
  } else {
    const activeCount = homework.filter(hw => {
      if (!hw.deadline) return true;
      return urgencyLevel(new Date(hw.deadline)) > 0;
    }).length;
    if (activeCount > 0) {
      updateBadge(String(activeCount), '#2ed573');
    } else {
      chrome.action.setBadgeText({ text: '' });
    }
  }
}

// --- Notifications ---

async function checkUrgentNotifications(homework) {
  const settings = await getSettings();
  if (!settings.notifications) return;

  const urgent = homework.filter(hw => {
    if (!hw.deadline) return false;
    return urgencyLevel(new Date(hw.deadline)) === 1;
  });

  if (urgent.length > 0) {
    chrome.notifications.create('urgent-homework', {
      type: 'basic',
      iconUrl: chrome.runtime.getURL('icons/icon128.png'),
      title: `${urgent.length} 项作业即将截止`,
      message: urgent.slice(0, 3).map(hw => `[${hw.courseName}] ${hw.title}`).join('\n'),
    });
  }
}

// --- Login detection via webNavigation ---

chrome.webNavigation.onCompleted.addListener(async (details) => {
  if (details.url.includes(LOGIN_SUCCESS_PATH) && details.frameId === 0) {
    console.log('Login detected, refreshing homework...');
    setTimeout(async () => {
      const result = await refreshHomework();
      chrome.runtime.sendMessage({ type: 'LOGIN_SUCCESS', ...result }).catch(() => {});
    }, 2000);
  }
}, { url: [{ hostContains: 'learn.tsinghua.edu.cn' }] });

// --- Message handling ---

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'REFRESH') {
    refreshHomework().then(sendResponse);
    return true;
  }

  if (message.type === 'GET_HOMEWORK') {
    getHomeworkCache().then(cache => {
      if (cache?.homework) {
        const refreshed = cache.homework.map(hw => ({
          ...hw,
          timeLeft: hw.deadline ? formatTimeLeft(new Date(hw.deadline)) : '',
          urgency: hw.deadline ? urgencyLevel(new Date(hw.deadline)) : 5,
        }));
        sendResponse({ homework: refreshed, updatedAt: cache.updatedAt });
      } else {
        sendResponse({ homework: null, updatedAt: null });
      }
    });
    return true;
  }

  if (message.type === 'OPEN_LOGIN') {
    chrome.tabs.create({ url: LOGIN_URL });
    sendResponse({ ok: true });
    return false;
  }

  if (message.type === 'UPDATE_ALARM') {
    chrome.alarms.clear(ALARM_NAME, () => {
      chrome.alarms.create(ALARM_NAME, { periodInMinutes: message.interval });
    });
    sendResponse({ ok: true });
    return false;
  }
});
