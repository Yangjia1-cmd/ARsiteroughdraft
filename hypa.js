// hypa.js — organic root/hyphae growth from letter edges

class HypaController {
  constructor(canvas) {
    this.canvas = canvas;
    this.text   = '';
    this.color  = '#ffffff';
    this.bgColor = '#111111';

    this.lineSpacing = 1.0;

    this.density   = 40;   // relative density of start points (5-100)
    this.maxLen    = 120;  // max root length in px
    this.wiggle    = 35;   // turn randomness 0-100
    this.branches  = 40;   // branching probability 0-100
    this.thickness = 0.8;  // base line width multiplier

    this._textCanvas   = null;
    this._detectCanvas = null; // transparent-bg canvas for alpha-based edge detection
    this._drawCanvas   = null; // accumulates root strokes
    this._tips    = [];
    this._raf     = null;
    this._growing = false;

    this._bindUI();
    window.addEventListener('resize', () => {
      if (this._isActive()) { this._buildTextCanvas(); this.render(); }
    });
  }

  _isActive() {
    return document.getElementById('sec-hypa')?.classList.contains('active');
  }

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

    // Visible canvas: bg colour + styled text
    const tc   = document.createElement('canvas');
    tc.width   = W; tc.height = H;
    const tctx = tc.getContext('2d');
    tctx.fillStyle = this.bgColor;
    tctx.fillRect(0, 0, W, H);

    // Detection canvas: transparent bg, white text → use alpha for edge finding
    const dc   = document.createElement('canvas');
    dc.width   = W; dc.height = H;
    const dctx = dc.getContext('2d');

    if (this.text.trim()) {
      const lines  = this.text.split('\n');
      const fs     = this._fontSize();
      const lineH  = fs * this.lineSpacing;
      const startY = H / 2 - ((lines.length - 1) * lineH) / 2;

      for (const ctx of [tctx, dctx]) {
        ctx.font         = `${fs}px 'Courier New', monospace`;
        ctx.textAlign    = 'center';
        ctx.textBaseline = 'middle';
      }
      tctx.fillStyle = this.color;
      dctx.fillStyle = '#ffffff';
      lines.forEach((line, i) => {
        if (!line.length) return;
        const y = startY + i * lineH;
        tctx.fillText(line, W / 2, y);
        dctx.fillText(line, W / 2, y);
      });
    }

