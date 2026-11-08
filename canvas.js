// canvas.js — Canvas rendering class + per-tab layer system

class Canvas {
  constructor(canvasId) {
    this.el = document.getElementById(canvasId);
    this.ctx = this.el.getContext('2d');
    this._fixedW = 0;
    this._fixedH = 0;
    this._layerMap = new Map();   // tab → LayerInfo
    this._ctxStack = [];          // stack for nested beginLayer calls
    this._resize();
    window.addEventListener('resize', () => this._resize());
  }

  get width()  { return this.el.width; }
  get height() { return this.el.height; }

  // Called when the user confirms a document size in the New Document dialog.
  setFixedSize(w, h) {
    this._fixedW = w;
    this._fixedH = h;
    this.el.width  = w;
    this.el.height = h;
    this._layerMap.forEach(L => {
      L.el.width = w; L.el.height = h;
      if (L.tab === 'background' && this._bgColor) {
        const ctx = L.el.getContext('2d');
        ctx.fillStyle = this._bgColor;
        ctx.fillRect(0, 0, w, h);
      }
    });
    document.getElementById('canvas-area')?.classList.add('fixed-mode');
    this._applyDisplayScale();
  }

  // Scale the canvas-wrapper so the document fits visible area; buffer stays full-res.
  _applyDisplayScale() {
    const area = document.getElementById('canvas-area');
    if (!area) return;
    const pad   = 40;
    const maxW  = Math.max(1, area.clientWidth  - pad * 2);
    const maxH  = Math.max(1, area.clientHeight - pad * 2);
    const scale = Math.min(1, maxW / this._fixedW, maxH / this._fixedH);
    const dW    = Math.round(this._fixedW  * scale);
    const dH    = Math.round(this._fixedH * scale);
    const wrap  = document.getElementById('canvas-wrapper');
    if (wrap) { wrap.style.width = dW + 'px'; wrap.style.height = dH + 'px'; }
  }

  _resize() {
    if (this._fixedW) { this._applyDisplayScale(); return; }
    const wrap = document.getElementById('canvas-wrapper');
    const W = wrap ? wrap.clientWidth  : this.el.parentElement.clientWidth;
    const H = wrap ? wrap.clientHeight : this.el.parentElement.clientHeight;
    if (W > 0 && H > 0) {
      this.el.width = W; this.el.height = H;
      this._layerMap.forEach(L => {
        L.el.width = W; L.el.height = H;
        if (L.tab === 'background' && this._bgColor) {
          const ctx = L.el.getContext('2d');
          ctx.fillStyle = this._bgColor;
          ctx.fillRect(0, 0, W, H);
        }
      });
      if (this._layerMap.size) this._composite();
    }
  }

  clear(bg = '#111111') {
    if (this._ctxStack.length > 0) {
      // Inside a layer — layer canvases are transparent; background comes from the background layer
      this.ctx.clearRect(0, 0, this.width, this.height);
    } else {
      this.ctx.fillStyle = bg;
      this.ctx.fillRect(0, 0, this.width, this.height);
    }
  }

  // Create/update the locked background layer (always order -1, bottom of stack).
  setBackground(color) {
    this._bgColor = color;
    let L = this._layerMap.get('background');
    if (!L) {
      const el = document.createElement('canvas');
      el.width = this.el.width; el.height = this.el.height;
      L = { tab: 'background', el, transform: { dx: 0, dy: 0, scale: 1 }, visible: true, order: -1 };
      this._layerMap.set('background', L);
    }
    const ctx = L.el.getContext('2d');
    ctx.fillStyle = color;
    ctx.fillRect(0, 0, L.el.width, L.el.height);
    this._composite();
    window.textLayerPanel?.refresh();
  }

  drawText(text, x, y, { fontSize = 80, fontFamily = 'monospace', color = '#cccccc', bold = false } = {}) {
    const weight = bold ? 'bold ' : '';
    this.ctx.font = `${weight}${fontSize}px ${fontFamily}`;
    this.ctx.fillStyle = color;
    this.ctx.textBaseline = 'alphabetic';
    this.ctx.fillText(text, x, y);
  }

