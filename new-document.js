// new-document.js — Photoshop-style New Document dialog

(function () {
  const modal     = document.getElementById('new-doc-modal');
  const wInput    = document.getElementById('nd-width');
  const hInput    = document.getElementById('nd-height');
  const portBtn   = document.getElementById('nd-portrait');
  const landBtn   = document.getElementById('nd-landscape');
  const createBtn = document.getElementById('nd-create');
  const bgCustom  = document.getElementById('nd-bg-custom');
  const bgInput   = document.getElementById('nd-bg-input');
  const newBtn    = document.getElementById('btn-new');
  const wLbl      = document.getElementById('nd-ulbl-w');
  const hLbl      = document.getElementById('nd-ulbl-h');
  const dpiInput  = document.getElementById('nd-dpi');
  const resWrap   = document.getElementById('nd-res-wrap');

  let selectedBg = '#ffffff';
  let unit = 'px';

  // ── Unit conversion ────────────────────────────────────────────────────────

  function getDpi() { return Math.max(1, parseInt(dpiInput.value) || 300); }

  function toPx(val) {
    const v = parseFloat(val) || 0;
    const dpi = getDpi();
    if (unit === 'px') return Math.round(v);
    if (unit === 'in') return Math.round(v * dpi);
    if (unit === 'cm') return Math.round(v * dpi / 2.54);
    if (unit === 'mm') return Math.round(v * dpi / 25.4);
    return Math.round(v);
  }

  function fromPx(px) {
    const dpi = getDpi();
    if (unit === 'px') return Math.round(px);
    if (unit === 'in') return +(px / dpi).toFixed(3);
    if (unit === 'cm') return +(px * 2.54 / dpi).toFixed(3);
    if (unit === 'mm') return +(px * 25.4 / dpi).toFixed(2);
    return Math.round(px);
  }

  // Convert a value from an arbitrary unit to px
  function unitToPx(val, fromUnit) {
    const v = parseFloat(val) || 0;
    const dpi = getDpi();
    if (fromUnit === 'px') return Math.round(v);
    if (fromUnit === 'in') return Math.round(v * dpi);
    if (fromUnit === 'cm') return Math.round(v * dpi / 2.54);
    if (fromUnit === 'mm') return Math.round(v * dpi / 25.4);
    return Math.round(v);
  }

  function getWpx() { return Math.max(1, Math.min(32000, toPx(wInput.value))); }
  function getHpx() { return Math.max(1, Math.min(32000, toPx(hInput.value))); }

  // ── Helpers ────────────────────────────────────────────────────────────────

  function syncOrientBtns() {
    const land = getWpx() >= getHpx();
    landBtn.classList.toggle('nd-on', land);
    portBtn.classList.toggle('nd-on', !land);
  }

  function clearPresetHighlight() {
    document.querySelectorAll('.nd-preset').forEach(b => b.classList.remove('nd-on'));
  }

  function updateUnitLabels() {
    wLbl.textContent = unit;
    hLbl.textContent = unit;
    resWrap.style.display = unit === 'px' ? 'none' : 'flex';
  }

  // ── Unit buttons ───────────────────────────────────────────────────────────

  document.querySelectorAll('.nd-unit-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const wPx = getWpx();
      const hPx = getHpx();
      unit = btn.dataset.unit;
      document.querySelectorAll('.nd-unit-btn').forEach(b => b.classList.remove('nd-on'));
      btn.classList.add('nd-on');
      updateUnitLabels();
      wInput.value = fromPx(wPx);
      hInput.value = fromPx(hPx);
      clearPresetHighlight();
      syncOrientBtns();
    });
  });

  dpiInput.addEventListener('change', () => {
    // Values stay in current unit; just re-check orientation
    syncOrientBtns();
  });

  // ── Presets ────────────────────────────────────────────────────────────────

  document.querySelectorAll('.nd-preset').forEach(btn => {
    btn.addEventListener('click', () => {
      const presetUnit = btn.dataset.unit || 'px';
      const rawW = parseFloat(btn.dataset.w);
      const rawH = parseFloat(btn.dataset.h);

      // Convert preset native values → px → current unit
      const wPx = unitToPx(rawW, presetUnit);
      const hPx = unitToPx(rawH, presetUnit);
      let dispW = fromPx(wPx);
      let dispH = fromPx(hPx);

      // Respect current orientation
      const wantLand   = landBtn.classList.contains('nd-on');
      const presetLand = wPx >= hPx;
      if (wantLand && !presetLand)   { const t = dispW; dispW = dispH; dispH = t; }
      else if (!wantLand && presetLand) { const t = dispW; dispW = dispH; dispH = t; }

      wInput.value = dispW;
      hInput.value = dispH;
      clearPresetHighlight();
      btn.classList.add('nd-on');
      syncOrientBtns();
    });
  });

  // ── Orientation ────────────────────────────────────────────────────────────

  portBtn.addEventListener('click', () => {
    const w = parseFloat(wInput.value), h = parseFloat(hInput.value);
    if (w > h) { wInput.value = h; hInput.value = w; }
    syncOrientBtns();
    clearPresetHighlight();
  });

  landBtn.addEventListener('click', () => {
    const w = parseFloat(wInput.value), h = parseFloat(hInput.value);
    if (h > w) { wInput.value = h; hInput.value = w; }
    syncOrientBtns();
    clearPresetHighlight();
  });

  wInput.addEventListener('input', () => { clearPresetHighlight(); syncOrientBtns(); });
  hInput.addEventListener('input', () => { clearPresetHighlight(); syncOrientBtns(); });

  // ── Background ─────────────────────────────────────────────────────────────

  document.querySelectorAll('.nd-bg-swatch').forEach(sw => {
    sw.addEventListener('click', () => {
      document.querySelectorAll('.nd-bg-swatch, .nd-bg-custom').forEach(el => el.classList.remove('nd-on'));
      sw.classList.add('nd-on');
      selectedBg = sw.dataset.bg;
    });
  });

  bgCustom.addEventListener('click', () => bgInput.click());
  bgInput.addEventListener('input', () => {
    selectedBg = bgInput.value;
    bgCustom.style.background = bgInput.value;
    document.querySelectorAll('.nd-bg-swatch, .nd-bg-custom').forEach(el => el.classList.remove('nd-on'));
    bgCustom.classList.add('nd-on');
  });

  // ── Create ─────────────────────────────────────────────────────────────────

  function openModal() {
    modal.classList.remove('hidden');
  }

  function create() {
    const w = getWpx(), h = getHpx();
    canvas.setFixedSize(w, h);
    canvas.setBackground(selectedBg);
    modal.classList.add('hidden');
  }

  createBtn.addEventListener('click', create);

  wInput.addEventListener('keydown', e => { if (e.key === 'Enter') create(); });
  hInput.addEventListener('keydown', e => { if (e.key === 'Enter') create(); });

  if (newBtn) newBtn.addEventListener('click', openModal);

  document.addEventListener('keydown', e => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'n') {
      e.preventDefault();
      openModal();
    }
  });

  // ── Show on startup ────────────────────────────────────────────────────────

  openModal();
})();
