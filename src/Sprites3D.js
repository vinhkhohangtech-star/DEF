/* =========================================================
   Sprites3D.js — pre-rendered 3D model sprites.
   Your .glb models are rendered offline (from the game's exact
   2.5D camera, with real lighting/shadows, 16–32 headings) into
   atlases in assets/sprites3d/. assets/sprites3d/manifest.js
   lists them. Anything missing falls back to the vector art.
   Works from file:// (plain <img>, no WebGL, no server).
   ========================================================= */
(function (TD) {
  'use strict';
  const TAU = Math.PI * 2;

  const S3 = {
    on: true,                 // master switch (F12: TD.S3.on = false → vector art)
    M: {},                    // id → meta
    cells: {},                // cached per-cell canvases (props)
    pages: [],
    load() {
      const man = TD.S3_MANIFEST || {}, files = TD.S3_PAGES || [];
      const one = (src) => new Promise((res) => {
        const im = new Image();
        im.onload = () => {
          if (!(im.naturalWidth > 0)) return res(null);
          if (window.createImageBitmap) createImageBitmap(im).then((bm) => res(bm), () => res(im)); else res(im);
        };
        im.onerror = () => res(null);
        im.src = src;
      });
      return Promise.all(files.map(one)).then((imgs) => {
        this.pages = imgs;
        if (imgs.some((i) => !i)) return 0;          // a page failed → stay on vector art
        for (const id of Object.keys(man)) this.M[id] = man[id];
        return Object.keys(this.M).length;
      });
    },
    has(id) { return this.on && !!this.M[id]; },
    /** Cell index for a world heading (0 = screen right, PI/2 = toward the viewer). */
    angleIndex(id, a) {
      const m = this.M[id];
      if (m.headings) {
        let best = 0, bd = 9;
        m.headings.forEach((h, i) => { let d = Math.abs(((a - h) % TAU + TAU + Math.PI) % TAU - Math.PI); if (d < bd) { bd = d; best = i; } });
        return best;
      }
      const n = m.angles;
      return ((Math.round(a / (TAU / n)) % n) + n) % n;
    },
    /** Draw sprite with its ground anchor at (x, y). k = extra scale. */
    draw(ctx, id, x, y, a = Math.PI / 2, frame = 0, k = 1) {
      const m = this.M[id];
      if (!m) return false;
      return this.drawIndex(ctx, id, x, y, this.angleIndex(id, a) + (frame % m.frames) * m.angles, k);
    },
    /** Heading (radians) of the baked cell that draw() would pick for heading a. */
    cellHeading(id, a) {
      const m = this.M[id];
      if (!m) return a;
      const i = this.angleIndex(id, a);
      return m.headings ? m.headings[i] : (i * TAU) / m.angles;
    },
    /** Like draw(), but keeps the model's PIVOT (turret base) fixed at (x, y) while it turns.
        pivot = distance (world px) of the base from the bake anchor along the model's own heading
        (measured from the atlas); uses the quantised cell heading so the base never jitters. */
    drawPivot(ctx, id, x, y, a, pivot, iso = 0.6, k = 1) {
      const h = this.cellHeading(id, a);
      return this.draw(ctx, id, x - Math.cos(h) * pivot * k, y - Math.sin(h) * pivot * iso * k, a, 0, k);
    },
    drawIndex(ctx, id, x, y, idx, k = 1) {
      const m = this.M[id];
      if (!m) return false;
      const c = m.cells[idx] || m.cells[0];
      const s = k / m.res;
      ctx.drawImage(this.pages[c[0]], c[1], c[2], m.cw, m.ch, x - m.ax * s, y - m.ay * s, m.cw * s, m.ch * s);
      return true;
    },
    /** Draw a side-view projectile sprite (nose = +x) rotated to screen angle ang, scaled to length len. */
    drawRot(ctx, id, x, y, ang, len) {
      const m = this.M[id];
      if (!m) return false;
      const k = len ? len / Math.max(1, m.size[0], m.size[2]) : 1;
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(ang);
      const s = k / m.res;
      // centre the sprite on its bounding box (projectiles have no "ground")
      const c = m.cells[0];
      ctx.drawImage(this.pages[c[0]], c[1], c[2], m.cw, m.ch, -m.cw * s / 2, -m.ch * s / 2, m.cw * s, m.ch * s);
      ctx.restore();
      return true;
    },
    /** World height (px) of the model. */
    height(id) { const m = this.M[id]; return m ? m.size[1] : 0; },
    /** Standalone canvas of one cell (for the pre-built prop sprites). */
    cell(id, idx = 0) {
      const key = id + '#' + idx;
      if (this.cells[key]) return this.cells[key];
      const m = this.M[id];
      if (!m) return null;
      const c = document.createElement('canvas');
      c.width = m.cw; c.height = m.ch;
      const q = m.cells[idx] || m.cells[0];
      c.getContext('2d').drawImage(this.pages[q[0]], q[1], q[2], m.cw, m.ch, 0, 0, m.cw, m.ch);
      return (this.cells[key] = { img: c, w: m.cw / m.res, h: m.ch / m.res, ay: m.ay / m.ch, ax: m.ax / m.cw });
    },
    count(id) { const m = this.M[id]; return m ? m.angles * m.frames : 0; },
  };

  TD.S3 = S3;
})(window.TD);
