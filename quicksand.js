// quicksand.js — Drag a rectangle to select part of a letter; only that region falls as sand

class QuicksandController {
  constructor(canvas) {
    this.canvas = canvas;
    this.text      = '';
    this.textColor = '#ffffff';
    this.bgColor   = '#111111';

    this.lineSpacing = 1.0;

    this.fallSpeed = 1;   // slider value 1-15; actual rate = fallSpeed/30 steps/frame
    this.spread    = 1;
    this._frameAcc = 0;   // fractional-step accumulator for sub-1-step-per-frame rates
    this.SCALE     = 2;   // canvas pixels per grid cell (grain size)

    this.EMPTY  = 0;
    this.LETTER = 1;  // static letter pixel — eroded by selection
    this.SAND   = 2;  // falling / settled grain

    this._grid       = null;
    this._gW         = 0;
    this._gH         = 0;
    this._letterData = null;  // pixel snapshot of original text render
    this._sandRGB    = this._hex2rgb(this.textColor);
    this._bgRGB      = this._hex2rgb(this.bgColor);

    this._selectMode = false;
    this._drag       = null;   // { startX, startY, curX, curY }
    this._raf        = null;

    this._textCanvas = null;

    this._bindUI();
    this._bindCanvas();

    window.addEventListener('resize', () => {
      if (this._isTabActive()) {
        this._buildTextCanvas();
        this._buildGrid();
      }
    });
  }

  // ── Helpers ────────────────────────────────────────────────────────────────

  _hex2rgb(hex) {
    return [
      parseInt(hex.slice(1, 3), 16),
      parseInt(hex.slice(3, 5), 16),
      parseInt(hex.slice(5, 7), 16),
    ];
  }

  _xy(e) {
    const rect = this.canvas.el.getBoundingClientRect();
    return {
      x: (e.clientX - rect.left) * (this.canvas.width  / rect.width),
      y: (e.clientY - rect.top)  * (this.canvas.height / rect.height),
    };
  }

  _isTabActive() {
    return document.getElementById('sec-quicksand')?.classList.contains('active');
  }

  // ── Text rendering ────────────────────────────────────────────────────────

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
    if (!W || !H) return;
    const tc  = document.createElement('canvas');
    tc.width  = W; tc.height = H;
    const ctx = tc.getContext('2d');
    ctx.fillStyle = this.bgColor;
    ctx.fillRect(0, 0, W, H);

