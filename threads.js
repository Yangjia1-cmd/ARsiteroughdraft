// threads.js — Thread tab: animated threads travel zigzag paths that form letters

// ─── ZigzagPath ──────────────────────────────────────────────────────────────

class ZigzagPath {
  constructor(points) {
    this.points = points;

    this._lens = [0];
    for (let i = 1; i < points.length; i++) {
      const dx = points[i].x - points[i - 1].x;
      const dy = points[i].y - points[i - 1].y;
      this._lens.push(this._lens[i - 1] + Math.sqrt(dx * dx + dy * dy));
    }
    this.totalLength = this._lens[this._lens.length - 1];
  }

  getPoint(t) {
    if (this.points.length === 0) return { x: 0, y: 0 };
    if (this.points.length === 1) return this.points[0];

    const target = Math.max(0, Math.min(1, t)) * this.totalLength;
    let lo = 0, hi = this._lens.length - 1;
    while (lo < hi - 1) {
      const mid = (lo + hi) >> 1;
      if (this._lens[mid] < target) lo = mid; else hi = mid;
    }

    const segLen = this._lens[hi] - this._lens[lo];
    const frac   = segLen < 1e-9 ? 0 : (target - this._lens[lo]) / segLen;
    const p1 = this.points[lo], p2 = this.points[hi];
    return { x: p1.x + (p2.x - p1.x) * frac, y: p1.y + (p2.y - p1.y) * frac };
  }

  draw(ctx, color, alpha, lineWidth) {
    if (this.points.length < 2) return;
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.strokeStyle = color;
    ctx.lineWidth   = lineWidth;
    ctx.lineJoin    = 'round';
    ctx.beginPath();
    ctx.moveTo(this.points[0].x, this.points[0].y);
    for (let i = 1; i < this.points.length; i++) {
      ctx.lineTo(this.points[i].x, this.points[i].y);
    }
    ctx.stroke();
    ctx.restore();
  }
}


// ─── Thread ───────────────────────────────────────────────────────────────────

class Thread {
  constructor(path, speed, color, trailLength) {
    this.path      = path;
    this.t         = Math.random();
    this.speed     = speed * (0.5 + Math.random());
    this.color     = color;
    this.maxTrail  = trailLength;
    this.trail     = [];
  }

  update() {
    this.t += this.speed;
    if (this.t > 1) this.t -= 1;
    this.trail.push(this.path.getPoint(this.t));
    if (this.trail.length > this.maxTrail) this.trail.shift();
  }

  draw(ctx) {
    if (this.trail.length < 2) return;
    ctx.save();
    ctx.lineCap  = 'round';
    ctx.lineJoin = 'round';

    for (let i = 1; i < this.trail.length; i++) {
      const frac  = i / this.trail.length;
      ctx.globalAlpha = frac * 0.85;
      ctx.lineWidth   = 0.5 + frac * 2;
      ctx.strokeStyle = this.color;
      ctx.beginPath();
      ctx.moveTo(this.trail[i - 1].x, this.trail[i - 1].y);
      ctx.lineTo(this.trail[i].x,     this.trail[i].y);
      ctx.stroke();
    }

    const head = this.trail[this.trail.length - 1];
    ctx.globalAlpha = 1;
    ctx.fillStyle   = this.color;
    ctx.beginPath();
    ctx.arc(head.x, head.y, 2, 0, Math.PI * 2);
    ctx.fill();

    ctx.restore();
  }
}


// ─── ThreadsController ────────────────────────────────────────────────────────

class ThreadsController {
  constructor(canvas) {
    this.canvas  = canvas;
    this.paths   = [];
    this.threads = [];
    this.animId  = null;
    this.running = false;

    this.text        = '';
    this.color       = '#ffffff';
    this.bgColor     = '#111111';
    this.lineSpacing = 1.0;
    this.rowCount    = 20;
    this.zigzagPeaks = 5;
    this.threadCount = 15;
    this.speed       = 3;
    this.trailLength = 20;
    this.lineWeight  = 1;

    this._off         = null;
    this._offCtx      = null;
    this._pathCanvas  = null;
    this._freeCanvas  = null;
    this._mode        = 'none';
    this._initialized = false;

    // Freestyle settings
    this.freeRowSpacing  = 2;
    this.freeGapChance   = 35;
    this.freeFringeLen   = 40;
    this.freeDiagDensity = 0;

    // Drag mode state
    this._dragModeActive = false;
    this._dragState      = null;

    this._bindUI();
    this._initDragListeners();
  }

