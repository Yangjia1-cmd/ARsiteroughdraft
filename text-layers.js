// text-layers.js — Layers panel (top-right) + click-to-select + resize overlay

class TextLayerPanel {
  constructor() {
    this._overlay   = null;
    this._selected  = null;
    this._dragging  = null;       // canvas transform drag state
    this._bboxCache = new Map();
    this._dragTab   = null;       // tab being reordered by drag-and-drop
  }

  init() {
    this._overlay = document.getElementById('select-overlay');
    if (!this._overlay) return;

    this._syncOverlaySize();
    window.addEventListener('resize', () => this._syncOverlaySize());

    // canvas.el always receives events (overlay is pointer-events:none by default).
    // We bind cursor-tracking and selection here so effects (sand brush, water clicks, etc.)
    // still reach canvas.el normally.
    const c = canvas.el;
    c.addEventListener('mousemove',  e => this._onMoveCheck(e));
    c.addEventListener('mousedown',  e => this._onCanvasDown(e));
    c.addEventListener('mouseup',    e => this._onUp(e));
    c.addEventListener('mouseleave', e => this._onUp(e));
    c.addEventListener('click',      e => this._onCanvasClick(e));

    // Overlay only receives events when we force pointer-events:auto during a resize/move drag
    // or when the cursor is near a handle.
    const o = this._overlay;
    o.addEventListener('mousemove',  e => this._onMoveCheck(e));
    o.addEventListener('mousedown',  e => this._onDown(e));
    o.addEventListener('mouseup',    e => this._onUp(e));
    o.addEventListener('mouseleave', e => this._onUp(e));
    o.addEventListener('click',      e => this._onClick(e));

    document.getElementById('tl-add-layer')?.addEventListener('click', () => {
      if (window.canvas) canvas.addUserLayer();
    });

    this._renderPanel();
  }

  refresh() {
    this._renderPanel();
    if (this._selected) this._drawHandles(this._selected);
  }

  // ── Overlay size sync ───────────────────────────────────────────────────────

  _syncOverlaySize() {
    const o = this._overlay;
    if (!o || !window.canvas) return;
    if (o.width  !== canvas.el.width)  o.width  = canvas.el.width;
    if (o.height !== canvas.el.height) o.height = canvas.el.height;
  }

  _eventCoords(e) {
    // Use canvas.el for coordinates — works whether the event came from canvas.el or overlay,
    // since both are positioned identically over the same area.
    const rect = canvas.el.getBoundingClientRect();
    const sx = canvas.el.width  / rect.width;
    const sy = canvas.el.height / rect.height;
    return [(e.clientX - rect.left) * sx, (e.clientY - rect.top) * sy];
  }

  // ── Bounding-box ────────────────────────────────────────────────────────────

  _computeBBox(tab) {
    const L = canvas._layerMap?.get(tab);
    if (!L) return null;
    const el = L.el;
    const W = el.width, H = el.height;
    if (!W || !H) return null;
    const data = el.getContext('2d').getImageData(0, 0, W, H).data;

    // Check if the layer canvas has a transparent background (alpha=0 at corners)
    const cornerAlpha = (data[3] + data[(W-1)*4+3] + data[(H-1)*W*4+3]) / 3;
    const isTransparent = cornerAlpha < 10;

    const bgR = Math.round((data[0] + data[(W-1)*4]   + data[(H-1)*W*4])   / 3);
    const bgG = Math.round((data[1] + data[(W-1)*4+1] + data[(H-1)*W*4+1]) / 3);
    const bgB = Math.round((data[2] + data[(W-1)*4+2] + data[(H-1)*W*4+2]) / 3);

    const step = Math.max(1, Math.floor(Math.min(W, H) / 300));
    let minX = W, maxX = 0, minY = H, maxY = 0;
    for (let y = 0; y < H; y += step) {
      for (let x = 0; x < W; x += step) {
        const i = (y * W + x) * 4;
        const isContent = isTransparent
          ? data[i + 3] > 20
          : Math.abs(data[i]-bgR) + Math.abs(data[i+1]-bgG) + Math.abs(data[i+2]-bgB) > 25;
        if (isContent) {
          if (x < minX) minX = x; if (x > maxX) maxX = x;
          if (y < minY) minY = y; if (y > maxY) maxY = y;
        }
      }
    }
    if (maxX <= minX || maxY <= minY) return null;
    return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
  }

