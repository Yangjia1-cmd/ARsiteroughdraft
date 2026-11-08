// spawnandgrow.js — Spawn & Grow (OOP port of tinkering-to-fix spawn-grow.js)

// ─── Block ────────────────────────────────────────────────────────────────────
// Represents one outline block on one edge of a letterform.
// dir = 'up' | 'down' | 'left' | 'right'
// spanMin/spanMax = extent along the edge
// letterEdge     = the pixel coordinate of the letter's surface
// layerOffset    = how far outside the letter this layer sits
// growLength     = how long the block extends outward (grows on each Grow click)

class Block {
  constructor({ dir, spanMin, spanMax, letterEdge, layerOffset, thickness, angle, overlapVal }) {
    this.dir          = dir;
    this.spanMin      = spanMin;
    this.spanMax      = spanMax;
    this.letterEdge   = letterEdge;
    this.layerOffset  = layerOffset;
    this.growLength   = thickness;
    this.minGrowLength = thickness;
    this.angle        = angle;
    this.overlapVal   = overlapVal;
    this.stopped      = false;
  }

  get cx() {
    if (this.dir === 'up' || this.dir === 'down') return (this.spanMin + this.spanMax) / 2;
    if (this.dir === 'left') return (this.letterEdge - this.layerOffset) - this.growLength / 2;
    return (this.letterEdge + this.layerOffset) + this.growLength / 2;
  }

  get cy() {
    if (this.dir === 'left' || this.dir === 'right') return (this.spanMin + this.spanMax) / 2;
    if (this.dir === 'up') return (this.letterEdge - this.layerOffset) - this.growLength / 2;
    return (this.letterEdge + this.layerOffset) + this.growLength / 2;
  }

  get w() {
    return (this.dir === 'up' || this.dir === 'down') ? this.spanMax - this.spanMin : this.growLength;
  }

  get h() {
    return (this.dir === 'left' || this.dir === 'right') ? this.spanMax - this.spanMin : this.growLength;
  }

  get aabb() {
    return { l: this.cx - this.w / 2, r: this.cx + this.w / 2,
             t: this.cy - this.h / 2, b: this.cy + this.h / 2 };
  }

  draw(ctx, color) {
    if (this.w <= 0 || this.h <= 0) return;
    ctx.save();
    ctx.translate(this.cx, this.cy);
    ctx.rotate(this.angle * Math.PI / 180);
    ctx.fillStyle = color;
    ctx.fillRect(-this.w / 2, -this.h / 2, this.w, this.h);
    ctx.restore();
  }
}


// ─── LeftPanel ────────────────────────────────────────────────────────────────

class LeftPanel {
  constructor() {
    document.querySelectorAll('.panel-tab').forEach(tab => {
      tab.addEventListener('click', () => {
        document.querySelectorAll('.panel-tab').forEach(t => t.classList.remove('active'));
        document.querySelectorAll('.panel-section').forEach(s => s.classList.remove('active'));
        tab.classList.add('active');
        document.getElementById(`sec-${tab.dataset.section}`)?.classList.add('active');
        // Broadcast so each controller knows when its tab is active
        document.dispatchEvent(new CustomEvent('tabchange', { detail: tab.dataset.section }));
      });
    });
  }
}


// ─── SpawnAndGrow ─────────────────────────────────────────────────────────────

class SpawnAndGrow {
  constructor(canvas) {
    this.canvas      = canvas;
    this.blocks      = [];
    this.spawnCount  = 0;

    // Shared state
    this.text        = '';
    this.blockColor  = '#ffffff';
    this.bgColor     = '#111111';
    this.lineSpacing = 1.0;

    this.fontStroke  = 50;   // 0-100, controls thickness
    this.randomize   = 0;    // 0-100, angle tilt
    this.rotate      = 0;    // 0-100, layer rotation
    this.nextStroke  = 0;    // 0-100, gap between layers
    this.overlap     = 0;    // 0-100, collision softness

    // Offscreen canvas for pixel sampling (created on first spawn)
    this._off    = null;
    this._offCtx = null;
    this._cellSize = 8;
    this._fontSize = 0;
    this._initialized = false;

    this._bindUI();
    this.render();
  }