  // ── UI ────────────────────────────────────────────────────────────────────

  _bindUI() {
    document.getElementById('threads-text-input').addEventListener('input', e => {
      this.text = e.target.value;
      this._initialized = false;
      if (this._isActive() && !this.running) this.render();
    });

    this._slider('sl-ls-threads', 'v-ls-threads', v => {
      this.lineSpacing = v;
      this._initialized = false;
      if (this._isActive()) this.render();
    });

    document.getElementById('btn-threads-build').addEventListener('click',     () => this.build());
    document.getElementById('btn-threads-static').addEventListener('click',    () => this.drawStatic());
    document.getElementById('btn-threads-play').addEventListener('click',      () => this._toggle());
    document.getElementById('btn-threads-reset').addEventListener('click',     () => this.reset());
    document.getElementById('btn-threads-freestyle').addEventListener('click', () => this.buildFreestyle());
    document.getElementById('btn-threads-drag').addEventListener('click',      () => this._toggleDragMode());

    this._slider('sl-rows',         'v-rows',         v => { this.rowCount    = v; if (this._mode === 'zigzag' && this._initialized) this.build(); });
    this._slider('sl-zigzag',       'v-zigzag',       v => { this.zigzagPeaks = v; if (this._mode === 'zigzag' && this._initialized) this.build(); });
    this._slider('sl-thread-count', 'v-thread-count', v => { this.threadCount = v; this._respawnThreads(); });
    this._slider('sl-thread-speed', 'v-thread-speed', v => { this.speed       = v; this._updateSpeeds(); });
    this._slider('sl-trail',        'v-trail',        v => { this.trailLength = v; if (this._isActive() && !this.running) this.render(); });
    this._slider('sl-line-weight',  'v-line-weight',  v => { this.lineWeight  = v; if (this._mode === 'zigzag' && this._pathCanvas) { this._bakePathCanvas(); this.render(); } });
    this._slider('sl-free-spacing', 'v-free-spacing', v => { this.freeRowSpacing  = v; if (this._mode === 'freestyle' && this._initialized) this.buildFreestyle(); });
    this._slider('sl-free-gap',     'v-free-gap',     v => { this.freeGapChance   = v; if (this._mode === 'freestyle' && this._initialized) this.buildFreestyle(); });
    this._slider('sl-free-fringe',  'v-free-fringe',  v => { this.freeFringeLen   = v; if (this._mode === 'freestyle' && this._initialized) this.buildFreestyle(); });
    this._slider('sl-free-diag',    'v-free-diag',    v => { this.freeDiagDensity = v; if (this._mode === 'freestyle' && this._initialized) this.buildFreestyle(); });

    const swatch = document.getElementById('threads-color-swatch');
    const label  = document.getElementById('threads-color-label');
    const input  = document.getElementById('threads-color-input');
    swatch.addEventListener('click', () => input.click());
    input.addEventListener('input', () => {
      this.color = input.value;
      label.textContent  = input.value;
      swatch.style.background = input.value;
    });

    document.addEventListener('tabchange', e => {
      if (e.detail === 'threads') this.render();
      else this._stop();
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
    return document.getElementById('sec-threads')?.classList.contains('active');
  }

  // ── Offscreen canvas ──────────────────────────────────────────────────────

  _initOffscreen() {
    const W = this.canvas.width, H = this.canvas.height;
    const _t1Lines = this.text.split('\n');
    const _t1MaxLen = Math.max(..._t1Lines.map(l => l.length), 1);
    const _t1NLines = _t1Lines.length || 1;
    const fontSize = Math.min(
      Math.max(24, Math.min(W, H) * 0.55 / Math.max(1, Math.pow(_t1MaxLen, 0.55))),
      Math.max(24, H * 0.78 / (_t1NLines * this.lineSpacing))
    );

    const off = document.createElement('canvas');
    off.width = W; off.height = H;
    const ctx = off.getContext('2d');
    ctx.fillStyle = 'white'; ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = 'black';
    ctx.font = `${fontSize}px 'Courier New', monospace`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';

    const lines  = _t1Lines;
    const lineH  = fontSize * this.lineSpacing;
    const startY = H / 2 - ((lines.length - 1) * lineH) / 2;
    lines.forEach((line, i) => { if (line.length) ctx.fillText(line, W / 2, startY + i * lineH); });

    this._off = off; this._offCtx = ctx; this._initialized = true;
  }

  _bakePathCanvas() {
    const W = this.canvas.width, H = this.canvas.height;
    const pc = document.createElement('canvas');
    pc.width = W; pc.height = H;
    const ctx = pc.getContext('2d');
    ctx.clearRect(0, 0, W, H);
    this.paths.forEach(p => p.draw(ctx, this.color, 1, this.lineWeight));
    this._pathCanvas = pc;
  }

  // ── Path building ─────────────────────────────────────────────────────────

  _segmentsAtY(y, px, W, H) {
    y = Math.round(y);
    if (y < 0 || y >= H) return [];
    const segs = [];
    let inSeg = false, start = 0;
    for (let x = 0; x < W; x++) {
      const hit = px[(y * W + x) * 4] < 128;
      if (hit && !inSeg)  { inSeg = true;  start = x; }
      if (!hit && inSeg)  { inSeg = false; segs.push([start, x]); }
    }
    if (inSeg) segs.push([start, W - 1]);
    return segs;
  }

  _buildPaths() {
    const W  = this._off.width, H = this._off.height;
    const px = this._offCtx.getImageData(0, 0, W, H).data;

    let minY = H, maxY = 0;
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        if (px[(y * W + x) * 4] < 128) { minY = Math.min(minY, y); maxY = Math.max(maxY, y); break; }
      }
    }
    if (minY >= maxY) return;

    const rowH  = (maxY - minY) / this.rowCount;
    const amp   = rowH * 0.48;
    const paths = [];

    for (let r = 0; r < this.rowCount; r++) {
      const yMid = minY + (r + 0.5) * rowH;
      const yTop = yMid - amp;
      const yBot = yMid + amp;

      const segs = this._segmentsAtY(yMid, px, W, H);

      for (const [xL, xR] of segs) {
        const width = xR - xL;
        if (width < 6) continue;

        const peaks  = Math.max(2, Math.round((width / rowH) * this.zigzagPeaks));
        const points = [];
        const forward = r % 2 === 0;

        for (let z = 0; z <= peaks; z++) {
          const t = z / peaks;
          const x = forward ? xL + t * width : xR - t * width;
          const y = z % 2 === 0 ? yTop : yBot;
          points.push({ x, y });
        }

        paths.push(new ZigzagPath(points));
      }
    }

    this.paths = paths;
  }

