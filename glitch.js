// glitch.js — Glitch tab: draggable/resizable grid that VHS-glitches text inside it

// ─── GlitchGrid ───────────────────────────────────────────────────────────────
// One rectangular grid placed on the canvas.
// Divided into (numRows × numCols) cells; each cell independently glitches the
// text slice below it: shift (horizontal displacement), blank (missing row),
// or ghost (double-exposure overlap).
// Cell effects are randomised once and stay stable — re-randomise with reseed().

class GlitchGrid {
  constructor(id, x, y, w, h) {
    this.id = id;
    this.x = x; this.y = y;
    this.w = w; this.h = h;
    this._cells = []; // flat [r * numCols + c] array of { type, dx }
  }

  // Rebuild the cell array with fresh random effects.
  // dx is normalised (–1…1); multiply by shiftMax at draw time so the slider
  // works in real-time without re-seeding.
  randomize(numRows, numCols, density) {
    this._cells = [];
    for (let r = 0; r < numRows; r++) {
      for (let c = 0; c < numCols; c++) {
        if (Math.random() > density / 100) {
          this._cells.push({ type: 'normal' });
          continue;
        }
        const roll = Math.random();
        const sign = Math.random() < 0.5 ? 1 : -1;
        if (roll < 0.52) {
          this._cells.push({ type: 'shift', dx: sign * (0.3 + Math.random() * 0.7) });
        } else if (roll < 0.74) {
          this._cells.push({ type: 'blank' });
        } else {
          this._cells.push({ type: 'ghost', dx: sign * (0.2 + Math.random() * 0.5) });
        }
      }
    }
  }

  // Apply per-cell glitch effects over whatever is already drawn on ctx.
  applyGlitch(ctx, textCanvas, bgColor, numRows, numCols, shiftMax) {
    if (!this._cells.length) return;
    const cellW = this.w / numCols;
    const cellH = this.h / numRows;

    for (let r = 0; r < numRows; r++) {
      for (let c = 0; c < numCols; c++) {
        const cell = this._cells[r * numCols + c];
        if (!cell || cell.type === 'normal') continue;

        const cx = this.x + c * cellW;
        const cy = this.y + r * cellH;

        ctx.save();
        ctx.beginPath();
        ctx.rect(cx, cy, cellW, cellH);
        ctx.clip();

        // Clear cell to background first
        ctx.fillStyle = bgColor;
        ctx.fillRect(cx, cy, cellW, cellH);

        if (cell.type === 'shift') {
          // Entire text canvas shifted horizontally — only the clipped slice shows
          ctx.drawImage(textCanvas, cell.dx * shiftMax, 0);

        } else if (cell.type === 'ghost') {
          // Two semi-transparent copies at opposite offsets → double-exposure look
          ctx.globalAlpha = 0.50;
          ctx.drawImage(textCanvas, -cell.dx * shiftMax, 0);
          ctx.globalAlpha = 0.82;
          ctx.drawImage(textCanvas,  cell.dx * shiftMax * 0.45, 0);
          ctx.globalAlpha = 1;
        }
        // 'blank': already cleared — cell stays as background colour

        ctx.restore();
      }
    }
  }

  // Apply prismatic colour-refraction: R/G/B channels drawn at different offsets
  // per cell, layered on top of whatever glitch content is already there.
  // Only activates on cells that already have a glitch effect — normal cells are untouched.
  applyRefraction(ctx, redC, greenC, blueC, numRows, numCols, refractAmt) {
    if (!redC || !this._cells.length) return;
    const cellW = this.w / numCols;
    const cellH = this.h / numRows;
    const cx0   = (numCols - 1) / 2;
    const cy0   = (numRows - 1) / 2;

    for (let r = 0; r < numRows; r++) {
      for (let c = 0; c < numCols; c++) {
        const cell = this._cells[r * numCols + c];
        if (!cell || cell.type === 'normal') continue; // leave clean cells intact

        const px = this.x + c * cellW;
        const py = this.y + r * cellH;

        // Normalised vector from grid centre → this cell (0 at centre, ~1 at edge)
        const nx  = numCols > 1 ? (c - cx0) / (numCols / 2) : 0;
        const ny  = numRows > 1 ? (r - cy0) / (numRows / 2) : 0;
        const mag = Math.hypot(nx, ny);
        const ang = Math.atan2(ny, nx);
        const shift = mag * refractAmt;

        // Red shifts outward, blue shifts inward → prismatic fringe at letter edges
        const rdx =  Math.cos(ang) * shift;
        const rdy =  Math.sin(ang) * shift * 0.5;
        const bdx = -Math.cos(ang) * shift * 0.65;
        const bdy = -Math.sin(ang) * shift * 0.325;

        ctx.save();
        ctx.beginPath();
        ctx.rect(px, py, cellW, cellH);
        ctx.clip();

        // screen blends colour channels on top of existing glitch content without clearing it
        ctx.globalCompositeOperation = 'screen';
        ctx.drawImage(redC,   rdx, rdy);
        ctx.drawImage(greenC,   0,   0);
        ctx.drawImage(blueC,  bdx, bdy);
        ctx.globalCompositeOperation = 'source-over';

        ctx.restore();
      }
    }
  }