  // ── UI ────────────────────────────────────────────────────────────────────

  _bindUI() {
    const textInput = document.getElementById('text-input');
    textInput.addEventListener('input', () => {
      this.text = textInput.value;
      this._initialized = false; // force re-init on next spawn
      this.render();
    });

    this._slider('sl-ls-sg', 'v-ls-sg', v => {
      this.lineSpacing = v;
      this._initialized = false;
      this.render();
    });

    document.getElementById('btn-spawn').addEventListener('click', () => this.spawn());
    document.getElementById('btn-grow').addEventListener('click',  () => this.grow());
    document.getElementById('btn-reset').addEventListener('click', () => this.reset());

    this._slider('sl-stroke', 'v-stroke', v => { this.fontStroke = v; });
    this._slider('sl-rand',   'v-rand',   v => { this.randomize  = v; });
    this._slider('sl-rot',    'v-rot',    v => { this.rotate      = v; });
    this._slider('sl-next',   'v-next',   v => { this.nextStroke  = v; });
    this._slider('sl-olap',   'v-olap',   v => { this.overlap     = v; });

    const swatch = document.getElementById('color-swatch');
    const label  = document.getElementById('color-label');
    const input  = document.getElementById('color-input');
    swatch.addEventListener('click', () => input.click());
    input.addEventListener('input', () => {
      this.blockColor = input.value;
      label.textContent = input.value;
      swatch.style.background = input.value;
      this.render();
    });

    // Re-render when Spawn & Grow tab is re-activated
    document.addEventListener('tabchange', e => {
      if (e.detail === 'sg') this.render();
    });
  }

  _slider(id, displayId, onChange) {
    const el  = document.getElementById(id);
    const out = document.getElementById(displayId);
    if (!el) return;
    // Show initial value
    if (out) out.textContent = el.value;
    el.addEventListener('input', () => {
      const val = parseFloat(el.value);
      if (out) out.textContent = val;
      onChange(val);
    });
  }

  // ── Offscreen init ────────────────────────────────────────────────────────
  // Renders the text to a hidden canvas in black-on-white so we can read pixels.

  _initOffscreen() {
    const W = this.canvas.width;
    const H = this.canvas.height;
    const text = this.text;

    const _sgLines = text.split('\n');
    const _sgMaxLen = Math.max(..._sgLines.map(l => l.length), 1);
    const _sgNLines = _sgLines.length || 1;
    const fontSize = Math.min(
      Math.max(24, Math.min(W, H) * 0.55 / Math.max(1, Math.pow(_sgMaxLen, 0.55))),
      Math.max(24, H * 0.78 / (_sgNLines * this.lineSpacing))
    );
    this._fontSize = fontSize;
    this._cellSize = Math.max(5, Math.round(fontSize * 0.045));

    const off = document.createElement('canvas');
    off.width  = W;
    off.height = H;
    const ctx  = off.getContext('2d');

    ctx.fillStyle = 'white';
    ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = 'black';
    ctx.font = `${fontSize}px 'Courier New', monospace`;
    ctx.textAlign    = 'center';
    ctx.textBaseline = 'middle';

    const lines  = _sgLines;
    const lineH  = fontSize * this.lineSpacing;
    const startY = H / 2 - ((lines.length - 1) * lineH) / 2;
    lines.forEach((line, i) => { if (line.length) ctx.fillText(line, W / 2, startY + i * lineH); });

    this._off    = off;
    this._offCtx = ctx;
    this._initialized = true;
  }

  // ── Pixel helpers ─────────────────────────────────────────────────────────

  _isText(px, x, y, W, H) {
    x = Math.round(x); y = Math.round(y);
    if (x < 0 || x >= W || y < 0 || y >= H) return false;
    return px[(y * W + x) * 4] < 128; // black pixel = letter
  }

  // Groups sorted edge points into consecutive runs.
  // pk = primary key (the axis being scanned), ek = edge key (depth value)
  _groupRuns(pts, pk, ek, maxGap) {
    if (!pts.length) return [];
    const sorted = [...pts].sort((a, b) => a[pk] - b[pk]);
    const groups = [[sorted[0]]];
    for (let i = 1; i < sorted.length; i++) {
      const prev = sorted[i - 1], curr = sorted[i];
      const gapTooLarge  = curr[pk] - prev[pk] > maxGap;
      const edgeTooFar   = Math.abs(curr[ek] - prev[ek]) > maxGap * 0.6;
      if (gapTooLarge || edgeTooFar) groups.push([curr]);
      else groups[groups.length - 1].push(curr);
    }
    return groups;
  }

