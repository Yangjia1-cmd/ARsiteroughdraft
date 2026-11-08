// save.js — Export canvas as PNG, JPEG, WEBP, or Video (WebM)

class SaveController {
  constructor(canvas) {
    this.canvas   = canvas;
    this._format  = 'png';
    this._transp  = false;
    this._recStop = null;   // function to stop an in-progress recording

    this._bindUI();
  }

  // ── UI ────────────────────────────────────────────────────────────────────

  _bindUI() {
    document.getElementById('btn-save').addEventListener('click', () => this._open());

    document.getElementById('save-cancel').addEventListener('click', () => this._close());

    // Close on backdrop click
    document.getElementById('save-modal').addEventListener('click', e => {
      if (e.target === document.getElementById('save-modal')) this._close();
    });

    // Format pills
    document.querySelectorAll('.save-fmt').forEach(btn => {
      btn.addEventListener('click', () => {
        this._format = btn.dataset.fmt;
        this._refreshUI();
      });
    });

    // Transparent checkbox
    document.getElementById('save-transp').addEventListener('change', e => {
      this._transp = e.target.checked;
    });

    // Download button
    document.getElementById('save-download').addEventListener('click', () => this._download());
  }

  _open() {
    this._refreshUI();
    document.getElementById('save-modal').classList.add('active');
  }

  _close() {
    document.getElementById('save-modal').classList.remove('active');
    // Reset download button label in case a recording was in progress
    document.getElementById('save-download').textContent = 'Download';
    document.getElementById('save-download').disabled = false;
  }

  _refreshUI() {
    // Highlight selected format
    document.querySelectorAll('.save-fmt').forEach(btn => {
      btn.classList.toggle('save-fmt-on', btn.dataset.fmt === this._format);
    });

    // Transparent option is only meaningful for PNG and WEBP
    const supportsAlpha = this._format === 'png' || this._format === 'webp';
    const cb = document.getElementById('save-transp');
    cb.disabled = !supportsAlpha;
    if (!supportsAlpha) { cb.checked = false; this._transp = false; }

    // Update hint text
    const hint = document.getElementById('save-hint');
    if (this._format === 'video') {
      hint.textContent = 'Records 5 seconds of the canvas as a WebM video.';
    } else if (this._format === 'jpeg') {
      hint.textContent = 'JPEG does not support transparency.';
    } else {
      hint.textContent = 'Removes the background colour and keeps the marks.';
    }
  }

  // ── Export ────────────────────────────────────────────────────────────────

  async _download() {
    if (this._format === 'video') {
      await this._recordVideo();
    } else {
      this._exportImage();
      this._close();
    }
  }

  _exportImage() {
    const W = this.canvas.el.width, H = this.canvas.el.height;

    // Flatten layers into export when any are pinned
    const src = (typeof layerManager !== 'undefined' && layerManager.layers.length > 0)
      ? layerManager.getComposite()
      : this.canvas.el;

    const off = document.createElement('canvas');
    off.width = W; off.height = H;
    const ctx = off.getContext('2d');
    ctx.drawImage(src, 0, 0);

    if (this._transp) {
      const id   = ctx.getImageData(0, 0, W, H);
      const data = id.data;

      // Detect background colour from the four corners so this works for both
      // dark-background effects (bg ≈ #111) and light-background effects like
      // Pencil (bg ≈ #ece9e0).  Pixels within `tol` of the bg colour are erased.
      const corners = [0, (W - 1) * 4, (H - 1) * W * 4, ((H - 1) * W + W - 1) * 4];
      let bgR = 0, bgG = 0, bgB = 0;
      corners.forEach(ci => { bgR += data[ci]; bgG += data[ci + 1]; bgB += data[ci + 2]; });
      bgR = Math.round(bgR / 4);
      bgG = Math.round(bgG / 4);
      bgB = Math.round(bgB / 4);

      const tol = 30;
      for (let i = 0; i < data.length; i += 4) {
        if (Math.abs(data[i]     - bgR) <= tol &&
            Math.abs(data[i + 1] - bgG) <= tol &&
            Math.abs(data[i + 2] - bgB) <= tol) {
          data[i + 3] = 0;
        }
      }
      ctx.putImageData(id, 0, 0);
    }

    this._triggerDownload(off.toDataURL(`image/${this._format}`, 0.95), `export.${this._format}`);
  }

  async _recordVideo() {
    if (!this.canvas.el.captureStream) {
      alert('Video recording is not supported in this browser.');
      return;
    }

    const btn = document.getElementById('save-download');
    const DURATION = 5000; // ms

    const stream   = this.canvas.el.captureStream(30);
    const mimeType = MediaRecorder.isTypeSupported('video/webm; codecs=vp9')
      ? 'video/webm; codecs=vp9'
      : 'video/webm';
    const recorder = new MediaRecorder(stream, { mimeType });
    const chunks   = [];

    recorder.ondataavailable = e => { if (e.data.size > 0) chunks.push(e.data); };

    return new Promise(resolve => {
      recorder.onstop = () => {
        const blob = new Blob(chunks, { type: 'video/webm' });
        const url  = URL.createObjectURL(blob);
        this._triggerDownload(url, 'export.webm');
        URL.revokeObjectURL(url);
        btn.textContent = 'Download';
        btn.disabled    = false;
        this._close();
        resolve();
      };

      recorder.start();
      btn.disabled = true;

      let remaining = DURATION / 1000;
      btn.textContent = `Recording ${remaining}s…`;
      const tick = setInterval(() => {
        remaining--;
        if (remaining > 0) {
          btn.textContent = `Recording ${remaining}s…`;
        } else {
          clearInterval(tick);
        }
      }, 1000);

      setTimeout(() => {
        clearInterval(tick);
        recorder.stop();
      }, DURATION);
    });
  }

  _triggerDownload(urlOrDataUrl, filename) {
    const a = document.createElement('a');
    a.href     = urlOrDataUrl;
    a.download = filename;
    a.click();
  }
}

// Instantiate after DOM is ready (canvas is already defined globally by canvas.js)
const saveController = new SaveController(canvas);