  // Draw the visible grid overlay (faint interior lines + solid border).
  drawOverlay(ctx, numRows, numCols) {
    const cellW = this.w / numCols;
    const cellH = this.h / numRows;

    ctx.save();

    // Interior horizontal dividers
    ctx.strokeStyle = 'rgba(255,255,255,0.10)';
    ctx.lineWidth   = 0.5;
    for (let r = 1; r < numRows; r++) {
      const ry = this.y + r * cellH;
      ctx.beginPath();
      ctx.moveTo(this.x, ry);
      ctx.lineTo(this.x + this.w, ry);
      ctx.stroke();
    }

    // Interior vertical dividers
    for (let c = 1; c < numCols; c++) {
      const rx = this.x + c * cellW;
      ctx.beginPath();
      ctx.moveTo(rx, this.y);
      ctx.lineTo(rx, this.y + this.h);
      ctx.stroke();
    }

    // Outer border — brighter so the grid region is visible
    ctx.strokeStyle = 'rgba(255,255,255,0.55)';
    ctx.lineWidth   = 1;
    ctx.strokeRect(this.x, this.y, this.w, this.h);

    ctx.restore();
  }
}


// ─── GlitchController ─────────────────────────────────────────────────────────

class GlitchController {
  constructor(canvas) {
    this.canvas  = canvas;
    this.text    = '';
    this.color   = '#ffffff';
    this.bgColor = '#111111';

    this.lineSpacing = 1.0;

    this.numRows  = 8;
    this.numCols  = 4;
    this.shiftMax = 30;  // max horizontal displacement in px
    this.density  = 55;  // % of cells that receive a glitch effect

    this.refractMode = false;
    this.refractAmt  = 15;  // px of max channel separation

    this.grids   = [];
    this._nextId = 0;

    this._textCanvas  = null;
    this._srcCanvas   = null; // transparent bg + real text colour — used for channel extraction
    this._redCanvas   = null;
    this._greenCanvas = null;
    this._blueCanvas  = null;

    // Interaction state
    this._active  = false; // placement/edit mode
    this._drag    = null;  // { type:'create'|'move'|'resize', grid, startX, startY, origX?, origY?, origW?, origH? }
    this._preview = null;  // grid being dragged into existence

    this._bindUI();
    this._bindCanvas();

    window.addEventListener('resize', () => {
      if (this._isActive()) { this._buildTextCanvas(); this.render(); }
    });
  }

  // ── Text canvas ──────────────────────────────────────────────────────────────

  _fontSize() {
    const W = this.canvas.width, H = this.canvas.height;
    const lines = this.text.split('\n');
    const maxLineLen = Math.max(...lines.map(l => l.length), 1);
    const numLines = lines.length || 1;
    const fontByWidth  = Math.max(24, Math.min(W, H) * 0.55 / Math.max(1, Math.pow(maxLineLen, 0.55)));
    const fontByHeight = Math.max(24, H * 0.78 / (numLines * this.lineSpacing));
    return Math.min(fontByWidth, fontByHeight);
  }