  _transformedBBox(tab) {
    const L = canvas._layerMap?.get(tab);
    if (!L) return null;
    let b = this._bboxCache.get(tab);
    if (!b) { b = this._computeBBox(tab); if (b) this._bboxCache.set(tab, b); }
    if (!b) return null;
    const W = canvas.el.width, H = canvas.el.height;
    const { dx, dy, scale } = L.transform;
    return {
      x: (b.x - W/2) * scale + W/2 + dx,
      y: (b.y - H/2) * scale + H/2 + dy,
      w: b.w * scale,
      h: b.h * scale,
    };
  }

  // ── Hit-test ────────────────────────────────────────────────────────────────

  _hitTest(cx, cy) {
    if (!canvas._layerMap) return null;
    const sorted = [...canvas._layerMap.entries()].sort((a, b) => b[1].order - a[1].order);
    for (const [tab, L] of sorted) {
      if (!L.visible || tab === 'background') continue;
      const b = this._transformedBBox(tab);
      if (!b) continue;
      const pad = 10;
      if (cx >= b.x-pad && cx <= b.x+b.w+pad && cy >= b.y-pad && cy <= b.y+b.h+pad) return tab;
    }
    return null;
  }

  // ── Handles ─────────────────────────────────────────────────────────────────

  _handlePositions(b) {
    const { x, y, w, h } = b;
    const cx = x + w/2, cy = y + h/2;
    return [
      { id: 'nw', px: x,    py: y    }, { id: 'n',  px: cx,   py: y    }, { id: 'ne', px: x+w, py: y    },
      { id: 'w',  px: x,    py: cy   },                                     { id: 'e',  px: x+w, py: cy   },
      { id: 'sw', px: x,    py: y+h  }, { id: 's',  px: cx,   py: y+h  }, { id: 'se', px: x+w, py: y+h  },
    ];
  }

  _hitHandle(cx, cy, handles) {
    for (const h of handles) {
      if (Math.abs(cx - h.px) < 9 && Math.abs(cy - h.py) < 9) return h.id;
    }
    return null;
  }

  _drawHandles(tab) {
    this._syncOverlaySize();
    const o = this._overlay;
    const ctx = o.getContext('2d');
    ctx.clearRect(0, 0, o.width, o.height);

    const b = this._transformedBBox(tab);
    if (!b) return;
    const pad = 8;
    const bx = b.x-pad, by = b.y-pad, bw = b.w+pad*2, bh = b.h+pad*2;

    ctx.save();
    ctx.strokeStyle = 'rgba(255,255,255,0.75)';
    ctx.lineWidth = 1;
    ctx.setLineDash([5, 4]);
    ctx.strokeRect(bx+0.5, by+0.5, bw, bh);
    ctx.setLineDash([]);
    ctx.restore();

    this._handlePositions({ x: bx, y: by, w: bw, h: bh }).forEach(({ px, py }) => {
      ctx.fillStyle = '#ffffff'; ctx.strokeStyle = '#333'; ctx.lineWidth = 1;
      ctx.fillRect(px-4, py-4, 8, 8);
      ctx.strokeRect(px-4, py-4, 8, 8);
    });
  }

  _clearOverlay() {
    const o = this._overlay;
    if (o) o.getContext('2d').clearRect(0, 0, o.width, o.height);
  }

  // ── Canvas mouse events ─────────────────────────────────────────────────────

  _onClick(e) {
    if (this._dragging) return;
    const [cx, cy] = this._eventCoords(e);
    const hit = this._hitTest(cx, cy);
    if (hit) this.select(hit);
    else     this.deselect();
  }

