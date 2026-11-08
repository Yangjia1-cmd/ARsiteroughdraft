// pattern.js — Pattern tab: fill letter shapes with 10 tiling patterns

class PatternController {
  constructor(canvas) {
    this.canvas       = canvas;
    this.text         = '';
    this.color        = '#ffffff';
    this.bgColor      = '#111111';
    this.lineSpacing  = 1.0;
    this.cellSize     = 14;
    this.strokeWeight = 1.0;
    this.expand       = 0;
    this.selectedPatterns = new Set([0]);

    this._off     = null;
    this._offCtx  = null;
    this._cellMap = null;
    this._cW      = 0;
    this._cH      = 0;

    this.bgPatType       = 'none';
    this.bgPatScale      = 30;
    this.bgPatDensity    = 40;
    this.bgPatDistortion = 0;
    this.bgPatRotation   = 0;
    this.bgPatColorA     = '#444444';
    this.bgPatColorB     = '#111111';
    this.bgPatReach      = 60;   // how far pattern spreads from letter edges
    this.bgPatFalloff    = 60;   // 0 = hard crisp edge, 100 = very soft fade
    this.bgPatInner      = 0;    // 0-100, fills inside letters

    this._distField = null;
    this._dfW       = 0;
    this._dfH       = 0;

    this._patterns = this._definePatterns();
    this._bindUI();
  }

  // ── 10 pattern definitions ────────────────────────────────────────────────
  // Each draw(ctx, x, y, s, col, sw): x/y = cell top-left, s = cell size,
  // col = colour string, sw = stroke weight multiplier

