// stain.js — Ink stain: letters bleed directional streaks like wet ink on paper

class StainController {
  constructor(canvas) {
    this.canvas = canvas;

    this.text        = '';
    this.lineSpacing = 1.0;
    this.bold        = true;

    this.inkColor  = '#0a0a0a';
    this.bgColor   = '#f5f5f0';

    this.direction  = 'down'; // down | up | left | right | all
    this.density    = 0.7;    // probability an exit edge spawns drips
    this.maxLength  = 200;    // max drip length (px)
    this.spread     = 3;      // max lateral drift (px)
    this.decay      = 0.975;  // alpha decay per step (higher = longer tails)

    this._result     = null;  // offscreen canvas with built result
    this._needsBuild = false;

    this._bindUI();
  }

  // ── Helpers ─────────────────────────────────────────────────────────────────

  _isActive() {
    return document.getElementById('sec-stain')?.classList.contains('active');
  }

  _hex2rgb(hex) {
    return [
      parseInt(hex.slice(1, 3), 16),
      parseInt(hex.slice(3, 5), 16),
      parseInt(hex.slice(5, 7), 16),
    ];
  }

  _fontSize() {
    const W = this.canvas.width, H = this.canvas.height;
    const lines  = this.text.split('\n');
    const maxLen = Math.max(...lines.map(l => l.length), 1);
    const nLines = lines.length || 1;
    return Math.min(
      Math.max(24, Math.min(W, H) * 0.55 / Math.max(1, Math.pow(maxLen, 0.55))),
      Math.max(24, H * 0.78 / (nLines * this.lineSpacing))
    );
  }

  // ── Text render ──────────────────────────────────────────────────────────────

  _renderText() {
    const W = this.canvas.width, H = this.canvas.height;
    const tc  = document.createElement('canvas');
    tc.width  = W; tc.height = H;
    const ctx = tc.getContext('2d');

    ctx.fillStyle = this.bgColor;
    ctx.fillRect(0, 0, W, H);

    if (!this.text.trim()) return tc;

    const fs     = this._fontSize();
    const weight = this.bold ? 'bold ' : '';
    const lines  = this.text.split('\n');
    const lh     = fs * this.lineSpacing;
    const startY = (H - lines.length * lh) / 2 + fs;

    ctx.font         = `${weight}${fs}px monospace`;
    ctx.fillStyle    = this.inkColor;
    ctx.textAlign    = 'center';
    ctx.textBaseline = 'alphabetic';
    lines.forEach((line, i) => ctx.fillText(line, W / 2, startY + i * lh));

    return tc;
  }

  // ── Stain algorithm ──────────────────────────────────────────────────────────

  _buildStain() {
    const W = this.canvas.width, H = this.canvas.height;
    if (!W || !H) return;

    const srcData = this._renderText().getContext('2d').getImageData(0, 0, W, H).data;
    const [bgR,  bgG,  bgB]  = this._hex2rgb(this.bgColor);
    const [inkR, inkG, inkB] = this._hex2rgb(this.inkColor);

    const dst = new Uint8ClampedArray(srcData); // start from source copy

    // Check original letter pixels (not dst, so stains from all passes can overlap freely)
    const isLetter = (x, y) => {
      if (x < 0 || x >= W || y < 0 || y >= H) return false;
      const i = (y * W + x) * 4;
      return Math.abs(srcData[i] - bgR) + Math.abs(srcData[i+1] - bgG) + Math.abs(srcData[i+2] - bgB) > 30;
    };

    const paint = (x, y, alpha) => {
      if (x < 0 || x >= W || y < 0 || y >= H) return;
      if (isLetter(x, y)) return;
      const i = (y * W + x) * 4;
      const a = Math.min(1, alpha);
      dst[i]   = Math.round(dst[i]   * (1 - a) + inkR * a);
      dst[i+1] = Math.round(dst[i+1] * (1 - a) + inkG * a);
      dst[i+2] = Math.round(dst[i+2] * (1 - a) + inkB * a);
      dst[i+3] = 255;
    };

    // Column scan (down or up)
    const runCol = (forward) => {
      const yStart = forward ? 0 : H - 1;
      const yEnd   = forward ? H : -1;
      const yStep  = forward ? 1 : -1;

      for (let x = 0; x < W; x++) {
        const drips = [];
        let prevLetter = false;

        for (let y = yStart; y !== yEnd; y += yStep) {
          const letter = isLetter(x, y);

          // Spawn drips at each letter→empty edge
          if (!letter && prevLetter) {
            const n = Math.random() < this.density
              ? 1 + (Math.random() < 0.45 ? 1 : 0)
              : 0;
            for (let d = 0; d < n; d++) {
              drips.push({
                dx:    Math.round((Math.random() - 0.5) * this.spread * 1.4),
                len:   Math.floor(this.maxLength * (0.25 + Math.random() * 0.75)),
                alpha: 0.8 + Math.random() * 0.2,
                decay: 0.966 + Math.random() * 0.022,
              });
            }
          }
          prevLetter = letter;

          if (!letter) {
            let i = drips.length;
            while (i--) {
              const dr = drips[i];
              paint(x + dr.dx, y, dr.alpha);
              // Thin edge fringe
              if (this.spread > 0 && Math.random() < 0.22)
                paint(x + dr.dx + (Math.random() < 0.5 ? 1 : -1), y, dr.alpha * 0.32);
              dr.alpha *= dr.decay;
              dr.len--;
              if (Math.random() < 0.22) dr.dx += Math.random() < 0.5 ? 1 : -1;
              dr.dx = Math.max(-this.spread, Math.min(this.spread, dr.dx));
              if (dr.len <= 0 || dr.alpha < 0.012) drips.splice(i, 1);
            }
          }
        }
      }
    };

    // Row scan (left or right)
    const runRow = (forward) => {
      const xStart = forward ? 0 : W - 1;
      const xEnd   = forward ? W : -1;
      const xStep  = forward ? 1 : -1;

      for (let y = 0; y < H; y++) {
        const drips = [];
        let prevLetter = false;

        for (let x = xStart; x !== xEnd; x += xStep) {
          const letter = isLetter(x, y);

          if (!letter && prevLetter) {
            const n = Math.random() < this.density
              ? 1 + (Math.random() < 0.45 ? 1 : 0)
              : 0;
            for (let d = 0; d < n; d++) {
              drips.push({
                dy:    Math.round((Math.random() - 0.5) * this.spread * 1.4),
                len:   Math.floor(this.maxLength * (0.25 + Math.random() * 0.75)),
                alpha: 0.8 + Math.random() * 0.2,
                decay: 0.966 + Math.random() * 0.022,
              });
            }
          }
          prevLetter = letter;

          if (!letter) {
            let i = drips.length;
            while (i--) {
              const dr = drips[i];
              paint(x, y + dr.dy, dr.alpha);
              if (this.spread > 0 && Math.random() < 0.22)
                paint(x, y + dr.dy + (Math.random() < 0.5 ? 1 : -1), dr.alpha * 0.32);
              dr.alpha *= dr.decay;
              dr.len--;
              if (Math.random() < 0.22) dr.dy += Math.random() < 0.5 ? 1 : -1;
              dr.dy = Math.max(-this.spread, Math.min(this.spread, dr.dy));
              if (dr.len <= 0 || dr.alpha < 0.012) drips.splice(i, 1);
            }
          }
        }
      }
    };

    const dirs = this.direction === 'all'
      ? ['down', 'up', 'left', 'right']
      : [this.direction];

    for (const d of dirs) {
      if (d === 'down')  runCol(true);
      if (d === 'up')    runCol(false);
      if (d === 'right') runRow(true);
      if (d === 'left')  runRow(false);
    }

    const result = document.createElement('canvas');
    result.width = W; result.height = H;
    result.getContext('2d').putImageData(new ImageData(dst, W, H), 0, 0);
    this._result = result;
  }

