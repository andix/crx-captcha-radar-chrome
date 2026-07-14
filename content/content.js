// Config & state
let extensionEnabled = true;
let detectedCaptchas = new Map(); // Store detected captchas with their details {type, selector, timestamp}
let shadowRootElement = null;
let popupVisible = false;
let lastOcrImageEl = null;

// Color maps and logos for captcha types
const CAPTCHA_THEMES = {
  'Google reCAPTCHA': {
    color: '#4285F4',
    logo: '🤖',
    desc: 'Google reCAPTCHA terdeteksi di halaman ini.'
  },
  'hCaptcha': {
    color: '#00E8C6',
    logo: '🛡️',
    desc: 'hCaptcha terdeteksi di halaman ini.'
  },
  'Cloudflare Turnstile': {
    color: '#F38020',
    logo: '🌀',
    desc: 'Cloudflare Turnstile terdeteksi di halaman ini.'
  },
  'GeeTest': {
    color: '#EA4335',
    logo: '⚙️',
    desc: 'GeeTest Captcha terdeteksi di halaman ini.'
  },
  'Arkoselabs FunCaptcha': {
    color: '#8A2BE2',
    logo: '🎮',
    desc: 'FunCaptcha terdeteksi di halaman ini.'
  },
  'Generic Captcha': {
    color: '#10B981',
    logo: '🧩',
    desc: 'Elemen Captcha umum terdeteksi di halaman ini.'
  }
};

// Check for captcha elements on the page
function scanForCaptchas() {
  if (!extensionEnabled) return;

  const currentScans = [
    // Google reCAPTCHA
    {
      type: 'Google reCAPTCHA',
      selector: 'iframe[src*="google.com/recaptcha"]',
    },
    {
      type: 'Google reCAPTCHA',
      selector: 'iframe[src*="recaptcha.net"]',
    },
    {
      type: 'Google reCAPTCHA',
      selector: '.g-recaptcha',
    },
    // hCaptcha
    {
      type: 'hCaptcha',
      selector: 'iframe[src*="hcaptcha.com"]',
    },
    {
      type: 'hCaptcha',
      selector: '.h-captcha',
    },
    // Cloudflare Turnstile
    {
      type: 'Cloudflare Turnstile',
      selector: 'iframe[src*="challenges.cloudflare.com"]',
    },
    {
      type: 'Cloudflare Turnstile',
      selector: '.cf-turnstile',
    },
    // GeeTest
    {
      type: 'GeeTest',
      selector: '[class*="geetest_"]',
    },
    {
      type: 'GeeTest',
      selector: 'iframe[src*="geetest.com"]',
    },
    // Arkoselabs FunCaptcha
    {
      type: 'Arkoselabs FunCaptcha',
      selector: 'iframe[src*="funcaptcha.com"]',
    },
    {
      type: 'Arkoselabs FunCaptcha',
      selector: 'iframe[src*="arkoselabs.com"]',
    },
    // Generic / custom captcha (image-based, keyword driven)
    {
      type: 'Generic Captcha',
      selector: 'img[alt*="captcha" i], img[title*="captcha" i], img[src*="captcha" i]',
    },
    {
      type: 'Generic Captcha',
      selector: '[class*="captcha" i], [id*="captcha" i]',
    },
    {
      type: 'Generic Captcha',
      selector: 'input[placeholder*="captcha" i], input[placeholder*="kode keamanan" i], input[name*="captcha" i]',
    }
  ];

  let foundNew = false;
  let newType = '';

  currentScans.forEach(scan => {
    const elements = document.querySelectorAll(scan.selector);
    elements.forEach(el => {
      // Avoid duplicate detection of same element
      let uniqueId = el.id || el.src || scan.selector;
      if (!detectedCaptchas.has(uniqueId)) {
        detectedCaptchas.set(uniqueId, {
          type: scan.type,
          timestamp: Date.now()
        });
        foundNew = true;
        newType = scan.type;
        console.log(`[Captcha Detector] Terdeteksi: ${scan.type}`, el);
      }
    });
  });

  if (foundNew) {
    updateBadge();
    showInPagePopup(newType);
  }

  scanForCaptchaImages();
}

// --- OCR (Tesseract.js) for image-based / generic captchas ---
const CAPTCHA_IMAGE_SELECTOR = 'img[alt*="captcha" i], img[title*="captcha" i], img[src*="captcha" i]';
const lastOcrSrc = new WeakMap(); // img element -> last processed src (avoids re-OCR on unchanged image)
let ocrWorkerPromise = null;

function getSiteOcrConfig() {
  return {
    whitelist: 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789',
    length: null
  };
}

