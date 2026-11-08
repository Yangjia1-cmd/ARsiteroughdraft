// waterdrop.js — Water Drop: draggable / resizable magnifying lens drops on text

class WaterDrop {
  constructor(id, cx, cy, r) {
    this.id = id;
    this.cx = cx;
    this.cy = cy;
    this.r  = r;
  }
}


class WaterDropController {
  constructor(canvas) {
    this.canvas  = canvas;
    this.text    = '';
    this.color   = '#ffffff';
    this.bgColor = '#111111';

    this.magnification  = 1.8;
    this.blur           = 0;
    this.outlineOpacity = 1.0;
    this.lineSpacing    = 1.0;

    this.drops    = [];
    this._nextId  = 0;

    this._textCanvas = null;
    this._active     = false;
    this._drag       = null;   // { type:'create'|'move'|'resize', drop, startX, startY, origCx?, origCy? }
    this._preview    = null;   // drop being sized before release

    this._bindUI();
    this._bindCanvas();
  }

  // ── Text canvas ───────────────────────────────────────────────────────────

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
      const fs     = this._fontSize();
      const lines  = this.text.split('\n');
      const lineH  = fs * this.lineSpacing;
      const startY = H / 2 - ((lines.length - 1) * lineH) / 2;
      ctx.font         = `${fs}px 'Courier New', monospace`;
      ctx.textAlign    = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle    = this.color;
      lines.forEach((line, i) => { if (line.length) ctx.fillText(line, W / 2, startY + i * lineH); });
    }
    this._textCanvas = tc;
  }

  // ── Draw a single water drop ──────────────────────────────────────────────

  _drawDrop(ctx, drop) {
    if (!this._textCanvas) return;
    const { cx, cy, r } = drop;
    const m = this.magnification;

    // ── 1. Drop shadow (drawn before anything so it's behind the drop) ──
    ctx.save();
    ctx.shadowColor   = 'rgba(0,0,0,0.38)';
    ctx.shadowBlur    = 22;
    ctx.shadowOffsetX = 4;
    ctx.shadowOffsetY = 7;
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(0,0,0,0.01)'; // near-transparent: just to project shadow
    ctx.fill();
    ctx.restore();

    // ── 2. Magnified (and optionally blurred) text inside the drop ──
    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.clip();

    ctx.translate(cx, cy);
    ctx.scale(m, m);
    ctx.translate(-cx, -cy);
    if (this.blur > 0) ctx.filter = `blur(${this.blur}px)`;
    ctx.drawImage(this._textCanvas, 0, 0);
    ctx.filter = 'none';

    ctx.restore();

    // ── 3. Glass lens overlay — controlled by outlineOpacity ──
    if (this.outlineOpacity > 0) {
      ctx.save();
      ctx.globalAlpha = this.outlineOpacity;

      const rimGrad = ctx.createRadialGradient(cx, cy, r * 0.72, cx, cy, r);
      rimGrad.addColorStop(0,   'rgba(0,0,0,0)');
      rimGrad.addColorStop(0.7, 'rgba(0,0,0,0.10)');
      rimGrad.addColorStop(1,   'rgba(0,0,0,0.55)');
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.fillStyle = rimGrad;
      ctx.fill();

      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.strokeStyle = 'rgba(255,255,255,0.80)';
      ctx.lineWidth   = 1.8;
      ctx.stroke();

      ctx.beginPath();
      ctx.arc(cx, cy, r - 2.5, 0, Math.PI * 2);
      ctx.strokeStyle = 'rgba(0,0,0,0.22)';
      ctx.lineWidth   = 3;
      ctx.stroke();

      ctx.restore();
    }
  }

  // ── Resize handle ─────────────────────────────────────────────────────────
  // Small dot sitting at the rightmost point of the circle.

  _handlePos(drop) {
    return { x: drop.cx + drop.r, y: drop.cy, r: 7 };
  }

  _drawHandle(ctx, drop) {
    const h = this._handlePos(drop);
    ctx.save();
    ctx.beginPath();
    ctx.arc(h.x, h.y, h.r, 0, Math.PI * 2);
    ctx.fillStyle   = 'rgba(255,255,255,0.90)';
    ctx.shadowColor = 'rgba(0,0,0,0.5)';
    ctx.shadowBlur  = 6;
    ctx.fill();
    ctx.shadowBlur  = 0;
    ctx.strokeStyle = 'rgba(140,200,255,0.75)';
    ctx.lineWidth   = 1;
    ctx.stroke();
    ctx.restore();
  }

  // ── Render ────────────────────────────────────────────────────────────────

  render() {
    if (window._fwActive) return; // falling water owns the canvas

    const { canvas } = this;
    const ctx = canvas.ctx;
    const W   = canvas.width, H = canvas.height;

    // Base: background + plain text
    if (this._textCanvas) {
      ctx.drawImage(this._textCanvas, 0, 0);
    } else {
      ctx.fillStyle = this.bgColor;
      ctx.globalAlpha = 1;
      ctx.fillRect(0, 0, W, H);
    }

    // Committed drops
    this.drops.forEach(d => this._drawDrop(ctx, d));

    // In-progress drag preview
    if (this._preview && this._preview.r >= 5) {
      this._drawDrop(ctx, this._preview);
    }

    // Resize handles (only in active mode)
    if (this._active) {
      this.drops.forEach(d => this._drawHandle(ctx, d));
    }
  }

  // ── Hit testing ───────────────────────────────────────────────────────────

  _hitTest(x, y) {
    for (let i = this.drops.length - 1; i >= 0; i--) {
      const d = this.drops[i];
      const h = this._handlePos(d);
      if (Math.hypot(x - h.x, y - h.y) <= h.r * 2.2)
        return { type: 'resize', drop: d };
      if (Math.hypot(x - d.cx, y - d.cy) <= d.r)
        return { type: 'move', drop: d };
    }
    return null;
  }

  // ── Canvas mouse events ───────────────────────────────────────────────────

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
        const d = hit.drop;
        this._drag = {
          type: hit.type, drop: d,
          startX: x, startY: y,
          origCx: d.cx, origCy: d.cy,
        };
      } else {
        const d       = new WaterDrop(this._nextId++, x, y, 0);
        this._preview = d;
        this._drag    = { type: 'create', drop: d, startX: x, startY: y };
      }
      e.preventDefault();
    });

    el.addEventListener('mousemove', e => {
      if (!this._active) return;
      const { x, y } = this._xy(e);

      if (this._drag) {
        const d = this._drag;
        if (d.type === 'move') {
          d.drop.cx = d.origCx + (x - d.startX);
          d.drop.cy = d.origCy + (y - d.startY);
          this.render();
        } else if (d.type === 'resize') {
          d.drop.r = Math.max(15, Math.hypot(x - d.drop.cx, y - d.drop.cy));
          this.render();
        } else if (d.type === 'create') {
          d.drop.r = Math.hypot(x - d.startX, y - d.startY);
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
        if (d.drop.r < 15) d.drop.r = 80; // click without drag → default size
        this.drops.push(d.drop);
        this._preview = null;
      }
      this._drag = null;
      this.render();
    };

    el.addEventListener('mouseup',    endDrag);
    el.addEventListener('mouseleave', endDrag);
  }

  // ── UI binding ────────────────────────────────────────────────────────────

  _bindUI() {
    document.getElementById('water-text-input').addEventListener('input', e => {
      this.text = e.target.value;
      this._buildTextCanvas();
      if (this.drops.length || this._active) this.render();
    });

    document.getElementById('btn-waterdrop-place').addEventListener('click', () => {
      this._active = !this._active;
      const btn = document.getElementById('btn-waterdrop-place');
      btn.textContent = this._active ? 'Drop: On' : 'Water Drop';
      btn.classList.toggle('btn-on', this._active);
      this.canvas.el.style.cursor = this._active ? 'crosshair' : 'default';
      if (this._active) {
        this._buildTextCanvas();
        this.render();
      }
    });

    document.getElementById('btn-waterdrop-reset').addEventListener('click', () => this.reset());

    this._slider('sl-waterdrop-mag', 'v-waterdrop-mag', v => {
      this.magnification = v;
      if (this.drops.length || this._preview) this.render();
    });

    this._slider('sl-waterdrop-blur', 'v-waterdrop-blur', v => {
      this.blur = v;
      if (this.drops.length || this._preview) this.render();
    });

    this._slider('sl-waterdrop-outline', 'v-waterdrop-outline', v => {
      this.outlineOpacity = v;
      if (this.drops.length || this._preview) this.render();
    });

    this._slider('sl-ls-water', 'v-ls-water', v => {
      this.lineSpacing = v;
      this._buildTextCanvas();
      if (this.drops.length || this._active) this.render();
    });

    document.addEventListener('tabchange', e => {
      if (e.detail === 'water') {
        this._buildTextCanvas();
        if (this.drops.length > 0 || this._active) this.render();
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
    return document.getElementById('sec-water')?.classList.contains('active');
  }

  _deactivate() {
    this._active  = false;
    this._drag    = null;
    this._preview = null;
    this.canvas.el.style.cursor = 'default';
    const btn = document.getElementById('btn-waterdrop-place');
    if (btn) { btn.textContent = 'Water Drop'; btn.classList.remove('btn-on'); }
  }

  reset() {
    this.drops    = [];
    this._preview = null;
    this._drag    = null;
    this._deactivate();
    this._buildTextCanvas();
    this.render();
  }
}


const waterDropController = new WaterDropController(canvas);
