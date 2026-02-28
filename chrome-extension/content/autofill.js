/**
 * Content script for id.tsinghua.edu.cn.
 * Auto-fills saved credentials but does NOT auto-submit (user clicks login for 2FA).
 */

(async () => {
  // Only run on login pages
  if (!window.location.href.includes('/do/off/ui/auth/login')) return;

  try {
    const result = await chrome.storage.local.get('credentials');
    const creds = result.credentials;
    if (!creds?.username || !creds?.password) return;

    // Wait for form inputs to appear
    const usernameInput = await waitForElement('input[name="i_user"], input[name="userName"], #i_user, #userName');
    const passwordInput = await waitForElement('input[name="i_pass"], input[name="password"], #i_pass, #password');

    if (usernameInput && passwordInput) {
      fillInput(usernameInput, creds.username);
      fillInput(passwordInput, creds.password);
    }
  } catch (e) {
    console.warn('[wlxt-reminder] autofill error:', e);
  }
})();

/**
 * Fill an input field and dispatch events so frameworks detect the change.
 */
function fillInput(el, value) {
  el.focus();
  el.value = value;
  el.dispatchEvent(new Event('input', { bubbles: true }));
  el.dispatchEvent(new Event('change', { bubbles: true }));
}

/**
 * Wait for an element matching the selector to appear in the DOM.
 */
function waitForElement(selector, timeout = 5000) {
  return new Promise((resolve) => {
    // Check if already present
    const el = document.querySelector(selector);
    if (el) { resolve(el); return; }

    const observer = new MutationObserver(() => {
      const el = document.querySelector(selector);
      if (el) {
        observer.disconnect();
        resolve(el);
      }
    });

    observer.observe(document.body, { childList: true, subtree: true });

    setTimeout(() => {
      observer.disconnect();
      resolve(document.querySelector(selector));
    }, timeout);
  });
}
