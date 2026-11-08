// water.js — Water tab: draggable/resizable concentric ripple rings with text distortion

// ─── Topo helpers ─────────────────────────────────────────────────────────────
// BFS edge-distance field + thin-line contour renderer used by both
// WaterController (topo background) and WaterPulse (topo build mode).

function _parseRGB(css) {
  const t = document.createElement('canvas'); t.width = t.height = 1;
  const c = t.getContext('2d'); c.fillStyle = css; c.fillRect(0, 0, 1, 1);
  const d = c.getImageData(0, 0, 1, 1).data;
  return [d[0], d[1], d[2]];
}

// Returns Int32Array of per-pixel distance to nearest letter edge (4-connected BFS).
// textCanvas must have letter pixels with R > 128 on a dark background.
function _topoDistField(textCanvas) {
  const W = textCanvas.width, H = textCanvas.height;
  const N   = W * H;
  const src = textCanvas.getContext('2d').getImageData(0, 0, W, H).data;
  const dist  = new Int32Array(N).fill(-1);
  const queue = new Int32Array(N);
  let qH = 0, qT = 0;

  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const idx = y * W + x;
      const isL = src[idx * 4] > 128;
      let edge  = (x === 0 || x === W - 1 || y === 0 || y === H - 1);
      if (!edge) {
        edge = (src[(idx - 1) * 4] > 128) !== isL
            || (src[(idx + 1) * 4] > 128) !== isL
            || (src[(idx - W) * 4] > 128) !== isL
            || (src[(idx + W) * 4] > 128) !== isL;
      }
      if (edge) { dist[idx] = 0; queue[qT++] = idx; }
    }
  }

  while (qH < qT) {
    const idx = queue[qH++];
    const nd  = dist[idx] + 1;
    const y   = (idx / W) | 0, x = idx % W;
    if (x > 0   && dist[idx - 1] < 0) { dist[idx - 1] = nd; queue[qT++] = idx - 1; }
    if (x < W-1 && dist[idx + 1] < 0) { dist[idx + 1] = nd; queue[qT++] = idx + 1; }
    if (y > 0   && dist[idx - W] < 0) { dist[idx - W] = nd; queue[qT++] = idx - W; }
    if (y < H-1 && dist[idx + W] < 0) { dist[idx + W] = nd; queue[qT++] = idx + W; }
  }

  return dist;
}