  _onDown(e) {
    if (!this._selected) return;
    const L = canvas._layerMap?.get(this._selected);
    if (!L) return;
    const [cx, cy] = this._eventCoords(e);
    const b = this._transformedBBox(this._selected);
    if (!b) return;
    const pad = 8;
    const bx = b.x-pad, by = b.y-pad, bw = b.w+pad*2, bh = b.h+pad*2;
    const handles = this._handlePositions({ x: bx, y: by, w: bw, h: bh });
    const hitH = this._hitHandle(cx, cy, handles);
    if (hitH) {
      this._dragging = { type: 'resize', handle: hitH, startX: cx, startY: cy, origTf: {...L.transform}, origB: {...b} };
    } else if (cx >= bx && cx <= bx+bw && cy >= by && cy <= by+bh) {
      this._dragging = { type: 'move', startX: cx, startY: cy, origTf: {...L.transform} };
    }
    if (this._dragging) {
      this._overlay.style.pointerEvents = 'auto'; // keep overlay live for the full drag
      e.preventDefault();
    }
  }

  _onCanvasDown(e) {
    if (!this._selected) return;
    const L = canvas._layerMap?.get(this._selected);
    if (!L) return;
    const [cx, cy] = this._eventCoords(e);
    const b = this._transformedBBox(this._selected);
    if (!b) return;
    const pad = 8;
    const bx = b.x-pad, by = b.y-pad, bw = b.w+pad*2, bh = b.h+pad*2;
    const handles = this._handlePositions({ x: bx, y: by, w: bw, h: bh });
    if (!this._hitHandle(cx, cy, handles) &&
        cx >= bx && cx <= bx+bw && cy >= by && cy <= by+bh) {
      this._dragging = { type: 'move', startX: cx, startY: cy, origTf: {...L.transform} };
      this._overlay.style.pointerEvents = 'auto';
      e.preventDefault();
    }
  }

  _onCanvasClick(e) {
    if (this._dragging) return;
    const [cx, cy] = this._eventCoords(e);
    const hit = this._hitTest(cx, cy);
    if (hit) this.select(hit);
    else this.deselect();
  }

  _onMoveCheck(e) {
    if (this._dragging) { this._onMove(e); return; }
    const [cx, cy] = this._eventCoords(e);
    let cursor = 'default';
    let nearHandle = false;
    if (this._selected) {
      const L = canvas._layerMap?.get(this._selected);
      if (L) {
        const b = this._transformedBBox(this._selected);
        if (b) {
          const pad = 8;
          const bx = b.x-pad, by = b.y-pad, bw = b.w+pad*2, bh = b.h+pad*2;
          const hh = this._hitHandle(cx, cy, this._handlePositions({ x: bx, y: by, w: bw, h: bh }));
          if      (hh === 'nw' || hh === 'se')  { cursor = 'nwse-resize'; nearHandle = true; }
          else if (hh === 'ne' || hh === 'sw')  { cursor = 'nesw-resize'; nearHandle = true; }
          else if (hh === 'n'  || hh === 's')   { cursor = 'ns-resize';   nearHandle = true; }
          else if (hh === 'e'  || hh === 'w')   { cursor = 'ew-resize';   nearHandle = true; }
          else if (cx >= bx && cx <= bx+bw && cy >= by && cy <= by+bh) cursor = 'move';
        }
      }
    }
    // Only let the overlay capture events when near a resize handle or during a drag.
    // For 'move' and 'default', keep pointer-events:none so effects (sand, water, etc.)
    // receive canvas.el events normally.
    this._overlay.style.cursor = cursor;
    this._overlay.style.pointerEvents = nearHandle ? 'auto' : 'none';
    canvas.el.style.cursor = cursor;
  }