function getOcrWorker() {
  if (!ocrWorkerPromise) {
    const siteConfig = getSiteOcrConfig();
    ocrWorkerPromise = Tesseract.createWorker('eng', 1, {
      workerPath: chrome.runtime.getURL('lib/tesseract/worker.min.js'),
      corePath: chrome.runtime.getURL('lib/tesseract/tesseract-core-simd-lstm.wasm.js'),
      langPath: chrome.runtime.getURL('lib/tesseract/'),
      gzip: true
    }).then(async (worker) => {
      // Captcha text is a single short line/word, not a full page of text —
      // constraining PSM + whitelist cuts down a lot of misreads.
      await worker.setParameters({
        tessedit_pageseg_mode: '7', // PSM.SINGLE_LINE
        tessedit_char_whitelist: siteConfig.whitelist
      });
      return worker;
    });
  }
  return ocrWorkerPromise;
}

// 3x3 median filter — knocks out the speckle noise / thin distractor lines captchas add,
// without blurring letter strokes away the way a mean blur would.
function medianDenoise(gray, width, height) {
  const out = new Uint8ClampedArray(gray.length);
  const window = new Array(9);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      let n = 0;
      for (let dy = -1; dy <= 1; dy += 1) {
        const yy = Math.min(height - 1, Math.max(0, y + dy));
        for (let dx = -1; dx <= 1; dx += 1) {
          const xx = Math.min(width - 1, Math.max(0, x + dx));
          window[n] = gray[yy * width + xx];
          n += 1;
        }
      }
      window.sort((a, b) => a - b);
      out[y * width + x] = window[4];
    }
  }
  return out;
}

// Shared first step for every enhancement variant: upscale onto a canvas and convert to
// grayscale. Returns the canvas/ctx/imageData so callers just need to fill in `data` and
// call ctx.putImageData before reading toDataURL.
function rasterizeGrayscale(img, scale) {
  const width = (img.naturalWidth || img.width) * scale;
  const height = (img.naturalHeight || img.height) * scale;
  if (!width || !height) {
    throw new Error('Captcha image has zero dimensions (not decoded yet)');
  }

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(img, 0, 0, width, height);

  const imageData = ctx.getImageData(0, 0, width, height);
  const data = imageData.data;

  const gray = new Uint8ClampedArray(width * height);
  for (let i = 0, p = 0; i < data.length; i += 4, p += 1) {
    gray[p] = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
  }

  return { canvas, ctx, imageData, data, gray, width, height };
}

// Method 1: upscale + grayscale + contrast-stretch (no hard black/white cutoff — Tesseract
// already does its own adaptive binarization internally, and a crude global threshold on
// top of that tends to erase strokes or fuse them with noise instead of helping).
// invert=true produces a light-text-on-dark-background version, for captchas styled that way.
// denoise=true runs a median filter first, for captchas with speckle/line noise.
function enhanceCaptchaImage(img, { invert = false, denoise = false, scale = 3 } = {}) {
  let { ctx, imageData, data, gray, width, height } = rasterizeGrayscale(img, scale);

  if (denoise) gray = medianDenoise(gray, width, height);

  let min = 255;
  let max = 0;
  for (let p = 0; p < gray.length; p += 1) {
    if (gray[p] < min) min = gray[p];
    if (gray[p] > max) max = gray[p];
  }
  const range = Math.max(max - min, 1); // avoid divide-by-zero on flat images

  for (let i = 0, p = 0; i < data.length; i += 4, p += 1) {
    let value = ((gray[p] - min) / range) * 255; // stretch contrast to fill 0-255
    if (invert) value = 255 - value;
    data[i] = data[i + 1] = data[i + 2] = value;
  }

  ctx.putImageData(imageData, 0, 0);
  return ctx.canvas.toDataURL('image/png');
}

// Otsu's method: picks the threshold that best splits the grayscale histogram into two
// classes (ink vs. background), which contrast-stretching alone can't do for captchas
// with gradient/colorful backgrounds where "light" and "dark" span a continuous range.
function otsuThreshold(gray) {
  const histogram = new Array(256).fill(0);
  for (let p = 0; p < gray.length; p += 1) histogram[gray[p]] += 1;

  const total = gray.length;
  let sum = 0;
  for (let t = 0; t < 256; t += 1) sum += t * histogram[t];

  let sumBackground = 0;
  let weightBackground = 0;
  let maxVariance = 0;
  let threshold = 127;

  for (let t = 0; t < 256; t += 1) {
    weightBackground += histogram[t];
    if (weightBackground === 0) continue;
    const weightForeground = total - weightBackground;
    if (weightForeground === 0) break;

    sumBackground += t * histogram[t];
    const meanBackground = sumBackground / weightBackground;
    const meanForeground = (sum - sumBackground) / weightForeground;
    const betweenVariance = weightBackground * weightForeground * (meanBackground - meanForeground) ** 2;

    if (betweenVariance > maxVariance) {
      maxVariance = betweenVariance;
      threshold = t;
    }
  }

  return threshold;
}