  _buildTextCanvas() {
    const W = this.canvas.width, H = this.canvas.height;
    if (W === 0 || H === 0) return;
    const tc  = document.createElement('canvas');
    tc.width  = W; tc.height = H;
    const ctx = tc.getContext('2d');
    ctx.fillStyle = this.bgColor;
    ctx.fillRect(0, 0, W, H);

    // Transparent-bg canvas: only letter pixels with real colour — for channel extraction
    const sc   = document.createElement('canvas');
    sc.width   = W; sc.height = H;
    const sctx = sc.getContext('2d');

    if (this.text.trim()) {
      const lines  = this.text.split('\n');
      const fs     = this._fontSize();
      const lineH  = fs * this.lineSpacing;
      const startY = H / 2 - ((lines.length - 1) * lineH) / 2;
      for (const c of [ctx, sctx]) {
        c.font         = `${fs}px 'Courier New', monospace`;
        c.textAlign    = 'center';
        c.textBaseline = 'middle';
      }
      ctx.fillStyle  = this.color;
      sctx.fillStyle = this.color;
      lines.forEach((line, i) => {
        if (!line.length) return;
        const y = startY + i * lineH;
        ctx.fillText(line,  W / 2, y);
        sctx.fillText(line, W / 2, y);
      });
    }
    this._textCanvas = tc;
    this._srcCanvas  = sc;
    this._buildChannelCanvases();
  }

  _buildChannelCanvases() {
    if (!this._srcCanvas) {
      this._redCanvas = this._greenCanvas = this._blueCanvas = null;
      return;
    }
    const W = this._srcCanvas.width, H = this._srcCanvas.height;
    // Read from the transparent-bg source so bg pixels (alpha=0) contribute nothing
    // when screen-blended — refraction colour only appears on actual letter pixels.
    const src = this._srcCanvas.getContext('2d').getImageData(0, 0, W, H).data;

    const makeChannel = (useR, useG, useB) => {
      const c   = document.createElement('canvas');
      c.width = W; c.height = H;
      const cx  = c.getContext('2d');
      const id  = cx.createImageData(W, H);
      const od  = id.data;
      for (let i = 0; i < src.length; i += 4) {
        od[i]   = useR ? src[i]   : 0;
        od[i+1] = useG ? src[i+1] : 0;
        od[i+2] = useB ? src[i+2] : 0;
        od[i+3] = src[i+3];
      }
      cx.putImageData(id, 0, 0);
      return c;
    };

    this._redCanvas   = makeChannel(true,  false, false);
    this._greenCanvas = makeChannel(false, true,  false);
    this._blueCanvas  = makeChannel(false, false, true);
  }

  // ── Resize handle ────────────────────────────────────────────────────────────
  // Placed at the bottom-right corner of the grid rectangle.

  _handlePos(grid) {
    return { x: grid.x + grid.w, y: grid.y + grid.h, r: 9 };
  }

  _drawHandle(ctx, grid) {
    const h = this._handlePos(grid);
    ctx.save();
    ctx.beginPath();
    ctx.arc(h.x, h.y, h.r, 0, Math.PI * 2);
    ctx.fillStyle   = 'rgba(255,255,255,0.92)';
    ctx.shadowColor = 'rgba(0,0,0,0.5)';
    ctx.shadowBlur  = h.r * 0.9;
    ctx.fill();
    ctx.shadowColor  = 'transparent';
    ctx.strokeStyle  = 'rgba(160,220,255,0.85)';
    ctx.lineWidth    = 1.5;
    ctx.stroke();
    const s = h.r * 0.35;
    ctx.strokeStyle = 'rgba(100,180,255,0.7)';
    ctx.lineWidth   = 1;
    ctx.beginPath();
    ctx.moveTo(h.x - s, h.y - s); ctx.lineTo(h.x + s, h.y + s);
    ctx.moveTo(h.x,     h.y - s); ctx.lineTo(h.x + s, h.y);
    ctx.stroke();
    ctx.restore();
  }

  _hitTest(x, y) {
    for (let i = this.grids.length - 1; i >= 0; i--) {
      const g = this.grids[i];
      const h = this._handlePos(g);
      if (Math.hypot(x - h.x, y - h.y) <= h.r * 2)
        return { type: 'resize', grid: g };
      if (x >= g.x && x <= g.x + g.w && y >= g.y && y <= g.y + g.h)
        return { type: 'move', grid: g };
    }
    return null;
  }