  getCharPositions(text, originX, originY, fontSize = 80, fontFamily = 'monospace') {
    this.ctx.font = `${fontSize}px ${fontFamily}`;
    this.ctx.textBaseline = 'alphabetic';
    const positions = [];
    let curX = originX;
    for (const char of text) {
      if (char === '\n') { curX = originX; originY += fontSize * 1.3; continue; }
      const metrics = this.ctx.measureText(char);
      const w = metrics.width;
      if (char !== ' ') positions.push({ char, x: curX, y: originY, w, h: fontSize });
      curX += w;
    }
    return positions;
  }

  measureText(text, fontSize = 80, fontFamily = 'monospace') {
    this.ctx.font = `${fontSize}px ${fontFamily}`;
    return this.ctx.measureText(text).width;
  }

  // ── Layer system ────────────────────────────────────────────────────────────
  // Each controller calls beginLayer(tab) at the start of its render and
  // endLayer() at the end.  canvas.ctx is temporarily redirected to the
  // per-tab offscreen canvas so all existing drawing code works unchanged.

  beginLayer(tab) {
    let L = this._layerMap.get(tab);
    if (!L) {
      const el = document.createElement('canvas');
      el.width = this.el.width; el.height = this.el.height;
      L = { tab, el, transform: { dx: 0, dy: 0, scale: 1 }, visible: true, order: this._layerMap.size };
      this._layerMap.set(tab, L);
    } else if (L.el.width !== this.el.width || L.el.height !== this.el.height) {
      L.el.width = this.el.width; L.el.height = this.el.height;
    }
    this._ctxStack.push(this.ctx);
    this.ctx = L.el.getContext('2d');
  }

  endLayer() {
    if (this._ctxStack.length) this.ctx = this._ctxStack.pop();
    this._composite();
    window.textLayerPanel?.refresh();
  }

  // Composite all visible layer canvases → main canvas.
  _composite() {
    const ctx = this.el.getContext('2d');   // always write to the real canvas
    const W = this.el.width, H = this.el.height;
    ctx.clearRect(0, 0, W, H);
    if (!this._layerMap.size) return;
    const sorted = [...this._layerMap.values()].sort((a, b) => a.order - b.order);
    for (const L of sorted) {
      if (!L.visible) continue;
      const { dx, dy, scale } = L.transform;
      ctx.save();
      if (dx !== 0 || dy !== 0 || scale !== 1) {
        ctx.translate(W / 2 + dx, H / 2 + dy);
        ctx.scale(scale, scale);
        ctx.drawImage(L.el, -W / 2, -H / 2);
      } else {
        ctx.drawImage(L.el, 0, 0);
      }
      ctx.restore();
    }
  }

  setLayerTransform(tab, dx, dy, scale) {
    const L = this._layerMap.get(tab);
    if (L) { L.transform = { dx, dy, scale }; this._composite(); }
  }

  setLayerVisible(tab, v) {
    const L = this._layerMap.get(tab);
    if (L) { L.visible = v; this._composite(); }
  }

  removeLayer(tab) {
    if (this._layerMap.delete(tab)) this._composite();
  }

  // Create a new blank user layer and return its key.
  addUserLayer() {
    let n = 1;
    while (this._layerMap.has('user-' + n)) n++;
    const key = 'user-' + n;
    const el = document.createElement('canvas');
    el.width = this.el.width; el.height = this.el.height;
    const maxOrder = this._layerMap.size
      ? Math.max(...[...this._layerMap.values()].map(L => L.order))
      : -1;
    const L = { tab: key, el, transform: { dx: 0, dy: 0, scale: 1 }, visible: true, order: maxOrder + 1, name: 'Layer ' + n };
    this._layerMap.set(key, L);
    this._composite();
    window.textLayerPanel?.refresh();
    return key;
  }
}