// Renders the distance field as thin contour lines every `spacing` px.
// Line pixels get [lr,lg,lb]; background pixels get [br,bg,bb].
// cfg: { spacing, jitter 0-1, thickness, thickVar 0-1 }
function _topoRender(dist, W, H, lr, lg, lb, br, bg, bb, cfg) {
  const spacing   = cfg.spacing   ?? 10;
  const jitter    = cfg.jitter    ?? 0;    // 0–1: gap-size randomness
  const thickness = cfg.thickness ?? 1.5; // base line width px
  const thickVar  = cfg.thickVar  ?? 0;   // 0–1: per-line width randomness

  // Find max distance in field for LUT size
  let maxDist = 0;
  for (let i = 0; i < dist.length; i++) if (dist[i] > maxDist) maxDist = dist[i];

  // Build lookup table: lut[d] = opacity (0–1) at that integer distance
  const lut = new Float32Array(maxDist + 2);
  lut[0] = 1; // letter-edge pixels always solid

  let d = 0;
  while (d <= maxDist) {
    const step  = Math.max(2, spacing * (1 + jitter  * (Math.random() * 2 - 1)));
    d += step;
    if (d > maxDist + 1) break;
    const thick = Math.max(0.5, thickness * (1 + thickVar * (Math.random() * 2 - 1)));
    const half  = thick / 2;
    const lo = Math.max(0, Math.floor(d - half));
    const hi = Math.min(maxDist, Math.ceil(d + half));
    for (let v = lo; v <= hi; v++) {
      const alpha = half < 0.5 ? 1 : Math.max(0, 1 - Math.abs(v - d) / (half + 0.001));
      if (alpha > lut[v]) lut[v] = alpha;
    }
  }

  // Render pixels using LUT
  const tc  = document.createElement('canvas');
  tc.width  = W; tc.height = H;
  const ctx = tc.getContext('2d');
  const img = ctx.createImageData(W, H);
  const px  = img.data;
  for (let i = 0; i < W * H; i++) {
    const v = dist[i];
    const a = v < lut.length ? lut[v] : 0;
    px[i * 4]     = Math.round(br + (lr - br) * a);
    px[i * 4 + 1] = Math.round(bg + (lg - bg) * a);
    px[i * 4 + 2] = Math.round(bb + (lb - bb) * a);
    px[i * 4 + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  return tc;
}

// ─── Ripple ───────────────────────────────────────────────────────────────────
// One circular ripple at (cx, cy) with radius r.
// Per-segment effects (skip / thicker) are cached so the glass-like
// appearance on letter pixels stays stable between renders.

class Ripple {
  constructor(id, cx, cy, r) {
    this.id = id;
    this.cx = cx;
    this.cy = cy;
    this.r  = r;
    this._fx = new Map(); // "ring_seg" → { skip, thick }
  }

  invalidate() { this._fx.clear(); }

  draw(ctx, color, numRings, spacing, lineWidth, isOnText) {
    for (let ri = 0; ri < numRings; ri++) {
      const rad = this.r - (numRings - 1 - ri) * spacing;
      if (rad < 3) continue;

      const t    = ri / Math.max(numRings - 1, 1); // 0 = inner, 1 = outer
      const SEGS = 72;
      ctx.save();
      ctx.lineCap  = 'round';
      ctx.lineJoin = 'round';

      for (let s = 0; s < SEGS; s++) {
        const t0 = (s / SEGS) * Math.PI * 2;
        const t1 = ((s + 1) / SEGS) * Math.PI * 2;
        const tm = (t0 + t1) / 2;
        const mx = this.cx + rad * Math.cos(tm);
        const my = this.cy + rad * Math.sin(tm);
        const onTxt = isOnText ? isOnText(mx, my) : false;

        const key = `${ri}_${s}`;
        let fx = this._fx.get(key);
        if (fx === undefined) {
          fx = onTxt
            ? { skip: Math.random() < 0.30, thick: Math.random() < 0.70 }
            : { skip: false, thick: false };
          this._fx.set(key, fx);
        }

        if (fx.skip) continue;

        const lw = fx.thick ? lineWidth * (0.8 + t * 2.2) : lineWidth;

        ctx.strokeStyle = color;
        ctx.lineWidth   = lw;
        ctx.beginPath();
        for (let k = 0; k <= 6; k++) {
          const theta = t0 + (t1 - t0) * (k / 6);
          const px = this.cx + rad * Math.cos(theta);
          const py = this.cy + rad * Math.sin(theta);
          if (k === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
        }
        ctx.stroke();
      }

      ctx.restore();
    }
  }
}


// ─── WaterController ──────────────────────────────────────────────────────────

class WaterController {
  constructor(canvas) {
    this.canvas   = canvas;
    this.text     = '';
    this.color    = '#ffffff';
    this.bgColor  = '#111111';

    this.lineSpacing = 1.0;

    this.numRings   = 10;
    this.spacing    = 15;       // px between ring radii
    this.lineWidth  = 1.5;
    this.distortAmt = 20;       // distortion amplitude (0 = off, 50 = heavy)
    this.distortDir = 'tangent'; // 'tangent' | 'right' | 'left' | 'top'

    this.topoActive    = false;
    this.topoSpacing   = 10;
    this.topoJitter    = 0;
    this.topoThickness = 1.5;
    this.topoThickVar  = 0;

    this.ripples  = [];
    this._nextId  = 0;

    // Offscreen text canvas — visible text for distortion source
    this._textCanvas = null;

    // Mask canvas pixel data (white-on-black) for letter detection
    this._maskData = null;
    this._maskW    = 0;
    this._maskH    = 0;

    // Interaction state
    this._active  = false; // placement/edit mode toggled by button
    this._drag    = null;  // { type:'create'|'move'|'resize', ripple, startX, startY, origCx?, origCy? }
    this._preview = null;  // ripple being dragged into existence (not yet committed)

    this._bindUI();
    this._bindCanvas();

    window.addEventListener('resize', () => {
      if (this._isActive()) { this._rebuild(); this.render(); }
    });
  }

  // ── Text helpers ────────────────────────────────────────────────────────────

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
      ctx.font          = `${fs}px 'Courier New', monospace`;
      ctx.textAlign     = 'center';
      ctx.textBaseline  = 'middle';
      ctx.fillStyle     = this.color;
      lines.forEach((line, i) => { if (line.length) ctx.fillText(line, W / 2, startY + i * lineH); });

      if (this.topoActive) {
        // Build white-on-black text for the distance field
        const mc   = document.createElement('canvas');
        mc.width   = W; mc.height = H;
        const mctx = mc.getContext('2d');
        mctx.fillStyle = '#000'; mctx.fillRect(0, 0, W, H);
        mctx.fillStyle = '#fff';
        mctx.font = ctx.font; mctx.textAlign = 'center'; mctx.textBaseline = 'middle';
        lines.forEach((line, i) => { if (line.length) mctx.fillText(line, W / 2, startY + i * lineH); });
        const [cr, cg, cb] = _parseRGB(this.color);
        const [br, bg, bb] = _parseRGB(this.bgColor);
        this._textCanvas = _topoRender(_topoDistField(mc), W, H, cr, cg, cb, br, bg, bb, {
          spacing:   this.topoSpacing,
          jitter:    this.topoJitter,
          thickness: this.topoThickness,
          thickVar:  this.topoThickVar,
        });
        return;
      }
    }
    this._textCanvas = tc;
  }

  _buildMask() {
    if (!this.text.trim()) { this._maskData = null; return; }
    const W = this.canvas.width, H = this.canvas.height;
    const mc  = document.createElement('canvas');
    mc.width  = W; mc.height = H;
    const ctx = mc.getContext('2d');
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, W, H);
    const lines  = this.text.split('\n');
    const fs     = this._fontSize();
    const lineH  = fs * this.lineSpacing;
    const startY = H / 2 - ((lines.length - 1) * lineH) / 2;
    ctx.font         = `${fs}px 'Courier New', monospace`;
    ctx.textAlign    = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle    = '#fff';
    lines.forEach((line, i) => { if (line.length) ctx.fillText(line, W / 2, startY + i * lineH); });
    this._maskData = ctx.getImageData(0, 0, W, H).data;
    this._maskW = W; this._maskH = H;
  }

  _isOnText(x, y) {
    if (!this._maskData) return false;
    const px = Math.round(x), py = Math.round(y);
    if (px < 0 || py < 0 || px >= this._maskW || py >= this._maskH) return false;
    return this._maskData[(py * this._maskW + px) * 4] > 128;
  }

  // ── Strip-based distortion ─────────────────────────────────────────────────
  // Splits the canvas into thin strips and blits each one shifted by a
  // displacement derived from nearby ring boundaries.
  //
  // Modes:
  //   tangent — shift follows the ring's tangent vector (flowing/lens look)
  //   right   — all text near rings is pushed rightward
  //   left    — pushed leftward
  //   top     — pushed upward (uses vertical strips instead of horizontal)
  //
  // Convention: positive xDisp → text shifts right; negative yDisp → text shifts up.
  // drawImage(src, +dx, 0) places source(0,y) at dest(dx,y) → source content at dx appears at 0 → RIGHT shift ✓

  _drawWithDistortion(ctx, W, H) {
    if (!this._textCanvas) return;
    if (this.distortAmt <= 0) { ctx.drawImage(this._textCanvas, 0, 0); return; }

    const STRIP     = 3;
    const AMP       = this.distortAmt;
    const INFL_BAND = Math.max(12, AMP * 1.8); // falloff zone around each ring
    const dir       = this.distortDir;

    if (dir === 'top') {
      // ── Vertical strips, y-displacement ──────────────────────────────────
      for (let x = 0; x < W; x += STRIP) {
        let yDisp = 0;
        const stripCx = x + STRIP / 2;

        for (const rip of this.ripples) {
          for (let ri = 0; ri < this.numRings; ri++) {
            const rad = rip.r - (this.numRings - 1 - ri) * this.spacing;
            if (rad < 3) continue;
            const dx = stripCx - rip.cx;
            if (Math.abs(dx) > rad * 1.3) continue;

            const cosV = Math.max(-1, Math.min(1, dx / rad));
            for (const theta of [Math.acos(cosV), -Math.acos(cosV)]) {
              const epx  = rip.cx + rad * Math.cos(theta);
              const dX   = Math.abs(stripCx - epx);
              const infl = Math.max(0, 1 - dX / INFL_BAND);
              if (infl < 0.01) continue;
              yDisp -= AMP * infl; // negative = upward
            }
          }
        }

        const dy = Math.round(yDisp);
        if (dy !== 0) {
          ctx.save();
          ctx.beginPath();
          ctx.rect(x, 0, STRIP, H);
          ctx.clip();
          ctx.drawImage(this._textCanvas, 0, dy); // dy < 0 → content shifts up
          ctx.restore();
        } else {
          ctx.drawImage(this._textCanvas, x, 0, STRIP, H, x, 0, STRIP, H);
        }
      }
      return;
    }

    // ── Horizontal strips, x-displacement (tangent / right / left) ───────────
    for (let y = 0; y < H; y += STRIP) {
      let xDisp = 0;
      const stripCy = y + STRIP / 2;

      for (const rip of this.ripples) {
        for (let ri = 0; ri < this.numRings; ri++) {
          const rad = rip.r - (this.numRings - 1 - ri) * this.spacing;
          if (rad < 3) continue;

          const dy = stripCy - rip.cy;
          if (Math.abs(dy) > rad * 1.3) continue;

          const sinV = Math.max(-1, Math.min(1, dy / rad));
          for (const theta of [Math.asin(sinV), Math.PI - Math.asin(sinV)]) {
            const epy  = rip.cy + rad * Math.sin(theta);
            const dY   = Math.abs(stripCy - epy);
            const infl = Math.max(0, 1 - dY / INFL_BAND);
            if (infl < 0.01) continue;

            if (dir === 'tangent') {
              const txDir = -rad * Math.sin(theta);
              const tLen  = Math.hypot(txDir, rad * Math.cos(theta)) || 1;
              xDisp += (txDir / tLen) * AMP * infl;
            } else {
              xDisp += (dir === 'right' ? +1 : -1) * AMP * infl;
            }
          }
        }
      }

      const dx = Math.round(xDisp);
      if (dx !== 0) {
        ctx.save();
        ctx.beginPath();
        ctx.rect(0, y, W, STRIP);
        ctx.clip();
        ctx.drawImage(this._textCanvas, dx, 0); // positive dx → text shifts right
        ctx.restore();
      } else {
        ctx.drawImage(this._textCanvas, 0, y, W, STRIP, 0, y, W, STRIP);
      }
    }
  }

  // ── Resize handle ───────────────────────────────────────────────────────────

  _handlePos(rip) {
    const a  = Math.PI * 0.25; // 45° — bottom-right
    const hr = Math.max(8, rip.r * 0.09);
    return { x: rip.cx + rip.r * Math.cos(a), y: rip.cy + rip.r * Math.sin(a), r: hr };
  }

  _drawHandle(ctx, rip) {
    const h = this._handlePos(rip);
    ctx.save();
    ctx.beginPath();
    ctx.arc(h.x, h.y, h.r, 0, Math.PI * 2);
    ctx.fillStyle   = 'rgba(255,255,255,0.9)';
    ctx.shadowColor = 'rgba(0,0,0,0.5)';
    ctx.shadowBlur  = h.r * 0.8;
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
    for (let i = this.ripples.length - 1; i >= 0; i--) {
      const rip = this.ripples[i];
      const h   = this._handlePos(rip);
      if (Math.hypot(x - h.x, y - h.y) <= h.r * 2.5)
        return { type: 'resize', ripple: rip };
      if (Math.hypot(x - rip.cx, y - rip.cy) <= rip.r)
        return { type: 'move', ripple: rip };
    }
    return null;
  }

  // ── Render ──────────────────────────────────────────────────────────────────

  render() {
    if (window._fwActive) return;
    const { canvas } = this;
    canvas.beginLayer('water');
    try {
      const ctx = canvas.ctx;
      const W   = canvas.width, H = canvas.height;

      ctx.fillStyle  = this.bgColor;
      ctx.globalAlpha = 1;
      ctx.fillRect(0, 0, W, H);

      if (!this.text.trim()) return;

      if (this.ripples.length && this._textCanvas) {
        this._drawWithDistortion(ctx, W, H);
      } else if (this._textCanvas) {
        ctx.drawImage(this._textCanvas, 0, 0);
      }

      const maskFn = this._maskData ? (x, y) => this._isOnText(x, y) : null;
      this.ripples.forEach(rip =>
        rip.draw(ctx, this.color, this.numRings, this.spacing, this.lineWidth, maskFn)
      );

      if (this._preview && this._preview.r >= 3) {
        this._preview.draw(ctx, this.color, this.numRings, this.spacing, this.lineWidth, null);
      }

      this.ripples.forEach(rip => this._drawHandle(ctx, rip));
    } finally {
      canvas.endLayer();
    }
  }

  // ── Canvas mouse interaction ─────────────────────────────────────────────────

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
        const rip = hit.ripple;
        this._drag = {
          type: hit.type, ripple: rip,
          startX: x, startY: y,
          origCx: rip.cx, origCy: rip.cy,
        };
      } else {
        // Start drag-to-create: center = mousedown, radius = drag distance
        const rip      = new Ripple(this._nextId++, x, y, 0);
        this._preview  = rip;
        this._drag     = { type: 'create', ripple: rip, startX: x, startY: y };
      }
      e.preventDefault();
    });

    el.addEventListener('mousemove', e => {
      if (!this._active) return;
      const { x, y } = this._xy(e);

      if (this._drag) {
        const d = this._drag;
        if (d.type === 'move') {
          d.ripple.cx = d.origCx + (x - d.startX);
          d.ripple.cy = d.origCy + (y - d.startY);
          d.ripple.invalidate();
          this.render();
        } else if (d.type === 'resize') {
          d.ripple.r = Math.max(20, Math.hypot(x - d.ripple.cx, y - d.ripple.cy));
          d.ripple.invalidate();
          this.render();
        } else if (d.type === 'create') {
          d.ripple.r = Math.hypot(x - d.startX, y - d.startY);
          this.render();
        }
      } else {
        // Update cursor based on hover
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
        if (d.ripple.r < 15) d.ripple.r = 80; // click without drag → default size
        this.ripples.push(d.ripple);
        this._preview = null;
        this.ripples.forEach(r => r.invalidate()); // re-randomize all text-segment effects
      }
      this._drag = null;
      this.render();
    };

    el.addEventListener('mouseup',    endDrag);
    el.addEventListener('mouseleave', endDrag);
  }

  // ── UI binding ──────────────────────────────────────────────────────────────

  _bindUI() {
    document.getElementById('water-text-input').addEventListener('input', e => {
      this.text = e.target.value;
      this._rebuild();
      if (this._isActive()) this.render();
    });

    this._slider('sl-ls-water', 'v-ls-water', v => {
      this.lineSpacing = v;
      this._rebuild();
      if (this._isActive()) this.render();
    });

    document.getElementById('btn-water-ripple').addEventListener('click', () => {
      this._active = !this._active;
      const btn = document.getElementById('btn-water-ripple');
      btn.textContent = this._active ? 'Ripple: On' : 'Water Ripple';
      btn.classList.toggle('btn-on', this._active);
      this.canvas.el.style.cursor = this._active ? 'crosshair' : 'default';
    });

    document.getElementById('btn-water-reset').addEventListener('click', () => this.reset());

    ['left', 'right', 'top'].forEach(d => {
      document.getElementById(`btn-water-${d}`).addEventListener('click', () => this._setDir(d));
    });

    this._slider('sl-water-distort', 'v-water-distort', v => {
      this.distortAmt = v;
      if (this._isActive()) this.render();
    });
    this._slider('sl-water-rings',   'v-water-rings', v => {
      this.numRings = v;
      this.ripples.forEach(r => r.invalidate());
      if (this._isActive()) this.render();
    });
    this._slider('sl-water-spacing', 'v-water-spacing', v => {
      this.spacing = v;
      if (this._isActive()) this.render();
    });
    this._slider('sl-water-lw',      'v-water-lw', v => {
      this.lineWidth = v;
      if (this._isActive()) this.render();
    });

    document.getElementById('btn-water-topo').addEventListener('click', () => {
      const btn = document.getElementById('btn-water-topo');
      this.topoActive = !this.topoActive;
      btn.textContent = this.topoActive ? 'Topo Lines: On' : 'Topo Lines';
      btn.classList.toggle('btn-on', this.topoActive);
      this._rebuild();
      if (this._isActive()) this.render();
    });

    this._slider('sl-water-topo-spacing',   'v-water-topo-spacing',   v => {
      this.topoSpacing = v;
      if (this.topoActive) { this._rebuild(); if (this._isActive()) this.render(); }
    });
    this._slider('sl-water-topo-jitter',    'v-water-topo-jitter',    v => {
      this.topoJitter = v / 100;
      if (this.topoActive) { this._rebuild(); if (this._isActive()) this.render(); }
    });
    this._slider('sl-water-topo-thick',     'v-water-topo-thick',     v => {
      this.topoThickness = v;
      if (this.topoActive) { this._rebuild(); if (this._isActive()) this.render(); }
    });
    this._slider('sl-water-topo-thickvar',  'v-water-topo-thickvar',  v => {
      this.topoThickVar = v / 100;
      if (this.topoActive) { this._rebuild(); if (this._isActive()) this.render(); }
    });

    const swatch = document.getElementById('water-color-swatch');
    const label  = document.getElementById('water-color-label');
    const input  = document.getElementById('water-color-input');
    swatch.addEventListener('click', () => input.click());
    input.addEventListener('input', () => {
      this.color = input.value;
      label.textContent       = input.value;
      swatch.style.background = input.value;
      this._buildTextCanvas();
      this._buildMask();
      if (this._isActive()) this.render();
    });

    document.addEventListener('tabchange', e => {
      if (e.detail === 'water') {
        this._rebuild();
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

  _setDir(dir) {
    // Toggle off if already active → back to tangent; otherwise switch direction
    this.distortDir = this.distortDir === dir ? 'tangent' : dir;
    ['left', 'right', 'top'].forEach(d => {
      const btn = document.getElementById(`btn-water-${d}`);
      if (btn) btn.classList.toggle('btn-on', this.distortDir === d);
    });
    if (this._isActive()) this.render();
  }

  _isActive() {
    return document.getElementById('sec-water')?.classList.contains('active');
  }

  _rebuild() {
    this._buildTextCanvas();
    this._buildMask();
    this.ripples.forEach(r => r.invalidate());
  }

  _deactivate() {
    this._active  = false;
    this._drag    = null;
    this._preview = null;
    this.canvas.el.style.cursor = 'default';
    const btn = document.getElementById('btn-water-ripple');
    if (btn) { btn.textContent = 'Water Ripple'; btn.classList.remove('btn-on'); }
  }

  _resetDir() {
    this.distortDir = 'tangent';
    ['left', 'right', 'top'].forEach(d => {
      const btn = document.getElementById(`btn-water-${d}`);
      if (btn) btn.classList.remove('btn-on');
    });
  }

  reset() {
    this.ripples  = [];
    this._preview = null;
    this._drag    = null;
    this._deactivate();
    this._rebuild();
    this.render();
  }
}


// ─── WaterPulse ───────────────────────────────────────────────────────────────
// Water-drop contour effect.
// Each letter becomes a Gaussian blob (spread = blur radius).
// Close blobs merge their fields like real water droplets on a surface.
// Contour lines drawn at equal intervals of the blended potential field
// give the topographic ring / optical-art appearance.

class WaterPulse {
  constructor(canvas) {
    this.canvas  = canvas;
    this.text    = '';
    this.color   = '#ffffff';
    this.bgColor = '#111111';

    this.lineSpacing = 1.0;

    this.spread    = 30;   // Gaussian blur radius (px) — controls drop size + merging
    this.numRings  = 12;   // contour band count across the full potential range
    this.threshold = 0.10; // potential level below which is pure background (0–1)
    this.invert    = false;

    this.topoSpacing   = 10;
    this.topoJitter    = 0;
    this.topoThickness = 1.5;
    this.topoThickVar  = 0;
    this._topoBuilt    = false;  // true when last build was topo mode

    this._pulseCanvas = null;

    this._bindUI();
  }

  // ── UI ──────────────────────────────────────────────────────────────────────

  _bindUI() {
    document.getElementById('water-text-input').addEventListener('input', e => {
      this.text = e.target.value;
    });

    this._slider('sl-ls-water', 'v-ls-water', v => {
      this.lineSpacing = v;
      if (this._pulseCanvas) this.build();
    });

    document.getElementById('water-color-input').addEventListener('input', e => {
      this.color = e.target.value;
    });

    document.getElementById('btn-pulse-build').addEventListener('click', () => {
      this._topoBuilt = false;
      this.build();
    });
    document.getElementById('btn-pulse-reset').addEventListener('click', () => this.reset());

    this._slider('sl-pulse-spread', 'v-pulse-spread', v => { this.spread    = v; if (this._pulseCanvas && !this._topoBuilt) this.build(); });
    this._slider('sl-pulse-rings',  'v-pulse-rings',  v => { this.numRings  = v; if (this._pulseCanvas && !this._topoBuilt) this.build(); });
    this._slider('sl-pulse-thresh', 'v-pulse-thresh', v => { this.threshold = v / 100; if (this._pulseCanvas && !this._topoBuilt) this.build(); });

    const invBtn = document.getElementById('btn-pulse-invert');
    invBtn.addEventListener('click', () => {
      this.invert = !this.invert;
      invBtn.textContent = `Invert: ${this.invert ? 'On' : 'Off'}`;
      invBtn.classList.toggle('btn-on', this.invert);
      if (this._pulseCanvas) this._topoBuilt ? this.buildTopo() : this._renderToMain();
    });

    document.getElementById('btn-pulse-topo').addEventListener('click', () => this.buildTopo());
    this._slider('sl-pulse-topo-spacing',  'v-pulse-topo-spacing',  v => {
      this.topoSpacing = v;
      if (this._topoBuilt) this.buildTopo();
    });
    this._slider('sl-pulse-topo-jitter',   'v-pulse-topo-jitter',   v => {
      this.topoJitter = v / 100;
      if (this._topoBuilt) this.buildTopo();
    });
    this._slider('sl-pulse-topo-thick',    'v-pulse-topo-thick',    v => {
      this.topoThickness = v;
      if (this._topoBuilt) this.buildTopo();
    });
    this._slider('sl-pulse-topo-thickvar', 'v-pulse-topo-thickvar', v => {
      this.topoThickVar = v / 100;
      if (this._topoBuilt) this.buildTopo();
    });

    document.addEventListener('tabchange', e => {
      if (e.detail !== 'water') this._pulseCanvas = null;
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

  // ── Helpers ──────────────────────────────────────────────────────────────────

  // Parse a CSS colour string into [r, g, b] (0-255)
  _parseColor(css) {
    const t = document.createElement('canvas');
    t.width = t.height = 1;
    const c = t.getContext('2d');
    c.fillStyle = css;
    c.fillRect(0, 0, 1, 1);
    const d = c.getImageData(0, 0, 1, 1).data;
    return [d[0], d[1], d[2]];
  }

  // ── Build ────────────────────────────────────────────────────────────────────

  build() {
    if (!this.text.trim()) return;
    const W = this.canvas.width, H = this.canvas.height;

    // ── Step 1: render text as white on black ──────────────────────────────
    const textOff    = document.createElement('canvas');
    textOff.width    = W; textOff.height = H;
    const tctx       = textOff.getContext('2d');
    const _wpLines = this.text.split('\n');
    const _wpMaxLen = Math.max(..._wpLines.map(l => l.length), 1);
    const _wpNLines = _wpLines.length || 1;
    const fontSize = Math.min(
      Math.max(24, Math.min(W, H) * 0.55 / Math.max(1, Math.pow(_wpMaxLen, 0.55))),
      Math.max(24, H * 0.78 / (_wpNLines * this.lineSpacing))
    );
    tctx.fillStyle   = '#000'; tctx.fillRect(0, 0, W, H);
    tctx.fillStyle   = '#fff';
    tctx.font        = `${fontSize}px 'Courier New', monospace`;
    tctx.textAlign   = 'center'; tctx.textBaseline = 'middle';
    const lines  = _wpLines;
    const lineH  = fontSize * this.lineSpacing;
    const startY = H / 2 - ((lines.length - 1) * lineH) / 2;
    lines.forEach((line, i) => { if (line.length) tctx.fillText(line, W / 2, startY + i * lineH); });

    // ── Step 2: Gaussian blur creates the water-drop potential field ───────
    // Each letter becomes a soft Gaussian blob.
    // Overlapping blobs ADD their potentials — close letters merge like real
    // water droplets, forming a smooth connected region automatically.
    const blurOff   = document.createElement('canvas');
    blurOff.width   = W; blurOff.height = H;
    const bctx      = blurOff.getContext('2d');
    bctx.filter     = `blur(${this.spread}px)`;
    bctx.drawImage(textOff, 0, 0);
    bctx.filter     = 'none';

    // ── Step 3: read the potential field (R channel, 0-255) ────────────────
    const field = bctx.getImageData(0, 0, W, H).data;

    // ── Step 4: draw contour bands ─────────────────────────────────────────
    this._pulseCanvas = this._drawContours(field, W, H);
    this._renderToMain();
  }

  buildTopo() {
    if (!this.text.trim()) return;
    const W = this.canvas.width, H = this.canvas.height;

    const lines  = this.text.split('\n');
    const maxLen = Math.max(...lines.map(l => l.length), 1);
    const nLines = lines.length || 1;
    const fs = Math.min(
      Math.max(24, Math.min(W, H) * 0.55 / Math.max(1, Math.pow(maxLen, 0.55))),
      Math.max(24, H * 0.78 / (nLines * this.lineSpacing))
    );
    const lineH  = fs * this.lineSpacing;
    const startY = H / 2 - ((lines.length - 1) * lineH) / 2;

    // White-on-black text for distance field
    const textOff  = document.createElement('canvas');
    textOff.width  = W; textOff.height = H;
    const tctx     = textOff.getContext('2d');
    tctx.fillStyle = '#000'; tctx.fillRect(0, 0, W, H);
    tctx.fillStyle = '#fff';
    tctx.font = `${fs}px 'Courier New', monospace`;
    tctx.textAlign = 'center'; tctx.textBaseline = 'middle';
    lines.forEach((l, i) => { if (l.length) tctx.fillText(l, W / 2, startY + i * lineH); });

    const dist = _topoDistField(textOff);

    const [cr, cg, cb] = this._parseColor(this.color);
    const [br, bg, bb] = this._parseColor(this.bgColor);
    // Invert swaps which color is the line vs the gap
    const [lr, lg, lb] = this.invert ? [br, bg, bb] : [cr, cg, cb];
    const [mr, mg, mb] = this.invert ? [cr, cg, cb] : [br, bg, bb];

    this._pulseCanvas = _topoRender(dist, W, H, lr, lg, lb, mr, mg, mb, {
      spacing:   this.topoSpacing,
      jitter:    this.topoJitter,
      thickness: this.topoThickness,
      thickVar:  this.topoThickVar,
    });
    this._topoBuilt   = true;
    this._renderToMain();
  }

  _drawContours(field, W, H) {
    const pc   = document.createElement('canvas');
    pc.width   = W; pc.height = H;
    const pctx = pc.getContext('2d');
    const img  = pctx.createImageData(W, H);
    const data = img.data;

    const [cr, cg, cb] = this._parseColor(this.color);
    const [br, bg, bb] = this._parseColor(this.bgColor);

    const thresh   = this.threshold;          // 0-1: drop surface cutoff
    const nRings   = this.numRings;
    const inv      = this.invert;

    for (let i = 0; i < W * H; i++) {
      // Normalised potential 0-1 (field stores 0-255 in R channel)
      const p = field[i * 4] / 255;

      // Below threshold → pure background (the empty table surface)
      if (p < thresh) {
        data[i * 4]     = br;
        data[i * 4 + 1] = bg;
        data[i * 4 + 2] = bb;
        data[i * 4 + 3] = 255;
        continue;
      }

      // Remap potential from [threshold, 1] → [0, 1] so rings fill the drop
      const t = (p - thresh) / (1 - thresh);

      // sin-based contour bands: positive half = light, negative = dark
      // Using sin gives smooth crisp alternating rings without aliasing
      const bandSin = Math.sin(t * nRings * Math.PI);
      let light = bandSin > 0 ? 1 : 0;
      if (inv) light = 1 - light;

      data[i * 4]     = Math.round(br + (cr - br) * light);
      data[i * 4 + 1] = Math.round(bg + (cg - bg) * light);
      data[i * 4 + 2] = Math.round(bb + (cb - bb) * light);
      data[i * 4 + 3] = 255;
    }

    pctx.putImageData(img, 0, 0);
    return pc;
  }

  _renderToMain() {
    if (!this._pulseCanvas) return;
    this.canvas.beginLayer('water');
    this.canvas.clear(this.bgColor);
    this.canvas.ctx.drawImage(this._pulseCanvas, 0, 0);
    this.canvas.endLayer();
  }

  reset() {
    this._pulseCanvas = null;
    this._topoBuilt   = false;
    this.canvas.beginLayer('water');
    this.canvas.clear(this.bgColor);
    this.canvas.endLayer();
  }
}


// ─── Init ─────────────────────────────────────────────────────────────────────
// canvas is the shared global defined in spawnandgrow.js

const waterController = new WaterController(canvas);
const waterPulse      = new WaterPulse(canvas);