// Method 2 (fallback): median-denoise + Otsu binarization to a hard black/white image.
// Used only when Method 1's contrast-stretch variants come back unreadable — a different
// way of separating text from background that catches gradient/noisy captchas the other
// approach misses.
function enhanceCaptchaImageBinary(img, { invert = false, scale = 4 } = {}) {
  const { ctx, imageData, data, gray: rawGray, width, height } = rasterizeGrayscale(img, scale);
  const gray = medianDenoise(rawGray, width, height);
  const threshold = otsuThreshold(gray);

  for (let i = 0, p = 0; i < data.length; i += 4, p += 1) {
    let value = gray[p] >= threshold ? 255 : 0;
    if (invert) value = 255 - value;
    data[i] = data[i + 1] = data[i + 2] = value;
  }

  ctx.putImageData(imageData, 0, 0);
  return ctx.canvas.toDataURL('image/png');
}

function scanForCaptchaImages() {
  if (typeof Tesseract === 'undefined') return;

  document.querySelectorAll(CAPTCHA_IMAGE_SELECTOR).forEach(img => {
    if (!img.src) return;
    if (lastOcrSrc.get(img) === img.src) return; // already processed this exact image
    lastOcrSrc.set(img, img.src);
    processCaptchaImageOcr(img);
  });
}

// Fetch the exact bytes currently shown, once, so every OCR pass (including the
// raw fallback) reads the same image. Letting Tesseract fetch img.src itself risks
// "Unknown format: no pix returned" on sites with one-time-use captcha endpoints:
// the endpoint issues a fresh/invalidated image on each request, so a second network
// fetch can come back as something other than the image the user saw.
async function fetchCaptchaBlob(img) {
  try {
    const response = await fetch(img.currentSrc || img.src, { credentials: 'include' });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const blob = await response.blob();
    if (!blob.type.startsWith('image/')) throw new Error(`Unexpected content-type: ${blob.type}`);
    return blob;
  } catch (err) {
    console.warn('[Captcha Detector] Gagal mengambil ulang bytes gambar captcha, pakai elemen <img> langsung:', err);
    return null;
  }
}

// Decode a Blob into an <img> we fully control (never tainted for canvas use,
// since we already own the bytes rather than relying on the browser's original
// cross-origin image load).
function blobToImage(blob) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob);
    const image = new Image();
    image.onload = () => { URL.revokeObjectURL(url); resolve(image); };
    image.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Gagal mendekode bytes captcha yang diambil')); };
    image.src = url;
  });
}

// Wait until the browser has actually decoded the image. Running OCR against an
// img with naturalWidth/naturalHeight still 0 produces a blank canvas, which is
// what causes Tesseract's "Unknown format: no pix returned" error.
async function ensureImageLoaded(img) {
  if (img.complete && img.naturalWidth > 0) return true;

  if (img.decode) {
    try {
      await img.decode();
      if (img.naturalWidth > 0) return true;
    } catch (e) {
      // fall through to the load/error listener below
    }
  }

  return new Promise((resolve) => {
    const cleanup = () => {
      img.removeEventListener('load', onLoad);
      img.removeEventListener('error', onError);
    };
    const onLoad = () => { cleanup(); resolve(img.naturalWidth > 0); };
    const onError = () => { cleanup(); resolve(false); };
    img.addEventListener('load', onLoad);
    img.addEventListener('error', onError);
    // Safety timeout in case neither event fires (e.g. src already swapped again)
    setTimeout(() => { cleanup(); resolve(img.naturalWidth > 0); }, 1500);
  });
}

// Soft budget: spend up to this long trying candidates before settling — accuracy over
// raw speed, but still bounded so the popup doesn't spin forever.
const OCR_TIME_BUDGET_MS = 7000;

