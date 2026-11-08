// sand.js — Sand erosion: drag brush over letters to dissolve them into falling sand

class SandController {
  constructor(canvas) {
    this.canvas = canvas;

    this.brushSize = 20;       // canvas pixels
    this.fallSpeed = 2;        // simulation steps per animation frame
    this.spread    = 1;        // diagonal slide distance (0 = straight down only)
    this.color     = '#e8c97c';
    this.bgColor   = '#111111';

    // Cellular automaton constants
    this.EMPTY  = 0;
    this.LETTER = 1; // static — eroded by brush
    this.SAND   = 2; // falling / settled

    // Each grid cell = SCALE×SCALE canvas pixels (grain size)
    this.SCALE = 2;

    this._grid       = null;
    this._gW         = 0;
    this._gH         = 0;
    this._letterData = null; // Uint8ClampedArray snapshot of original canvas
    this._sandRGB    = this._hex2rgb(this.color);
    this._bgRGB      = this._hex2rgb(this.bgColor);

    this._active   = false;
    this._painting = false;
    this._lastX    = 0;
    this._lastY    = 0;
    this._raf      = null;

    this._bindCanvas();
    this._bindUI();
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

  _isActive() {
    return document.getElementById('sec-dots')?.classList.contains('active');
  }

  // ── Setup / teardown ───────────────────────────────────────────────────────

  // Snapshot the current canvas, build the cellular grid from its bright pixels.
  activate() {
    const { canvas } = this;
    const W = canvas.width, H = canvas.height;
    if (!W || !H) return;

    this._gW = Math.floor(W / this.SCALE);
    this._gH = Math.floor(H / this.SCALE);
    this._grid = new Uint8Array(this._gW * this._gH);

    // Copy current canvas into an offscreen snapshot
    const snap = document.createElement('canvas');
    snap.width = W; snap.height = H;
    snap.getContext('2d').drawImage(canvas.el, 0, 0);

    const id   = snap.getContext('2d').getImageData(0, 0, W, H);
    this._letterData = id.data.slice(); // keep a permanent copy for LETTER pixels

    // Mark grid cells: any cell whose top-left pixel is clearly non-background = LETTER
    const d  = id.data;
    const gW = this._gW, gH = this._gH, S = this.SCALE;
    for (let gy = 0; gy < gH; gy++) {
      for (let gx = 0; gx < gW; gx++) {
        const i = ((gy * S) * W + gx * S) * 4;
        if (d[i] > 60 || d[i + 1] > 60 || d[i + 2] > 60) {
          this._grid[gy * gW + gx] = this.LETTER;
        }
      }
    }

    this._active = true;
    canvas.el.style.cursor = 'crosshair';
    this._startLoop();
  }

  deactivate() {
    this._active   = false;
    this._painting = false;
    this._stopLoop();
    this.canvas.el.style.cursor = 'default';
  }

  reset() {
    this.deactivate();
    this._grid       = null;
    this._letterData = null;
    const btn = document.getElementById('btn-sand');
    if (btn) { btn.textContent = 'Sand'; btn.classList.remove('btn-on'); }
  }

  // ── Physics ────────────────────────────────────────────────────────────────

  _updateSand() {
    const grid = this._grid;
    if (!grid) return;
    const gW = this._gW, gH = this._gH;
    const EMPTY = this.EMPTY, SAND = this.SAND;
    const spread = this.spread + 1; // +1 so spread=0 still tries immediate diagonal

    // Sweep bottom-to-top; alternate left/right scan per row to avoid bias
    for (let y = gH - 2; y >= 0; y--) {
      const leftFirst = (y & 1) === 0;
      for (let xi = 0; xi < gW; xi++) {
        const x  = leftFirst ? xi : gW - 1 - xi;
        const ci = y * gW + x;
        if (grid[ci] !== SAND) continue;

        const bel = ci + gW; // index directly below

        if (grid[bel] === EMPTY) {
          // Fall straight down
          grid[bel] = SAND;
          grid[ci]  = EMPTY;
          continue;
        }

        // Try to slide diagonally (random side first)
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

  _applyBrush(cx, cy) {
    const grid = this._grid;
    if (!grid) return;
    const S   = this.SCALE;
    const gx0 = Math.floor(cx / S);
    const gy0 = Math.floor(cy / S);
    const gr  = Math.ceil(this.brushSize / S);
    const gr2 = gr * gr;

    for (let dy = -gr; dy <= gr; dy++) {
      for (let dx = -gr; dx <= gr; dx++) {
        if (dx * dx + dy * dy > gr2) continue;
        const gx = gx0 + dx, gy = gy0 + dy;
        if (gx < 0 || gy < 0 || gx >= this._gW || gy >= this._gH) continue;
        const idx = gy * this._gW + gx;
        if (grid[idx] === this.LETTER) grid[idx] = this.SAND;
      }
    }
  }

  // ── Rendering ──────────────────────────────────────────────────────────────

  _render() {
    const { canvas } = this;
    canvas.beginLayer('dots');
    const ctx = canvas.ctx;
    const W   = canvas.width, H = canvas.height;
    const grid = this._grid;
    if (!grid) { canvas.endLayer(); return; }

    const S  = this.SCALE;
    const gW = this._gW, gH = this._gH;
    const ld = this._letterData;
    const [sr, sg, sb] = this._sandRGB;
    const [br, bg, bb] = this._bgRGB;
    const LETTER = this.LETTER, SAND = this.SAND;

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
              // Restore original pixel from snapshot
              px[oi]     = ld[oi];
              px[oi + 1] = ld[oi + 1];
              px[oi + 2] = ld[oi + 2];
              px[oi + 3] = 255;
            } else if (cell === SAND) {
              // Deterministic per-grain tint — stable, no flickering
              const v    = ((gx * 31 + gy * 17) & 15) - 7;
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
    canvas.endLayer();
  }

  // ── Loop ───────────────────────────────────────────────────────────────────

  _startLoop() {
    if (this._raf) return;
    const step = () => {
      if (!this._active) return;
      for (let i = 0; i < this.fallSpeed; i++) this._updateSand();
      this._render();
      this._raf = requestAnimationFrame(step);
    };
    this._raf = requestAnimationFrame(step);
  }

  _stopLoop() {
    if (this._raf) { cancelAnimationFrame(this._raf); this._raf = null; }
  }

  // ── Canvas events ──────────────────────────────────────────────────────────

  _bindCanvas() {
    const el = this.canvas.el;

    el.addEventListener('mousedown', e => {
      if (!this._active) return;
      this._painting = true;
      const { x, y } = this._xy(e);
      this._lastX = x; this._lastY = y;
      this._applyBrush(x, y);
      e.preventDefault();
    });

    el.addEventListener('mousemove', e => {
      if (!this._active || !this._painting) return;
      const { x, y } = this._xy(e);
      // Interpolate along the stroke so fast drags leave no gaps
      const dist  = Math.hypot(x - this._lastX, y - this._lastY);
      const steps = Math.max(1, Math.ceil(dist / (this.brushSize * 0.4)));
      for (let i = 1; i <= steps; i++) {
        const t = i / steps;
        this._applyBrush(
          this._lastX + (x - this._lastX) * t,
          this._lastY + (y - this._lastY) * t,
        );
      }
      this._lastX = x; this._lastY = y;
    });

    el.addEventListener('mouseup',    () => { this._painting = false; });
    el.addEventListener('mouseleave', () => { this._painting = false; });
  }

  // ── UI ─────────────────────────────────────────────────────────────────────

  _bindUI() {
    document.getElementById('btn-sand').addEventListener('click', () => {
      const btn = document.getElementById('btn-sand');
      if (this._active) {
        this.deactivate();
        btn.textContent = 'Sand';
        btn.classList.remove('btn-on');
      } else {
        this.activate();
        btn.textContent = 'Sand: On';
        btn.classList.add('btn-on');
      }
    });

    document.getElementById('btn-sand-reset').addEventListener('click', () => this.reset());

    this._slider('sl-sand-brush',  'v-sand-brush',  v => { this.brushSize = v; });
    this._slider('sl-sand-speed',  'v-sand-speed',  v => { this.fallSpeed = Math.round(v); });
    this._slider('sl-sand-spread', 'v-sand-spread', v => { this.spread    = Math.round(v); });

    const swatch = document.getElementById('sand-color-swatch');
    const label  = document.getElementById('sand-color-label');
    const input  = document.getElementById('sand-color-input');
    swatch.addEventListener('click', () => input.click());
    input.addEventListener('input', () => {
      this.color    = input.value;
      this._sandRGB = this._hex2rgb(input.value);
      label.textContent       = input.value;
      swatch.style.background = input.value;
    });

    document.addEventListener('tabchange', e => {
      if (e.detail !== 'dots') {
        this.deactivate();
        const btn = document.getElementById('btn-sand');
        if (btn) { btn.textContent = 'Sand'; btn.classList.remove('btn-on'); }
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
}

const sandController = new SandController(canvas);
