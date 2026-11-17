/**
 * Content script for id.tsinghua.edu.cn login pages.
 *
 * 1. Records the device fingerprint the login page computes, so the service
 *    worker can later restore an expired session without a password
 *    (see trySilentLogin in lib/auth.js).
 * 2. Auto-fills saved credentials.
 * 3. Submits the form ONLY when the service worker opened this tab for a
 *    background auto login. On a page the user opened, they click login.
 * 4. In a background login tab, reports anything only the user can resolve
 *    (2FA, captcha, wrong password) back to the service worker.
 */

(async () => {
  // Only run on login pages
  if (!window.location.href.includes('/do/off/ui/auth/login')) return;

  captureFingerprint();

  // Ask the service worker whether this tab is its background login tab.
  let ctx = { pending: false, autoSubmit: false };
  try {
    ctx = (await chrome.runtime.sendMessage({ type: 'LOGIN_PAGE_READY' })) || ctx;
  } catch (e) {
    // Service worker unavailable — behave like a normal user-opened page.
  }

  try {
    if (ctx.pending) {
      // A captcha can be demanded up front; the rest only shows after submit.
      const blocker = detectBlocker({ afterSubmit: !ctx.autoSubmit });
      if (blocker) {
        reportNeedsUser(blocker);
        return;
      }
    }

    const result = await chrome.storage.local.get('credentials');
    const creds = result.credentials;
    if (!creds?.username || !creds?.password) return;

    // Wait for form inputs to appear
    const usernameInput = await waitForElement('input[name="i_user"], input[name="userName"], #i_user, #userName');
    const passwordInput = await waitForElement('input[name="i_pass"], input[name="password"], #i_pass, #password');

    if (!usernameInput || !passwordInput) {
      // After a successful submit there is no form: that is the redirect page.
      return;
    }

    fillInput(usernameInput, creds.username);
    fillInput(passwordInput, creds.password);

    if (ctx.autoSubmit) {
      // The page's own script encrypts the password and adds the fingerprint.
      await waitForFingerprint();
      await saveFingerprint(); // the click navigates away, so store it first
      const button = document.querySelector(
        '#theform a.btn, #theform [type="submit"], form [type="submit"]'
      );
      if (button) {
        button.click();
      } else {
        reportNeedsUser('unknown');
      }
    }
  } catch (e) {
    console.warn('[wlxt-reminder] autofill error:', e);
  }
})();

function reportNeedsUser(reason) {
  chrome.runtime.sendMessage({ type: 'LOGIN_NEEDS_USER', reason }).catch(() => {});
}

function isShown(el) {
  return !!el && !el.classList.contains('hidden') && getComputedStyle(el).display !== 'none';
}

/**
 * Detect a page state that automation must not push through.
 * Returns 'captcha' | 'two_factor' | 'bad_credentials' | 'unknown' | null.
 */
function detectBlocker({ afterSubmit }) {
  if (isShown(document.querySelector('#c_code'))) return 'captcha';
  if (!afterSubmit) return null;

  if (document.body?.innerText.includes('二次认证')) return 'two_factor';
  if (isShown(document.querySelector('#c_note'))) return 'bad_credentials';

  // We already submitted once and are looking at the login form again.
  if (document.querySelector('#i_user, input[name="i_user"]')) return 'unknown';
  return null;
}

function readFingerprint() {
  const read = (name) =>
    document.querySelector(`#${name}, input[name="${name}"]`)?.value || '';
  return {
    fingerPrint: read('fingerPrint'),
    fingerGenPrint: read('fingerGenPrint'),
    fingerGenPrint3: read('fingerGenPrint3'),
  };
}

let lastSavedFingerprint = '';

/**
 * Store the page's fingerprint fields if they are filled in and changed.
 */
async function saveFingerprint() {
  const fp = readFingerprint();
  const serialized = JSON.stringify(fp);
  if (!fp.fingerPrint || serialized === lastSavedFingerprint) return;

  lastSavedFingerprint = serialized;
  await chrome.storage.local.set({ fingerprint: fp }).catch(() => {});
}

/**
 * The page fills its hidden fingerprint fields asynchronously. Poll for a
 * while, and also store them at the moment the user logs in.
 */
function captureFingerprint() {
  let ticks = 0;
  const timer = setInterval(() => {
    ticks += 1;
    saveFingerprint();
    if (ticks >= 50) clearInterval(timer); // ~15s (longer in a background tab)
  }, 300);

  // Capture phase, so this runs before the page's own handler navigates away.
  document.addEventListener('click', (e) => {
    if (e.target.closest?.('#theform a.btn, #theform [type="submit"]')) saveFingerprint();
  }, true);
  document.addEventListener('submit', () => saveFingerprint(), true);
}

function waitForFingerprint(timeout = 8000) {
  return new Promise((resolve) => {
    const started = Date.now();
    const timer = setInterval(() => {
      if (readFingerprint().fingerPrint || Date.now() - started > timeout) {
        clearInterval(timer);
        resolve();
      }
    }, 200);
  });
}

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