  // ── Spawn ─────────────────────────────────────────────────────────────────

  spawn() {
    if (!this.text.trim()) return;
    if (!this._initialized) this._initOffscreen();

    const cs          = this._cellSize;
    const thickness   = Math.max(cs, cs + (this.fontStroke / 100) * cs * 3);
    const layerOffset = this.spawnCount * (thickness + this.nextStroke * 0.5);
    const rotation    = (this.rotate / 100) * 10 * this.spawnCount;
    const maxTilt     = (this.randomize / 30) * 10;

    const newBlocks = this._buildOutlineBlocks(layerOffset, rotation, maxTilt, thickness);
    this.blocks.push(...newBlocks);
    this.spawnCount++;
    this.render();
  }

  _buildOutlineBlocks(layerOffset, rotation, maxTilt, thickness) {
    const W   = this._off.width;
    const H   = this._off.height;
    const cs  = this._cellSize;
    const px  = this._offCtx.getImageData(0, 0, W, H).data;
    const isT = (x, y) => this._isText(px, x, y, W, H);

    const tilt    = () => maxTilt * (Math.random() - 0.5) * 2;
    const blocks  = [];

    const makeBlock = (dir, spanMin, spanMax, letterEdge) => new Block({
      dir, spanMin, spanMax, letterEdge,
      layerOffset,
      thickness,
      angle: rotation + tilt(),
      overlapVal: this.overlap,
    });

    // ── Top edges: scan each column downward, take first black pixel ──────
    const topPts = [];
    for (let x = 0; x < W; x += cs) {
      for (let y = 0; y < H; y++) {
        if (isT(x, y)) { topPts.push({ x, y }); break; }
      }
    }
    this._groupRuns(topPts, 'x', 'y', cs * 2.5).forEach(grp => {
      const minX = Math.min(...grp.map(p => p.x));
      const maxX = Math.max(...grp.map(p => p.x)) + cs;
      const avgY = grp.reduce((s, p) => s + p.y, 0) / grp.length;
      blocks.push(makeBlock('up', minX, maxX, avgY));
    });

    // ── Bottom edges: scan each column upward, take first black pixel ─────
    const botPts = [];
    for (let x = 0; x < W; x += cs) {
      for (let y = H - 1; y >= 0; y--) {
        if (isT(x, y)) { botPts.push({ x, y }); break; }
      }
    }
    this._groupRuns(botPts, 'x', 'y', cs * 2.5).forEach(grp => {
      const minX = Math.min(...grp.map(p => p.x));
      const maxX = Math.max(...grp.map(p => p.x)) + cs;
      const avgY = grp.reduce((s, p) => s + p.y, 0) / grp.length;
      blocks.push(makeBlock('down', minX, maxX, avgY));
    });

    // ── Left edges: scan each row rightward, take first black pixel ───────
    const leftPts = [];
    for (let y = 0; y < H; y += cs) {
      for (let x = 0; x < W; x++) {
        if (isT(x, y)) { leftPts.push({ y, x }); break; }
      }
    }
    this._groupRuns(leftPts, 'y', 'x', cs * 2.5).forEach(grp => {
      const minY = Math.min(...grp.map(p => p.y));
      const maxY = Math.max(...grp.map(p => p.y)) + cs;
      const avgX = grp.reduce((s, p) => s + p.x, 0) / grp.length;
      blocks.push(makeBlock('left', minY, maxY, avgX));
    });

    // ── Right edges: scan each row leftward, take first black pixel ───────
    const rightPts = [];
    for (let y = 0; y < H; y += cs) {
      for (let x = W - 1; x >= 0; x--) {
        if (isT(x, y)) { rightPts.push({ y, x }); break; }
      }
    }
    this._groupRuns(rightPts, 'y', 'x', cs * 2.5).forEach(grp => {
      const minY = Math.min(...grp.map(p => p.y));
      const maxY = Math.max(...grp.map(p => p.y)) + cs;
      const avgX = grp.reduce((s, p) => s + p.x, 0) / grp.length;
      blocks.push(makeBlock('right', minY, maxY, avgX));
    });

    return blocks;
  }

