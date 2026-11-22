/* =========================================================
   AssetLoader.js
   - Loads every image listed in MANIFEST from assets/images/.
   - Any file that is missing / broken is marked as "fallback";
     entities then draw themselves with programmatic cartoon
     vector shapes (see TD.Draw helpers below).
   - To swap art: just drop a PNG with the same file name into
     the matching folder. No code change required.
   ========================================================= */
window.TD = window.TD || {};

(function (TD) {
  'use strict';

  /** key -> path. Keys are what the game code asks for. */
  const MANIFEST = {
    // Tower (one sprite per tier — drop tower_tier0..3.png to replace the vector fortress)
    tower_tier0: 'assets/images/tower/tower_tier0.png',
    tower_tier1: 'assets/images/tower/tower_tier1.png',
    tower_tier2: 'assets/images/tower/tower_tier2.png',
    tower_tier3: 'assets/images/tower/tower_tier3.png',
    // Enemies (anchor = feet / bottom-center, facing RIGHT)
    knife:    'assets/images/enemies/knife.png',
    ak:       'assets/images/enemies/ak.png',
    sniper:   'assets/images/enemies/sniper.png',
    biker:    'assets/images/enemies/biker.png',
    tank:     'assets/images/enemies/tank.png',
    drone:    'assets/images/enemies/drone.png',
    katyusha: 'assets/images/enemies/katyusha.png',
    boss:     'assets/images/enemies/boss.png',
    // Environment
    map:         'assets/images/environment/Map.webp',   // full battlefield texture (pad at the centre)
    ground_tile: 'assets/images/environment/ground_tile.png',
    prop_border: 'assets/images/environment/prop_border.png',
    crate:       'assets/images/environment/crate.png',
    // UI (icons are optional — emoji are used otherwise)
    health_bar:      'assets/images/ui/health_bar.png',
    icon_gold:       'assets/images/ui/icon_gold.png',
    icon_artillery:  'assets/images/ui/icon_artillery.png',
    icon_emp:        'assets/images/ui/icon_emp.png',
    icon_repair:     'assets/images/ui/icon_repair.png',
    icon_decoy:      'assets/images/ui/icon_decoy.png',
  };

  class AssetLoader {
    constructor() {
      this.images = {};   // key -> HTMLImageElement | null
      this.status = {};   // key -> 'loaded' | 'fallback'
    }

    /** Load a single image. Always resolves (never rejects). */
    load(key, src, timeoutMs = 3500) {
      return new Promise((resolve) => {
        const img = new Image();
        let settled = false;
        const finish = (ok) => {
          if (settled) return;
          settled = true;
          this.images[key] = ok ? img : null;
          this.status[key] = ok ? 'loaded' : 'fallback';
          resolve(ok);
        };
        img.onload = () => finish(img.naturalWidth > 0);
        img.onerror = () => finish(false);
        setTimeout(() => finish(false), timeoutMs);
        img.src = src;
      });
    }

    /** Load all manifest entries in parallel. */
    async loadAll() {
      const keys = Object.keys(MANIFEST);
      await Promise.all(keys.map((k) => this.load(k, MANIFEST[k])));
      const loaded = keys.filter((k) => this.status[k] === 'loaded').length;
      return { loaded, total: keys.length };
    }

    has(key) { return !!this.images[key]; }
    get(key) { return this.images[key] || null; }

    /** Draw sprite anchored at bottom-center (feet). Returns false if missing. */
    drawSprite(ctx, key, x, y, w, h) {
      const img = this.images[key];
      if (!img) return false;
      if (h == null) h = w * (img.naturalHeight / img.naturalWidth);
      ctx.drawImage(img, x - w / 2, y - h, w, h);
      return true;
    }
  }

  /* ---------------------------------------------------------
     Shared cartoon drawing helpers for the vector fallbacks
     --------------------------------------------------------- */
  const INK = '#14181a';

  function shade(hex, amt) {
    // amt -1..1 : darken (<0) / lighten (>0)
    let c = hex.replace('#', '');
    if (c.length === 3) c = c.split('').map((ch) => ch + ch).join('');
    const n = parseInt(c, 16);
    let r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
    const t = amt < 0 ? 0 : 255;
    const p = Math.abs(amt);
    r = Math.round((t - r) * p + r);
    g = Math.round((t - g) * p + g);
    b = Math.round((t - b) * p + b);
    return '#' + ((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1);
  }

  /** Soft radial sprites, cached per color (fast smoke / glow). */
  const blobCache = new Map();
  function blob(color, hard = 0.0) {
    const key = color + '|' + hard;
    let c = blobCache.get(key);
    if (c) return c;
    c = document.createElement('canvas');
    c.width = c.height = 64;
    const x = c.getContext('2d');
    const g = x.createRadialGradient(32, 32, 0, 32, 32, 32);
    const rgb = hexToRgb(color);
    g.addColorStop(0, `rgba(${rgb},1)`);
    g.addColorStop(Math.max(0.05, hard), `rgba(${rgb},${hard > 0 ? 1 : 0.85})`);
    g.addColorStop(1, `rgba(${rgb},0)`);
    x.fillStyle = g;
    x.fillRect(0, 0, 64, 64);
    blobCache.set(key, c);
    return c;
  }
  function hexToRgb(hex) {
    let c = hex.replace('#', '');
    if (c.length === 3) c = c.split('').map((ch) => ch + ch).join('');
    const n = parseInt(c, 16);
    return `${(n >> 16) & 255},${(n >> 8) & 255},${n & 255}`;
  }

  const Draw = {
    INK,
    shade,
    blob,
    hexToRgb,

    /** Metallic linear gradient across a horizontal span. */
    metal(ctx, x0, x1, base) {
      const g = ctx.createLinearGradient(x0, 0, x1, 0);
      g.addColorStop(0, shade(base, -0.35));
      g.addColorStop(0.28, shade(base, 0.22));
      g.addColorStop(0.55, base);
      g.addColorStop(1, shade(base, -0.5));
      return g;
    },

    /** Row of rivets along a line. */
    rivets(ctx, x0, y0, x1, y1, n, r = 1.6) {
      ctx.fillStyle = 'rgba(255,255,255,0.35)';
      for (let i = 0; i <= n; i++) {
        const t = i / n;
        ctx.beginPath(); ctx.arc(x0 + (x1 - x0) * t, y0 + (y1 - y0) * t, r, 0, Math.PI * 2); ctx.fill();
      }
      ctx.fillStyle = 'rgba(0,0,0,0.45)';
      for (let i = 0; i <= n; i++) {
        const t = i / n;
        ctx.beginPath(); ctx.arc(x0 + (x1 - x0) * t + 0.6, y0 + (y1 - y0) * t + 0.6, r * 0.7, 0, Math.PI * 2); ctx.fill();
      }
    },

    shadow(ctx, x, y, rx, ry, alpha = 0.28) {
      ctx.save();
      ctx.fillStyle = `rgba(8,10,6,${alpha})`;
      ctx.beginPath();
      ctx.ellipse(x, y, Math.max(1, rx), Math.max(1, ry), 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    },

    ellipse(ctx, x, y, rx, ry, fill, stroke = INK, lw = 4) {
      ctx.beginPath();
      ctx.ellipse(x, y, Math.max(0.5, rx), Math.max(0.5, ry), 0, 0, Math.PI * 2);
      if (fill) { ctx.fillStyle = fill; ctx.fill(); }
      if (stroke && lw > 0) { ctx.lineWidth = lw; ctx.strokeStyle = stroke; ctx.stroke(); }
    },

    circle(ctx, x, y, r, fill, stroke = INK, lw = 4) {
      Draw.ellipse(ctx, x, y, r, r, fill, stroke, lw);
    },

    roundRect(ctx, x, y, w, h, r) {
      r = Math.min(r, w / 2, h / 2);
      ctx.beginPath();
      ctx.moveTo(x + r, y);
      ctx.arcTo(x + w, y, x + w, y + h, r);
      ctx.arcTo(x + w, y + h, x, y + h, r);
      ctx.arcTo(x, y + h, x, y, r);
      ctx.arcTo(x, y, x + w, y, r);
      ctx.closePath();
    },

    /** A soft glossy highlight on a round body. */
    gloss(ctx, x, y, rx, ry, alpha = 0.45) {
      ctx.save();
      ctx.fillStyle = `rgba(255,255,255,${alpha})`;
      ctx.beginPath();
      ctx.ellipse(x - rx * 0.35, y - ry * 0.45, rx * 0.32, ry * 0.2, -0.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    },

    /**
     * Cute cartoon eyes.
     * opts: look (-1..1 horizontal), angry, closed, scared, blink(0..1)
     */
    eyes(ctx, x, y, s, opts = {}) {
      const gap = s * 1.15;
      const look = opts.look || 0;
      const lookY = opts.lookY || 0;
      const blink = opts.blink || 0;
      for (const side of [-1, 1]) {
        const ex = x + side * gap * 0.5;
        if (opts.closed || blink > 0.6) {
          ctx.beginPath();
          ctx.lineWidth = Math.max(2, s * 0.22);
          ctx.strokeStyle = INK;
          ctx.lineCap = 'round';
          ctx.arc(ex, y, s * 0.42, 0.15 * Math.PI, 0.85 * Math.PI);
          ctx.stroke();
          continue;
        }
        const ry = s * 0.62 * (opts.scared ? 1.15 : 1);
        Draw.ellipse(ctx, ex, y, s * 0.5, ry, '#ffffff', INK, Math.max(1.5, s * 0.16));
        const pr = s * (opts.scared ? 0.18 : 0.27);
        ctx.fillStyle = INK;
        ctx.beginPath();
        ctx.arc(ex + look * s * 0.18, y + s * 0.1 + lookY * s * 0.15, pr, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#fff';
        ctx.beginPath();
        ctx.arc(ex + look * s * 0.18 - pr * 0.35, y + s * 0.1 - pr * 0.4, pr * 0.38, 0, Math.PI * 2);
        ctx.fill();
        if (opts.angry) {
          ctx.beginPath();
          ctx.lineWidth = Math.max(2.5, s * 0.24);
          ctx.strokeStyle = INK;
          ctx.lineCap = 'round';
          ctx.moveTo(ex - side * s * 0.6, y - ry - s * 0.25);
          ctx.lineTo(ex + side * s * 0.35, y - ry + s * 0.12);
          ctx.stroke();
        }
      }
    },

    /** Small health bar above units. */
    hpBar(ctx, x, y, w, pct, color = '#5fd35f') {
      const h = 7;
      ctx.fillStyle = INK;
      Draw.roundRect(ctx, x - w / 2 - 2, y - 2, w + 4, h + 4, 5);
      ctx.fill();
      ctx.fillStyle = '#2a1414';
      Draw.roundRect(ctx, x - w / 2, y, w, h, 3);
      ctx.fill();
      ctx.fillStyle = pct > 0.5 ? color : pct > 0.25 ? '#ffc93c' : '#ff4d4d';
      Draw.roundRect(ctx, x - w / 2, y, Math.max(0, w * pct), h, 3);
      ctx.fill();
    },
  };

  TD.ASSET_MANIFEST = MANIFEST;
  TD.Assets = new AssetLoader();
  TD.Draw = Draw;
  TD.util = {
    rand: (a, b) => a + Math.random() * (b - a),
    randInt: (a, b) => Math.floor(a + Math.random() * (b - a + 1)),
    pick: (arr) => arr[Math.floor(Math.random() * arr.length)],
    clamp: (v, a, b) => (v < a ? a : v > b ? b : v),
    lerp: (a, b, t) => a + (b - a) * t,
    dist: (ax, ay, bx, by) => Math.hypot(ax - bx, ay - by),
    lerpAngle(a, b, t) {
      let d = ((b - a + Math.PI) % (Math.PI * 2)) - Math.PI;
      if (d < -Math.PI) d += Math.PI * 2;
      return a + d * t;
    },
  };
})(window.TD);
