// Shared metadata for OCR reading strategies — used by both the popup (to render the
// reorder/enable settings UI) and the content script (to build/order the actual OCR
// candidates). Keeping this list in one file stops the two from drifting out of sync.
const OCR_STRATEGY_DEFS = [
  { id: 'contrast_s3', label: 'Kontras s3' },
  { id: 'contrast_invert_s3', label: 'Kontras Invert s3' },
  { id: 'contrast_denoise_s3', label: 'Kontras + Denoise s3' },
  { id: 'contrast_s4', label: 'Kontras s4' },
  { id: 'contrast_invert_denoise_s4', label: 'Kontras Invert + Denoise s4' },
  { id: 'raw_blob', label: 'Gambar Asli (Raw)' },
  { id: 'otsu_s4', label: 'Otsu Binarization s4' },
  { id: 'otsu_invert_s4', label: 'Otsu Invert s4' },
  { id: 'otsu_s5', label: 'Otsu Binarization s5' }
];

const OCR_STRATEGY_DEFAULT_ORDER = OCR_STRATEGY_DEFS.map(s => ({ id: s.id, enabled: true }));
