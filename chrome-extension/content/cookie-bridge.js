/**
 * Content script for learn.tsinghua.edu.cn.
 * Reads XSRF-TOKEN from document.cookie (always works in page context)
 * and saves it to chrome.storage.local for the service worker to use.
 */
(function () {
  const cookies = {};
  document.cookie.split(';').forEach(c => {
    const [k, ...v] = c.trim().split('=');
    if (k) cookies[k] = v.join('=');
  });

  const xsrf = cookies['XSRF-TOKEN'];
  if (xsrf) {
    chrome.storage.local.set({ xsrfToken: xsrf });
  }
})();
