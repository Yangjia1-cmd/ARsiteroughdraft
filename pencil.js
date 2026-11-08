// pencil.js — Dense overlapping pencil scribbles that form letter shapes

class PencilController {
  constructor(canvas) {
    this.canvas = canvas;

    this.text        = '';
    this.color       = '#1a1818';
    this.bgColor     = '#ece9e0';
    this.lineSpacing = 1.0;

    this.fontThickness = 0;   // mask dilation radius (0 = normal, higher = bolder)
    this.blendDist    = 0;   // how far strokes bleed into background (px)

    this.density      = 6;    // horizontal passes per row
    this.rowSpacing   = 2;    // px between scribble rows
    this.wiggle       = 5;    // fill stroke waviness amplitude
    this.strokeWeight = 0.65; // base line width
    this.outlinePasses = 5;   // outline trace repetitions
    this.outlineWiggle = 10;  // outline oscillation amplitude
    this.diagDensity  = 3;    // diagonal hatching passes

    this.stitchMode    = 'none'; // 'none' | 'dot' | 'seed' | 'run' | 'cross'
    this.stitchSpacing = 14;     // px between contour rings
    this.stitchSize    = 5;      // mark half-length in px

    this._maskW      = 0;
    this._maskH      = 0;
    this._letterMask = null;
    this._drawCanvas = null;

    this._bindUI();
    window.addEventListener('resize', () => {
      if (this._isActive()) this._rebuild();
    });
  }

  // ── Helpers ─────────────────────────────────────────────────────────────────

  _isActive() {
    return document.getElementById('sec-pencil')?.classList.contains('active');
  }

  _fontSize() {
    const W = this.canvas.width, H = this.canvas.height;
    const lines = this.text.split('\n');
    const maxLen = Math.max(...lines.map(l => l.length), 1);
    const nLines = lines.length || 1;
    return Math.min(
      Math.max(24, Math.min(W, H) * 0.55 / Math.max(1, Math.pow(maxLen, 0.55))),
      Math.max(24, H * 0.78 / (nLines * this.lineSpacing))
    );
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

  // ── Letter mask ─────────────────────────────────────────────────────────────

  _buildMask() {
    const W = this.canvas.width, H = this.canvas.height;
    if (!W || !H || !this.text.trim()) { this._letterMask = null; return; }

    const mc  = document.createElement('canvas');
    mc.width  = W; mc.height = H;
    const ctx = mc.getContext('2d');
    ctx.fillStyle = '#000000';
    ctx.fillRect(0, 0, W, H);

    const lines  = this.text.split('\n');
    const fs     = this._fontSize();
    const lineH  = fs * this.lineSpacing;
    const startY = H / 2 - ((lines.length - 1) * lineH) / 2;
    ctx.font         = `${fs}px 'Courier New', monospace`;
    ctx.textAlign    = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle    = '#ffffff';
    lines.forEach((line, i) => { if (line.length) ctx.fillText(line, W / 2, startY + i * lineH); });

    const data = ctx.getImageData(0, 0, W, H).data;
    let mask = new Uint8Array(W * H);
    for (let i = 0; i < W * H; i++) mask[i] = data[i * 4] > 128 ? 1 : 0;

    if (this.fontThickness > 0) mask = this._dilate(mask, W, H, Math.round(this.fontThickness));

    this._letterMask = mask;
    this._maskW = W;
    this._maskH = H;
  }

  // Expand letter pixels outward by `radius` using BFS (Manhattan distance).
  _dilate(mask, W, H, radius) {
    const result = mask.slice();
    const queue  = new Int32Array(W * H * 2);  // [x, y] pairs
    let qHead = 0, qTail = 0;

    // Seed queue with all existing letter pixels
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        if (mask[y * W + x]) { queue[qTail++] = x; queue[qTail++] = y; }
      }
    }