// Builders for every selectable strategy in Pengaturan > Urutan Pembacaan OCR (see
// lib/ocr-strategies.js for the id/label list shared with the popup UI). Each returns
// { source, psm } or null if not applicable (e.g. raw_blob with no fetched blob).
const OCR_STRATEGY_BUILDERS = {
  contrast_s3: (sourceImg) => ({ source: enhanceCaptchaImage(sourceImg, { invert: false, denoise: false, scale: 3 }), psm: '7' }),
  contrast_invert_s3: (sourceImg) => ({ source: enhanceCaptchaImage(sourceImg, { invert: true, denoise: false, scale: 3 }), psm: '7' }),
  contrast_denoise_s3: (sourceImg) => ({ source: enhanceCaptchaImage(sourceImg, { invert: false, denoise: true, scale: 3 }), psm: '7' }),
  contrast_s4: (sourceImg) => ({ source: enhanceCaptchaImage(sourceImg, { invert: false, denoise: false, scale: 4 }), psm: '7' }),
  contrast_invert_denoise_s4: (sourceImg) => ({ source: enhanceCaptchaImage(sourceImg, { invert: true, denoise: true, scale: 4 }), psm: '7' }),
  raw_blob: (sourceImg, blob) => (blob ? { source: blob, psm: '7' } : null),
  otsu_s4: (sourceImg) => ({ source: enhanceCaptchaImageBinary(sourceImg, { invert: false, scale: 4 }), psm: '8' }),
  otsu_invert_s4: (sourceImg) => ({ source: enhanceCaptchaImageBinary(sourceImg, { invert: true, scale: 4 }), psm: '8' }),
  otsu_s5: (sourceImg) => ({ source: enhanceCaptchaImageBinary(sourceImg, { invert: false, scale: 5 }), psm: '8' })
};

function getOcrStrategyConfig() {
  return new Promise((resolve) => {
    chrome.storage.local.get({ ocrStrategyConfig: OCR_STRATEGY_DEFAULT_ORDER }, (items) => {
      resolve(items.ocrStrategyConfig && items.ocrStrategyConfig.length ? items.ocrStrategyConfig : OCR_STRATEGY_DEFAULT_ORDER);
    });
  });
}

// Run OCR over the user-ordered list of candidates, keeping the best-scoring readable
// result. Trying the next enabled strategy when one comes back unreadable is exactly
// what this loop already does (the `if (!cleaned) continue` below) — the settings UI
// just lets the user pick which strategies run and in what order.
async function runOcrCandidates(worker, candidates, siteConfig, stripRegex, timeBudgetMs) {
  let best = null;
  let currentPsm = null;
  const startTime = performance.now();

  for (const candidate of candidates) {
    if (performance.now() - startTime >= timeBudgetMs) break; // respect the read time budget

    try {
      if (candidate.psm && candidate.psm !== currentPsm) {
        await worker.setParameters({ tessedit_pageseg_mode: candidate.psm });
        currentPsm = candidate.psm;
      }
      const { data } = await worker.recognize(candidate.source);
      const cleaned = data.text.replace(stripRegex, '').trim();
      if (!cleaned) continue;

      // On sites with a known fixed length, an exact-length match beats raw confidence —
      // a 5-digit site will never legitimately produce a 3 or 7 character result.
      const matchesExpectedLength = siteConfig.length ? cleaned.length === siteConfig.length : false;
      const score = data.confidence + (matchesExpectedLength ? 1000 : 0);

      if (!best || score > best.score) {
        best = { cleaned, score, strategyId: candidate.id };
      }

      // Already found a confident, correctly-sized match — no need to burn the rest of the budget.
      if (matchesExpectedLength && data.confidence >= 85) break;
    } catch (recognizeErr) {
      console.warn(`[Captcha Detector] Strategi "${candidate.id}" gagal:`, recognizeErr);
    }
  }

  return best;
}