  _onMove(e) {
    if (!this._dragging || !this._selected) return;
    const L = canvas._layerMap?.get(this._selected);
    if (!L) return;
    const [cx, cy] = this._eventCoords(e);
    const { type, startX, startY, origTf, origB } = this._dragging;

    if (type === 'move') {
      canvas.setLayerTransform(this._selected, origTf.dx + (cx-startX), origTf.dy + (cy-startY), origTf.scale);
    } else {
      const dx = cx-startX, dy = cy-startY;
      const { handle } = this._dragging;
      const diag = Math.sqrt(origB.w*origB.w + origB.h*origB.h);
      let delta = 1;
      if      (handle === 'se') delta = 1 + (dx+dy)   / (diag*1.41);
      else if (handle === 'nw') delta = 1 - (dx+dy)   / (diag*1.41);
      else if (handle === 'ne') delta = 1 + (-dx+dy)  / (diag*1.41) * -1 + dx / origB.w;
      else if (handle === 'sw') delta = 1 + (dx-dy)   / (diag*1.41) * -1 + dy / origB.h;
      else if (handle === 'e')  delta = 1 + dx / origB.w;
      else if (handle === 'w')  delta = 1 - dx / origB.w;
      else if (handle === 's')  delta = 1 + dy / origB.h;
      else if (handle === 'n')  delta = 1 - dy / origB.h;
      canvas.setLayerTransform(this._selected, origTf.dx, origTf.dy, Math.max(0.05, origTf.scale * delta));
    }

    this._bboxCache.delete(this._selected);
    this._drawHandles(this._selected);
  }

  _onUp() {
    if (!this._dragging) return;
    this._dragging = null;
    if (this._overlay) this._overlay.style.pointerEvents = 'none';
  }

  // ── Select / deselect ───────────────────────────────────────────────────────

  select(tab) {
    this._selected = tab;
    this._bboxCache.delete(tab);
    this._drawHandles(tab);
    this._renderPanel();
  }

  deselect() {
    this._selected = null;
    this._clearOverlay();
    this._renderPanel();
  }

  // ── Layers panel ────────────────────────────────────────────────────────────