  // ── Render ───────────────────────────────────────────────────────────────────

  render() {
    const { canvas } = this;
    canvas.beginLayer('glitch');
    try {
      const ctx = canvas.ctx;
      const W   = canvas.width, H = canvas.height;

      ctx.fillStyle   = this.bgColor;
      ctx.globalAlpha = 1;
      ctx.fillRect(0, 0, W, H);

      if (!this._textCanvas) return;
      if (!this.text.trim()) return;

      ctx.drawImage(this._textCanvas, 0, 0);
      this.grids.forEach(g =>
        g.applyGlitch(ctx, this._textCanvas, this.bgColor, this.numRows, this.numCols, this.shiftMax)
      );

      if (this.refractMode && this._redCanvas) {
        this.grids.forEach(g =>
          g.applyRefraction(ctx, this._redCanvas, this._greenCanvas, this._blueCanvas,
                            this.numRows, this.numCols, this.refractAmt)
        );
      }

      if (this._preview && this._preview.w > 10 && this._preview.h > 10) {
        this._preview.applyGlitch(ctx, this._textCanvas, this.bgColor, this.numRows, this.numCols, this.shiftMax);
        if (this.refractMode && this._redCanvas) {
          this._preview.applyRefraction(ctx, this._redCanvas, this._greenCanvas, this._blueCanvas,
                                        this.numRows, this.numCols, this.refractAmt);
        }
        this._preview.drawOverlay(ctx, this.numRows, this.numCols);
      }

      this.grids.forEach(g => { g.drawOverlay(ctx, this.numRows, this.numCols); this._drawHandle(ctx, g); });
    } finally {
      canvas.endLayer();
    }
  }

  // ── Canvas interaction ────────────────────────────────────────────────────────

  _xy(e) {
    const rect = this.canvas.el.getBoundingClientRect();
    return {
      x: (e.clientX - rect.left) * (this.canvas.width  / rect.width),
      y: (e.clientY - rect.top)  * (this.canvas.height / rect.height),
    };
  }

  _bindCanvas() {
    const el = this.canvas.el;

    el.addEventListener('mousedown', e => {
      if (!this._active) return;
      const { x, y } = this._xy(e);
      const hit = this._hitTest(x, y);

      if (hit) {
        const g = hit.grid;
        this._drag = {
          type: hit.type, grid: g,
          startX: x, startY: y,
          origX: g.x, origY: g.y, origW: g.w, origH: g.h,
        };
      } else {
        // Drag-to-create: top-left = mousedown point, drag to bottom-right
        const g = new GlitchGrid(this._nextId++, x, y, 0, 0);
        g.randomize(this.numRows, this.numCols, this.density);
        this._preview = g;
        this._drag = { type: 'create', grid: g, startX: x, startY: y };
      }
      e.preventDefault();
    });

    el.addEventListener('mousemove', e => {
      if (!this._active) return;
      const { x, y } = this._xy(e);

      if (this._drag) {
        const d = this._drag;
        if (d.type === 'move') {
          d.grid.x = d.origX + (x - d.startX);
          d.grid.y = d.origY + (y - d.startY);
          this.render();
        } else if (d.type === 'resize') {
          d.grid.w = Math.max(20, d.origW + (x - d.startX));
          d.grid.h = Math.max(20, d.origH + (y - d.startY));
          this.render();
        } else if (d.type === 'create') {
          d.grid.x = Math.min(d.startX, x);
          d.grid.y = Math.min(d.startY, y);
          d.grid.w = Math.abs(x - d.startX);
          d.grid.h = Math.abs(y - d.startY);
          this.render();
        }
      } else {
        const hit = this._hitTest(x, y);
        el.style.cursor = hit
          ? (hit.type === 'resize' ? 'nw-resize' : 'move')
          : 'crosshair';
      }
    });

    const endDrag = () => {
      if (!this._drag) return;
      const d = this._drag;
      if (d.type === 'create') {
        const g = d.grid;
        if (g.w < 20 || g.h < 20) {
          // Click without drag — place a default-sized grid centred at click
          const dw = 220, dh = 160;
          g.x = d.startX - dw / 2;
          g.y = d.startY - dh / 2;
          g.w = dw; g.h = dh;
        }
        this.grids.push(g);
        this._preview = null;
      }
      this._drag = null;
      this.render();
    };

    el.addEventListener('mouseup',    endDrag);
    el.addEventListener('mouseleave', endDrag);
  }