async function processCaptchaImageOcr(img) {
  updateOcrStatus('Membaca teks captcha...', true);

  const loaded = await ensureImageLoaded(img);
  if (!loaded) {
    console.warn('[Captcha Detector] Gambar captcha gagal dimuat, OCR dilewati.');
    updateOcrStatus('Gagal memuat gambar captcha.', false, img);
    return;
  }

  // Grab the exact bytes once; reuse them for every variant below instead of letting
  // Tesseract re-fetch img.src later (see fetchCaptchaBlob for why that's unsafe).
  const blob = await fetchCaptchaBlob(img);
  let sourceImg = img;
  if (blob) {
    try {
      sourceImg = await blobToImage(blob);
    } catch (decodeErr) {
      console.warn('[Captcha Detector] Gagal mendekode blob captcha, pakai elemen <img> langsung:', decodeErr);
    }
  }

  // Build the candidate list in the user-configured order (Pengaturan > Urutan Pembacaan
  // OCR in the popup), skipping disabled strategies and any that fail to build individually
  // (e.g. cross-origin taint on the raw <img> when the blob fetch also failed).
  const strategyConfig = await getOcrStrategyConfig();
  const candidates = [];
  for (const entry of strategyConfig) {
    if (!entry.enabled) continue;
    const builder = OCR_STRATEGY_BUILDERS[entry.id];
    if (!builder) continue;
    try {
      const built = builder(sourceImg, blob);
      if (built) candidates.push({ id: entry.id, ...built });
    } catch (buildErr) {
      console.warn(`[Captcha Detector] Strategi "${entry.id}" dilewati saat pra-pemrosesan:`, buildErr);
    }
  }

  if (candidates.length === 0) {
    console.warn('[Captcha Detector] Tidak ada sumber piksel yang bisa dibaca (cross-origin & fetch gagal, atau semua strategi dimatikan), OCR dilewati.');
    updateOcrStatus('Gagal membaca gambar captcha (cross-origin).', false, img);
    return;
  }

  try {
    const worker = await getOcrWorker();
    const siteConfig = getSiteOcrConfig();
    const escapedWhitelist = siteConfig.whitelist.replace(/[-\]\\^]/g, '\\$&');
    const stripRegex = new RegExp(`[^${escapedWhitelist}]`, 'g');

    const best = await runOcrCandidates(worker, candidates, siteConfig, stripRegex, OCR_TIME_BUDGET_MS);

    console.log('[Captcha Detector] OCR hasil:', best ? `${best.cleaned} (strategi: ${best.strategyId})` : '(kosong)');
    updateOcrStatus(best ? best.cleaned : '', false, img);
    if (best) fillCaptchaInput(best.cleaned, img);
  } catch (err) {
    console.error('[Captcha Detector] OCR gagal:', err);
    updateOcrStatus('Gagal membaca teks captcha.', false);
  } finally {
    // Leave the worker on PSM 7 (single line) as the stable default for the next read.
    getOcrWorker().then(w => w.setParameters({ tessedit_pageseg_mode: '7' })).catch(() => {});
  }
}

// Attribute + label text patterns covering the common ways sites name a captcha field —
// not just "captcha" itself, but Indonesian variants and the generic "random code" phrasing.
const CAPTCHA_INPUT_ATTR_SELECTOR = [
  'input[placeholder*="captcha" i]', 'input[name*="captcha" i]', 'input[id*="captcha" i]', 'input[aria-label*="captcha" i]',
  'input[placeholder*="kode keamanan" i]', 'input[name*="keamanan" i]', 'input[id*="keamanan" i]',
  'input[placeholder*="kode verifikasi" i]', 'input[name*="verifikasi" i]', 'input[id*="verifikasi" i]',
  'input[placeholder*="random" i]', 'input[name*="random" i]', 'input[id*="random" i]', 'input[aria-label*="random" i]',
  'input[placeholder*="security code" i]', 'input[name*="security" i]', 'input[id*="security" i]',
  'input[placeholder*="kode unik" i]', 'input[name*="kode" i]', 'input[id*="kode" i]'
].join(', ');
const CAPTCHA_INPUT_LABEL_PATTERN = /captcha|kode\s*keamanan|kode\s*verifikasi|verifikasi|random|security\s*code|kode\s*unik|\bkode\b/i;

// Try to find the input field associated with a captcha image (for autofill)
function findCaptchaInput(img) {
  const explicit = document.querySelector(CAPTCHA_INPUT_ATTR_SELECTOR);
  if (explicit) return explicit;

  // Fallback: a <label> whose text mentions captcha/kode keamanan/random/etc., resolved to its input
  const labels = document.querySelectorAll('label');
  for (const label of labels) {
    if (!CAPTCHA_INPUT_LABEL_PATTERN.test(label.textContent || '')) continue;
    const forId = label.getAttribute('for');
    if (forId) {
      const input = document.getElementById(forId);
      if (input && input.tagName === 'INPUT') return input;
    }
    const nestedInput = label.querySelector('input');
    if (nestedInput) return nestedInput;
  }

  // Fallback: nearest input within the same container as the image
  let container = img.closest('div');
  let depth = 0;
  while (container && depth < 4) {
    const input = container.querySelector('input[type="text"], input:not([type])');
    if (input) return input;
    container = container.parentElement;
    depth += 1;
  }
  return null;
}

// Shared fill logic used both by the auto-fill-on-read and the manual "Isi Otomatis" button
function fillCaptchaInput(text, imgEl) {
  if (!text || !imgEl) return false;
  const input = findCaptchaInput(imgEl);
  if (!input) return false;
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
  setter.call(input, text);
  input.dispatchEvent(new Event('input', { bubbles: true }));
  input.dispatchEvent(new Event('change', { bubbles: true }));
  return true;
}

