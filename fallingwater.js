// fallingwater.js — Mascara-drip: drag to select letters, they melt downward as flowing ink

class FallingWaterController {
  constructor(canvas) {
    this.canvas    = canvas;
    this.text      = '';
    this.textColor = '#ffffff';
    this.bgColor   = '#111111';

    this.lineSpacing = 1.0;

    this.dripSpeed = 3;    // slider 1-10; rate = dripSpeed/30 steps per frame
    this.spread    = 3;    // 0-8: lateral rivulet probability

    this.SCALE = 2;

    this.EMPTY    = 0;
    this.LETTER   = 1;   // intact, unselected letter pixel
    this.SELECTED = 2;   // selected letter pixel — will drip

    this._letterMask = null;
    this._inkGrid    = null;
    this._gW = 0;
    this._gH = 0;
    this._letterData = null;

    this._inkR = 255; this._inkG = 255; this._inkB = 255;

    this._selectMode = false;
    this._drag       = null;
    this._raf        = null;
    this._frameAcc   = 0;
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
    return document.getElementById('sec-water')?.classList.contains('active');
  }

  // ── Text canvas ────────────────────────────────────────────────────────────

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
    const len = this._gW * this._gH;
    this._letterMask = new Uint8Array(len);
    this._inkGrid    = new Float32Array(len);

    const id = this._textCanvas.getContext('2d').getImageData(0, 0, W, H);
    this._letterData = id.data.slice();