  // ── Grow ──────────────────────────────────────────────────────────────────

  grow() {
    if (!this.blocks.length) return;

    const cs        = this._cellSize;
    const growStep  = Math.max(cs * 0.5, cs * (0.5 + this.fontStroke / 200));
    const W         = this.canvas.width;
    const H         = this.canvas.height;
    const allowOver = this.overlap < 0 ? Math.abs(this.overlap) : 0;

    this.blocks.forEach(b => {
      if (b.stopped) return;
      b.growLength += growStep;

      // Stop at canvas edges
      let oob = false;
      if (b.dir === 'up'    && (b.letterEdge - b.layerOffset - b.growLength) < -allowOver) oob = true;
      if (b.dir === 'down'  && (b.letterEdge + b.layerOffset + b.growLength) > H + allowOver) oob = true;
      if (b.dir === 'left'  && (b.letterEdge - b.layerOffset - b.growLength) < -allowOver) oob = true;
      if (b.dir === 'right' && (b.letterEdge + b.layerOffset + b.growLength) > W + allowOver) oob = true;
      if (oob) { b.growLength -= growStep; b.stopped = true; }
    });

    this._checkCollisions(allowOver);
    this.render();
  }

  _checkCollisions(allowOver) {
    for (let i = 0; i < this.blocks.length; i++) {
      const a = this.blocks[i];
      if (a.stopped) continue;
      const ra = a.aabb;
      for (let j = 0; j < this.blocks.length; j++) {
        if (i === j) continue;
        const b = this.blocks[j];
        if (a.dir === b.dir) continue; // same-direction blocks don't collide
        const rb = b.aabb;
        const overlaps = !(ra.r + allowOver < rb.l || ra.l - allowOver > rb.r ||
                           ra.b + allowOver < rb.t || ra.t - allowOver > rb.b);
        if (overlaps) {
          a.growLength = Math.max(a.minGrowLength, a.growLength - this._cellSize * 0.5);
          a.stopped = true;
          break;
        }
      }
    }
  }

  // ── Reset ─────────────────────────────────────────────────────────────────

  reset() {
    this.blocks      = [];
    this.spawnCount  = 0;
    this._initialized = false;
    this._off = null;
    this.render();
  }

  // ── Render ────────────────────────────────────────────────────────────────

  render() {
    const { canvas, text, blocks, bgColor, blockColor } = this;
    canvas.beginLayer('sg');
    try {
      const ctx = canvas.ctx;
      canvas.clear(bgColor);
      if (!text.trim()) return;
      if (blocks.length === 0) { this._drawText(ctx); return; }
      blocks.forEach(b => b.draw(ctx, blockColor));
    } finally {
      canvas.endLayer();
    }
  }

  _drawText(ctx) {
    const W = this.canvas.width;
    const H = this.canvas.height;
    const text = this.text;
    const _dtLines = text.split('\n');
    const _dtMaxLen = Math.max(..._dtLines.map(l => l.length), 1);
    const _dtNLines = _dtLines.length || 1;
    const fontSize = Math.min(
      Math.max(24, Math.min(W, H) * 0.55 / Math.max(1, Math.pow(_dtMaxLen, 0.55))),
      Math.max(24, H * 0.78 / (_dtNLines * this.lineSpacing))
    );

    const lines  = _dtLines;
    const lineH  = fontSize * this.lineSpacing;
    const startY = H / 2 - ((lines.length - 1) * lineH) / 2;

    ctx.font         = `${fontSize}px 'Courier New', monospace`;
    ctx.textAlign    = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle    = this.blockColor;

    lines.forEach((line, i) => { if (line.length) ctx.fillText(line, W / 2, startY + i * lineH); });
  }
}


// ─── Init ─────────────────────────────────────────────────────────────────────

const canvas       = new Canvas('main-canvas');
const leftPanel    = new LeftPanel();
const spawnAndGrow = new SpawnAndGrow(canvas);
