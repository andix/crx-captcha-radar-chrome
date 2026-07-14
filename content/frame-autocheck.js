// Runs only inside the reCAPTCHA / Cloudflare Turnstile challenge iframes themselves
// (see manifest.json's matches for this file, scoped to those origins with all_frames).
// All it does is click the same checkbox a user would click by hand — it does not try
// to solve any follow-up image puzzle or otherwise interfere with the risk-analysis
// Google/Cloudflare run after the click.

function clickIfUnchecked(el) {
  if (!el) return false;
  const alreadyChecked = el.getAttribute('aria-checked') === 'true' || el.checked === true;
  if (alreadyChecked) return false;
  el.click();
  return true;
}

function tryAutoCheck() {
  chrome.storage.local.get({ extensionEnabled: true }, (items) => {
    if (!items.extensionEnabled) return;

    // Classic reCAPTCHA v2 checkbox anchor
    const recaptchaAnchor = document.getElementById('recaptcha-anchor');
    if (recaptchaAnchor) {
      clickIfUnchecked(recaptchaAnchor);
      return;
    }

    // Cloudflare Turnstile — the interactive widget exposes a real checkbox input in
    // most builds; fully canvas-rendered variants have nothing clickable and are left alone.
    const turnstileCheckbox = document.querySelector('input[type="checkbox"]');
    if (turnstileCheckbox) {
      clickIfUnchecked(turnstileCheckbox);
      return;
    }
    const turnstileLabel = document.querySelector('#success, .cb-i, label');
    if (turnstileLabel) turnstileLabel.click();
  });
}

setTimeout(tryAutoCheck, 700); // give the widget time to render before the first attempt

const frameObserver = new MutationObserver(() => tryAutoCheck());
frameObserver.observe(document.documentElement, { childList: true, subtree: true });
setTimeout(() => frameObserver.disconnect(), 20000); // stop watching after 20s either way