    if (this.text.trim()) {
      const lines  = this.text.split('\n');
      const fs     = this._fontSize();
      const lineH  = fs * this.lineSpacing;
      const startY = H / 2 - ((lines.length - 1) * lineH) / 2;
      ctx.font         = `${fs}px 'Courier New', monospace`;
      ctx.textAlign    = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle    = this.textColor;
      lines.forEach((line, i) => { if (line.length) ctx.fillText(line, W / 2, startY + i * lineH); });
    }
    this._textCanvas = tc;
  }

  // ── Grid setup ────────────────────────────────────────────────────────────

  _buildGrid() {
    if (!this._textCanvas) return;
    const W = this._textCanvas.width, H = this._textCanvas.height;
    const S = this.SCALE;
    this._gW = Math.floor(W / S);
    this._gH = Math.floor(H / S);
    this._grid = new Uint8Array(this._gW * this._gH);

    const id  = this._textCanvas.getContext('2d').getImageData(0, 0, W, H);
    this._letterData = id.data.slice();

    const d  = id.data;
    const gW = this._gW, gH = this._gH;
    for (let gy = 0; gy < gH; gy++) {
      for (let gx = 0; gx < gW; gx++) {
        const i = ((gy * S) * W + gx * S) * 4;
        if (d[i] > 60 || d[i + 1] > 60 || d[i + 2] > 60) {
          this._grid[gy * gW + gx] = this.LETTER;
        }
      }
    }
  }

  // ── Selection erosion ─────────────────────────────────────────────────────
  // Converts LETTER cells within the drag rectangle into SAND grains.

  _erodeRect(x0, y0, x1, y1) {
    if (!this._grid) return;
    const S  = this.SCALE;
    const gW = this._gW, gH = this._gH;
    const gx0 = Math.floor(Math.min(x0, x1) / S);
    const gy0 = Math.floor(Math.min(y0, y1) / S);
    const gx1 = Math.ceil( Math.max(x0, x1) / S);
    const gy1 = Math.ceil( Math.max(y0, y1) / S);

    for (let gy = Math.max(0, gy0); gy < Math.min(gH, gy1); gy++) {
      for (let gx = Math.max(0, gx0); gx < Math.min(gW, gx1); gx++) {
        const idx = gy * gW + gx;
        if (this._grid[idx] === this.LETTER) this._grid[idx] = this.SAND;
      }
    }
  }

  // ── Sand physics ─────────────────────────────────────────────────────────
  // Cellular automaton: grains fall straight down, slide diagonally when blocked.

  _updateSand() {
    const grid = this._grid;
    if (!grid) return;
    const gW = this._gW, gH = this._gH;
    const EMPTY = this.EMPTY, SAND = this.SAND;
    const spread = this.spread + 1;

    for (let y = gH - 2; y >= 0; y--) {
      const leftFirst = (y & 1) === 0;
      for (let xi = 0; xi < gW; xi++) {
        const x  = leftFirst ? xi : gW - 1 - xi;
        const ci = y * gW + x;
        if (grid[ci] !== SAND) continue;

        const bel = ci + gW;
        if (grid[bel] === EMPTY) {
          grid[bel] = SAND;
          grid[ci]  = EMPTY;
          continue;
        }

        const dir = Math.random() < 0.5 ? 1 : -1;
        let moved = false;
        for (let s = 1; s <= spread && !moved; s++) {
          const xA = x + dir * s;
          const xB = x - dir * s;
          if (xA >= 0 && xA < gW && grid[(y + 1) * gW + xA] === EMPTY) {
            grid[(y + 1) * gW + xA] = SAND;
            grid[ci] = EMPTY;
            moved = true;
          } else if (xB >= 0 && xB < gW && grid[(y + 1) * gW + xB] === EMPTY) {
            grid[(y + 1) * gW + xB] = SAND;
            grid[ci] = EMPTY;
            moved = true;
          }
        }
      }
    }
  }

  // ── Render ────────────────────────────────────────────────────────────────

  render() {
    const { canvas } = this;
    canvas.beginLayer('quicksand');
    try {
    const ctx = canvas.ctx;
    const W   = canvas.width, H = canvas.height;

    if (!this._grid) {
      if (this._textCanvas) {
        ctx.drawImage(this._textCanvas, 0, 0);
      } else {
        ctx.fillStyle = this.bgColor;
        ctx.fillRect(0, 0, W, H);
      }
      return;
    }

    const S  = this.SCALE;
    const gW = this._gW, gH = this._gH;
    const ld = this._letterData;
    const [sr, sg, sb] = this._sandRGB;
    const [br, bg, bb] = this._bgRGB;
    const LETTER = this.LETTER, SAND = this.SAND;

    const grid = this._grid;

    const id = ctx.createImageData(W, H);
    const px = id.data;

    for (let gy = 0; gy < gH; gy++) {
      for (let gx = 0; gx < gW; gx++) {
        const cell = grid[gy * gW + gx];
        const px0  = gx * S, py0 = gy * S;

        for (let dy = 0; dy < S; dy++) {
          for (let dx = 0; dx < S; dx++) {
            const ox = px0 + dx, oy = py0 + dy;
            const oi = (oy * W + ox) * 4;

            if (cell === LETTER) {
              px[oi]     = ld[oi];
              px[oi + 1] = ld[oi + 1];
              px[oi + 2] = ld[oi + 2];
              px[oi + 3] = 255;
            } else if (cell === SAND) {
              const v = ((gx * 31 + gy * 17) & 15) - 7;
              px[oi]     = Math.min(255, Math.max(0, sr + v));
              px[oi + 1] = Math.min(255, Math.max(0, sg + v));
              px[oi + 2] = Math.min(255, Math.max(0, sb + (v >> 1)));
              px[oi + 3] = 255;
            } else {
              px[oi]     = br;
              px[oi + 1] = bg;
              px[oi + 2] = bb;
              px[oi + 3] = 255;
            }
          }
        }
      }
    }

    ctx.putImageData(id, 0, 0);

    // Selection rectangle preview during drag
    if (this._drag) {
      const { startX, startY, curX, curY } = this._drag;
      const rx = Math.min(startX, curX);
      const ry = Math.min(startY, curY);
      const rw = Math.abs(curX - startX);
      const rh = Math.abs(curY - startY);
      ctx.save();
      ctx.strokeStyle = 'rgba(255,220,90,0.9)';
      ctx.lineWidth   = 1.5;
      ctx.setLineDash([5, 4]);
      ctx.strokeRect(rx, ry, rw, rh);
      ctx.fillStyle = 'rgba(255,200,70,0.07)';
      ctx.fillRect(rx, ry, rw, rh);
      ctx.restore();
    }
    } finally {
      canvas.endLayer();
    }
  }

  // ── Loop ─────────────────────────────────────────────────────────────────

  _startLoop() {
    if (this._raf) return;
    const step = () => {
      if (!this._isTabActive()) { this._raf = null; return; }
      if (this._grid) {
        this._frameAcc += this.fallSpeed / 30;
        while (this._frameAcc >= 1) { this._updateSand(); this._frameAcc -= 1; }
      }
      this.render();
      this._raf = requestAnimationFrame(step);
    };
    this._raf = requestAnimationFrame(step);
  }

  _stopLoop() {
    if (this._raf) { cancelAnimationFrame(this._raf); this._raf = null; }
  }

  // ── Canvas events ─────────────────────────────────────────────────────────

  _bindCanvas() {
    const el = this.canvas.el;

    el.addEventListener('mousedown', e => {
      if (!this._selectMode || !this._isTabActive()) return;
      const { x, y } = this._xy(e);
      this._drag = { startX: x, startY: y, curX: x, curY: y };
      e.preventDefault();
    });

    el.addEventListener('mousemove', e => {
      if (!this._selectMode || !this._drag) return;
      const { x, y } = this._xy(e);
      this._drag.curX = x;
      this._drag.curY = y;
    });

    const endDrag = () => {
      if (!this._drag) return;
      const { startX, startY, curX, curY } = this._drag;
      this._drag = null;
      const w = Math.abs(curX - startX);
      const h = Math.abs(curY - startY);
      if (w >= 3 || h >= 3) {
        this._erodeRect(startX, startY, curX, curY);
      }
    };

    el.addEventListener('mouseup',    endDrag);
    el.addEventListener('mouseleave', () => { this._drag = null; });
  }

  // ── UI ────────────────────────────────────────────────────────────────────

  _bindUI() {
    document.getElementById('qs-text-input').addEventListener('input', e => {
      this.text = e.target.value;
      if (this._isTabActive()) {
        this._buildTextCanvas();
        this._buildGrid();
      }
    });

    this._slider('sl-ls-qs', 'v-ls-qs', v => {
      this.lineSpacing = v;
      if (this._isTabActive()) { this._buildTextCanvas(); this._buildGrid(); }
    });

    document.getElementById('btn-qs-select').addEventListener('click', () => {
      const btn = document.getElementById('btn-qs-select');
      this._selectMode = !this._selectMode;
      btn.textContent = this._selectMode ? 'Select: On' : 'Select';
      btn.classList.toggle('btn-on', this._selectMode);
      this.canvas.el.style.cursor = this._selectMode ? 'crosshair' : 'default';
    });

    document.getElementById('btn-qs-reset').addEventListener('click', () => this.reset());

    this._slider('sl-qs-speed',  'v-qs-speed',  v => { this.fallSpeed = Math.round(v); });
    this._slider('sl-qs-spread', 'v-qs-spread', v => { this.spread    = Math.round(v); });
    this._slider('sl-qs-grain',  'v-qs-grain',  v => {
      this.SCALE = Math.round(v);
      if (this._textCanvas) this._buildGrid();
    });

    const txtSwatch = document.getElementById('qs-text-swatch');
    const txtLabel  = document.getElementById('qs-text-label');
    const txtInput  = document.getElementById('qs-text-input-color');
    txtSwatch.addEventListener('click', () => txtInput.click());
    txtInput.addEventListener('input', () => {
      this.textColor = txtInput.value;
      this._sandRGB  = this._hex2rgb(txtInput.value);  // sand always matches text
      txtLabel.textContent       = txtInput.value;
      txtSwatch.style.background = txtInput.value;
      if (this._isTabActive()) { this._buildTextCanvas(); this._buildGrid(); }
    });

    document.addEventListener('tabchange', e => {
      if (e.detail === 'quicksand') {
        this._buildTextCanvas();
        this._buildGrid();
        this._startLoop();
      } else {
        this._selectMode = false;
        this._drag       = null;
        this.canvas.el.style.cursor = 'default';
        this._stopLoop();
        const btn = document.getElementById('btn-qs-select');
        if (btn) { btn.textContent = 'Select'; btn.classList.remove('btn-on'); }
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

  reset() {
    this._stopLoop();
    this._selectMode = false;
    this._drag       = null;
    this._grid       = null;
    this._letterData = null;
    this._frameAcc   = 0;
    this.canvas.el.style.cursor = 'default';
    const btn = document.getElementById('btn-qs-select');
    if (btn) { btn.textContent = 'Select'; btn.classList.remove('btn-on'); }
    this._buildTextCanvas();
    this._buildGrid();
    if (this._isTabActive()) this._startLoop();
  }
}

const quicksandController = new QuicksandController(canvas);