    // BFS outward — dist tracked separately to limit expansion
    const dist = new Int32Array(W * H).fill(-1);
    for (let i = 0; i < qTail; i += 2) {
      const bx = queue[i], by = queue[i + 1];
      dist[by * W + bx] = 0;
    }

    while (qHead < qTail) {
      const x = queue[qHead++], y = queue[qHead++];
      const d = dist[y * W + x];
      if (d >= radius) continue;
      const nd = d + 1;
      const neighbors = [[x-1,y],[x+1,y],[x,y-1],[x,y+1]];
      for (const [nx, ny] of neighbors) {
        if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
        if (dist[ny * W + nx] >= 0) continue;
        dist[ny * W + nx] = nd;
        result[ny * W + nx] = 1;
        queue[qTail++] = nx;
        queue[qTail++] = ny;
      }
    }

    return result;
  }

  _segmentsAtY(y) {
    const W = this._maskW, H = this._maskH, mask = this._letterMask;
    if (!mask || y < 0 || y >= H) return [];
    const segs = []; let inSeg = false, start = 0;
    for (let x = 0; x < W; x++) {
      const hit = mask[y * W + x] === 1;
      if (hit && !inSeg)  { inSeg = true; start = x; }
      if (!hit && inSeg)  { inSeg = false; segs.push([start, x - 1]); }
    }
    if (inSeg) segs.push([start, W - 1]);
    return segs;
  }

  _findEdgePixels() {
    const W = this._maskW, H = this._maskH, mask = this._letterMask;
    if (!mask) return [];
    const edges = [];
    for (let y = 1; y < H - 1; y += 2) {
      for (let x = 1; x < W - 1; x += 2) {
        if (!mask[y * W + x]) continue;
        let nx = 0, ny = 0;
        if (!mask[y * W + x + 1]) nx += 1;
        if (!mask[y * W + x - 1]) nx -= 1;
        if (!mask[(y + 1) * W + x]) ny += 1;
        if (!mask[(y - 1) * W + x]) ny -= 1;
        if (nx === 0 && ny === 0) continue;
        const len = Math.sqrt(nx * nx + ny * ny) || 1;
        edges.push({ x, y, nx: nx / len, ny: ny / len });
      }
    }
    return edges;
  }

  // ── Scribble drawing ─────────────────────────────────────────────────────────

  _buildScribbles() {
    const W = this._maskW, H = this._maskH;
    const dc  = document.createElement('canvas');
    dc.width  = W; dc.height = H;
    const ctx = dc.getContext('2d');
    ctx.clearRect(0, 0, W, H);
    ctx.strokeStyle = this.color;
    ctx.lineCap  = 'round';
    ctx.lineJoin = 'round';

    const spacing = Math.max(1, Math.round(this.rowSpacing));

    // ── Phase 1: Dense horizontal scribble fill ───────────────────────────────
    for (let pass = 0; pass < this.density; pass++) {
      const passShift = (pass / this.density) * spacing;

      for (let baseY = 0; baseY < H; baseY += spacing) {
        const y  = baseY + passShift;
        const yi = Math.round(y);
        if (yi < 0 || yi >= H) continue;

        const segs = this._segmentsAtY(yi);

        for (const [x0, x1] of segs) {
          if (x1 - x0 < 3) continue;

          ctx.globalAlpha = 0.055 + Math.random() * 0.10;
          ctx.lineWidth   = this.strokeWeight * (0.45 + Math.random() * 0.85);

          const forward = (pass + Math.floor(baseY / spacing)) % 2 === 0;
          const xA = forward ? x0 : x1;
          const xB = forward ? x1 : x0;
          const dx = forward ? 2 : -2;

          ctx.beginPath();
          let dy = (Math.random() - 0.5) * 2;
          ctx.moveTo(xA, y + dy);

          for (let x = xA + dx; forward ? x <= xB : x >= xB; x += dx) {
            dy += (Math.random() - 0.5) * this.wiggle * 0.45;
            dy *= 0.88;
            ctx.lineTo(x, y + dy);
          }
          ctx.stroke();
        }
      }
    }

    // ── Phase 2: Diagonal accent hatching ────────────────────────────────────
    const dSpacing = spacing * 3;
    for (let pass = 0; pass < this.diagDensity; pass++) {
      const passShift = (pass / this.diagDensity) * dSpacing;

      for (let baseY = 0; baseY < H; baseY += dSpacing) {
        const y  = baseY + passShift;
        const yi = Math.round(y);
        if (yi < 0 || yi >= H) continue;

        const segs = this._segmentsAtY(yi);

        for (const [x0, x1] of segs) {
          if (x1 - x0 < 8) continue;

          ctx.globalAlpha = 0.03 + Math.random() * 0.055;
          ctx.lineWidth   = this.strokeWeight * 0.5;

          const tilt  = (pass % 2 === 0 ? 1 : -1) * 0.4;
          const width = x1 - x0;

          ctx.beginPath();
          let dy = 0;
          ctx.moveTo(x0, y);
          for (let x = x0; x <= x1; x += 2) {
            dy += (Math.random() - 0.5) * this.wiggle * 0.3;
            dy *= 0.9;
            const diagOffset = ((x - x0) / width) * dSpacing * tilt;
            ctx.lineTo(x, y + dy + diagOffset);
          }
          ctx.stroke();
        }
      }
    }

    // ── Phase 3: Bleed — strokes escape from letter edges into background ────────
    // Multiple passes of decreasing length stack up near the edge (darkest there)
    // and fade to nothing at blendDist — creating a natural density gradient.
    if (this.blendDist > 0) {
      const bd          = this.blendDist;
      const bleedPasses = Math.max(3, Math.round(this.density * 0.55));
      const bleedAlpha  = 0.022;

      for (let pass = 0; pass < bleedPasses; pass++) {
        const maxDist = bd * (1 - pass / bleedPasses);

        ctx.globalAlpha = bleedAlpha;
        ctx.lineWidth   = this.strokeWeight * (0.35 + Math.random() * 0.45);

        for (let baseY = 0; baseY < H; baseY += spacing) {
          const y  = baseY + (pass / bleedPasses) * spacing;
          const yi = Math.round(y);
          if (yi < 0 || yi >= H) continue;

          const segs = this._segmentsAtY(yi);

          for (const [x0, x1] of segs) {
            // Left bleed — strokes escape leftward
            ctx.beginPath();
            let dy = 0;
            ctx.moveTo(x0, y);
            for (let x = x0 - 2; x >= Math.max(0, x0 - maxDist); x -= 2) {
              const pct = (x0 - x) / bd;
              dy += (Math.random() - 0.5) * this.wiggle * (0.35 + pct * 0.65);
              dy *= 0.87;
              ctx.lineTo(x, y + dy);
            }
            ctx.stroke();

            // Right bleed — strokes escape rightward
            ctx.beginPath();
            dy = 0;
            ctx.moveTo(x1, y);
            for (let x = x1 + 2; x <= Math.min(W - 1, x1 + maxDist); x += 2) {
              const pct = (x - x1) / bd;
              dy += (Math.random() - 0.5) * this.wiggle * (0.35 + pct * 0.65);
              dy *= 0.87;
              ctx.lineTo(x, y + dy);
            }
            ctx.stroke();
          }
        }
      }
    }

    // ── Phase 4: Wobbly outline traces ────────────────────────────────────────
    // Group edges into scan-line chains, then draw each chain as a wobbly polyline
    const edges = this._findEdgePixels();
    if (edges.length) {
      const chains = this._buildEdgeChains(edges);

      for (let pass = 0; pass < this.outlinePasses; pass++) {
        const outShift  = (pass - this.outlinePasses / 2) * 1.8;
        const ampScale  = 0.7 + Math.random() * 0.6;

        ctx.globalAlpha = 0.07 + Math.random() * 0.09;
        ctx.lineWidth   = this.strokeWeight * (0.5 + Math.random() * 0.7);

        for (const chain of chains) {
          if (chain.length < 4) continue;

          ctx.beginPath();
          let wdx = 0, wdy = 0;
          const p0 = chain[0];
          ctx.moveTo(p0.x + outShift * p0.nx + wdx,
                     p0.y + outShift * p0.ny + wdy);

          for (let i = 1; i < chain.length; i++) {
            const pt = chain[i];
            wdx += (Math.random() - 0.5) * this.outlineWiggle * 0.4 * ampScale;
            wdy += (Math.random() - 0.5) * this.outlineWiggle * 0.4 * ampScale;
            wdx *= 0.82; wdy *= 0.82;
            ctx.lineTo(
              pt.x + outShift * pt.nx + wdx,
              pt.y + outShift * pt.ny + wdy
            );
          }
          ctx.stroke();
        }
      }
    }

    // ── Phase 5: Stitch contours ─────────────────────────────────────────────
    if (this.stitchMode !== 'none') this._buildStitches(ctx, W, H);

    this._drawCanvas = dc;
  }

  // BFS distance field from letter boundary — radiates in all directions across canvas.
  // Returns Int32Array where each value is px distance from nearest letter edge.
  _buildDistField(W, H) {
    const mask  = this._letterMask;
    if (!mask) return null;
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
      const i  = queue[qH++];
      const nd = dist[i] + 1;
      const x  = i % W, y = (i / W) | 0;
      if (x > 0   && dist[i - 1] < 0) { dist[i - 1] = nd; queue[qT++] = i - 1; }
      if (x < W-1 && dist[i + 1] < 0) { dist[i + 1] = nd; queue[qT++] = i + 1; }
      if (y > 0   && dist[i - W] < 0) { dist[i - W] = nd; queue[qT++] = i - W; }
      if (y < H-1 && dist[i + W] < 0) { dist[i + W] = nd; queue[qT++] = i + W; }
    }

    return dist;
  }

  // Draw oriented stitch marks along concentric distance contours.
  _buildStitches(ctx, W, H) {
    const dist = this._buildDistField(W, H);
    if (!dist) return;

    const sp   = this.stitchSpacing;
    const sz   = this.stitchSize;
    const tol  = Math.max(1.5, sp * 0.14);
    const step = Math.max(3, Math.round(sz * 1.35));
    const maxD = Math.sqrt(W * W + H * H);

    ctx.strokeStyle = this.color;
    ctx.fillStyle   = this.color;
    ctx.lineCap     = 'round';
    ctx.lineJoin    = 'round';

    for (let y = step; y < H - step; y += step) {
      for (let x = step; x < W - step; x += step) {
        const i = y * W + x;
        const d = dist[i];
        if (d < 0) continue;

        const ring = d % sp;
        if (ring > tol && ring < sp - tol) continue;

        // Gradient of distance field → perpendicular = contour tangent
        const gx   = (dist[i + 1] || 0) - (dist[i - 1] || 0);
        const gy   = (dist[i + W] || 0) - (dist[i - W] || 0);
        const glen = Math.sqrt(gx * gx + gy * gy) || 1;
        const tx   = -gy / glen;
        const ty   =  gx / glen;

        // Fade with distance from letter edge — stitches denser near letters
        const fade = Math.max(0.08, 0.9 - d / (maxD * 0.38));
        const jit  = 0.75 + Math.random() * 0.5;
        ctx.globalAlpha = Math.min(fade * jit, 0.82);

        const wx = (Math.random() - 0.5) * 1.5;
        const wy = (Math.random() - 0.5) * 1.5;
        const cx = x + wx, cy = y + wy;

        switch (this.stitchMode) {
          case 'dot': {
            ctx.beginPath();
            ctx.arc(cx, cy, sz * 0.38, 0, Math.PI * 2);
            ctx.fill();
            break;
          }
          case 'seed': {
            // Curved short oval — rice/seed stitch feel
            const len   = sz * (0.9 + Math.random() * 0.5);
            const curve = (Math.random() - 0.5) * 0.7;
            ctx.lineWidth = sz * 0.22 + Math.random() * sz * 0.14;
            ctx.beginPath();
            ctx.moveTo(cx - tx * len, cy - ty * len);
            const mpx = cx - ty * curve * len;
            const mpy = cy + tx * curve * len;
            ctx.quadraticCurveTo(mpx, mpy, cx + tx * len, cy + ty * len);
            ctx.stroke();
            break;
          }
          case 'run': {
            const len = sz * (1.1 + Math.random() * 0.4);
            ctx.lineWidth = sz * 0.16 + Math.random() * 0.5;
            ctx.beginPath();
            ctx.moveTo(cx - tx * len, cy - ty * len);
            ctx.lineTo(cx + tx * len, cy + ty * len);
            ctx.stroke();
            break;
          }
          case 'cross': {
            const len = sz * 0.65;
            ctx.lineWidth = sz * 0.16;
            ctx.beginPath();
            ctx.moveTo(cx - tx * len - ty * len, cy - ty * len + tx * len);
            ctx.lineTo(cx + tx * len + ty * len, cy + ty * len - tx * len);
            ctx.moveTo(cx + tx * len - ty * len, cy + ty * len + tx * len);
            ctx.lineTo(cx - tx * len + ty * len, cy - ty * len - tx * len);
            ctx.stroke();
            break;
          }
        }
      }
    }
  }

  // Sort edge pixels into short connected chains for outline drawing
  _buildEdgeChains(edgePixels) {
    // Bucket by row for fast neighbor lookup
    const byRow = new Map();
    for (const pt of edgePixels) {
      if (!byRow.has(pt.y)) byRow.set(pt.y, []);
      byRow.get(pt.y).push(pt);
    }

    const visited = new Set();
    const chains  = [];

    for (const start of edgePixels) {
      if (visited.has(start)) continue;
      const chain = [];
      let cur = start;

      for (let step = 0; step < 500; step++) {
        if (visited.has(cur)) break;
        visited.add(cur);
        chain.push(cur);

        // Find nearest unvisited edge pixel within radius 8
        let best = null, bestD = 64;
        for (let dy = -3; dy <= 3; dy++) {
          const row = byRow.get(cur.y + dy);
          if (!row) continue;
          for (const pt of row) {
            if (visited.has(pt)) continue;
            const d = (pt.x - cur.x) ** 2 + (pt.y - cur.y) ** 2;
            if (d < bestD) { bestD = d; best = pt; }
          }
        }
        if (!best) break;
        cur = best;
      }

      if (chain.length >= 5) chains.push(chain);
    }

    return chains;
  }

  // ── Core ──────────────────────────────────────────────────────────────────

  _rebuild() {
    this._buildMask();
    if (this._letterMask) this._buildScribbles();
    this.render();
  }

  render() {
    const { canvas } = this;
    canvas.beginLayer('pencil');
    try {
      const ctx = canvas.ctx;
      const W   = canvas.width, H = canvas.height;

      ctx.globalAlpha = 1;
      ctx.fillStyle   = this.bgColor;
      ctx.fillRect(0, 0, W, H);

      if (!this.text.trim()) return;

      if (!this._drawCanvas) { this._drawDimText(ctx, W, H); return; }

      ctx.drawImage(this._drawCanvas, 0, 0);
    } finally {
      canvas.endLayer();
    }
  }

  _drawDimText(ctx, W, H) {
    const lines  = this.text.split('\n');
    const maxLen = Math.max(...lines.map(l => l.length), 1);
    const nLines = lines.length || 1;
    const fs     = Math.min(
      Math.max(24, Math.min(W, H) * 0.55 / Math.max(1, Math.pow(maxLen, 0.55))),
      Math.max(24, H * 0.78 / (nLines * this.lineSpacing))
    );
    const lineH  = fs * this.lineSpacing;
    const startY = H / 2 - ((lines.length - 1) * lineH) / 2;
    ctx.save();
    ctx.font         = `${fs}px 'Courier New', monospace`;
    ctx.textAlign    = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle    = this.color;
    ctx.globalAlpha  = 0.10;
    lines.forEach((l, i) => { if (l.length) ctx.fillText(l, W / 2, startY + i * lineH); });
    ctx.restore();
  }

  reset() {
    this._letterMask = null;
    this._drawCanvas = null;
    this.render();
  }

  // ── UI ───────────────────────────────────────────────────────────────────────

  _bindUI() {
    document.getElementById('pencil-text-input').addEventListener('input', e => {
      this.text = e.target.value;
      this._drawCanvas = null;
      if (this._isActive()) this.render();
    });

    this._slider('sl-ls-pencil', 'v-ls-pencil', v => {
      this.lineSpacing = v;
      this._drawCanvas = null;
      if (this._isActive()) this.render();
    });

    document.getElementById('btn-pencil-build').addEventListener('click',  () => this._rebuild());
    document.getElementById('btn-pencil-reset').addEventListener('click',  () => this.reset());

    this._slider('sl-pencil-thickness',  'v-pencil-thickness',  v => { this.fontThickness = v; });
    this._slider('sl-pencil-blend',     'v-pencil-blend',     v => { this.blendDist     = v; });
    this._slider('sl-pencil-density',   'v-pencil-density',   v => { this.density       = v; });
    this._slider('sl-pencil-spacing',   'v-pencil-spacing',   v => { this.rowSpacing     = v; });
    this._slider('sl-pencil-wiggle',    'v-pencil-wiggle',    v => { this.wiggle         = v; });
    this._slider('sl-pencil-weight',    'v-pencil-weight',    v => { this.strokeWeight   = v; });
    this._slider('sl-pencil-outline',   'v-pencil-outline',   v => { this.outlineWiggle  = v; });
    this._slider('sl-pencil-outpasses', 'v-pencil-outpasses', v => { this.outlinePasses  = v; });
    this._slider('sl-pencil-diag',      'v-pencil-diag',      v => { this.diagDensity    = v; });

    const swatch = document.getElementById('pencil-color-swatch');
    const label  = document.getElementById('pencil-color-label');
    const input  = document.getElementById('pencil-color-input');
    if (swatch) swatch.addEventListener('click', () => input.click());
    if (input)  input.addEventListener('input', () => {
      this.color = input.value;
      if (label)  label.textContent = input.value;
      if (swatch) swatch.style.background = input.value;
    });

    const bgSwatch = document.getElementById('pencil-bg-swatch');
    const bgLabel  = document.getElementById('pencil-bg-label');
    const bgInput  = document.getElementById('pencil-bg-input');
    if (bgSwatch) bgSwatch.addEventListener('click', () => bgInput.click());
    if (bgInput)  bgInput.addEventListener('input', () => {
      this.bgColor = bgInput.value;
      if (bgLabel)  bgLabel.textContent = bgInput.value;
      if (bgSwatch) bgSwatch.style.background = bgInput.value;
      if (this._isActive()) this.render();
    });

    // Stitch mode buttons
    ['none', 'dot', 'seed', 'run', 'cross'].forEach(mode => {
      const btn = document.getElementById(`btn-stitch-${mode}`);
      if (!btn) return;
      btn.addEventListener('click', () => {
        this.stitchMode = mode;
        document.querySelectorAll('.stitch-mode-btn').forEach(b => b.classList.remove('btn-on'));
        btn.classList.add('btn-on');
      });
    });

    this._slider('sl-stitch-spacing', 'v-stitch-spacing', v => { this.stitchSpacing = v; });
    this._slider('sl-stitch-size',    'v-stitch-size',    v => { this.stitchSize    = v; });

    document.addEventListener('tabchange', e => {
      if (e.detail === 'pencil') this.render();
    });
  }
}

const pencilController = new PencilController(canvas);