    const d = id.data, gW = this._gW, gH = this._gH;
    for (let gy = 0; gy < gH; gy++) {
      for (let gx = 0; gx < gW; gx++) {
        const i = ((gy * S) * W + gx * S) * 4;
        if (d[i] > 60 || d[i + 1] > 60 || d[i + 2] > 60) {
          this._letterMask[gy * gW + gx] = this.LETTER;
        }
      }
    }
  }

  // ── Selection ─────────────────────────────────────────────────────────────
  // Mark LETTER cells inside the drag rectangle as SELECTED and seed with ink.

  _selectRect(x0, y0, x1, y1) {
    if (!this._letterMask) return false;
    const S  = this.SCALE, gW = this._gW, gH = this._gH;
    const gx0 = Math.floor(Math.min(x0, x1) / S);
    const gy0 = Math.floor(Math.min(y0, y1) / S);
    const gx1 = Math.ceil( Math.max(x0, x1) / S);
    const gy1 = Math.ceil( Math.max(y0, y1) / S);

    // Per-column ink bias — dramatic variation so columns behave completely differently
    const colCount = Math.max(1, gx1 - gx0);
    const colBias  = new Float32Array(colCount);
    for (let c = 0; c < colCount; c++) {
      const r = Math.random();
      if (r < 0.25) {
        colBias[c] = 0.04 + Math.random() * 0.20;   // dry: barely any ink
      } else if (r < 0.60) {
        colBias[c] = 0.7  + Math.random() * 0.9;    // normal flow
      } else {
        colBias[c] = 2.8  + Math.random() * 2.2;    // drenched: heavy cascade
      }
    }

    let any = false;
    for (let gy = Math.max(0, gy0); gy < Math.min(gH, gy1); gy++) {
      for (let gx = Math.max(0, gx0); gx < Math.min(gW, gx1); gx++) {
        const idx = gy * gW + gx;
        if (this._letterMask[idx] === this.LETTER) {
          this._letterMask[idx] = this.SELECTED;
          const bias = colBias[gx - gx0];
          this._inkGrid[idx] = bias * (0.7 + Math.random() * 0.6);
          any = true;
        }
      }
    }
    return any;
  }

  // ── Physics ───────────────────────────────────────────────────────────────
  // Ink flows downward under gravity; lateral spread creates rivulets.

  _updateDrip() {
    const gW  = this._gW, gH = this._gH;
    const ink = this._inkGrid;
    // Spread 0 → almost no lateral; spread 8 → aggressive rivulet branching
    const lateralProb = this.spread * 0.042;

    for (let y = 0; y < gH - 1; y++) {
      for (let x = 0; x < gW; x++) {
        const ci     = y * gW + x;
        const amount = ink[ci];
        if (amount < 0.004) continue;

        // Flow rate scales dramatically with ink weight — heavy ink gushes, thin ink crawls
        let flowFrac;
        if (amount > 3.5) {
          flowFrac = 0.32 + Math.random() * 0.18;  // gushing — 32–50% per step
        } else if (amount > 1.5) {
          flowFrac = 0.16 + Math.random() * 0.12;  // flowing — 16–28%
        } else if (amount > 0.4) {
          flowFrac = 0.05 + Math.random() * 0.07;  // trickling — 5–12%
        } else {
          flowFrac = 0.01 + Math.random() * 0.025; // barely moving — 1–3.5%
        }

        const toFlow = amount * flowFrac;

        const down = (y + 1) * gW + x;
        ink[down] = Math.min(5.0, ink[down] + toFlow);
        ink[ci]  -= toFlow;

        // Lateral spread — heavy ink blobs sideways more aggressively
        if (lateralProb > 0 && Math.random() < lateralProb) {
          const passes = amount > 2.5 ? 2 : 1;  // heavy ink can spread both directions
          for (let p = 0; p < passes; p++) {
            const dir = Math.random() < 0.5 ? -1 : 1;
            const nx  = x + dir;
            if (nx >= 0 && nx < gW) {
              const lateralFrac = amount > 2.5 ? 0.38 : 0.22;
              const lateralAmt  = toFlow * lateralFrac;
              ink[(y + 1) * gW + nx] = Math.min(5.0, ink[(y + 1) * gW + nx] + lateralAmt);
              ink[ci] -= lateralAmt;
            }
          }
        }
      }
    }
  }

  // ── Render ────────────────────────────────────────────────────────────────

  render() {
    const { canvas } = this;
    canvas.beginLayer('water');
    const ctx = canvas.ctx;
    const W   = canvas.width, H = canvas.height;

    if (!this._letterMask) {
      if (this._textCanvas) ctx.drawImage(this._textCanvas, 0, 0);
      else { ctx.fillStyle = this.bgColor; ctx.fillRect(0, 0, W, H); }
      this._drawDragPreview(ctx);
      canvas.endLayer();
      return;
    }

    const S    = this.SCALE;
    const gW   = this._gW, gH = this._gH;
    const ld   = this._letterData;
    const ink  = this._inkGrid;
    const mask = this._letterMask;
    const [br, bg, bb] = this._hex2rgb(this.bgColor);
    const ir = this._inkR, ig = this._inkG, ib = this._inkB;
    const LETTER = this.LETTER, SELECTED = this.SELECTED;

    const imgData = ctx.createImageData(W, H);
    const px = imgData.data;

    for (let gy = 0; gy < gH; gy++) {
      for (let gx = 0; gx < gW; gx++) {
        const ci     = gy * gW + gx;
        const m      = mask[ci];
        const inkAmt = ink[ci];
        const px0    = gx * S, py0 = gy * S;

        for (let dy = 0; dy < S; dy++) {
          for (let dx = 0; dx < S; dx++) {
            const ox = px0 + dx, oy = py0 + dy;
            const oi = (oy * W + ox) * 4;
            let r, g, b;

            if (m === LETTER) {
              // Unselected letters — always fully intact
              r = ld[oi]; g = ld[oi + 1]; b = ld[oi + 2];
            } else if (m === SELECTED) {
              // Selected letters — fade to background as ink drains
              const t = Math.min(1, inkAmt);
              r = Math.round(br + (ld[oi]     - br) * t);
              g = Math.round(bg + (ld[oi + 1] - bg) * t);
              b = Math.round(bb + (ld[oi + 2] - bb) * t);
            } else {
              // Empty cells — drip trail: heavy ink fully opaque, thin ink fades
              if (inkAmt > 0.004) {
                let a;
                if (inkAmt >= 3.0) {
                  a = 1.0;
                } else if (inkAmt >= 1.2) {
                  a = 0.78 + (inkAmt - 1.2) / 1.8 * 0.22;
                } else {
                  a = Math.pow(inkAmt / 1.2, 0.5);
                }
                r = Math.round(br + (ir - br) * a);
                g = Math.round(bg + (ig - bg) * a);
                b = Math.round(bb + (ib - bb) * a);
              } else {
                r = br; g = bg; b = bb;
              }
            }

            px[oi]     = r;
            px[oi + 1] = g;
            px[oi + 2] = b;
            px[oi + 3] = 255;
          }
        }
      }
    }

    ctx.putImageData(imgData, 0, 0);
    this._drawDragPreview(ctx);
    canvas.endLayer();
  }

  _drawDragPreview(ctx) {
    if (!this._drag) return;
    const { startX, startY, curX, curY } = this._drag;
    const rx = Math.min(startX, curX), ry = Math.min(startY, curY);
    const rw = Math.abs(curX - startX), rh = Math.abs(curY - startY);
    ctx.save();
    ctx.strokeStyle = 'rgba(100,180,255,0.85)';
    ctx.lineWidth   = 1.5;
    ctx.setLineDash([5, 4]);
    ctx.strokeRect(rx, ry, rw, rh);
    ctx.fillStyle = 'rgba(80,160,255,0.07)';
    ctx.fillRect(rx, ry, rw, rh);
    ctx.restore();
  }

  // ── Loop ─────────────────────────────────────────────────────────────────

  _hasAnyInk() {
    if (!this._inkGrid) return false;
    const ink = this._inkGrid;
    for (let i = 0; i < ink.length; i++) {
      if (ink[i] > 0.004) return true;
    }
    return false;
  }

  _startLoop() {
    window._fwActive = true;
    if (this._raf) return;
    const step = () => {
      if (!this._isTabActive()) { this._raf = null; return; }
      this._frameAcc += this.dripSpeed / 30;
      while (this._frameAcc >= 1) { this._updateDrip(); this._frameAcc -= 1; }
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
      if (Math.abs(curX - startX) >= 3 || Math.abs(curY - startY) >= 3) {
        if (!this._letterMask) { this._buildTextCanvas(); this._buildGrid(); }
        if (this._selectRect(startX, startY, curX, curY)) this._startLoop();
      }
    };

    el.addEventListener('mouseup',    endDrag);
    el.addEventListener('mouseleave', () => { this._drag = null; });
  }

  // ── UI ────────────────────────────────────────────────────────────────────

  _bindUI() {
    document.getElementById('water-text-input').addEventListener('input', e => {
      this.text = e.target.value;
      if (this._isTabActive() && this._letterMask) {
        this._buildTextCanvas();
        this._buildGrid();
      }
    });

    this._slider('sl-ls-water', 'v-ls-water', v => {
      this.lineSpacing = v;
      if (this._isTabActive() && this._letterMask) { this._buildTextCanvas(); this._buildGrid(); }
    });

    // Share the water ripple color picker — ink color matches text color
    document.getElementById('water-color-input').addEventListener('input', e => {
      this.textColor = e.target.value;
      const [r, g, b] = this._hex2rgb(e.target.value);
      this._inkR = r; this._inkG = g; this._inkB = b;
    });

    document.getElementById('btn-fw-select').addEventListener('click', () => {
      const btn = document.getElementById('btn-fw-select');
      this._selectMode = !this._selectMode;
      btn.textContent = this._selectMode ? 'Select: On' : 'Select Letters';
      btn.classList.toggle('btn-on', this._selectMode);
      if (this._selectMode) {
        this.canvas.el.style.cursor = 'crosshair';
        if (!this._letterMask) { this._buildTextCanvas(); this._buildGrid(); }
        this._startLoop();
      } else {
        this.canvas.el.style.cursor = 'default';
      }
    });

    document.getElementById('btn-fw-reset').addEventListener('click', () => this.reset());

    this._slider('sl-fw-speed',  'v-fw-speed',  v => { this.dripSpeed = Math.round(v); });
    this._slider('sl-fw-spread', 'v-fw-spread', v => { this.spread    = Math.round(v); });

    document.addEventListener('tabchange', e => {
      if (e.detail === 'water') {
        this.text = document.getElementById('water-text-input').value;
        this._buildTextCanvas();
        if (!this._letterMask) this._buildGrid();
        // Only take over canvas if there's active ink
        if (this._hasAnyInk()) this._startLoop();
      } else {
        this._selectMode = false;
        this._drag       = null;
        this.canvas.el.style.cursor = 'default';
        this._stopLoop();
        const btn = document.getElementById('btn-fw-select');
        if (btn) { btn.textContent = 'Select Letters'; btn.classList.remove('btn-on'); }
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
    this._letterMask = null;
    this._inkGrid    = null;
    this._letterData = null;
    this._frameAcc   = 0;
    window._fwActive = false;
    this.canvas.el.style.cursor = 'default';
    const btn = document.getElementById('btn-fw-select');
    if (btn) { btn.textContent = 'Select Letters'; btn.classList.remove('btn-on'); }
    if (this._isTabActive()) waterController.render();
  }
}

const fallingWaterController = new FallingWaterController(canvas);