// Send statistics to background script to update icon badge
function updateBadge() {
  const captchaList = Array.from(detectedCaptchas.values()).map(c => c.type);
  chrome.runtime.sendMessage({
    action: 'captchaDetected',
    count: detectedCaptchas.size,
    captchas: captchaList,
    url: window.location.href
  });
}

// Create and show Shadow DOM custom popup
function showInPagePopup(captchaType) {
  if (popupVisible) {
    // If popup is already open, just update its text to the latest detected type
    updatePopupContent(captchaType);
    return;
  }

  // Create overlay container if not exists
  if (!shadowRootElement) {
    shadowRootElement = document.createElement('div');
    shadowRootElement.id = 'crx-captcha-radar-root';
    shadowRootElement.style.position = 'fixed';
    shadowRootElement.style.top = '20px';
    shadowRootElement.style.right = '20px';
    shadowRootElement.style.zIndex = '2147483647'; // Highest possible z-index
    document.documentElement.appendChild(shadowRootElement);

    const shadow = shadowRootElement.attachShadow({ mode: 'open' });
    
    // Inject Styles inside Shadow DOM
    const style = document.createElement('style');
    style.textContent = `
      .card {
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
        background: rgba(15, 23, 42, 0.95);
        backdrop-filter: blur(12px);
        border: 1px solid rgba(255, 255, 255, 0.15);
        border-radius: 16px;
        padding: 20px;
        width: 320px;
        color: #f1f5f9;
        box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.5), 0 10px 10px -5px rgba(0, 0, 0, 0.4), 0 0 15px rgba(34, 197, 94, 0.3);
        transform: translateX(400px);
        transition: transform 0.5s cubic-bezier(0.16, 1, 0.3, 1), box-shadow 0.3s;
        box-sizing: border-box;
      }
      .card.show {
        transform: translateX(0);
      }
      .header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        margin-bottom: 12px;
      }
      .title-group {
        display: flex;
        align-items: center;
        gap: 10px;
      }
      .icon {
        font-size: 24px;
        animation: pulse 2s infinite ease-in-out;
      }
      .title {
        font-size: 16px;
        font-weight: 700;
        margin: 0;
        color: #fff;
        letter-spacing: 0.5px;
      }
      .close-btn {
        background: none;
        border: none;
        color: #94a3b8;
        font-size: 18px;
        cursor: pointer;
        padding: 4px;
        border-radius: 50%;
        display: flex;
        align-items: center;
        justify-content: center;
        transition: background 0.2s, color 0.2s;
        width: 24px;
        height: 24px;
      }
      .close-btn:hover {
        background: rgba(255, 255, 255, 0.1);
        color: #fff;
      }
      .body {
        font-size: 13.5px;
        line-height: 1.5;
        color: #cbd5e1;
        margin-bottom: 16px;
      }
      .captcha-badge {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        padding: 4px 10px;
        border-radius: 9999px;
        font-size: 11px;
        font-weight: 600;
        text-transform: uppercase;
        margin-top: 8px;
        box-shadow: 0 2px 4px rgba(0,0,0,0.2);
      }
      .footer {
        display: flex;
        gap: 8px;
        justify-content: flex-end;
      }
      .btn {
        padding: 6px 12px;
        font-size: 12px;
        font-weight: 600;
        border-radius: 8px;
        cursor: pointer;
        transition: all 0.2s;
        border: none;
      }
      .btn-primary {
        background: #22c55e;
        color: #052e16;
      }
      .btn-primary:hover {
        background: #4ade80;
        box-shadow: 0 0 10px rgba(74, 222, 128, 0.5);
      }
      .btn-secondary {
        background: rgba(255, 255, 255, 0.08);
        color: #e2e8f0;
      }
      .btn-secondary:hover {
        background: rgba(255, 255, 255, 0.15);
      }
      @keyframes pulse {
        0%, 100% { transform: scale(1); opacity: 1; }
        50% { transform: scale(1.1); opacity: 0.8; }
      }
      
      /* Mini mode */
      .mini-badge {
        display: flex;
        align-items: center;
        justify-content: center;
        background: #0f172a;
        color: #22c55e;
        border: 2px solid #22c55e;
        width: 48px;
        height: 48px;
        border-radius: 50%;
        cursor: pointer;
        box-shadow: 0 10px 15px -3px rgba(0, 0, 0, 0.3), 0 0 15px rgba(34, 197, 94, 0.5);
        transition: transform 0.3s cubic-bezier(0.175, 0.885, 0.32, 1.275);
        transform: scale(0);
        font-size: 20px;
      }
      .mini-badge.show {
        transform: scale(1);
      }
      .mini-badge:hover {
        transform: scale(1.1) rotate(15deg);
      }
      .ocr-section {
        display: none;
        margin-top: 4px;
        margin-bottom: 12px;
        padding: 10px 12px;
        border-radius: 10px;
        background: rgba(255, 255, 255, 0.06);
        border: 1px solid rgba(255, 255, 255, 0.1);
      }
      .ocr-section.show {
        display: block;
      }
      .ocr-label {
        font-size: 10px;
        text-transform: uppercase;
        letter-spacing: 0.5px;
        color: #94a3b8;
        margin-bottom: 6px;
        display: block;
      }
      .ocr-row {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 8px;
      }
      .ocr-text {
        font-family: "SFMono-Regular", Consolas, monospace;
        font-size: 15px;
        font-weight: 700;
        color: #4ade80;
        letter-spacing: 1px;
        word-break: break-all;
      }
      .ocr-text.loading {
        color: #94a3b8;
        font-size: 12px;
        font-weight: 400;
        font-family: inherit;
        letter-spacing: normal;
      }
      .ocr-actions {
        display: flex;
        gap: 6px;
        flex-shrink: 0;
      }
      .ocr-icon-btn {
        background: rgba(255, 255, 255, 0.08);
        border: none;
        color: #e2e8f0;
        width: 26px;
        height: 26px;
        border-radius: 6px;
        cursor: pointer;
        font-size: 12px;
        display: flex;
        align-items: center;
        justify-content: center;
        transition: background 0.2s;
      }
      .ocr-icon-btn:hover {
        background: rgba(255, 255, 255, 0.18);
      }
      .ocr-icon-btn:disabled {
        opacity: 0.5;
        cursor: default;
        animation: spin 0.8s linear infinite;
      }
      @keyframes spin {
        from { transform: rotate(0deg); }
        to { transform: rotate(360deg); }
      }
    `;

    shadow.appendChild(style);

    const card = document.createElement('div');
    card.className = 'card';
    card.id = 'crx-card';

    card.innerHTML = `
      <div class="header">
        <div class="title-group">
          <span class="icon" id="crx-icon">🤖</span>
          <h4 class="title">Captcha Radar</h4>
        </div>
        <button class="close-btn" id="crx-close-btn">&times;</button>
      </div>
      <div class="body">
        <span id="crx-desc">Sistem mendeteksi adanya Captcha yang membutuhkan penyelesaian.</span>
        <div>
          <span class="captcha-badge" id="crx-badge-type"></span>
        </div>
      </div>
      <div class="ocr-section" id="crx-ocr-section">
        <span class="ocr-label">Hasil Baca OCR (Tesseract.js)</span>
        <div class="ocr-row">
          <span class="ocr-text" id="crx-ocr-text">Membaca...</span>
          <div class="ocr-actions">
            <button class="ocr-icon-btn" id="crx-ocr-reread-btn" title="Baca Ulang">🔄</button>
            <button class="ocr-icon-btn" id="crx-ocr-copy-btn" title="Salin">📋</button>
            <button class="ocr-icon-btn" id="crx-ocr-fill-btn" title="Isi Otomatis">✍️</button>
          </div>
        </div>
      </div>
      <div class="footer">
        <button class="btn btn-secondary" id="crx-minimize-btn">Sembunyikan</button>
        <button class="btn btn-primary" id="crx-solve-btn">Oke, Mengerti</button>
      </div>
    `;
    shadow.appendChild(card);

    const miniBadge = document.createElement('div');
    miniBadge.className = 'mini-badge';
    miniBadge.id = 'crx-mini-badge';
    miniBadge.innerHTML = '🛡️';
    miniBadge.title = 'Captcha Terdeteksi! Klik untuk membuka.';
    shadow.appendChild(miniBadge);

    // Event Listeners inside Shadow DOM
    shadow.getElementById('crx-close-btn').addEventListener('click', () => dismissPopup(false));
    shadow.getElementById('crx-solve-btn').addEventListener('click', () => dismissPopup(false));
    shadow.getElementById('crx-minimize-btn').addEventListener('click', () => dismissPopup(true));
    miniBadge.addEventListener('click', () => restorePopup());

    shadow.getElementById('crx-ocr-copy-btn').addEventListener('click', () => {
      const text = shadow.getElementById('crx-ocr-text').textContent;
      if (text) navigator.clipboard.writeText(text).catch(() => {});
    });
    shadow.getElementById('crx-ocr-fill-btn').addEventListener('click', () => {
      const text = shadow.getElementById('crx-ocr-text').textContent;
      fillCaptchaInput(text, lastOcrImageEl);
    });
    shadow.getElementById('crx-ocr-reread-btn').addEventListener('click', (e) => {
      if (!lastOcrImageEl) return;
      const btn = e.currentTarget;
      btn.disabled = true;
      processCaptchaImageOcr(lastOcrImageEl).finally(() => { btn.disabled = false; });
    });
  }

  updatePopupContent(captchaType);

  // Animate slide-in
  setTimeout(() => {
    const shadow = shadowRootElement.shadowRoot;
    shadow.getElementById('crx-card').classList.add('show');
    popupVisible = true;
  }, 100);
}