  // ── UI binding ────────────────────────────────────────────────────────────────

  _reseedAll() {
    this.grids.forEach(g => g.randomize(this.numRows, this.numCols, this.density));
    if (this._isActive()) this.render();
  }

  _bindUI() {
    document.getElementById('glitch-text-input').addEventListener('input', e => {
      this.text = e.target.value;
      this._buildTextCanvas();
      if (this._isActive()) this.render();
    });

    this._slider('sl-ls-glitch', 'v-ls-glitch', v => {
      this.lineSpacing = v;
      this._buildTextCanvas();
      if (this._isActive()) this.render();
    });

    document.getElementById('btn-glitch-grid').addEventListener('click', () => {
      this._active = !this._active;
      const btn = document.getElementById('btn-glitch-grid');
      btn.textContent = this._active ? 'Grid Glitch: On' : 'Grid Glitch';
      btn.classList.toggle('btn-on', this._active);
      this.canvas.el.style.cursor = this._active ? 'crosshair' : 'default';
    });

    document.getElementById('btn-glitch-reseed').addEventListener('click', () => this._reseedAll());
    document.getElementById('btn-glitch-reset').addEventListener('click',  () => this.reset());

    this._slider('sl-glitch-rows',    'v-glitch-rows',    v => { this.numRows  = v; this._reseedAll(); });
    this._slider('sl-glitch-cols',    'v-glitch-cols',    v => { this.numCols  = v; this._reseedAll(); });
    this._slider('sl-glitch-shift',   'v-glitch-shift',   v => { this.shiftMax = v; if (this._isActive()) this.render(); });
    this._slider('sl-glitch-density', 'v-glitch-density', v => { this.density  = v; this._reseedAll(); });

    document.getElementById('btn-glitch-refract').addEventListener('click', () => {
      this.refractMode = !this.refractMode;
      const btn = document.getElementById('btn-glitch-refract');
      btn.classList.toggle('btn-on', this.refractMode);
      if (this._isActive()) this.render();
    });
    this._slider('sl-glitch-refract', 'v-glitch-refract', v => {
      this.refractAmt = v;
      if (this._isActive()) this.render();
    });

    const swatch = document.getElementById('glitch-color-swatch');
    const label  = document.getElementById('glitch-color-label');
    const input  = document.getElementById('glitch-color-input');
    swatch.addEventListener('click', () => input.click());
    input.addEventListener('input', () => {
      this.color = input.value;
      label.textContent       = input.value;
      swatch.style.background = input.value;
      this._buildTextCanvas();
      if (this._isActive()) this.render();
    });

    document.addEventListener('tabchange', e => {
      if (e.detail === 'glitch') {
        this._buildTextCanvas();
        this.render();
      } else {
        this._deactivate();
      }
    });
  }

  _slider(id, displayId, onChange) {
    const el  = document.getElementById(id);
    const out = document.getElementById(displayId);
    if (!el) return;
    if (out) out.textContent = el.value;
    el.addEventListener('input', () => {
      const val = parseFloat(el.value);
      if (out) out.textContent = val;
      onChange(val);
    });
  }

  _isActive() {
    return document.getElementById('sec-glitch')?.classList.contains('active');
  }

  _deactivate() {
    this._active  = false;
    this._drag    = null;
    this._preview = null;
    this.canvas.el.style.cursor = 'default';
    const btn = document.getElementById('btn-glitch-grid');
    if (btn) { btn.textContent = 'Grid Glitch'; btn.classList.remove('btn-on'); }
  }

  reset() {
    this.grids       = [];
    this._preview    = null;
    this._drag       = null;
    this.refractMode = false;
    this._srcCanvas  = null;
    const rb = document.getElementById('btn-glitch-refract');
    if (rb) { rb.classList.remove('btn-on'); }
    this._deactivate();
    this._buildTextCanvas();
    this.render();
  }
}


// ─── Init ─────────────────────────────────────────────────────────────────────
// canvas is the shared global defined in spawnandgrow.js

const glitchController = new GlitchController(canvas);