  // ── Thread management ─────────────────────────────────────────────────────

  _speedFactor() { return this.speed * 0.001; }

  _respawnThreads() {
    if (!this.paths.length) return;
    const sf = this._speedFactor();
    this.threads = Array.from({ length: Math.ceil(this.threadCount) }, () => {
      const path = this.paths[Math.floor(Math.random() * this.paths.length)];
      return new Thread(path, sf, this.color, Math.ceil(this.trailLength));
    });
  }

  _updateSpeeds() {
    const sf = this._speedFactor();
    this.threads.forEach(th => { th.speed = sf * (0.5 + Math.random()); });
  }

  // ── Core actions ──────────────────────────────────────────────────────────

  build() {
    if (!this.text.trim()) return;
    if (!this._initialized) this._initOffscreen();
    this._buildPaths();
    this._bakePathCanvas();
    this._respawnThreads();
    this._stop();
    this._mode = 'zigzag';
    this.render();
  }

  drawStatic() {
    this._stop();
    this.render();
  }

  _toggle() {
    if (this.running) this._stop(); else this._play();
  }

  _play() {
    if (!this._pathCanvas) return;
    if (!this.threads.length) this._respawnThreads();
    this.running = true;
    document.getElementById('btn-threads-play').textContent = 'Stop';
    this._loop();
  }

  _stop() {
    this.running = false;
    if (this.animId) { cancelAnimationFrame(this.animId); this.animId = null; }
    const btn = document.getElementById('btn-threads-play');
    if (btn) btn.textContent = 'Animate';
  }