function updatePopupContent(captchaType) {
  const theme = CAPTCHA_THEMES[captchaType] || CAPTCHA_THEMES['Generic Captcha'];
  const shadow = shadowRootElement.shadowRoot;
  
  shadow.getElementById('crx-icon').textContent = theme.logo;
  shadow.getElementById('crx-desc').textContent = theme.desc;
  
  const badge = shadow.getElementById('crx-badge-type');
  badge.textContent = captchaType;
  badge.style.backgroundColor = `${theme.color}20`; // 12% opacity
  badge.style.color = theme.color;
  badge.style.border = `1px solid ${theme.color}50`;
  
  // Dynamic card outer glow color based on captcha type
  shadow.getElementById('crx-card').style.boxShadow = `0 20px 25px -5px rgba(0, 0, 0, 0.5), 0 0 15px ${theme.color}40`;
}

// Update the OCR section of the in-page card with recognized text / loading state
function updateOcrStatus(text, loading, imgEl) {
  if (imgEl) lastOcrImageEl = imgEl;
  if (!shadowRootElement) return; // card not created yet (e.g. no visual captcha shown so far)

  const shadow = shadowRootElement.shadowRoot;
  const section = shadow.getElementById('crx-ocr-section');
  const textEl = shadow.getElementById('crx-ocr-text');
  if (!section || !textEl) return;

  section.classList.add('show');
  textEl.classList.toggle('loading', loading);
  textEl.textContent = loading ? text : (text || '(tidak terbaca)');
}