  _definePatterns() {
    return [
      {
        name: 'Cross',
        draw: (ctx, x, y, s, col, sw) => {
          const p = s * 0.15;
          ctx.strokeStyle = col;
          ctx.lineWidth = Math.max(0.8, s * 0.11 * sw);
          ctx.beginPath();
          ctx.moveTo(x + p,     y + p);     ctx.lineTo(x + s - p, y + s - p);
          ctx.moveTo(x + s - p, y + p);     ctx.lineTo(x + p,     y + s - p);
          ctx.stroke();
        },
      },
      {
        name: 'Plus',
        draw: (ctx, x, y, s, col, sw) => {
          const p = s * 0.15, cx = x + s / 2, cy = y + s / 2;
          ctx.strokeStyle = col;
          ctx.lineWidth = Math.max(0.8, s * 0.11 * sw);
          ctx.beginPath();
          ctx.moveTo(x + p, cy); ctx.lineTo(x + s - p, cy);
          ctx.moveTo(cx, y + p); ctx.lineTo(cx, y + s - p);
          ctx.stroke();
        },
      },
      {
        name: 'Ring',
        draw: (ctx, x, y, s, col, sw) => {
          ctx.strokeStyle = col;
          ctx.lineWidth = Math.max(0.8, s * 0.1 * sw);
          ctx.beginPath();
          ctx.arc(x + s / 2, y + s / 2, s * 0.32, 0, Math.PI * 2);
          ctx.stroke();
        },
      },
      {
        name: 'Dot',
        draw: (ctx, x, y, s, col) => {
          ctx.fillStyle = col;
          ctx.beginPath();
          ctx.arc(x + s / 2, y + s / 2, s * 0.28, 0, Math.PI * 2);
          ctx.fill();
        },
      },
      {
        name: 'Diamond',
        draw: (ctx, x, y, s, col, sw) => {
          const cx = x + s / 2, cy = y + s / 2, r = s * 0.35;
          ctx.strokeStyle = col;
          ctx.lineWidth = Math.max(0.8, s * 0.1 * sw);
          ctx.beginPath();
          ctx.moveTo(cx, cy - r); ctx.lineTo(cx + r, cy);
          ctx.lineTo(cx, cy + r); ctx.lineTo(cx - r, cy);
          ctx.closePath();
          ctx.stroke();
        },
      },
      {
        name: 'Square',
        draw: (ctx, x, y, s, col, sw) => {
          const p = s * 0.17;
          ctx.strokeStyle = col;
          ctx.lineWidth = Math.max(0.8, s * 0.1 * sw);
          ctx.strokeRect(x + p, y + p, s - 2 * p, s - 2 * p);
        },
      },
      {
        name: 'Star',
        draw: (ctx, x, y, s, col, sw) => {
          const cx = x + s / 2, cy = y + s / 2, r = s * 0.38;
          ctx.strokeStyle = col;
          ctx.lineWidth = Math.max(0.8, s * 0.09 * sw);
          ctx.beginPath();
          for (let i = 0; i < 4; i++) {
            const a = i * Math.PI / 4;
            ctx.moveTo(cx - Math.cos(a) * r, cy - Math.sin(a) * r);
            ctx.lineTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r);
          }
          ctx.stroke();
        },
      },
      {
        name: 'Triangle',
        draw: (ctx, x, y, s, col, sw) => {
          const p = s * 0.14;
          ctx.strokeStyle = col;
          ctx.lineWidth = Math.max(0.8, s * 0.1 * sw);
          ctx.beginPath();
          ctx.moveTo(x + s / 2, y + p);
          ctx.lineTo(x + s - p, y + s - p);
          ctx.lineTo(x + p,     y + s - p);
          ctx.closePath();
          ctx.stroke();
        },
      },
      {
        name: 'Checker',
        draw: (ctx, x, y, s, col) => {
          const h = s / 2;
          ctx.fillStyle = col;
          ctx.fillRect(x,     y,     h, h);
          ctx.fillRect(x + h, y + h, h, h);
        },
      },
      {
        name: 'Slash',
        draw: (ctx, x, y, s, col, sw) => {
          const p = s * 0.1;
          ctx.strokeStyle = col;
          ctx.lineWidth = Math.max(0.8, s * 0.12 * sw);
          ctx.beginPath();
          ctx.moveTo(x + p,     y + s - p);
          ctx.lineTo(x + s - p, y + p);
          ctx.stroke();
        },
      },
    ];
  }

  // ── Build ─────────────────────────────────────────────────────────────────

  build() {
    if (!this.text.trim()) return;
    this._buildMask();
    this._buildDistField();
    this._buildCellMap();
    this.render();
  }

  remix() {
    if (!this._off) return;
    this._buildCellMap();
    this.render();
  }

  reset() {
    this._off       = null;
    this._offCtx    = null;
    this._cellMap   = null;
    this._distField = null;
    this.render();
  }

  _buildMask() {
    const W = this.canvas.width, H = this.canvas.height;
    const _pmLines = this.text.split('\n');
    const _pmMaxLen = Math.max(..._pmLines.map(l => l.length), 1);
    const _pmNLines = _pmLines.length || 1;
    const fs = Math.min(
      Math.max(24, Math.min(W, H) * 0.55 / Math.max(1, Math.pow(_pmMaxLen, 0.55))),
      Math.max(24, H * 0.78 / (_pmNLines * this.lineSpacing))
    );
    const lines  = _pmLines;
    const lineH  = fs * this.lineSpacing;
    const startY = H / 2 - ((lines.length - 1) * lineH) / 2;

    // Draw white-on-black: blurring white expands the letter region naturally
    const src  = document.createElement('canvas');
    src.width  = W; src.height = H;
    const sctx = src.getContext('2d');
    sctx.fillStyle = '#000'; sctx.fillRect(0, 0, W, H);
    sctx.fillStyle = '#fff';
    sctx.font = `${fs}px 'Courier New', monospace`;
    sctx.textAlign = 'center'; sctx.textBaseline = 'middle';
    lines.forEach((ln, i) => { if (ln.length) sctx.fillText(ln, W / 2, startY + i * lineH); });

    // Gaussian blur dilates the letter shape by ~expand px
    const blurred  = document.createElement('canvas');
    blurred.width  = W; blurred.height = H;
    const bctx     = blurred.getContext('2d');
    if (this.expand > 0) bctx.filter = `blur(${this.expand}px)`;
    bctx.drawImage(src, 0, 0);
    bctx.filter = 'none';

    // Threshold → black-on-white mask  (px < 128 == letter, used by _buildCellMap)
    const bd  = bctx.getImageData(0, 0, W, H).data;
    const off = document.createElement('canvas');
    off.width = W; off.height = H;
    const ctx = off.getContext('2d');
    const id  = ctx.createImageData(W, H);
    const d   = id.data;
    for (let i = 0; i < W * H; i++) {
      const v = bd[i * 4] > 128 ? 0 : 255;   // bright (letter) → black; bg → white
      d[i * 4] = d[i * 4 + 1] = d[i * 4 + 2] = v;
      d[i * 4 + 3] = 255;
    }
    ctx.putImageData(id, 0, 0);
    this._off    = off;
    this._offCtx = ctx;
  }

  _buildCellMap() {
    const W  = this._off.width, H = this._off.height;
    const s  = Math.max(4, Math.round(this.cellSize));
    const px = this._offCtx.getImageData(0, 0, W, H).data;
    const cW = Math.ceil(W / s), cH = Math.ceil(H / s);
    const sel = [...this.selectedPatterns];
    if (!sel.length) sel.push(0);
    const map = new Int8Array(cW * cH).fill(-1);

    for (let row = 0; row < cH; row++) {
      for (let col = 0; col < cW; col++) {
        const cx = Math.round(col * s + s / 2);
        const cy = Math.round(row * s + s / 2);
        if (cx >= 0 && cx < W && cy >= 0 && cy < H && px[(cy * W + cx) * 4] < 128) {
          map[row * cW + col] = sel[Math.floor(Math.random() * sel.length)];
        }
      }
    }
    this._cellMap = map;
    this._cW = cW;
    this._cH = cH;
  }

  // ── Render ────────────────────────────────────────────────────────────────

  render() {
    const { canvas } = this;
    canvas.beginLayer('pattern');
    try {
      const ctx = canvas.ctx;
      const W   = canvas.width, H = canvas.height;

      ctx.globalAlpha = 1;
      ctx.fillStyle   = this.bgPatType !== 'none' ? this.bgPatColorB : this.bgColor;
      ctx.fillRect(0, 0, W, H);

      if (this.bgPatType !== 'none') this._renderBgPattern(ctx, W, H);

      if (!this._cellMap) {
        if (this.text.trim()) this._drawDimText(ctx, W, H);
        return;
      }

      const s  = Math.max(4, Math.round(this.cellSize));
      const sw = this.strokeWeight;
      ctx.save();
      ctx.lineCap  = 'round';
      ctx.lineJoin = 'round';

      for (let row = 0; row < this._cH; row++) {
        for (let col = 0; col < this._cW; col++) {
          const pi = this._cellMap[row * this._cW + col];
          if (pi < 0) continue;
          this._patterns[pi].draw(ctx, col * s, row * s, s, this.color, sw);
        }
      }
      ctx.restore();
    } finally {
      canvas.endLayer();
    }
  }

  _drawDimText(ctx, W, H) {
    const _pdLines = this.text.split('\n');
    const _pdMaxLen = Math.max(..._pdLines.map(l => l.length), 1);
    const _pdNLines = _pdLines.length || 1;
    const fs = Math.min(
      Math.max(24, Math.min(W, H) * 0.55 / Math.max(1, Math.pow(_pdMaxLen, 0.55))),
      Math.max(24, H * 0.78 / (_pdNLines * this.lineSpacing))
    );
    const lines  = _pdLines;
    const lineH  = fs * this.lineSpacing;
    const startY = H / 2 - ((lines.length - 1) * lineH) / 2;
    ctx.font = `${fs}px 'Courier New', monospace`;
    ctx.textAlign    = 'center';
    ctx.textBaseline = 'middle';
    ctx.globalAlpha  = 0.15;
    ctx.fillStyle    = this.color;
    lines.forEach((l, i) => { if (l.length) ctx.fillText(l, W / 2, startY + i * lineH); });
    ctx.globalAlpha  = 1;
  }

  // ── Background pattern helpers ────────────────────────────────────────────

  // BFS distance field from letter boundary, radiating in all directions.
  _buildDistField() {
    if (!this._off) return;
    const W   = this._off.width, H = this._off.height;
    const px  = this._offCtx.getImageData(0, 0, W, H).data;
    // In _buildMask: letter pixels are BLACK (px < 128), background is WHITE
    const mask = new Uint8Array(W * H);
    for (let i = 0; i < W * H; i++) mask[i] = px[i * 4] < 128 ? 1 : 0;

    const dist  = new Int32Array(W * H).fill(-1);
    const queue = new Int32Array(W * H);
    let qH = 0, qT = 0;

    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const i      = y * W + x;
        const inside = mask[i] === 1;
        const isEdge = (x > 0   && (mask[i - 1] === 1) !== inside) ||
                       (x < W-1 && (mask[i + 1] === 1) !== inside) ||
                       (y > 0   && (mask[i - W] === 1) !== inside) ||
                       (y < H-1 && (mask[i + W] === 1) !== inside);
        if (isEdge) { dist[i] = 0; queue[qT++] = i; }
      }
    }
    while (qH < qT) {
      const i  = queue[qH++], nd = dist[i] + 1;
      const x  = i % W, y = (i / W) | 0;
      if (x > 0   && dist[i - 1] < 0) { dist[i - 1] = nd; queue[qT++] = i - 1; }
      if (x < W-1 && dist[i + 1] < 0) { dist[i + 1] = nd; queue[qT++] = i + 1; }
      if (y > 0   && dist[i - W] < 0) { dist[i - W] = nd; queue[qT++] = i - W; }
      if (y < H-1 && dist[i + W] < 0) { dist[i + W] = nd; queue[qT++] = i + W; }
    }

    this._distField = dist;
    this._dfW = W;
    this._dfH = H;
  }

  // Proximity mask: controls how the pattern reveals around / inside the text.
  // Reach   — how many px the pattern extends outward from letter edges
  // Falloff — 0 = hard crisp cut, 100 = very gradual feathering
  // Inner   — 0-100, fills the inside of the letters
  _makeProximityMask(W, H) {
    const dist = this._distField;
    if (!dist || this._dfW !== W || this._dfH !== H) return null;

    const px      = this._offCtx.getImageData(0, 0, W, H).data;
    const reach   = Math.max(1, this.bgPatReach);
    const falloff = this.bgPatFalloff / 100;   // 0–1
    const inner   = this.bgPatInner   / 100;   // 0–1

    // Power curve for outer fade:
    //   falloff=0  → power≈12  (pattern clings tightly to edge, hard cutoff)
    //   falloff=0.5 → power=1  (linear fade)
    //   falloff=1  → power≈0.08 (pattern fills most of reach, dissolves only at far edge)
    const outerPow = Math.pow(12, 1 - falloff * 2);

    const off = document.createElement('canvas');
    off.width = W; off.height = H;
    const ctx = off.getContext('2d');
    const id  = ctx.createImageData(W, H);
    const d   = id.data;

    for (let i = 0; i < W * H; i++) {
      const dv       = dist[i];
      const isInside = px[i * 4] < 128;   // letter = black in mask

      let alpha = 0;

      if (isInside) {
        if (inner > 0) {
          // Fade in from letter edge inward — depth controlled by falloff
          const iFade = falloff < 0.05
            ? 1
            : Math.min(1, dv / (reach * falloff * 0.45 + 1));
          alpha = inner * iFade;
        }
      } else {
        if (dv < reach) {
          const t = dv / reach;
          alpha = Math.pow(1 - t, outerPow);
        }
      }

      d[i*4] = d[i*4+1] = d[i*4+2] = 255;
      d[i*4+3] = Math.round(Math.min(1, Math.max(0, alpha)) * 255);
    }

    ctx.putImageData(id, 0, 0);
    return off;
  }

  _noise(x, y) {
    const n = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
    return n - Math.floor(n);
  }

  _renderBgPattern(ctx, W, H) {
    if (this._distField && this._dfW === W && this._dfH === H) {
      // Draw pattern to offscreen canvas, then cut it to contour rings around the text
      const off    = document.createElement('canvas');
      off.width    = W; off.height = H;
      const offCtx = off.getContext('2d');

      offCtx.save();
      offCtx.translate(W / 2, H / 2);
      offCtx.rotate(this.bgPatRotation * Math.PI / 180);
      offCtx.translate(-W / 2, -H / 2);
      offCtx.lineCap  = 'round';
      offCtx.lineJoin = 'round';
      this._dispatchPattern(offCtx, W, H);
      offCtx.restore();

      const mask = this._makeProximityMask(W, H);
      if (mask) {
        offCtx.globalCompositeOperation = 'destination-in';
        offCtx.drawImage(mask, 0, 0);
      }

      ctx.drawImage(off, 0, 0);
    } else {
      // No text built yet — show full-canvas preview so controls are visible
      ctx.save();
      ctx.translate(W / 2, H / 2);
      ctx.rotate(this.bgPatRotation * Math.PI / 180);
      ctx.translate(-W / 2, -H / 2);
      ctx.lineCap  = 'round';
      ctx.lineJoin = 'round';
      this._dispatchPattern(ctx, W, H);
      ctx.restore();
    }
  }

  _dispatchPattern(ctx, W, H) {
    switch (this.bgPatType) {
      case 'grid':    this._bgGrid(ctx, W, H);    break;
      case 'hex':     this._bgHex(ctx, W, H);     break;
      case 'waves':   this._bgWaves(ctx, W, H);   break;
      case 'spirals': this._bgSpirals(ctx, W, H); break;
      case 'dots':    this._bgDots(ctx, W, H);    break;
      case 'web':     this._bgWeb(ctx, W, H);     break;
      case 'weave':   this._bgWeave(ctx, W, H);   break;
    }
  }

  _bgGrid(ctx, W, H) {
    const s    = this.bgPatScale;
    const dens = this.bgPatDensity / 100;
    const d    = this.bgPatDistortion;
    // Line width: hairline (1%) → fills entire cell (100%)
    const lw   = Math.max(0.3, s * (0.01 + dens * 0.94));
    const amp  = d * s * 0.12;
    const freq = Math.PI * 2 / Math.max(8, s * (4 - d * 0.03));

    ctx.strokeStyle = this.bgPatColorA;
    ctx.lineWidth   = lw;
    ctx.globalAlpha = 0.75 + dens * 0.25;

    const pad  = Math.ceil(amp) + s * 2;
    const cols = Math.ceil((W + pad * 2) / s) + 2;
    const rows = Math.ceil((H + pad * 2) / s) + 2;

    for (let r = -2; r <= rows; r++) {
      ctx.beginPath();
      for (let c = -2; c <= cols; c++) {
        const bx = c * s - pad, by = r * s - pad;
        const wx = amp * Math.sin(by * freq * 0.7 + bx * freq * 0.3);
        const wy = amp * Math.sin(bx * freq       + by * freq * 0.5);
        if (c === -2) ctx.moveTo(bx + wx, by + wy); else ctx.lineTo(bx + wx, by + wy);
      }
      ctx.stroke();
    }
    for (let c = -2; c <= cols; c++) {
      ctx.beginPath();
      for (let r = -2; r <= rows; r++) {
        const bx = c * s - pad, by = r * s - pad;
        const wx = amp * Math.sin(by * freq * 0.7 + bx * freq * 0.3);
        const wy = amp * Math.sin(bx * freq       + by * freq * 0.5);
        if (r === -2) ctx.moveTo(bx + wx, by + wy); else ctx.lineTo(bx + wx, by + wy);
      }
      ctx.stroke();
    }
  }

  _bgHex(ctx, W, H) {
    const r    = Math.max(2, this.bgPatScale / 2);
    const dens = this.bgPatDensity / 100;
    const d    = this.bgPatDistortion;
    const lw   = Math.max(0.3, r * (0.04 + dens * 0.88));
    const hw   = r * 2, hh = Math.sqrt(3) * r;

    ctx.strokeStyle = this.bgPatColorA;
    ctx.fillStyle   = this.bgPatColorA;
    ctx.lineWidth   = lw;

    const cols = Math.ceil(W / (hw * 0.75)) + 4;
    const rows = Math.ceil(H / hh) + 4;

    for (let row = -2; row < rows; row++) {
      for (let col = -2; col < cols; col++) {
        const cx = col * hw * 0.75;
        const cy = row * hh + (col % 2 !== 0 ? hh / 2 : 0);
        const nv = this._noise(col * 0.4 + d * 0.03, row * 0.4);
        const cr = r * Math.max(0.1, 1 + (nv - 0.5) * d * 0.04);

        ctx.beginPath();
        for (let i = 0; i < 6; i++) {
          const angle = (Math.PI / 3) * i + d * 0.02 * this._noise(col + i * 0.9, row);
          if (i === 0) ctx.moveTo(cx + cr * Math.cos(angle), cy + cr * Math.sin(angle));
          else         ctx.lineTo(cx + cr * Math.cos(angle), cy + cr * Math.sin(angle));
        }
        ctx.closePath();
        if (dens > 0.6) {
          ctx.globalAlpha = (dens - 0.6) / 0.4 * 0.88;
          ctx.fill();
        }
        ctx.globalAlpha = 0.88;
        ctx.stroke();
      }
    }
  }

  _bgWaves(ctx, W, H) {
    const s    = Math.max(4, this.bgPatScale);
    const dens = this.bgPatDensity / 100;
    const d    = this.bgPatDistortion;
    // Layers: 1 → 28 (density drives count dramatically)
    const layers = Math.round(1 + dens * 27);
    const amp    = s * (0.3 + d * 0.08);
    const lw     = Math.max(0.25, 0.3 + dens * s * 0.22);
    const f1     = (Math.PI * 2) / s;

    ctx.strokeStyle = this.bgPatColorA;
    ctx.lineWidth   = lw;
    ctx.globalAlpha = Math.max(0.05, 0.92 - dens * 0.62);

    for (let layer = 0; layer < layers; layer++) {
      const t  = layers > 1 ? layer / (layers - 1) : 0;
      const ph = layer * 0.97;
      const f2 = f1 * (2.4 + d * 0.09);
      const f3 = f1 * (3.9 + d * 0.07);
      const f4 = f1 * (5.3 + d * 0.05);
      const td = d / 100;

      ctx.beginPath();
      for (let x = 0; x <= W; x += 2) {
        const y = t * H
          + amp * Math.sin(x * f1 + ph)
          + amp * 0.45 * Math.sin(x * f2 + ph * 1.4) * td
          + amp * 0.25 * Math.sin(x * f3 + ph * 0.7) * td
          + amp * 0.15 * Math.sin(x * f4 + ph * 2.1) * td * td;
        if (x === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      }
      ctx.stroke();
    }
  }

  _bgSpirals(ctx, W, H) {
    const s    = Math.max(2, this.bgPatScale);
    const dens = this.bgPatDensity / 100;
    const d    = this.bgPatDistortion;
    // Count: 1 → 14
    const count = Math.round(1 + dens * 13);
    const maxR  = Math.sqrt(W * W + H * H);
    const turns = maxR / s;

    ctx.strokeStyle = this.bgPatColorA;
    ctx.lineWidth   = Math.max(0.3, 0.4 + dens * 3.2);
    ctx.globalAlpha = 0.72;

    for (let si = 0; si < count; si++) {
      const ox    = W * (0.1 + this._noise(si * 2.7 + d * 0.01, 0.5) * 0.8);
      const oy    = H * (0.1 + this._noise(0.5, si * 1.9 + d * 0.01) * 0.8);
      const phase = (si / count) * Math.PI * 2;
      const ecc   = 1 + d * 0.015 * this._noise(si, 1.5);

      ctx.beginPath();
      const steps = Math.round(turns * 55);
      for (let i = 0; i <= steps; i++) {
        const t      = i / steps;
        const angle  = t * turns * Math.PI * 2 + phase;
        const r      = t * maxR * 0.88;
        const wobble = d > 0 ? r * 0.18 * Math.sin(angle * (3 + d * 0.12) + si) * (d / 100) : 0;
        if (i === 0) ctx.moveTo(ox + (r + wobble) * Math.cos(angle) * ecc, oy + (r + wobble) * Math.sin(angle) / ecc);
        else         ctx.lineTo(ox + (r + wobble) * Math.cos(angle) * ecc, oy + (r + wobble) * Math.sin(angle) / ecc);
      }
      ctx.stroke();
    }
  }

  _bgDots(ctx, W, H) {
    const s    = Math.max(3, this.bgPatScale);
    const dens = this.bgPatDensity / 100;
    const d    = this.bgPatDistortion;
    // Radius: from 3% of spacing (tiny dots) → 58% (overlapping blobs)
    const dotR  = s * (0.03 + dens * 0.55);
    const jit   = d * s * 0.6;
    const rowH  = s * 0.866;

    ctx.fillStyle   = this.bgPatColorA;
    ctx.globalAlpha = 0.85;

    const cols = Math.ceil(W / s) + 5;
    const rows = Math.ceil(H / rowH) + 5;

    for (let r = -2; r < rows; r++) {
      for (let c = -2; c < cols; c++) {
        const bx = c * s + (r % 2 === 0 ? s * 0.5 : 0);
        const by = r * rowH;
        const nx = jit > 0 ? (this._noise(c + d * 0.07, r * 0.5) - 0.5) * jit * 2 : 0;
        const ny = jit > 0 ? (this._noise(c * 0.5, r + d * 0.07) - 0.5) * jit * 2 : 0;
        const sv = d > 0 ? Math.max(0.05, 1 + (this._noise(c, r + d * 0.02) - 0.5) * d * 0.08) : 1;
        const cr = dotR * sv;
        if (cr <= 0) continue;
        ctx.beginPath();
        ctx.arc(bx + nx, by + ny, cr, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }

  _bgWeb(ctx, W, H) {
    const s    = Math.max(4, this.bgPatScale);
    const dens = this.bgPatDensity / 100;
    const d    = this.bgPatDistortion;
    // Node count: 8 → 160 (very dramatic at high density)
    const count   = Math.round(8 + dens * 152);
    const maxDist = s * (1.0 + dens * 5.5);

    const nodes = [];
    for (let i = 0; i < count; i++) {
      nodes.push({
        x: this._noise(i * 2.31 + d * 0.05, i * 0.71) * W,
        y: this._noise(i * 1.13, i * 3.17 + d * 0.05) * H,
      });
    }

    ctx.strokeStyle = this.bgPatColorA;
    ctx.lineWidth   = Math.max(0.3, 0.4 + dens * 3.8);

    for (let i = 0; i < nodes.length; i++) {
      for (let j = i + 1; j < nodes.length; j++) {
        const dx = nodes[j].x - nodes[i].x;
        const dy = nodes[j].y - nodes[i].y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist > maxDist) continue;
        ctx.globalAlpha = (1 - dist / maxDist) * 0.78;
        ctx.beginPath();
        ctx.moveTo(nodes[i].x, nodes[i].y);
        if (d > 12) {
          const mx = (nodes[i].x + nodes[j].x) / 2 + (this._noise(i + d, j) - 0.5) * d * 5;
          const my = (nodes[i].y + nodes[j].y) / 2 + (this._noise(j + d, i) - 0.5) * d * 5;
          ctx.quadraticCurveTo(mx, my, nodes[j].x, nodes[j].y);
        } else {
          ctx.lineTo(nodes[j].x, nodes[j].y);
        }
        ctx.stroke();
      }
    }
    if (dens > 0.35) {
      ctx.fillStyle   = this.bgPatColorA;
      ctx.globalAlpha = 0.9;
      const nr = 1.5 + dens * 5.5;
      nodes.forEach(n => { ctx.beginPath(); ctx.arc(n.x, n.y, nr, 0, Math.PI * 2); ctx.fill(); });
    }
  }

  _bgWeave(ctx, W, H) {
    const s    = Math.max(3, this.bgPatScale);
    const dens = this.bgPatDensity / 100;
    const d    = this.bgPatDistortion;
    // Thread width: from very thin gap-heavy weave → thick solid bands
    const lw   = Math.max(0.5, s * (0.08 + dens * 0.86));
    const amp  = d * s * 0.11;
    const freq = Math.PI * 2 / Math.max(5, s * (5.5 - d * 0.045));

    ctx.strokeStyle = this.bgPatColorA;
    ctx.lineCap     = 'butt';

    ctx.lineWidth   = lw;
    ctx.globalAlpha = 0.60;
    for (let x = -s * 2; x < W + s * 2; x += s) {
      ctx.beginPath();
      for (let y = -s; y <= H + s; y += 2) {
        const wx = amp * Math.sin(y * freq + x * freq * 0.38);
        if (y === -s) ctx.moveTo(x + wx, y); else ctx.lineTo(x + wx, y);
      }
      ctx.stroke();
    }
    ctx.globalAlpha = 0.88;
    for (let y = -s * 2; y < H + s * 2; y += s) {
      ctx.beginPath();
      for (let x = -s; x <= W + s; x += 2) {
        const wy = amp * Math.sin(x * freq + y * freq * 0.38);
        if (x === -s) ctx.moveTo(x, y + wy); else ctx.lineTo(x, y + wy);
      }
      ctx.stroke();
    }
  }

  // ── Tile previews ─────────────────────────────────────────────────────────

  _drawTilePreviews() {
    document.querySelectorAll('.pat-tile').forEach(btn => {
      const idx = parseInt(btn.dataset.pat);
      const cv  = btn.querySelector('canvas');
      if (!cv || idx >= this._patterns.length) return;
      const s   = cv.width;
      const ctx = cv.getContext('2d');
      ctx.fillStyle = '#1a1a1a';
      ctx.fillRect(0, 0, s, s);
      const cell = Math.floor(s / 3);
      ctx.save();
      ctx.lineCap  = 'round';
      ctx.lineJoin = 'round';
      for (let r = 0; r < 3; r++) {
        for (let c = 0; c < 3; c++) {
          this._patterns[idx].draw(ctx, c * cell, r * cell, cell, '#ffffff', 1);
        }
      }
      ctx.restore();
    });
  }

  // ── UI ────────────────────────────────────────────────────────────────────

  _bindUI() {
    document.getElementById('pattern-text-input').addEventListener('input', e => {
      this.text = e.target.value;
      if (this._cellMap) this.build();
      else if (this._isActive()) this.render();
    });

    this._slider('sl-ls-pattern', 'v-ls-pattern', v => {
      this.lineSpacing = v;
      if (this._cellMap) this.build(); else if (this._isActive()) this.render();
    });

    document.getElementById('btn-pattern-build').addEventListener('click',  () => this.build());
    document.getElementById('btn-pattern-reset').addEventListener('click',  () => this.reset());
    document.getElementById('btn-pattern-remix').addEventListener('click',  () => this.remix());

    this._slider('sl-pattern-expand', 'v-pattern-expand', v => { this.expand       = v; if (this._cellMap) this.build(); });
    this._slider('sl-pattern-cell',   'v-pattern-cell',   v => { this.cellSize     = v; if (this._cellMap) this.build(); });
    this._slider('sl-pattern-stroke', 'v-pattern-stroke', v => { this.strokeWeight = v; if (this._cellMap) this.render(); });

    // Pattern tile toggles
    document.querySelectorAll('.pat-tile').forEach(btn => {
      const idx = parseInt(btn.dataset.pat);
      btn.classList.toggle('pat-on', this.selectedPatterns.has(idx));
      btn.addEventListener('click', () => {
        if (this.selectedPatterns.has(idx)) {
          if (this.selectedPatterns.size > 1) this.selectedPatterns.delete(idx);
        } else {
          this.selectedPatterns.add(idx);
        }
        btn.classList.toggle('pat-on', this.selectedPatterns.has(idx));
        if (this._off) { this._buildCellMap(); this.render(); }
      });
    });

    // Color picker
    const swatch = document.getElementById('pattern-color-swatch');
    const label  = document.getElementById('pattern-color-label');
    const input  = document.getElementById('pattern-color-input');
    swatch.addEventListener('click', () => input.click());
    input.addEventListener('input', () => {
      this.color = input.value;
      label.textContent       = input.value;
      swatch.style.background = input.value;
      if (this._cellMap) this.render();
    });

    // Background pattern type buttons
    ['none', 'grid', 'hex', 'waves', 'spirals', 'dots', 'web', 'weave'].forEach(type => {
      const btn = document.getElementById(`btn-bgpat-${type}`);
      if (!btn) return;
      btn.addEventListener('click', () => {
        this.bgPatType = type;
        document.querySelectorAll('.bg-pat-btn').forEach(b => b.classList.remove('btn-on'));
        btn.classList.add('btn-on');
        if (this._isActive()) this.render();
      });
    });

    this._slider('sl-bgpat-scale',      'v-bgpat-scale',      v => { this.bgPatScale       = v; if (this._isActive()) this.render(); });
    this._slider('sl-bgpat-density',    'v-bgpat-density',    v => { this.bgPatDensity     = v; if (this._isActive()) this.render(); });
    this._slider('sl-bgpat-distortion', 'v-bgpat-distortion', v => { this.bgPatDistortion  = v; if (this._isActive()) this.render(); });
    this._slider('sl-bgpat-rotation',   'v-bgpat-rotation',   v => { this.bgPatRotation    = v; if (this._isActive()) this.render(); });
    this._slider('sl-bgpat-reach',      'v-bgpat-reach',      v => { this.bgPatReach       = v; if (this._isActive()) this.render(); });
    this._slider('sl-bgpat-falloff',    'v-bgpat-falloff',    v => { this.bgPatFalloff     = v; if (this._isActive()) this.render(); });
    this._slider('sl-bgpat-inner',      'v-bgpat-inner',      v => { this.bgPatInner       = v; if (this._isActive()) this.render(); });

    const swA = document.getElementById('bgpat-color-a-swatch');
    const lbA = document.getElementById('bgpat-color-a-label');
    const inA = document.getElementById('bgpat-color-a-input');
    if (swA) swA.addEventListener('click', () => inA.click());
    if (inA) inA.addEventListener('input', () => {
      this.bgPatColorA = inA.value;
      if (lbA) lbA.textContent = inA.value;
      if (swA) swA.style.background = inA.value;
      if (this._isActive()) this.render();
    });

    const swB = document.getElementById('bgpat-color-b-swatch');
    const lbB = document.getElementById('bgpat-color-b-label');
    const inB = document.getElementById('bgpat-color-b-input');
    if (swB) swB.addEventListener('click', () => inB.click());
    if (inB) inB.addEventListener('input', () => {
      this.bgPatColorB = inB.value;
      if (lbB) lbB.textContent = inB.value;
      if (swB) swB.style.background = inB.value;
      if (this._isActive()) this.render();
    });

    document.addEventListener('tabchange', e => {
      if (e.detail === 'pattern') {
        this._drawTilePreviews();
        this.render();
      }
    });

    requestAnimationFrame(() => this._drawTilePreviews());
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
    return document.getElementById('sec-pattern')?.classList.contains('active');
  }
}

const patternController = new PatternController(canvas);