  _renderPanel() {
    const list = document.getElementById('text-layers-list');
    if (!list) return;
    list.innerHTML = '';

    const layers = canvas._layerMap
      ? [...canvas._layerMap.entries()].sort((a, b) => b[1].order - a[1].order)
      : [];

    if (!layers.length) {
      const empty = document.createElement('div');
      empty.className = 'tl-empty';
      empty.textContent = 'No layers yet';
      list.appendChild(empty);
      return;
    }

    layers.forEach(([tab, L]) => {
      const isBg = tab === 'background';
      const item = document.createElement('div');
      item.className = 'tl-item' + (tab === this._selected ? ' tl-selected' : '') + (isBg ? ' tl-bg-layer' : '');
      item.dataset.tab = tab;

      // ── Drag handle (not for background) ──────────────────────────
      if (!isBg) {
        const grip = document.createElement('span');
        grip.className = 'tl-grip';
        grip.textContent = '⠿';
        grip.title = 'Drag to reorder';
        item.appendChild(grip);
      } else {
        const spacer = document.createElement('span');
        spacer.className = 'tl-grip tl-grip-spacer';
        item.appendChild(spacer);
      }

      // ── Thumbnail ──────────────────────────────────────────────────
      const thumb = document.createElement('canvas');
      thumb.className = 'tl-thumb';
      thumb.width = 44; thumb.height = 28;
      const tctx = thumb.getContext('2d');
      if (!isBg) {
        // Draw checkerboard behind transparent layer content
        for (let ty = 0; ty < 28; ty += 4) {
          for (let tx = 0; tx < 44; tx += 4) {
            tctx.fillStyle = ((tx + ty) / 4 % 2 === 0) ? '#555' : '#333';
            tctx.fillRect(tx, ty, 4, 4);
          }
        }
      }
      tctx.drawImage(L.el, 0, 0, 44, 28);
      item.appendChild(thumb);

      // ── Name (double-click to rename, not for background) ──────────
      const nameEl = document.createElement('span');
      nameEl.className = 'tl-name';
      nameEl.textContent = L.name || this._label(tab);
      if (!isBg) {
        nameEl.title = 'Double-click to rename';
        nameEl.addEventListener('dblclick', ev => {
          ev.stopPropagation();
          this._startRename(tab, L, nameEl);
        });
      }
      item.appendChild(nameEl);

      // ── Visibility toggle ──────────────────────────────────────────
      const vis = document.createElement('button');
      vis.className = 'tl-btn';
      vis.title = L.visible ? 'Hide' : 'Show';
      vis.textContent = L.visible ? '●' : '○';
      vis.addEventListener('click', ev => {
        ev.stopPropagation();
        canvas.setLayerVisible(tab, !L.visible);
        this._renderPanel();
      });
      item.appendChild(vis);

      // ── Delete (not for background) ────────────────────────────────
      if (!isBg) {
        const del = document.createElement('button');
        del.className = 'tl-btn tl-del'; del.title = 'Remove'; del.textContent = '✕';
        del.addEventListener('click', ev => {
          ev.stopPropagation();
          canvas.removeLayer(tab);
          if (this._selected === tab) this.deselect();
          else this._renderPanel();
        });
        item.appendChild(del);
      }

      // ── Select on click (not for background) ──────────────────────
      if (!isBg) item.addEventListener('click', () => this.select(tab));

      // ── Drag-and-drop reordering (not for background) ─────────────
      if (!isBg) {
        item.draggable = true;

        item.addEventListener('dragstart', e => {
          this._dragTab = tab;
          e.dataTransfer.effectAllowed = 'move';
          setTimeout(() => item.classList.add('tl-dragging'), 0);
        });

        item.addEventListener('dragend', () => {
          this._dragTab = null;
          item.classList.remove('tl-dragging');
          list.querySelectorAll('.tl-drag-over').forEach(el => el.classList.remove('tl-drag-over'));
        });

        item.addEventListener('dragover', e => {
          if (!this._dragTab || this._dragTab === tab) return;
          e.preventDefault();
          e.dataTransfer.dropEffect = 'move';
          list.querySelectorAll('.tl-drag-over').forEach(el => el.classList.remove('tl-drag-over'));
          item.classList.add('tl-drag-over');
        });

        item.addEventListener('dragleave', e => {
          if (!item.contains(e.relatedTarget)) item.classList.remove('tl-drag-over');
        });

        item.addEventListener('drop', e => {
          e.preventDefault();
          item.classList.remove('tl-drag-over');
          if (!this._dragTab || this._dragTab === tab) return;
          const srcL = canvas._layerMap?.get(this._dragTab);
          const dstL = canvas._layerMap?.get(tab);
          if (srcL && dstL && dstL.tab !== 'background') {
            [srcL.order, dstL.order] = [dstL.order, srcL.order];
            canvas._composite();
            this._renderPanel();
          }
        });
      }

      list.appendChild(item);
    });
  }

  // ── Inline rename ───────────────────────────────────────────────────────────

  _startRename(tab, L, nameEl) {
    const input = document.createElement('input');
    input.className  = 'tl-rename-input';
    input.value      = L.name || this._label(tab);
    input.spellcheck = false;
    nameEl.replaceWith(input);
    input.select();

    const commit = () => {
      const val = input.value.trim();
      L.name = val || this._label(tab);
      this._renderPanel();
    };

    input.addEventListener('blur',   commit);
    input.addEventListener('keydown', e => {
      if (e.key === 'Enter')  { e.preventDefault(); input.blur(); }
      if (e.key === 'Escape') { input.value = L.name || this._label(tab); input.blur(); }
      e.stopPropagation();
    });
    input.addEventListener('click', e => e.stopPropagation());
  }

  // ── Helpers ─────────────────────────────────────────────────────────────────

  _label(tab) {
    if (tab.startsWith('user-')) return 'Layer ' + tab.slice(5);
    return { background: 'Background', sg: 'Spawn & Grow', dots: 'Dots', threads: 'Thread',
             water: 'Water', glitch: 'Glitch', hypa: 'Hypa', quicksand: 'Quicksand',
             pattern: 'Pattern', pencil: 'Pencil', stain: 'Stain' }[tab] || tab;
  }
}

const textLayerPanel = new TextLayerPanel();
document.addEventListener('DOMContentLoaded', () => textLayerPanel.init());