  reset() {
    this._stop();
    this.paths = []; this.threads = [];
    this._pathCanvas = null;
    this._freeCanvas = null;
    this._mode = 'none';
    this._initialized = false; this._off = null;
    // Turn off drag mode too
    if (this._dragModeActive) this._toggleDragMode();
    this.render();
  }

  // ── Animation loop ────────────────────────────────────────────────────────

  _loop() {
    if (!this.running) return;
    this.canvas.beginLayer('threads');
    const ctx = this.canvas.ctx;
    const W   = this.canvas.width, H = this.canvas.height;

    ctx.fillStyle = this.bgColor;
    ctx.globalAlpha = 1;
    ctx.fillRect(0, 0, W, H);

    if (this._pathCanvas) ctx.drawImage(this._pathCanvas, 0, 0);

    this.threads.forEach(th => {
      th.color    = this.color;
      th.maxTrail = Math.ceil(this.trailLength);
      th.update();
      th.draw(ctx);
    });

    this.canvas.endLayer();
    this.animId = requestAnimationFrame(() => this._loop());
  }

  // ── Render (static view) ──────────────────────────────────────────────────

  render() {
    const { canvas, text } = this;
    canvas.beginLayer('threads');
    try {
      canvas.clear(this.bgColor);
      if (!text.trim()) return;
      if (this._mode === 'freestyle' && this._freeCanvas) {
        canvas.ctx.drawImage(this._freeCanvas, 0, 0); return;
      }
      if (!this._pathCanvas) {
        this._drawDimText(canvas.ctx, canvas.width, canvas.height); return;
      }
      canvas.ctx.drawImage(this._pathCanvas, 0, 0);
      this.threads.forEach(th => th.draw(canvas.ctx));
    } finally {
      canvas.endLayer();
    }
  }

  // ── Freestyle: chaotic loose threads ──────────────────────────────────────