function dismissPopup(minimize = false) {
  if (!shadowRootElement) return;
  const shadow = shadowRootElement.shadowRoot;
  const card = shadow.getElementById('crx-card');
  const miniBadge = shadow.getElementById('crx-mini-badge');

  card.classList.remove('show');
  
  setTimeout(() => {
    if (minimize) {
      miniBadge.classList.add('show');
    } else {
      popupVisible = false;
    }
  }, 500);
}

function restorePopup() {
  if (!shadowRootElement) return;
  const shadow = shadowRootElement.shadowRoot;
  const card = shadow.getElementById('crx-card');
  const miniBadge = shadow.getElementById('crx-mini-badge');

  miniBadge.classList.remove('show');
  
  setTimeout(() => {
    card.classList.add('show');
    popupVisible = true;
  }, 200);
}

// Observe dynamic content changes to find newly rendered captchas
let observer = null;
function startObserver() {
  if (observer) return;
  
  observer = new MutationObserver((mutations) => {
    let checkNeeded = false;
    for (let mutation of mutations) {
      if (mutation.addedNodes.length > 0) {
        checkNeeded = true;
        break;
      }
    }
    if (checkNeeded) {
      // Throttle/Debounce check slightly to avoid performance hits
      clearTimeout(this.debounceTimer);
      this.debounceTimer = setTimeout(scanForCaptchas, 300);
    }
  });

  observer.observe(document.body, {
    childList: true,
    subtree: true
  });
}

// Initialize content script
function init() {
  // Load state from local storage
  chrome.storage.local.get({ extensionEnabled: true }, (items) => {
    extensionEnabled = items.extensionEnabled;
    
    if (extensionEnabled) {
      // Run initial check
      setTimeout(scanForCaptchas, 1000);
      // Start observer for dynamic loading
      startObserver();
    }
  });
}

// Listen for storage changes (e.g. extension turned off in popup)
chrome.storage.onChanged.addListener((changes, namespace) => {
  if (namespace === 'local' && changes.extensionEnabled) {
    extensionEnabled = changes.extensionEnabled.newValue;
    if (extensionEnabled) {
      scanForCaptchas();
      startObserver();
    } else {
      if (observer) {
        observer.disconnect();
        observer = null;
      }
      // Remove popup if visible
      if (shadowRootElement) {
        shadowRootElement.remove();
        shadowRootElement = null;
        popupVisible = false;
      }
      detectedCaptchas.clear();
    }
  }
});

// Run init
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
