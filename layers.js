// layers.js — Non-destructive layer compositing via CSS mix-blend-mode.
//
// Each pinned layer is a <canvas> element absolutely positioned inside
// #canvas-area, rendered BELOW the main canvas. When layers are present,
// the main canvas gets mix-blend-mode:screen so its dark background
// becomes transparent, revealing the layer canvases underneath.
// No changes are needed in any controller — they render normally.

class LayerManager {
  constructor() {
    this.layers  = [];
    this._nextId = 1;
    this._area   = null;   // #canvas-area element
    this._mainEl = null;   // #main-canvas element
    this._listEl = null;   // #layer-list element
  }

  init(mainEl, areaEl, listEl) {
    this._mainEl = mainEl;
    this._area   = areaEl;
    this._listEl = listEl;
    this._render();
  }

  // ── Public ──────────────────────────────────────────────────────────────────

  // Snapshot current canvas and push as a new layer.
  pin() {
    const src = this._mainEl;
    const activeTab = document.querySelector('.panel-tab.active');
    const tabName   = activeTab ? activeTab.dataset.label : '';
    const name      = tabName ? `${tabName} ${this._nextId}` : `Layer ${this._nextId}`;

    const c = document.createElement('canvas');
    c.width   = src.width;
    c.height  = src.height;
    c.getContext('2d').drawImage(src, 0, 0);

    // Absolute-positioned so it underlays the main canvas exactly
    c.style.cssText = [
      'position:absolute', 'top:0', 'left:0',
      'width:100%', 'height:100%',
      'pointer-events:none',
      'mix-blend-mode:screen',
    ].join(';');

    // Insert before main canvas in the DOM → layer renders below main
    this._area.insertBefore(c, src);

    const layer = {
      id:        this._nextId++,
      name,
      canvas:    c,
      opacity:   1,
      blendMode: 'screen',
      visible:   true,
    };
    this.layers.push(layer);
    this._syncMain();
    this._render();
  }

  remove(id) {
    const i = this.layers.findIndex(l => l.id === id);
    if (i < 0) return;
    this._area.removeChild(this.layers[i].canvas);
    this.layers.splice(i, 1);
    this._syncMain();
    this._render();
  }

  // Flatten all visible layers + main canvas into a single bitmap.
  // Called by save.js so exports include all layers.
  getComposite() {
    const W = this._mainEl.width, H = this._mainEl.height;
    const off = document.createElement('canvas');
    off.width = W; off.height = H;
    const ctx = off.getContext('2d');

    // Draw layers in DOM order (oldest/lowest first)
    this.layers.forEach(l => {
      if (!l.visible) return;
      ctx.save();
      ctx.globalAlpha = l.opacity;
      ctx.globalCompositeOperation = l.blendMode === 'normal' ? 'source-over' : l.blendMode;
      ctx.drawImage(l.canvas, 0, 0);
      ctx.restore();
    });

    // Draw main canvas on top with screen to match the visual blend
    ctx.save();
    if (this.layers.some(l => l.visible)) ctx.globalCompositeOperation = 'screen';
    ctx.drawImage(this._mainEl, 0, 0);
    ctx.restore();

    return off;
  }

  // ── Private ─────────────────────────────────────────────────────────────────

  // Main canvas uses mix-blend-mode:screen when layers exist so its dark
  // background pixels are transparent and layers below show through.
  _syncMain() {
    this._mainEl.style.mixBlendMode = this.layers.some(l => l.visible) ? 'screen' : '';
  }

  _render() {
    const list = this._listEl;
    if (!list) return;
    list.innerHTML = '';

    if (!this.layers.length) {
      const empty = document.createElement('div');
      empty.className = 'layer-empty';
      empty.textContent = 'No pinned layers';
      list.appendChild(empty);
      return;
    }

    // Show newest layer first (top of stack at top of UI)
    [...this.layers].reverse().forEach(L => {
      const item = document.createElement('div');
      item.className = 'layer-item';

      // Thumbnail preview
      const th = document.createElement('canvas');
      th.className = 'layer-thumb';
      th.width = 44; th.height = 28;
      th.getContext('2d').drawImage(L.canvas, 0, 0, 44, 28);

      // Name label
      const nm = document.createElement('span');
      nm.className = 'layer-name';
      nm.textContent = L.name;

      // Visibility toggle
      const vis = document.createElement('button');
      vis.className = 'layer-icon-btn';
      vis.title = L.visible ? 'Hide' : 'Show';
      vis.textContent = L.visible ? '●' : '○';
      vis.addEventListener('click', () => {
        L.visible = !L.visible;
        L.canvas.style.display = L.visible ? '' : 'none';
        vis.textContent = L.visible ? '●' : '○';
        vis.title       = L.visible ? 'Hide' : 'Show';
        this._syncMain();
      });

      // Blend mode selector
      const sel = document.createElement('select');
      sel.className = 'layer-blend-sel';
      ['screen', 'multiply', 'overlay', 'difference', 'lighten', 'darken', 'hard-light', 'color-dodge', 'normal'].forEach(m => {
        const o = document.createElement('option');
        o.value = m; o.textContent = m;
        if (m === L.blendMode) o.selected = true;
        sel.appendChild(o);
      });
      sel.addEventListener('change', () => {
        L.blendMode = sel.value;
        L.canvas.style.mixBlendMode = sel.value;
      });

      // Delete button
      const del = document.createElement('button');
      del.className = 'layer-icon-btn layer-del-btn';
      del.textContent = '✕';
      del.title = 'Remove layer';
      del.addEventListener('click', () => this.remove(L.id));

      item.append(th, nm, vis, sel, del);

      // Opacity slider on its own row
      const opRow = document.createElement('div');
      opRow.className = 'layer-op-row';
      const op = document.createElement('input');
      op.type = 'range'; op.min = 0; op.max = 1; op.step = 0.05;
      op.value = L.opacity;
      op.className = 'layer-op-slider';
      op.title = 'Opacity';
      op.addEventListener('input', () => {
        L.opacity = parseFloat(op.value);
        L.canvas.style.opacity = L.opacity;
      });
      opRow.appendChild(op);

      list.append(item, opRow);
    });
  }
}

const layerManager = new LayerManager();

document.addEventListener('DOMContentLoaded', () => {
  layerManager.init(
    document.getElementById('main-canvas'),
    document.getElementById('canvas-wrapper'),
    document.getElementById('layer-list')
  );
  document.getElementById('btn-pin').addEventListener('click', () => layerManager.pin());
});
