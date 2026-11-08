// dots.js — Dots tab: fill letters with dots + optional outline ring + animation

// ─── Dot ─────────────────────────────────────────────────────────────────────

class Dot {
  constructor(x, y, radius, color, alpha) {
    this.x      = x;
    this.y      = y;
    this.radius = radius;
    this.color  = color;
    this.alpha  = alpha ?? (0.7 + Math.random() * 0.3);
  }

  grow(amount) {
    this.radius = Math.max(0, this.radius + amount);
  }

  draw(ctx) {
    if (this.radius <= 0) return;
    ctx.save();
    ctx.globalAlpha = this.alpha;
    ctx.fillStyle   = this.color;
    ctx.beginPath();
    ctx.arc(this.x, this.y, this.radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
}


// ─── DotsController ───────────────────────────────────────────────────────────
// Spawn fills the letter shape with dots.
// An optional Dots Outline ring can be toggled on separately.

class DotsController {
  constructor(canvas) {
    this.canvas      = canvas;
    this.fillDots    = [];   // dots ON the letter pixels  → make up the letter shape
    this.outlineDots = [];   // dots AROUND the letter edges

    this.text     = '';
    this.dotColor = '#ffffff';
    this.bgColor  = '#111111';
    this.lineSpacing = 1.0;

    // Fill settings
    this.dotSize     = 6;    // initial radius (px)
    this.fillSpacing = 8;    // pixel step between sampled letter pixels
    this.growAmt     = 2;    // radius added per Grow click
    this.randomize   = 3;    // positional jitter strength

    // Outline settings
    this.outlineEnabled = false;
    this.outlineSize    = 5;    // outline dot radius (px)
    this.outlineSpacing = 8;    // pixel step along letter edge

    this._off         = null;
    this._offCtx      = null;
    this._cellSize    = 8;
    this._initialized = false;

    // Polka dots
    this._polkaDots   = [];
    this._polkaMode   = false;
    this._polkaDrag   = null;  // { dot, mode:'move'|'resize', mx, my }
    this.polkaSize    = 10;
    this.polkaSpacing = 24;
    this.polkaJitter  = 0;
    this.polkaSizeVar = 0;
    this.polkaOpacity = 0.9;
    this.polkaHex     = false;

    this._bindUI();
    this._initPolkaDragListeners();
  }

  // ── UI ────────────────────────────────────────────────────────────────────

  _bindUI() {
    document.getElementById('dots-text-input').addEventListener('input', e => {
      this.text = e.target.value;
      this._initialized = false;
      if (this._isActive()) this.render();
    });

    this._slider('sl-ls-dots', 'v-ls-dots', v => {
      this.lineSpacing = v;
      this._initialized = false;
      if (this._isActive()) this.render();
    });

    document.getElementById('btn-dots-spawn').addEventListener('click', () => this.spawn());
    document.getElementById('btn-dots-grow').addEventListener('click',  () => this.grow());
    document.getElementById('btn-dots-reset').addEventListener('click', () => this.reset());

    // Fill sliders
    this._slider('sl-dot-size',     'v-dot-size',     v => { this.dotSize     = v; if (this.fillDots.length) this.spawn(); });
    this._slider('sl-fill-spacing', 'v-fill-spacing', v => { this.fillSpacing = v; if (this.fillDots.length) this.spawn(); });
    this._slider('sl-dot-grow',     'v-dot-grow',     v => { this.growAmt     = v; });
    this._slider('sl-dot-rand',     'v-dot-rand',     v => { this.randomize   = v; if (this.fillDots.length) this.spawn(); });

    // Dots Outline toggle
    const toggleBtn = document.getElementById('btn-outline-toggle');
    toggleBtn.addEventListener('click', () => {
      this.outlineEnabled = !this.outlineEnabled;
      toggleBtn.textContent = `Dots Outline: ${this.outlineEnabled ? 'On' : 'Off'}`;
      toggleBtn.classList.toggle('btn-on', this.outlineEnabled);
      this._rebuildOutline();
    });

    // Outline sliders — rebuild outline whenever changed
    this._slider('sl-outline-size',    'v-outline-size',    v => { this.outlineSize    = v; this._rebuildOutline(); });
    this._slider('sl-outline-spacing', 'v-outline-spacing', v => { this.outlineSpacing = v; this._rebuildOutline(); });

    // Polka dots
    document.getElementById('btn-polka-spawn').addEventListener('click', () => this.spawnPolka());
    document.getElementById('btn-polka-reset').addEventListener('click', () => this.resetPolka());
    this._slider('sl-polka-size',     'v-polka-size',     v => { this.polkaSize    = v; if (this._polkaMode) this.spawnPolka(); });
    this._slider('sl-polka-spacing',  'v-polka-spacing',  v => { this.polkaSpacing = v; if (this._polkaMode) this.spawnPolka(); });
    this._slider('sl-polka-jitter',   'v-polka-jitter',   v => { this.polkaJitter  = v; if (this._polkaMode) this.spawnPolka(); });
    this._slider('sl-polka-size-var', 'v-polka-size-var', v => { this.polkaSizeVar = v; if (this._polkaMode) this.spawnPolka(); });
    this._slider('sl-polka-opacity', 'v-polka-opacity', v => { this.polkaOpacity = v / 100; if (this._polkaMode) this.render(); });
    const hexBtn = document.getElementById('btn-polka-hex');
    hexBtn.addEventListener('click', () => {
      this.polkaHex = !this.polkaHex;
      hexBtn.textContent = `Hex Grid: ${this.polkaHex ? 'On' : 'Off'}`;
      hexBtn.classList.toggle('btn-on', this.polkaHex);
    });

    // Color picker (shared with AnimDots)
    const swatch = document.getElementById('dots-color-swatch');
    const label  = document.getElementById('dots-color-label');
    const input  = document.getElementById('dots-color-input');
    swatch.addEventListener('click', () => input.click());
    input.addEventListener('input', () => {
      this.dotColor = input.value;
      label.textContent = input.value;
      swatch.style.background = input.value;
      if (this._isActive()) this.render();
    });

    document.addEventListener('tabchange', e => {
      if (e.detail === 'dots') this.render();
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
    return document.getElementById('sec-dots')?.classList.contains('active');
  }

  // ── Offscreen canvas ──────────────────────────────────────────────────────
  // Renders text black-on-white so we can read letter pixels.

  _initOffscreen() {
    const W = this.canvas.width, H = this.canvas.height;
    const _d1Lines = this.text.split('\n');
    const _d1MaxLen = Math.max(..._d1Lines.map(l => l.length), 1);
    const _d1NLines = _d1Lines.length || 1;
    const fontSize = Math.min(
      Math.max(24, Math.min(W, H) * 0.55 / Math.max(1, Math.pow(_d1MaxLen, 0.55))),
      Math.max(24, H * 0.78 / (_d1NLines * this.lineSpacing))
    );
    this._cellSize     = Math.max(5, Math.round(fontSize * 0.045));

    const off = document.createElement('canvas');
    off.width = W; off.height = H;
    const ctx = off.getContext('2d');
    ctx.fillStyle = 'white'; ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = 'black';
    ctx.font = `${fontSize}px 'Courier New', monospace`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';

    const lines  = _d1Lines;
    const lineH  = fontSize * this.lineSpacing;
    const startY = H / 2 - ((lines.length - 1) * lineH) / 2;
    lines.forEach((line, i) => { if (line.length) ctx.fillText(line, W / 2, startY + i * lineH); });

    this._off = off; this._offCtx = ctx; this._initialized = true;
  }

  _getPx() {
    return this._offCtx.getImageData(0, 0, this._off.width, this._off.height).data;
  }

  _isText(px, x, y) {
    x = Math.round(x); y = Math.round(y);
    const W = this._off.width, H = this._off.height;
    if (x < 0 || x >= W || y < 0 || y >= H) return false;
    return px[(y * W + x) * 4] < 128;
  }

  // ── Fill dots: sample ON letter pixels ───────────────────────────────────

  _buildFillDots() {
    const W    = this._off.width, H = this._off.height;
    const px   = this._getPx();
    const step = Math.max(2, Math.round(this.fillSpacing));
    // jitter scaled so randomize=0 means a perfect grid
    const jAmt = step * 0.5 * (this.randomize / 15);
    const dots = [];

    for (let y = 0; y < H; y += step) {
      for (let x = 0; x < W; x += step) {
        if (px[(y * W + x) * 4] < 128) {
          dots.push(new Dot(
            x + (Math.random() - 0.5) * jAmt * 2,
            y + (Math.random() - 0.5) * jAmt * 2,
            this.dotSize,
            this.dotColor,
            0.78 + Math.random() * 0.22
          ));
        }
      }
    }
    return dots;
  }

  // ── Outline dots: sit just outside letter edges ───────────────────────────

  _buildOutlineDots() {
    const W  = this._off.width, H = this._off.height;
    const px = this._getPx();
    const iT = (x, y) => this._isText(px, x, y);
    const step   = Math.max(4, Math.round(this.outlineSpacing));
    const offset = this.outlineSize + 3;   // gap from letter surface
    const r      = this.outlineSize;
    const a      = () => 0.6 + Math.random() * 0.35;
    const dots   = [];

    // Top edge: scan each column downward, first letter pixel found
    for (let x = 0; x < W; x += step) {
      for (let y = 0; y < H; y++) {
        if (iT(x, y)) { dots.push(new Dot(x, y - offset, r, this.dotColor, a())); break; }
      }
    }
    // Bottom edge
    for (let x = 0; x < W; x += step) {
      for (let y = H - 1; y >= 0; y--) {
        if (iT(x, y)) { dots.push(new Dot(x, y + offset, r, this.dotColor, a())); break; }
      }
    }
    // Left edge
    for (let y = 0; y < H; y += step) {
      for (let x = 0; x < W; x++) {
        if (iT(x, y)) { dots.push(new Dot(x - offset, y, r, this.dotColor, a())); break; }
      }
    }
    // Right edge
    for (let y = 0; y < H; y += step) {
      for (let x = W - 1; x >= 0; x--) {
        if (iT(x, y)) { dots.push(new Dot(x + offset, y, r, this.dotColor, a())); break; }
      }
    }
    return dots;
  }

  _rebuildOutline() {
    if (!this.outlineEnabled) {
      this.outlineDots = [];
    } else {
      if (!this._initialized && this.text.trim()) this._initOffscreen();
      this.outlineDots = this._initialized ? this._buildOutlineDots() : [];
    }
    if (this._isActive()) this.render();
  }

  // ── Core actions ──────────────────────────────────────────────────────────

  spawn() {
    if (!this.text.trim()) return;
    if (!this._initialized) this._initOffscreen();
    this._polkaMode  = false;
    this._polkaDots  = [];
    this._polkaDrag  = null;
    this.canvas.el.style.cursor = '';
    this.fillDots    = this._buildFillDots();
    this.outlineDots = this.outlineEnabled ? this._buildOutlineDots() : [];
    this.render();
  }

  grow() {
    if (!this.fillDots.length) return;
    this.fillDots.forEach(d => d.grow(this.growAmt));
    this.render();
  }

  reset() {
    this.fillDots = []; this.outlineDots = [];
    this._polkaDots = []; this._polkaMode = false; this._polkaDrag = null;
    this.canvas.el.style.cursor = '';
    this._initialized = false; this._off = null;
    this.render();
  }

  // ── Polka dots ────────────────────────────────────────────────────────────

  spawnPolka() {
    if (!this.text.trim()) return;
    if (!this._initialized) this._initOffscreen();
    this._polkaDots = this._buildPolkaDots();
    this._polkaMode = true;
    this.render();
  }

  resetPolka() {
    this._polkaDots = []; this._polkaMode = false; this._polkaDrag = null;
    this.canvas.el.style.cursor = '';
    this.render();
  }

  _initPolkaDragListeners() {
    const cvs = this.canvas.el;

    const pos = (e) => {
      const rect  = cvs.getBoundingClientRect();
      const src   = e.touches ? e.touches[0] : e;
      return {
        x: (src.clientX - rect.left) * (cvs.width  / rect.width),
        y: (src.clientY - rect.top)  * (cvs.height / rect.height),
      };
    };

    cvs.addEventListener('mousedown', (e) => {
      if (!this._polkaMode || !this._polkaDots.length) return;
      const p   = pos(e);
      const hit = this._hitPolkaDot(p.x, p.y);
      if (!hit) return;
      this._polkaDrag = { dot: hit.dot, mode: hit.mode, mx: p.x, my: p.y };
      e.preventDefault();
    });

    cvs.addEventListener('mousemove', (e) => {
      if (!this._polkaMode) return;
      const p = pos(e);

      if (this._polkaDrag) {
        const { dot, mode } = this._polkaDrag;
        if (mode === 'move') {
          dot.x += p.x - this._polkaDrag.mx;
          dot.y += p.y - this._polkaDrag.my;
          this._polkaDrag.mx = p.x;
          this._polkaDrag.my = p.y;
        } else {
          // Resize: radius = distance from dot centre to cursor
          const dx = p.x - dot.x, dy = p.y - dot.y;
          dot.r = Math.max(1, Math.sqrt(dx * dx + dy * dy));
        }
        this.render();
        e.preventDefault();
      } else {
        // Update cursor on hover
        const hit = this._hitPolkaDot(p.x, p.y);
        if (hit) {
          cvs.style.cursor = hit.mode === 'move' ? 'grab' : 'nesw-resize';
        } else if (cvs.style.cursor) {
          cvs.style.cursor = '';
        }
      }
    });

    const endDrag = () => { this._polkaDrag = null; };
    cvs.addEventListener('mouseup',    endDrag);
    cvs.addEventListener('mouseleave', endDrag);
  }

  // Returns { dot, mode:'move'|'resize' } for the dot under (mx,my), or null
  _hitPolkaDot(mx, my) {
    let best = null, bestDist = Infinity;
    for (const dot of this._polkaDots) {
      const dx = mx - dot.x, dy = my - dot.y;
      const d  = Math.sqrt(dx * dx + dy * dy);
      if (d < dot.r * 1.5 && d < bestDist) { bestDist = d; best = dot; }
    }
    if (!best) return null;
    // Inner 65% → move; outer ring → resize
    return { dot: best, mode: bestDist < best.r * 0.65 ? 'move' : 'resize' };
  }

  _buildPolkaDots() {
    const W  = this._off.width, H = this._off.height;
    const px = this._getPx();
    const sp = Math.max(4, this.polkaSpacing);
    const j  = this.polkaJitter;
    // Size variance: 0 = uniform, 100 = dots range from ~10% to ~190% of base size
    const varFrac = this.polkaSizeVar / 100;
    const dots = [];

    for (let row = 0; row * sp < H + sp; row++) {
      const hexOff = (this.polkaHex && row % 2 === 1) ? sp / 2 : 0;
      for (let col = 0; col * sp < W + sp; col++) {
        const cx = col * sp + hexOff + (Math.random() - 0.5) * j * 2;
        const cy = row * sp + (Math.random() - 0.5) * j * 2;
        const ix = Math.round(cx), iy = Math.round(cy);
        if (ix >= 0 && ix < W && iy >= 0 && iy < H && px[(iy * W + ix) * 4] < 128) {
          // Randomize radius: at varFrac=0 all dots are polkaSize; higher = wider spread
          const r = Math.max(0.5, this.polkaSize * (1 + (Math.random() * 2 - 1) * varFrac));
          dots.push({ x: cx, y: cy, r, alphaMod: 0.85 + Math.random() * 0.15 });
        }
      }
    }
    return dots;
  }

  // ── Render ────────────────────────────────────────────────────────────────

  render() {
    const { canvas, text } = this;
    canvas.beginLayer('dots');
    try {
      canvas.clear(this.bgColor);
      if (!text.trim()) return;

      if (this._polkaMode && this._polkaDots.length) {
        const ctx      = canvas.ctx;
        const activeDot = this._polkaDrag?.dot ?? null;
        ctx.fillStyle  = this.dotColor;
        for (const d of this._polkaDots) {
          ctx.globalAlpha = d.alphaMod * this.polkaOpacity;
          ctx.beginPath(); ctx.arc(d.x, d.y, d.r, 0, Math.PI * 2); ctx.fill();
          if (d === activeDot) {
            ctx.save(); ctx.globalAlpha = 0.55; ctx.strokeStyle = this.dotColor; ctx.lineWidth = 1;
            ctx.beginPath(); ctx.arc(d.x, d.y, d.r + 3, 0, Math.PI * 2); ctx.stroke(); ctx.restore();
          }
        }
        ctx.globalAlpha = 1;
        return;
      }

      if (!this.fillDots.length && !this.outlineDots.length) {
        this._drawText(canvas.ctx, canvas.width, canvas.height); return;
      }
      this.fillDots.forEach(d => d.draw(canvas.ctx));
      this.outlineDots.forEach(d => d.draw(canvas.ctx));
    } finally {
      canvas.endLayer();
    }
  }

  _drawText(ctx, W, H) {
    const _d2Lines = this.text.split('\n');
    const _d2MaxLen = Math.max(..._d2Lines.map(l => l.length), 1);
    const _d2NLines = _d2Lines.length || 1;
    const fontSize = Math.min(
      Math.max(24, Math.min(W, H) * 0.55 / Math.max(1, Math.pow(_d2MaxLen, 0.55))),
      Math.max(24, H * 0.78 / (_d2NLines * this.lineSpacing))
    );
    const lines      = _d2Lines;
    const lineH      = fontSize * this.lineSpacing;
    const startY     = H / 2 - ((lines.length - 1) * lineH) / 2;
    ctx.font = `${fontSize}px 'Courier New', monospace`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillStyle = this.dotColor;
    lines.forEach((line, i) => { if (line.length) ctx.fillText(line, W / 2, startY + i * lineH); });
  }
}


// ─── AnimDots ────────────────────────────────────────────────────────────────
// Animation: dots continuously spawn ON letter pixels, grow, then fade out.

class AnimDots {
  constructor(canvas) {
    this.canvas    = canvas;
    this.running   = false;
    this.animId    = null;
    this.particles = [];

    this.text      = '';
    this.dotColor  = '#ffffff';
    this.maxRadius = 10;
    this.speed     = 1;
    this.density   = 4;

    this._letterPixels = [];
    this._initialized  = false;

    this._bindUI();
  }

  _bindUI() {
    document.getElementById('dots-text-input').addEventListener('input', e => {
      this.text = e.target.value;
      this._initialized = false;
    });
    document.getElementById('dots-color-input').addEventListener('input', e => {
      this.dotColor = e.target.value;
    });

    document.getElementById('btn-anim-play').addEventListener('click',  () => this._toggle());
    document.getElementById('btn-anim-reset').addEventListener('click', () => this._clearParticles());

    this._slider('sl-anim-max',     'v-anim-max',     v => { this.maxRadius = v; this._initialized = false; });
    this._slider('sl-anim-speed',   'v-anim-speed',   v => { this.speed     = v; });
    this._slider('sl-anim-density', 'v-anim-density', v => { this.density   = v; });

    document.addEventListener('tabchange', e => {
      if (e.detail !== 'dots') this._stop();
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

  _initOffscreen() {
    const W = this.canvas.width, H = this.canvas.height;
    const _d3Lines = this.text.split('\n');
    const _d3MaxLen = Math.max(..._d3Lines.map(l => l.length), 1);
    const _d3NLines = _d3Lines.length || 1;
    const fontSize = Math.min(
      Math.max(24, Math.min(W, H) * 0.55 / Math.max(1, Math.pow(_d3MaxLen, 0.55))),
      Math.max(24, H * 0.78 / (_d3NLines * this.lineSpacing))
    );
    const step         = Math.max(3, Math.floor(this.maxRadius * 0.6));

    const off = document.createElement('canvas');
    off.width = W; off.height = H;
    const ctx = off.getContext('2d');
    ctx.fillStyle = 'white'; ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = 'black';
    ctx.font = `${fontSize}px 'Courier New', monospace`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';

    const lines  = _d3Lines;
    const lineH  = fontSize * this.lineSpacing;
    const startY = H / 2 - ((lines.length - 1) * lineH) / 2;
    lines.forEach((line, i) => { if (line.length) ctx.fillText(line, W / 2, startY + i * lineH); });

    const { data: px } = ctx.getImageData(0, 0, W, H);
    this._letterPixels = [];
    for (let y = 0; y < H; y += step) {
      for (let x = 0; x < W; x += step) {
        if (px[(y * W + x) * 4] < 128) {
          this._letterPixels.push({
            x: x + (Math.random() - 0.5) * step,
            y: y + (Math.random() - 0.5) * step,
          });
        }
      }
    }
    this._initialized = true;
  }

  _toggle() { this.running ? this._stop() : this._play(); }

  _play() {
    if (!this.text.trim()) return;
    if (!this._initialized) this._initOffscreen();
    if (!this._letterPixels.length) return;
    this.running = true;
    document.getElementById('btn-anim-play').textContent = 'Stop';
    this._loop();
  }

  _stop() {
    this.running = false;
    if (this.animId) { cancelAnimationFrame(this.animId); this.animId = null; }
    document.getElementById('btn-anim-play').textContent = 'Play';
  }

  _clearParticles() {
    this.particles = [];
    if (!this.running) this.canvas.clear('#111111');
  }

  _loop() {
    if (!this.running) return;
    const ctx = this.canvas.ctx;

    ctx.fillStyle = '#111111';
    ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);

    for (let i = 0; i < this.density; i++) this._spawnParticle();

    this.particles = this.particles.filter(p => {
      if (p.phase === 'grow') {
        p.radius += this.speed * 0.3;
        if (p.radius >= p.maxRadius) { p.radius = p.maxRadius; p.phase = 'fade'; }
      } else {
        p.alpha -= this.speed * 0.012;
        if (p.alpha <= 0) return false;
      }
      ctx.save();
      ctx.globalAlpha = Math.max(0, p.alpha);
      ctx.fillStyle   = this.dotColor;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.radius, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
      return true;
    });

    this.animId = requestAnimationFrame(() => this._loop());
  }

  _spawnParticle() {
    if (!this._letterPixels.length) return;
    const pos = this._letterPixels[Math.floor(Math.random() * this._letterPixels.length)];
    this.particles.push({
      x: pos.x, y: pos.y,
      radius: 0,
      maxRadius: this.maxRadius * (0.4 + Math.random() * 0.8),
      alpha: 0.5 + Math.random() * 0.45,
      phase: 'grow',
    });
  }
}


// ─── Init ─────────────────────────────────────────────────────────────────────

const dotsController = new DotsController(canvas);
const animDots       = new AnimDots(canvas);