  // ── Render ───────────────────────────────────────────────────────────────────

  render() {
    this.canvas.beginLayer('stain');
    try {
      const ctx = this.canvas.ctx;
      ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
      if (!this.text.trim()) return;
      if (this._needsBuild || !this._result) {
        this._buildStain();
        this._needsBuild = false;
      }
      if (this._result) ctx.drawImage(this._result, 0, 0);
    } finally {
      this.canvas.endLayer();
    }
  }

  // ── UI ───────────────────────────────────────────────────────────────────────

  _bindUI() {
    const ti = document.getElementById('stain-text-input');
    if (ti) {
      ti.addEventListener('input', () => {
        this.text = ti.value;
        this._needsBuild = true;
        this.render();
      });
    }

    document.querySelectorAll('.stain-dir-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.stain-dir-btn').forEach(b => b.classList.remove('btn-on'));
        btn.classList.add('btn-on');
        this.direction = btn.dataset.dir;
        this._needsBuild = true;
        this.render();
      });
    });

    document.getElementById('btn-stain-bold')?.addEventListener('click', () => {
      const btn = document.getElementById('btn-stain-bold');
      this.bold = !this.bold;
      btn.classList.toggle('btn-on', this.bold);
      this._needsBuild = true;
      this.render();
    });

    document.getElementById('btn-stain-build')?.addEventListener('click', () => {
      this._needsBuild = true;
      this.render();
    });

    document.getElementById('btn-stain-reset')?.addEventListener('click', () => {
      this._result = null;
      this._needsBuild = false;
      this.canvas.beginLayer('stain');
      this.canvas.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
      this.canvas.endLayer();
    });

    this._slider('sl-stain-ls',      'v-stain-ls',      v => { this.lineSpacing = v; });
    this._slider('sl-stain-density', 'v-stain-density', v => { this.density    = v; });
    this._slider('sl-stain-length',  'v-stain-length',  v => { this.maxLength  = Math.round(v); });
    this._slider('sl-stain-spread',  'v-stain-spread',  v => { this.spread     = Math.round(v); });
    this._slider('sl-stain-decay',   'v-stain-decay',   v => { this.decay      = v; });

    this._colorPicker('stain-ink-swatch', 'stain-ink-label', 'stain-ink-input', v => {
      this.inkColor = v; this._needsBuild = true; this.render();
    });
    this._colorPicker('stain-bg-swatch', 'stain-bg-label', 'stain-bg-input', v => {
      this.bgColor = v; this._needsBuild = true; this.render();
    });

    document.addEventListener('tabchange', e => {
      if (e.detail === 'stain') this.render();
    });

    window.addEventListener('resize', () => {
      if (this._isActive()) { this._needsBuild = true; this.render(); }
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

  _colorPicker(swatchId, labelId, inputId, onChange) {
    const swatch = document.getElementById(swatchId);
    const label  = document.getElementById(labelId);
    const input  = document.getElementById(inputId);
    if (!swatch || !input) return;
    swatch.addEventListener('click', () => input.click());
    input.addEventListener('input', () => {
      onChange(input.value);
      if (label) label.textContent = input.value;
      swatch.style.background = input.value;
    });
  }
}

const stainController = new StainController(canvas);
