# Captcha Radar

A Chrome extension (Manifest V3) that detects captchas on web pages in real time, reads image-based captcha text using OCR, and auto-fills the matching input field.

## Features

- **Real-time detection** for Google reCAPTCHA, hCaptcha, Cloudflare Turnstile, GeeTest, Arkoselabs FunCaptcha, and generic image/keyword-based captchas.
- **In-page popup** (Shadow DOM) that appears as soon as a captcha is detected, showing the captcha type and reading status.
- **Image captcha OCR** using [Tesseract.js](https://github.com/naptha/tesseract.js), with a configurable reading-strategy pipeline whose order and enabled/disabled state can be adjusted from the extension popup (contrast stretch, denoise, invert, Otsu binarization, etc.).
- **Auto-fill** OCR results into inputs labeled `captcha`, `security code`, `verification code`, `random`, and other similar variations — a manual fill button and a re-read button are also available.
- **Auto-check** for reCAPTCHA v2 / Cloudflare Turnstile checkboxes (mimics the single click a user would normally perform; it does not attempt to solve any further puzzle/challenge).
- **Per-site detection history**, stored in `chrome.storage.local`, clearable from the popup.
- Global enable/disable toggle for the radar.

## Project Structure

```
manifest.json              # Extension configuration (Manifest V3)
background.js               # Service worker: badge, per-tab detection history
content/
  content.js                 # Captcha detection, OCR, in-page popup, autofill
  frame-autocheck.js          # Auto-clicks the checkbox inside reCAPTCHA/Turnstile iframes
lib/
  ocr-strategies.js           # Default list & order of OCR strategies (used by popup + content script)
  tesseract/                  # Tesseract.js (worker, core wasm, English language model)
popup/
  popup.html / popup.js / popup.css   # Popup UI: status, history, OCR order settings
icons/                       # Extension icons
generate_icons.py            # Icon generation script
```

## Installation (Load Unpacked)

1. Open `chrome://extensions`.
2. Enable **Developer mode** (top right).
3. Click **Load unpacked** and select this project folder.
4. Open any page containing a captcha to test it.

## OCR Reading Order Settings

Click the extension icon → **"OCR Reading Order"** section:

- Enable/disable a strategy via its toggle.
- Reorder strategies with the ▲▼ buttons. If the top strategy fails to read the text, the system automatically falls through to the next one in order.
- The **Reset** button restores the default order.

## Notes

- OCR and autofill are *best-effort*; accuracy depends on the quality/style of the captcha on each site.
- The reCAPTCHA/Turnstile auto-check only replicates the initial checkbox click — it does not solve any further risk-analysis verification from Google or Cloudflare.