  buildFreestyle() {
    if (!this.text.trim()) return;
    this._stop();
    if (!this._initialized) this._initOffscreen();

    const W  = this._off.width, H = this._off.height;
    const px = this._offCtx.getImageData(0, 0, W, H).data;

    let minY = H, maxY = 0;
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        if (px[(y * W + x) * 4] < 128) { minY = Math.min(minY, y); maxY = Math.max(maxY, y); break; }
      }
    }
    if (minY >= maxY) return;

    const fc  = document.createElement('canvas');
    fc.width  = W; fc.height = H;
    const ctx = fc.getContext('2d');
    ctx.clearRect(0, 0, W, H);

    const step = Math.max(1, Math.round(this.freeRowSpacing));

    // ── Body: horizontal knit threads with chaotic waviness ────────────────
    for (let y = minY; y <= maxY; y += step) {
      // Randomly skip rows for a frayed, uneven look
      if (Math.random() < 0.08) continue;
      const segs = this._segmentsAtY(y, px, W, H);
      for (const [xL, xR] of segs) {
        if (xR - xL < 4) continue;
        this._drawKnitThread(ctx, xL, xR, y);
        // Generous fringe probability — more threads spilling out
        if (Math.random() < 0.65) this._drawHorzFringe(ctx, xL, y, -1);
        if (Math.random() < 0.65) this._drawHorzFringe(ctx, xR, y, +1);
        // Spontaneous diagonal breaks out of the body
        if (Math.random() < 0.25) this._drawDiagFringe(ctx, xL, y, -1, Math.random() < 0.5 ? -1 : 1);
        if (Math.random() < 0.25) this._drawDiagFringe(ctx, xR, y, +1, Math.random() < 0.5 ? -1 : 1);
      }
    }

    // ── Chaos threads: random-angle threads scattered through the body ──────
    // These give the tangled, snarled appearance
    const chaosStepY = Math.max(2, step * 2);
    for (let y = minY; y <= maxY; y += chaosStepY) {
      const segs = this._segmentsAtY(Math.round(y), px, W, H);
      for (const [xL, xR] of segs) {
        if (xR - xL < 6) continue;
        const count = 1 + Math.floor(Math.random() * 4);
        for (let i = 0; i < count; i++) {
          const rx = xL + Math.random() * (xR - xL);
          const angle = (Math.random() - 0.5) * Math.PI * 2;
          this._drawChaosThread(ctx, rx, y, angle);
        }
      }
    }

    // ── Vertical fringe at top/bottom letter edges ──────────────────────────
    const colStep = Math.max(1, step * 2);
    for (let x = 0; x < W; x += colStep) {
      let topY = -1, botY = -1;
      for (let y = 0; y < H; y++)     { if (px[(y * W + x) * 4] < 128) { topY = y; break; } }
      for (let y = H - 1; y >= 0; y--) { if (px[(y * W + x) * 4] < 128) { botY = y; break; } }
      if (topY >= 0 && Math.random() < 0.6) this._drawVertFringe(ctx, x, topY, -1);
      if (botY >= 0 && Math.random() < 0.6) this._drawVertFringe(ctx, x, botY, +1);
      // Extra-long accent fringes at some columns
      if (topY >= 0 && Math.random() < 0.12) this._drawVertFringe(ctx, x + (Math.random() - 0.5) * 3, topY, -1, 2.5);
      if (botY >= 0 && Math.random() < 0.12) this._drawVertFringe(ctx, x + (Math.random() - 0.5) * 3, botY, +1, 2.5);
    }

    // ── Diagonal threads stretching from letter edges ───────────────────────
    const diagProb = Math.max(0.15, (this.freeDiagDensity / 100) * 0.8);

    for (let y = minY; y <= maxY; y += step * 2) {
      const segs = this._segmentsAtY(y, px, W, H);
      for (const [xL, xR] of segs) {
        if (Math.random() < diagProb) this._drawDiagFringe(ctx, xL, y, -1, Math.random() < 0.5 ? -1 :  1);
        if (Math.random() < diagProb) this._drawDiagFringe(ctx, xR, y, +1, Math.random() < 0.5 ? -1 :  1);
      }
    }

    for (let x = 0; x < W; x += colStep * 2) {
      let topY2 = -1, botY2 = -1;
      for (let y = 0; y < H; y++)      { if (px[(y * W + x) * 4] < 128) { topY2 = y; break; } }
      for (let y = H - 1; y >= 0; y--) { if (px[(y * W + x) * 4] < 128) { botY2 = y; break; } }
      if (topY2 >= 0 && Math.random() < diagProb) this._drawDiagFringe(ctx, x, topY2, Math.random() < 0.5 ? -1 : 1, -1);
      if (botY2 >= 0 && Math.random() < diagProb) this._drawDiagFringe(ctx, x, botY2, Math.random() < 0.5 ? -1 : 1, +1);
    }

    this._freeCanvas = fc;
    this._mode = 'freestyle';
    this.render();
  }

  // Draw one horizontal knit thread — now with dramatic waviness and y-drift
  _drawKnitThread(ctx, xL, xR, y) {
    const gapProb = this.freeGapChance / 100;
    ctx.lineCap  = 'round';
    ctx.lineJoin = 'round';

    let x       = xL;
    let curY    = y + (Math.random() - 0.5) * 5;
    let drawing = Math.random() > gapProb * 0.5;

    while (x < xR) {
      if (drawing) {
        const segLen = 4 + Math.random() * 20;
        const endX   = Math.min(x + segLen, xR);
        const lw     = 0.15 + Math.random() * 0.45;
        ctx.lineWidth   = lw;
        ctx.strokeStyle = this.color;
        ctx.globalAlpha = 0.35 + Math.random() * 0.65;

        const midX    = (x + endX) / 2;
        // Much larger wave amplitude — the thread wanders vertically
        const waveAmp = 1.5 + Math.random() * 8;
        const waveDir = Math.floor(x / 8) % 2 === 0 ? 1 : -1;
        const jitter  = waveDir * waveAmp;
        // Y drifts slightly as thread progresses — creates slanted wandering look
        const endYdrift = curY + (Math.random() - 0.5) * 4;
        ctx.beginPath();
        ctx.moveTo(x, curY + (Math.random() - 0.5) * 1.5);
        ctx.quadraticCurveTo(midX, curY + jitter, endX, endYdrift);
        ctx.stroke();
        x    = endX;
        curY = endYdrift;
      } else {
        x += 1 + Math.random() * Math.max(1, this.freeGapChance * 0.15);
      }
      drawing = drawing ? Math.random() > gapProb : Math.random() > 0.18;
    }

    ctx.globalAlpha = 1;
  }

  // Horizontal fringe — now much more chaotic, curling and wandering
  _drawHorzFringe(ctx, edgeX, y, dir) {
    const len = 5 + Math.random() * this.freeFringeLen * 1.6;
    ctx.strokeStyle = this.color;
    ctx.lineWidth   = 0.15 + Math.random() * 0.4;
    ctx.lineCap     = 'round';
    ctx.globalAlpha = 0.3 + Math.random() * 0.7;

    ctx.beginPath();
    ctx.moveTo(edgeX, y);
    const steps = Math.max(4, Math.ceil(len / 10));
    let cx = edgeX, cy = y;
    let velY = (Math.random() - 0.5) * 4;
    for (let i = 0; i < steps; i++) {
      cx  += dir * (len / steps);
      velY += (Math.random() - 0.5) * 5;   // acceleration-style chaos
      velY *= 0.85;                          // slight damping so it doesn't explode
      cy  += velY + (Math.random() - 0.5) * 6;
      ctx.lineTo(cx, cy);
    }
    ctx.stroke();
    ctx.globalAlpha = 1;
  }

  // Vertical fringe — chaotic horizontal drift
  _drawVertFringe(ctx, x, edgeY, dir, lenMult = 1) {
    const len = 5 + Math.random() * this.freeFringeLen * lenMult;
    ctx.strokeStyle = this.color;
    ctx.lineWidth   = 0.15 + Math.random() * 0.4;
    ctx.lineCap     = 'round';
    ctx.globalAlpha = 0.3 + Math.random() * 0.7;

    ctx.beginPath();
    ctx.moveTo(x, edgeY);
    const steps = Math.max(4, Math.ceil(len / 10));
    let cx = x, cy = edgeY;
    let velX = (Math.random() - 0.5) * 4;
    for (let i = 0; i < steps; i++) {
      cy  += dir * (len / steps);
      velX += (Math.random() - 0.5) * 5;
      velX *= 0.85;
      cx  += velX + (Math.random() - 0.5) * 6;
      ctx.lineTo(cx, cy);
    }
    ctx.stroke();
    ctx.globalAlpha = 1;
  }

  // Diagonal fringe thread
  _drawDiagFringe(ctx, startX, startY, dirX, dirY) {
    const len      = 6 + Math.random() * this.freeFringeLen * 1.5;
    const steps    = Math.max(3, Math.ceil(len / 11));
    const stepSize = (len / steps) * (1 / Math.SQRT2);

    ctx.strokeStyle = this.color;
    ctx.lineWidth   = 0.15 + Math.random() * 0.4;
    ctx.lineCap     = 'round';
    ctx.globalAlpha = 0.3 + Math.random() * 0.65;

    ctx.beginPath();
    ctx.moveTo(startX, startY);
    let cx = startX, cy = startY;
    for (let i = 0; i < steps; i++) {
      cx += dirX * stepSize + (Math.random() - 0.5) * 3.5;
      cy += dirY * stepSize + (Math.random() - 0.5) * 3.5;
      ctx.lineTo(cx, cy);
    }
    ctx.stroke();
    ctx.globalAlpha = 1;
  }

  // Chaos thread: a wandering thread starting at a random angle, used for body snarl
  _drawChaosThread(ctx, startX, startY, angle) {
    const len   = 15 + Math.random() * 90;
    const steps = Math.max(4, Math.ceil(len / 9));
    const stepLen = len / steps;

    ctx.strokeStyle = this.color;
    ctx.lineWidth   = 0.15 + Math.random() * 0.45;
    ctx.lineCap     = 'round';
    ctx.globalAlpha = 0.2 + Math.random() * 0.55;

    ctx.beginPath();
    ctx.moveTo(startX, startY);
    let cx = startX, cy = startY;
    let curAngle = angle;

    for (let i = 0; i < steps; i++) {
      // Direction drifts randomly — thread snarls and curves
      curAngle += (Math.random() - 0.5) * 1.0;
      cx += Math.cos(curAngle) * stepLen;
      cy += Math.sin(curAngle) * stepLen;
      ctx.lineTo(cx, cy);
    }
    ctx.stroke();
    ctx.globalAlpha = 1;
  }

  // ── Drag mode: pull threads from letters ──────────────────────────────────

  _toggleDragMode() {
    this._dragModeActive = !this._dragModeActive;
    const btn = document.getElementById('btn-threads-drag');
    btn.textContent = this._dragModeActive ? 'Drag: ON' : 'Drag Threads';
    btn.classList.toggle('btn-on', this._dragModeActive);
    // Change cursor to crosshair when active
    this.canvas.el.style.cursor = this._dragModeActive ? 'crosshair' : '';
  }

  _initDragListeners() {
    const cvs = this.canvas.el;

    const getPos = (e) => {
      const rect   = cvs.getBoundingClientRect();
      const scaleX = cvs.width  / rect.width;
      const scaleY = cvs.height / rect.height;
      const src    = e.touches ? e.touches[0] : e;
      return {
        x: (src.clientX - rect.left) * scaleX,
        y: (src.clientY - rect.top)  * scaleY,
      };
    };

    cvs.addEventListener('mousedown', (e) => {
      if (!this._dragModeActive) return;
      const pos = getPos(e);
      this._dragState = { startX: pos.x, startY: pos.y, curX: pos.x, curY: pos.y };
      e.preventDefault();
    });

    cvs.addEventListener('mousemove', (e) => {
      if (!this._dragModeActive || !this._dragState) return;
      const pos = getPos(e);
      this._dragState.curX = pos.x;
      this._dragState.curY = pos.y;
      this._renderWithDragPreview();
      e.preventDefault();
    });

    cvs.addEventListener('mouseup', (e) => {
      if (!this._dragModeActive || !this._dragState) return;
      const { startX, startY, curX, curY } = this._dragState;
      this._dragState = null;
      const dx = curX - startX, dy = curY - startY;
      if (Math.sqrt(dx * dx + dy * dy) > 6) {
        this._applyDragThreads(startX, startY, curX, curY);
      } else {
        this.render();
      }
      e.preventDefault();
    });

    cvs.addEventListener('mouseleave', () => {
      if (this._dragState) { this._dragState = null; this.render(); }
    });
  }

  _renderWithDragPreview() {
    if (!this._dragState) return;
    const ctx = this.canvas.ctx;
    const W = this.canvas.width, H = this.canvas.height;

    ctx.fillStyle = this.bgColor;
    ctx.globalAlpha = 1;
    ctx.fillRect(0, 0, W, H);

    if (this._mode === 'freestyle' && this._freeCanvas) ctx.drawImage(this._freeCanvas, 0, 0);
    else if (this._pathCanvas) ctx.drawImage(this._pathCanvas, 0, 0);

    const { startX, startY, curX, curY } = this._dragState;
    ctx.save();
    ctx.strokeStyle = this.color;
    ctx.lineWidth = 1;
    ctx.globalAlpha = 0.3;
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    ctx.moveTo(startX, startY);
    ctx.lineTo(curX, curY);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.globalAlpha = 0.65;
    ctx.fillStyle = this.color;
    ctx.beginPath();
    ctx.arc(startX, startY, 3, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  // Generate drag threads: burst of loose threads from start, extending toward end
  _applyDragThreads(startX, startY, endX, endY) {
    // Ensure we have the offscreen letter mask
    if (!this._off) {
      if (!this.text.trim()) return;
      this._initOffscreen();
    }

    const W  = this._off.width, H = this._off.height;
    const px = this._offCtx.getImageData(0, 0, W, H).data;

    // Ensure a freestyle canvas exists to draw onto
    if (!this._freeCanvas) {
      this._freeCanvas = document.createElement('canvas');
      this._freeCanvas.width  = W;
      this._freeCanvas.height = H;
      this._mode = 'freestyle';
    }

    const ctx = this._freeCanvas.getContext('2d');

    const dx   = endX - startX;
    const dy   = endY - startY;
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (dist < 1) return;

    const nx = dx / dist; // unit direction toward drag end
    const ny = dy / dist;

    // Search radius around where the user started dragging
    const searchR    = Math.max(18, Math.min(70, dist * 0.3));
    const threadCount = 10 + Math.floor(dist / 8);

    for (let t = 0; t < threadCount; t++) {
      // Scatter origins around the drag start
      const angle = Math.random() * Math.PI * 2;
      const r     = Math.random() * searchR;
      let sx = Math.max(0, Math.min(W - 1, Math.round(startX + Math.cos(angle) * r)));
      let sy = Math.max(0, Math.min(H - 1, Math.round(startY + Math.sin(angle) * r)));

      // Snap to nearest letter pixel within a small search window
      let snapped = false;
      outer: for (let dr = 0; dr <= 10; dr++) {
        for (let da = 0; da < 8; da++) {
          const a  = da * Math.PI / 4;
          const tx = Math.round(sx + Math.cos(a) * dr);
          const ty = Math.round(sy + Math.sin(a) * dr);
          if (tx >= 0 && tx < W && ty >= 0 && ty < H && px[(ty * W + tx) * 4] < 128) {
            sx = tx; sy = ty; snapped = true; break outer;
          }
        }
      }
      // Still draw even if no letter pixel nearby — creates ambient trailing threads

      // Spread: threads don't all go in the exact same direction
      const spreadAngle = (Math.random() - 0.5) * 1.1;
      const cosA = Math.cos(spreadAngle), sinA = Math.sin(spreadAngle);
      const tdx  = nx * cosA - ny * sinA;
      const tdy  = nx * sinA + ny * cosA;

      const threadLen = dist * (0.35 + Math.random() * 1.1);
      const steps     = Math.max(12, Math.ceil(threadLen / 4));

      ctx.strokeStyle = this.color;
      ctx.lineWidth   = 0.15 + Math.random() * 0.5;
      ctx.lineCap     = 'round';
      ctx.globalAlpha = (snapped ? 0.4 : 0.2) + Math.random() * 0.5;

      // Perpendicular to the travel direction — used for sinusoidal curl
      const perpX = -tdy, perpY = tdx;

      // Thread personality: ~25% nearly straight, ~75% curly
      const isStraight = Math.random() < 0.25;
      const curlAmp    = isStraight ? 1 + Math.random() * 4 : 8 + Math.random() * 28;
      const curlFreq   = 1 + Math.random() * 3.5;   // curl cycles along thread length
      const phase      = Math.random() * Math.PI * 2;

      ctx.beginPath();
      ctx.moveTo(sx, sy);
      for (let i = 1; i <= steps; i++) {
        const t  = i / steps;
        // Base position along drag direction
        const bx = sx + tdx * threadLen * t;
        const by = sy + tdy * threadLen * t;
        // Sinusoidal curl perpendicular to travel
        const curlOff = Math.sin(phase + t * Math.PI * 2 * curlFreq) * curlAmp;
        // Tiny jitter for thread texture
        const jx = (Math.random() - 0.5) * 1.5;
        const jy = (Math.random() - 0.5) * 1.5;
        ctx.lineTo(bx + perpX * curlOff + jx, by + perpY * curlOff + jy);
      }
      ctx.stroke();
      ctx.globalAlpha = 1;
    }

    this.render();
  }

  _drawDimText(ctx, W, H) {
    const _t2Lines = this.text.split('\n');
    const _t2MaxLen = Math.max(..._t2Lines.map(l => l.length), 1);
    const _t2NLines = _t2Lines.length || 1;
    const fontSize = Math.min(
      Math.max(24, Math.min(W, H) * 0.55 / Math.max(1, Math.pow(_t2MaxLen, 0.55))),
      Math.max(24, H * 0.78 / (_t2NLines * this.lineSpacing))
    );
    const lines      = _t2Lines;
    const lineH      = fontSize * this.lineSpacing;
    const startY     = H / 2 - ((lines.length - 1) * lineH) / 2;
    ctx.save();
    ctx.font = `${fontSize}px 'Courier New', monospace`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillStyle = this.color;
    ctx.globalAlpha = 0.12;
    lines.forEach((line, i) => { if (line.length) ctx.fillText(line, W / 2, startY + i * lineH); });
    ctx.restore();
  }
}


// ─── Init ─────────────────────────────────────────────────────────────────────

const threadsController = new ThreadsController(canvas);