    this._textCanvas   = tc;
    this._detectCanvas = dc;
  }

  // Scan detect canvas for boundary pixels; return {x, y, nx, ny} for each.
  _findEdgePixels() {
    if (!this._detectCanvas) return [];
    const W    = this._detectCanvas.width;
    const H    = this._detectCanvas.height;
    const data = this._detectCanvas.getContext('2d').getImageData(0, 0, W, H).data;

    const on = (x, y) => {
      if (x < 0 || y < 0 || x >= W || y >= H) return false;
      return data[(y * W + x) * 4 + 3] > 128;
    };

    const edges = [];
    // Step by 2 to reduce work on large canvases without losing coverage
    for (let y = 1; y < H - 1; y += 2) {
      for (let x = 1; x < W - 1; x += 2) {
        if (!on(x, y)) continue;
        let nx = 0, ny = 0;
        if (!on(x + 1, y)) nx += 1;
        if (!on(x - 1, y)) nx -= 1;
        if (!on(x, y + 1)) ny += 1;
        if (!on(x, y - 1)) ny -= 1;
        if (nx === 0 && ny === 0) continue; // interior pixel — skip
        edges.push({ x, y, nx, ny });
      }
    }
    return edges;
  }

  startGrow() {
    this._stopGrow();
    this._buildTextCanvas();

    const W = this.canvas.width, H = this.canvas.height;
    const rc = document.createElement('canvas');
    rc.width = W; rc.height = H;
    this._drawCanvas = rc;

    const edges = this._findEdgePixels();
    if (!edges.length) { this.render(); return; }

    // Sample edge pixels — count scales with density but stays manageable
    const count = Math.min(800, Math.max(5, Math.floor(edges.length * this.density / 2000)));
    const sampled = edges.sort(() => Math.random() - 0.5).slice(0, count);

    const turnMax = (this.wiggle / 100) * 0.55;   // radians per step
    const branchP = (this.branches / 100) * 0.022; // probability per step

    this._tips = sampled.map(e => {
      // Outward normal from letter boundary + small noise for variety
      const baseAngle = Math.atan2(e.ny, e.nx) + (Math.random() - 0.5) * 0.9;
      return {
        x: e.x, y: e.y,
        angle:     baseAngle,
        initAngle: baseAngle,
        len:   0,
        depth: 0,
        lw:    (0.5 + Math.random() * 0.7) * this.thickness,
        alive: true,
      };
    });

    this._growing = true;
    this._animateGrow(turnMax, branchP, this.maxLen);
  }

  _animateGrow(turnMax, branchP, maxLen) {
    if (!this._growing) return;

    const rc   = this._drawCanvas;
    const rctx = rc.getContext('2d');
    const newTips = [];

    const STEPS = 5; // steps batched per animation frame
    for (let s = 0; s < STEPS; s++) {
      for (let i = 0, n = this._tips.length; i < n; i++) {
        const t = this._tips[i];
        if (!t.alive) continue;

        // Irregular step length — prevents uniform banding
        const step = 1.3 + Math.random() * 1.1;
        const nx   = t.x + Math.cos(t.angle) * step;
        const ny   = t.y + Math.sin(t.angle) * step;

        if (nx < 0 || ny < 0 || nx >= rc.width || ny >= rc.height || t.len > maxLen) {
          t.alive = false;
          continue;
        }

        // Draw tapering segment — roots thin toward their tips
        const progress = t.len / maxLen;
        rctx.beginPath();
        rctx.moveTo(t.x, t.y);
        rctx.lineTo(nx, ny);
        rctx.strokeStyle = this.color;
        rctx.lineWidth   = t.lw * Math.max(0.06, 1 - progress * 0.88);
        rctx.globalAlpha = 0.5 + Math.random() * 0.5;
        rctx.stroke();

        t.x = nx; t.y = ny;
        t.len += step;

        // Random turn each step
        t.angle += (Math.random() - 0.5) * 2 * turnMax;

        // Very slight gravitropism — roots drift downward naturally
        t.angle += 0.007;

        // Soft-clamp deviation from initial direction: max ±~100°.
        // This is the key to preventing circular paths — roots can't U-turn.
        const dev = t.angle - t.initAngle;
        if (Math.abs(dev) > Math.PI * 0.55) t.angle -= dev * 0.15;

        // Branching — probability decreases with depth
        if (t.depth < 4 && t.len > 10 &&
            Math.random() < branchP * Math.max(0.1, 1 - t.depth * 0.22)) {
          // Fork at a small angle — NOT perpendicular, so branches stay root-like
          const fork = (0.15 + Math.random() * 0.38) * (Math.random() < 0.5 ? 1 : -1);
          newTips.push({
            x: t.x, y: t.y,
            angle:     t.angle + fork,
            initAngle: t.angle + fork,
            len:   0,
            depth: t.depth + 1,
            lw:    t.lw * 0.65,
            alive: true,
          });
          // Cost parent tip some length so it doesn't grow as far after branching
          t.len += maxLen * 0.09;
        }
      }
    }

    rctx.globalAlpha = 1;
    this._tips.push(...newTips);

    // Cap tip count to avoid performance cliff
    if (this._tips.length > 8000) {
      this._tips = this._tips.filter(t => t.alive).slice(0, 5000);
    }

    this.render();

    if (this._tips.some(t => t.alive)) {
      this._raf = requestAnimationFrame(() => this._animateGrow(turnMax, branchP, maxLen));
    } else {
      this._growing = false;
      this._raf     = null;
    }
  }

  _stopGrow() {
    if (this._raf) { cancelAnimationFrame(this._raf); this._raf = null; }
    this._growing = false;
    this._tips    = [];
  }

  render() {
    const { canvas } = this;
    canvas.beginLayer('hypa');
    try {
      const ctx = canvas.ctx;
      ctx.fillStyle   = this.bgColor;
      ctx.globalAlpha = 1;
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      if (this._textCanvas) ctx.drawImage(this._textCanvas, 0, 0);
      if (this._drawCanvas) ctx.drawImage(this._drawCanvas, 0, 0);
    } finally {
      canvas.endLayer();
    }
  }

  reset() {
    this._stopGrow();
    this._textCanvas   = null;
    this._detectCanvas = null;
    this._drawCanvas   = null;
    this.render();
  }

  _bindUI() {
    document.getElementById('hypa-text-input').addEventListener('input', e => {
      this.text = e.target.value;
      this._buildTextCanvas();
      if (this._isActive()) this.render();
    });

    this._slider('sl-ls-hypa', 'v-ls-hypa', v => {
      this.lineSpacing = v;
      this._buildTextCanvas();
      if (this._isActive()) this.render();
    });

    document.getElementById('btn-hypa-grow').addEventListener('click',  () => this.startGrow());
    document.getElementById('btn-hypa-reset').addEventListener('click', () => this.reset());

    this._slider('sl-hypa-density',   'v-hypa-density',   v => { this.density   = v; if (this._drawCanvas && this._isActive()) this.startGrow(); });
    this._slider('sl-hypa-length',    'v-hypa-length',    v => { this.maxLen    = v; if (this._drawCanvas && this._isActive()) this.startGrow(); });
    this._slider('sl-hypa-wiggle',    'v-hypa-wiggle',    v => { this.wiggle    = v; if (this._drawCanvas && this._isActive()) this.startGrow(); });
    this._slider('sl-hypa-branch',    'v-hypa-branch',    v => { this.branches  = v; if (this._drawCanvas && this._isActive()) this.startGrow(); });
    this._slider('sl-hypa-thickness', 'v-hypa-thickness', v => { this.thickness = v; if (this._drawCanvas && this._isActive()) this.startGrow(); });

    const swatch = document.getElementById('hypa-color-swatch');
    const label  = document.getElementById('hypa-color-label');
    const input  = document.getElementById('hypa-color-input');
    swatch.addEventListener('click', () => input.click());
    input.addEventListener('input', () => {
      this.color              = input.value;
      label.textContent       = input.value;
      swatch.style.background = input.value;
      this._buildTextCanvas();
      if (this._isActive()) this.render();
    });

    document.addEventListener('tabchange', e => {
      if (e.detail === 'hypa') {
        this._buildTextCanvas();
        this.render();
      } else {
        this._stopGrow();
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

const hypaController = new HypaController(canvas);
