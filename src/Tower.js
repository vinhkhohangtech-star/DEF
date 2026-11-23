/* =========================================================
   Tower.js — the Tactical Fortress
   • Tier 0..3 modular evolution (bunker → 3-story command center)
   • 6 gold-shop stats driven by TD.CFG.stats (Skill Game)
   • Auxiliary weapons (cards), red-line branch, perimeter wall
   • Wall + animated Combat Engineers live here too
   ========================================================= */
(function (TD) {
  'use strict';
  const { rand, dist, clamp } = TD.util;
  const D = TD.Draw;
  const STAT_MAX = 15;
  const AUX_MAX = 10;
  const TIER_H = [78, 126, 170, 212];
  const TOP_SCALE = [1, 0.93, 0.87, 0.82];
  /** Deck height (where turrets sit). With a baked 3D tower model, it follows the model's roof. */
  const DECK_K = [0.86, 0.80, 0.70, 0.84];
  /** 🖼️ Custom tower PNGs (assets/images/tower/tower_tier0..3.png), measured in image px:
      w/h = file size it was measured on, crop = last row of the tower (caption text below is cut off),
      gy = ground centre (base on the pad), dy = centre of the roof deck, rim = half-width of the roof rim.
      If the user swaps a PNG for one of a different size, a generic estimate is used. */
  const PNG_META = [
    { w: 611, h: 675, crop: 527, gy: 389, dy: 123, rim: 247 },
    { w: 612, h: 886, crop: 738, gy: 600, dy: 124, rim: 250 },
    { w: 616, h: 1175, crop: 1027, gy: 888, dy: 128, rim: 259 },
    { w: 592, h: 1394, crop: 1260, gy: 1143, dy: 129, rim: 260 },
  ];
  const DECK_RIM = 62;   // screen half-width of the roof rim at tier 0 (× TOP_SCALE for higher tiers)
  function towerPng(i) {
    const img = TD.Assets && TD.Assets.get('tower_tier' + i);
    if (!img || !(img.naturalWidth > 0)) return null;
    const iw = img.naturalWidth, ih = img.naturalHeight;
    let m = PNG_META[i];
    if (!m || m.w !== iw || m.h !== ih) m = { crop: ih, gy: ih - iw * 0.22, dy: iw * 0.2, rim: iw * 0.41 };
    const s = (DECK_RIM * TOP_SCALE[i]) / m.rim;
    return { img, iw, m, s, deck: (m.gy - m.dy) * s };
  }
  function tierH(i) {
    const png = towerPng(i);
    if (png) return Math.round(png.deck);
    const id = 'tower_tier' + i;
    if (TD.S3 && TD.S3.has(id)) return Math.round(TD.S3.height(id) * DECK_K[i]);
    return TIER_H[i];
  }
  const STAT_COST = { dmg: 40, rate: 45, armor: 50, regen: 42, range: 35, crit: 48 };

  /* =========================================================
     PERIMETER WALL + COMBAT ENGINEERS
     ========================================================= */
  const WALL_LV = [
    { name: 'Bao Cát', hp: 140, h: 20, base: '#b59a62', dark: '#7d6a40' },
    { name: 'Bê Tông', hp: 300, h: 27, base: '#9a9c98', dark: '#5f625f' },
    { name: 'Thép Titan', hp: 560, h: 33, base: '#7b93a8', dark: '#3e5162' },
  ];

  class Wall {
    constructor(tower) {
      this.tower = tower; this.game = tower.game;
      this.R = 168; this.N = 20; this.lv = 0;
      this.segs = [];
      for (let i = 0; i < this.N; i++) this.segs.push({ i, hp: 0, max: 1, flash: 0 });
      this.engineers = [];
    }
    get spec() { return WALL_LV[Math.max(0, this.lv - 1)]; }
    get segMax() { return Math.round(this.spec.hp * (1 + 0.15 * (this.tower.aux.wall || 0))); }
    setLevel(lv) {
      const first = this.lv === 0;
      this.lv = lv;
      this.refreshMax(true);
      if (first) for (const s of this.segs) s.hp = s.max;
      while (this.engineers.length < lv) {
        const a = rand(0, Math.PI * 2);
        this.engineers.push({ a, target: null, t: rand(0, 5), work: 0, dir: 1 });
      }
    }
    refreshMax(heal) {
      const m = this.segMax;
      for (const s of this.segs) {
        const k = s.max > 1 ? s.hp / s.max : 1;
        s.max = m;
        s.hp = heal ? Math.min(m, Math.max(s.hp, m * Math.max(k, 0.5))) : Math.min(m, s.hp);
      }
    }
    repairAll() { for (const s of this.segs) s.hp = s.max; }
    segIndex(a) { const k = ((a % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2); return Math.floor((k / (Math.PI * 2)) * this.N) % this.N; }
    segAt(a) { const s = this.segs[this.segIndex(a)]; return s && s.hp > 0 ? s : null; }
    segMid(s) { return ((s.i + 0.5) / this.N) * Math.PI * 2; }
    damage(s, amount) {
      if (!s || s.hp <= 0) return;
      s.hp -= amount;
      s.flash = 1;
      const a = this.segMid(s);
      const g = this.game;
      g.particles.debris(Math.cos(a) * this.R, Math.sin(a) * this.R, 18, { count: 2, color: this.spec.dark, speed: 120, size: 3 });
      if (s.hp <= 0) {
        s.hp = 0;
        g.particles.smoke(Math.cos(a) * this.R, Math.sin(a) * this.R, 10, { count: 6, size: 14, color: '#8a8070', life: 1 });
        g.particles.debris(Math.cos(a) * this.R, Math.sin(a) * this.R, 18, { count: 7, color: this.spec.dark, speed: 200, size: 5 });
        g.audio.play('wallbreak');
      }
    }
    get pct() { let h = 0, m = 0; for (const s of this.segs) { h += s.hp; m += s.max; } return m ? h / m : 0; }
    update(dt) {
      if (!this.lv) return;
      for (const s of this.segs) s.flash = Math.max(0, s.flash - dt * 5);
      const taken = new Set();
      const rate = 20 + this.lv * 8;
      for (const en of this.engineers) {
        en.t += dt;
        // pick the most damaged segment nobody else is fixing
        if (!en.target || en.target.hp >= en.target.max) {
          let best = null, bk = 0.999;
          for (const s of this.segs) {
            if (taken.has(s)) continue;
            const k = s.hp / s.max;
            if (k < bk) { bk = k; best = s; }
          }
          en.target = best;
        }
        if (en.target) taken.add(en.target);
        if (!en.target) { en.a += dt * 0.15 * en.dir; en.work = 0; continue; }
        const goal = this.segMid(en.target);
        let d = ((goal - en.a + Math.PI) % (Math.PI * 2)) - Math.PI;
        if (d < -Math.PI) d += Math.PI * 2;
        const step = dt * 1.1;
        if (Math.abs(d) > 0.05) {
          en.a += Math.sign(d) * Math.min(step, Math.abs(d));
          en.dir = Math.sign(d);
          en.work = 0;
        } else {
          en.work += dt;
          en.target.hp = Math.min(en.target.max, en.target.hp + rate * dt);
          if (Math.random() < dt * 8) {
            const R = this.R - 8;
            this.game.particles.sparks(Math.cos(en.a) * R, Math.sin(en.a) * R, 16, { count: 2, color: '#ffe08a', speed: 90, life: 0.2 });
          }
        }
      }
    }
    /** Depth-sorted draw items for the game's render list. */
    /* (Wall) */
    renderItems(ctx, list) {
      if (!this.lv) return;
      for (const s of this.segs) {
        const a = this.segMid(s);
        list.push({ y: Math.sin(a) * this.R + (Math.sin(a) > 0 ? 2 : 0), d: () => this.drawSeg(ctx, s) });
      }
      for (const en of this.engineers) {
        const R = this.R - 26;
        list.push({ y: Math.sin(en.a) * R, d: () => this.drawEngineer(ctx, en, R) });
      }
    }
    drawSeg(ctx, s) {
      const g = this.game;
      const sp = this.spec;
      const wid = ['wall_sandbag', 'wall_concrete', 'wall_titan'][this.lv - 1];
      if (s.hp > 0 && TD.S3 && TD.S3.has(wid)) {
        const mid = this.segMid(s), k = s.hp / s.max;
        const p = g.project(Math.cos(mid) * this.R, Math.sin(mid) * this.R, 0);
        const N = TD.S3.count(wid);
        TD.S3.drawIndex(ctx, wid, p.x, p.y, Math.floor(((s.i + 0.5) / this.N) * N) % N);
        if (s.flash > 0) { ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = s.flash * 0.5; ctx.drawImage(D.blob('#ff5030'), p.x - 30, p.y - 40, 60, 46); ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over'; }
        if (k < 0.99) {
          const c = g.project(Math.cos(mid) * this.R, Math.sin(mid) * this.R, TD.S3.height(wid) + 10);
          ctx.fillStyle = 'rgba(0,0,0,0.6)'; ctx.fillRect(c.x - 11, c.y, 22, 4);
          ctx.fillStyle = k > 0.5 ? '#7dff6a' : k > 0.25 ? '#ffc93c' : '#ff4d4d'; ctx.fillRect(c.x - 11, c.y, 22 * k, 4);
        }
        return;
      }
      const gap = 0.012;
      const a0 = (s.i / this.N) * Math.PI * 2 + gap, a1 = ((s.i + 1) / this.N) * Math.PI * 2 - gap;
      const mid = (a0 + a1) / 2;
      const front = Math.sin(mid) > 0;
      const k = s.hp / s.max;
      if (s.hp <= 0) {
        // rubble
        for (let j = 0; j < 4; j++) {
          const a = a0 + (a1 - a0) * (j + 0.5) / 4;
          const p = g.project(Math.cos(a) * this.R, Math.sin(a) * this.R, 0);
          D.ellipse(ctx, p.x, p.y, 7, 3.5, sp.dark, null, 0);
        }
        return;
      }
      const h = sp.h * (0.45 + 0.55 * k);
      const Rf = front ? this.R + 6 : this.R - 6;
      const steps = 4;
      const bot = [], top = [], tin = [], tout = [];
      for (let j = 0; j <= steps; j++) {
        const a = a0 + (a1 - a0) * (j / steps);
        bot.push(g.project(Math.cos(a) * Rf, Math.sin(a) * Rf, 0));
        top.push(g.project(Math.cos(a) * Rf, Math.sin(a) * Rf, h));
        tin.push(g.project(Math.cos(a) * (this.R - 6), Math.sin(a) * (this.R - 6), h));
        tout.push(g.project(Math.cos(a) * (this.R + 6), Math.sin(a) * (this.R + 6), h));
      }
      // face
      const light = 0.15 * Math.cos(mid - 2.3);
      ctx.fillStyle = D.shade(sp.base, (front ? -0.05 : -0.22) + light);
      ctx.beginPath();
      bot.forEach((p, j) => (j ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
      for (let j = top.length - 1; j >= 0; j--) ctx.lineTo(top[j].x, top[j].y);
      ctx.closePath(); ctx.fill();
      // texture
      ctx.save(); ctx.clip();
      if (this.lv === 1) {
        ctx.strokeStyle = 'rgba(60,45,20,0.55)'; ctx.lineWidth = 1.2;
        for (let r = 1; r < 3; r++) {
          ctx.beginPath();
          bot.forEach((p, j) => { const y = p.y - (h * r) / 3; j ? ctx.lineTo(p.x, y) : ctx.moveTo(p.x, y); });
          ctx.stroke();
        }
        for (let j = 0; j < bot.length; j++) {
          for (let r = 0; r < 3; r++) {
            const x = bot[j].x + (r % 2 ? 6 : 0), y = bot[j].y - (h * (r + 0.5)) / 3;
            ctx.fillStyle = 'rgba(255,240,200,0.18)';
            ctx.beginPath(); ctx.ellipse(x, y - 1, 5, 2, 0, 0, Math.PI * 2); ctx.fill();
          }
        }
      } else if (this.lv === 2) {
        ctx.strokeStyle = 'rgba(30,30,30,0.35)'; ctx.lineWidth = 1;
        ctx.beginPath();
        bot.forEach((p, j) => { const y = p.y - h / 2; j ? ctx.lineTo(p.x, y) : ctx.moveTo(p.x, y); });
        ctx.stroke();
        for (let j = 0; j < bot.length; j += 2) { ctx.beginPath(); ctx.moveTo(bot[j].x, bot[j].y); ctx.lineTo(top[j].x, top[j].y); ctx.stroke(); }
        ctx.fillStyle = 'rgba(255,210,0,0.55)';
        ctx.fillRect(Math.min(bot[0].x, bot[steps].x), bot[2].y - h * 0.85, Math.abs(bot[steps].x - bot[0].x), 3);
      } else {
        const gr = ctx.createLinearGradient(0, top[2].y, 0, bot[2].y);
        gr.addColorStop(0, 'rgba(255,255,255,0.35)'); gr.addColorStop(0.4, 'rgba(255,255,255,0)'); gr.addColorStop(1, 'rgba(0,0,0,0.25)');
        ctx.fillStyle = gr; ctx.fillRect(Math.min(bot[0].x, bot[steps].x) - 2, top[2].y - 10, Math.abs(bot[steps].x - bot[0].x) + 4, h + 20);
        D.rivets(ctx, bot[0].x, bot[0].y - h * 0.3, bot[steps].x, bot[steps].y - h * 0.3, 3, 1.1);
        ctx.strokeStyle = 'rgba(140,220,255,0.6)'; ctx.lineWidth = 1.2;
        ctx.beginPath(); top.forEach((p, j) => (j ? ctx.lineTo(p.x, p.y + 2) : ctx.moveTo(p.x, p.y + 2))); ctx.stroke();
      }
      if (k < 0.5) {
        ctx.strokeStyle = 'rgba(0,0,0,0.55)'; ctx.lineWidth = 1.5;
        const c = bot[2];
        ctx.beginPath(); ctx.moveTo(c.x - 4, c.y - h); ctx.lineTo(c.x + 2, c.y - h * 0.6); ctx.lineTo(c.x - 3, c.y - h * 0.3); ctx.stroke();
      }
      ctx.restore();
      // top strip
      ctx.fillStyle = D.shade(sp.base, 0.18 + light);
      ctx.beginPath();
      tout.forEach((p, j) => (j ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
      for (let j = tin.length - 1; j >= 0; j--) ctx.lineTo(tin[j].x, tin[j].y);
      ctx.closePath(); ctx.fill();
      if (s.flash > 0) {
        ctx.globalAlpha = s.flash * 0.6;
        ctx.fillStyle = '#ff5030';
        ctx.fill();
        ctx.globalAlpha = 1;
      }
      // small hp tick when damaged
      if (k < 0.99) {
        const c = g.project(Math.cos(mid) * this.R, Math.sin(mid) * this.R, h + 12);
        ctx.fillStyle = 'rgba(0,0,0,0.6)'; ctx.fillRect(c.x - 11, c.y, 22, 4);
        ctx.fillStyle = k > 0.5 ? '#7dff6a' : k > 0.25 ? '#ffc93c' : '#ff4d4d';
        ctx.fillRect(c.x - 11, c.y, 22 * k, 4);
      }
    }
    drawEngineer(ctx, en, R) {
      const g = this.game;
      const s = g.project(Math.cos(en.a) * R, Math.sin(en.a) * R, 0);
      const walking = en.work === 0 && en.target;
      const bob = walking ? Math.abs(Math.sin(en.t * 10)) * 2 : 0;
      D.shadow(ctx, s.x, s.y, 7, 3, 0.3);
      if (TD.S3 && TD.S3.has('engineer')) {
        const head = en.work > 0 ? en.a + Math.PI : en.a + (en.dir >= 0 ? Math.PI / 2 : -Math.PI / 2);
        TD.S3.draw(ctx, 'engineer', s.x, s.y - bob, head);
        if (en.work > 0 && Math.random() < 0.3) { ctx.fillStyle = '#ffe08a'; ctx.fillRect(s.x + Math.random() * 8 - 4, s.y - 12 + Math.random() * 6, 2, 2); }
        return;
      }
      ctx.save();
      ctx.translate(s.x, s.y - bob);
      ctx.scale(en.dir < 0 ? -1 : 1, 1);
      // legs
      const st = walking ? Math.sin(en.t * 10) * 3 : 0;
      ctx.strokeStyle = '#3d4530'; ctx.lineWidth = 3; ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(-2, -9); ctx.lineTo(-2 + st, 0); ctx.moveTo(2, -9); ctx.lineTo(2 - st, 0); ctx.stroke();
      // body (orange hi-vis vest)
      ctx.fillStyle = '#ff8a1e';
      D.roundRect(ctx, -5, -19, 10, 11, 3); ctx.fill();
      ctx.fillStyle = '#e8f0ff'; ctx.fillRect(-5, -15, 10, 1.5);
      // head + yellow hard hat
      ctx.fillStyle = '#e0b48a';
      ctx.beginPath(); ctx.arc(0, -22, 3.5, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#ffd400';
      ctx.beginPath(); ctx.arc(0, -23.5, 4.2, Math.PI, 0); ctx.fill(); ctx.fillRect(-5.5, -24, 11, 1.6);
      // wrench arm
      const sw = en.work > 0 ? Math.sin(en.t * 18) * 0.9 : 0.3;
      ctx.save(); ctx.translate(4, -16); ctx.rotate(sw);
      ctx.strokeStyle = '#ff8a1e'; ctx.lineWidth = 2.5;
      ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(6, 3); ctx.stroke();
      ctx.strokeStyle = '#b8c0c8'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(6, 3); ctx.lineTo(11, 1); ctx.stroke();
      ctx.restore();
      ctx.restore();
    }
  }

  /* =========================================================
     TOWER
     ========================================================= */
  class Tower {
    constructor(game) {
      this.game = game;
      this.x = 0; this.y = 0;
      this.radius = 62;
      this.tier = 0;
      this.hDisp = tierH(0);
      this.lv = { dmg: 0, rate: 0, armor: 0, regen: 0, range: 0, crit: 0 };
      this.aux = { rocket: 0, tesla: 0, sam: 0, laser: 0, wall: 0, uav: 0, railgun: 0, aegis: 0, flamer: 0, gas: 0, barbed: 0 };
      this.searchA = 0;
      this.cards = {};
      this.branchId = null;
      this.branch = null;
      this.hp = this.maxHp;
      this.flash = 0; this.squash = 0; this.smokeT = 0; this.radarA = 0; this.t = 0;
      this.minigun = new TD.Weapons.Minigun(this);
      this.auxWeapons = [];
      this.subTurrets = [];        // 🎯 'multi' card: independent auxiliary sub-turrets
      this.wall = new Wall(this);
    }

    get cfg() { return TD.CFG.stats; }
    get height() { return this.hDisp; }
    get topScale() { return TOP_SCALE[this.tier]; }
    mountPos(m) { const k = this.topScale; return { x: this.x + m.ox * k, y: this.y + m.oy * k, z: this.hDisp }; }

    /* ----- stats ----- */
    lab(k) { return TD.TechLab ? TD.TechLab.bonus(k) : 0; }
    get damage() { const c = this.cfg.dmg; return c.base * (1 + this.lab('dmg')) * (1 + (c.gain / 100) * this.lv.dmg); }
    get fireRate() {
      const c = this.cfg.rate;
      return c.base * (1 + this.lab('rate')) * (1 + (c.gain / 100) * this.lv.rate) * (1 + 0.2 * (this.cards.rate || 0)) * (this.cards.overclock ? 2 : 1);
    }
    /** 📡 EW jammers cut the Minigun's range. */
    get range() { const c = this.cfg.range; return c.base * (1 + (c.gain / 100) * this.lv.range) * (1 - (this.game.jamFactor || 0)); }
    get armorPct() { const c = this.cfg.armor; return clamp(c.base + c.gain * this.lv.armor + this.lab('armor'), 0, 80); }
    get regen() { const c = this.cfg.regen; return c.base + c.gain * this.lv.regen; }
    get critChance() { const c = this.cfg.crit; return clamp(c.base + c.gain * this.lv.crit, 0, 100) / 100; }
    get critMult() { return 2.5; }
    get maxHp() { return 600 + this.tier * 250 + this.lab('hp'); }
    get aegis() { return this.auxWeapons.find((w) => w.id === 'aegis') || null; }
    get barbed() { return this.auxWeapons.find((w) => w.id === 'barbed') || null; }
    aux$(id) { return this.auxWeapons.find((w) => w.id === id) || null; }

    statValue(stat) {
      switch (stat) {
        case 'dmg': return this.damage.toFixed(1);
        case 'rate': return this.fireRate.toFixed(1) + '/s';
        case 'armor': return Math.round(this.armorPct) + '%';
        case 'regen': return this.regen.toFixed(1) + '/s';
        case 'range': return Math.round(this.range);
        case 'crit': return Math.round(this.critChance * 100) + '%';
      }
      return '';
    }
    upgradeCost(stat) {
      const lv = this.lv[stat];
      if (lv >= STAT_MAX) return Infinity;
      return Math.round(STAT_COST[stat] * Math.pow(1.42, lv));
    }
    upgrade(stat) { this.lv[stat]++; }

    auxCost(id) {
      if (!(this.cards[id] > 0)) return Infinity;
      const lv = this.aux[id];
      if (lv >= AUX_MAX) return Infinity;
      return Math.round((id === 'wall' ? 60 : ['uav', 'railgun', 'aegis', 'flamer', 'gas', 'barbed'].includes(id) ? 80 : 70) * Math.pow(1.5, lv));
    }
    upgradeAux(id) {
      this.aux[id]++;
      if (id === 'wall') this.wall.refreshMax(true);
    }

    /* ----- progression ----- */
    addCard(id) {
      const def = (TD.CARDS || []).find((c) => c.id === id);
      this.cards[id] = Math.min(def && def.max ? def.max : 3, (this.cards[id] || 0) + 1);
      const Cls = TD.Weapons.AUX_CLASSES[id];
      if (Cls && !this.auxWeapons.some((w) => w.id === id)) this.auxWeapons.push(new Cls(this));
      if (id === 'wall') this.wall.setLevel(this.cards.wall);
      if (id === 'multi') this.syncSubTurrets();
    }
    /** 🎯 Bắn Nhiều Đối Tượng Lv1/2/3 → 1/2/3 sub-turrets spaced evenly round the roof rim. */
    syncSubTurrets() {
      const n = Math.min(3, this.cards.multi || 0);
      const old = this.subTurrets;
      this.subTurrets = [];
      for (let i = 0; i < n; i++) {
        const a = Math.PI / 2 + (n === 2 ? (i ? 0.55 : -0.55) : (i * Math.PI * 2) / n);
        const mount = { ox: Math.round(Math.cos(a) * 56), oy: Math.round(Math.sin(a) * 56) };
        const st = old[i] || new TD.Weapons.SubTurret(this, i);
        st.mount = mount; st.slot = i;
        this.subTurrets.push(st);
      }
    }
    setBranch(id) {
      this.branchId = id;
      this.branch = new TD.Weapons.BRANCH_CLASSES[id](this);
      this.branch.setLevel(Math.max(1, this.tier));
    }
    tierUp() {
      if (this.tier >= 3) return false;
      const before = this.maxHp;
      this.tier++;
      this.hp = Math.min(this.maxHp, this.hp + (this.maxHp - before) + 150);
      if (this.branch) this.branch.setLevel(this.tier);
      return true;
    }

    takeDamage(amount, attacker) {
      const g = this.game;
      if (g.state !== 'playing' || this.hp <= 0) return;
      const dmg = Math.max(1, amount * (1 - this.armorPct / 100));
      this.hp -= dmg;
      this.flash = 1;
      this.squash = Math.min(1, this.squash + 0.35);
      g.ui.float(this.x + rand(-40, 40), this.y + 20, this.height * 0.7, '-' + Math.round(dmg), 'hurt');
      g.ui.towerHurt();
      if (this.hp <= 0) { this.hp = 0; g.gameOver(); }
    }
    heal(amount) {
      const before = this.hp;
      this.hp = Math.min(this.maxHp, this.hp + amount);
      return this.hp - before;
    }

    update(dt) {
      this.t += dt;
      this.flash = Math.max(0, this.flash - dt * 5);
      this.squash = Math.max(0, this.squash - dt * 4);
      this.radarA += dt * 2.2;
      this.hDisp += (tierH(this.tier) - this.hDisp) * Math.min(1, dt * 2.5);
      if (this.regen > 0) this.heal(this.regen * dt);
      this.minigun.update(dt);
      for (const st of this.subTurrets) st.update(dt);
      for (const w of this.auxWeapons) w.update(dt);
      if (this.branch) this.branch.update(dt);
      this.wall.update(dt);
      // 🔦 Tier 2+ searchlight sweeps the field and exposes cloaked infiltrators
      if (this.tier >= 2) {
        this.searchA += dt * 0.85;
        for (const e of this.game.enemies) {
          if (!e.cloaked || e.dead) continue;
          const d = Math.hypot(e.x - this.x, e.y - this.y);
          if (d > 460) continue;
          let da = Math.atan2(e.y - this.y, e.x - this.x) - this.searchA;
          da = Math.atan2(Math.sin(da), Math.cos(da));
          if (Math.abs(da) < 0.17) { e.reveal(); e.zapT = 1.4; }   // ⚡ caught in the beam → electric silhouette
        }
      }
      if (Math.abs(tierH(this.tier) - this.hDisp) > 3 && Math.random() < 0.5) {
        const a = rand(0, Math.PI * 2);
        this.game.particles.smoke(this.x + Math.cos(a) * 70, this.y + Math.sin(a) * 40, 0, { count: 1, size: 18, color: '#a49a88', life: 1, alpha: 0.5 });
      }
      if (this.hp / this.maxHp < 0.35) {
        this.smokeT -= dt;
        if (this.smokeT <= 0) {
          this.smokeT = 0.1;
          this.game.particles.smoke(this.x + rand(-40, 40), this.y + rand(-15, 15), this.height * rand(0.4, 0.9), { count: 1, size: 14, color: '#3d3b38', life: 1.4, rise: 60, alpha: 0.7 });
          if (Math.random() < 0.3) this.game.particles.fire(this.x + rand(-30, 30), this.y + rand(-10, 10), this.height * rand(0.3, 0.7), { count: 1, size: 12, life: 0.4 });
        }
      }
    }

    /** Ground hot-spot of the sweeping searchlight (world). */
    searchSpot() {
      const a = this.searchA, d = 460 * 0.7;
      return { x: this.x + Math.cos(a) * d, y: this.y + Math.sin(a) * d, r: 62 };
    }
    /** 🔦 v12 volumetric searchlight: a light shaft from the lamp on the command tower roof down to
        the moving hot-spot, with drifting dust motes caught in the beam and a lens glare at the lamp. */
    drawSearchShaft(ctx) {
      if (this.tier < 2 || this.dead) return;
      const g = this.game, C = TD.Camera;
      const lz = this.hDisp + 30;
      const lp = g.project(this.x, this.y, lz);
      const sp = this.searchSpot(), ss = g.project(sp.x, sp.y, 0);
      const v = C.screenVector({ x: this.x, y: this.y, z: lz }, { x: sp.x, y: sp.y, z: 0 });
      const nx = -v.uy, ny = v.ux, R = sp.r * 1.05;
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      const gr = ctx.createLinearGradient(lp.x, lp.y, ss.x, ss.y);
      gr.addColorStop(0, 'rgba(255,248,215,0.30)');
      gr.addColorStop(0.35, 'rgba(255,246,210,0.13)');
      gr.addColorStop(1, 'rgba(255,244,205,0.05)');
      ctx.fillStyle = gr;
      ctx.beginPath();
      ctx.moveTo(lp.x + nx * 4, lp.y + ny * 4);
      ctx.lineTo(ss.x + nx * R, ss.y + ny * R * 0.7);
      ctx.lineTo(ss.x - nx * R, ss.y - ny * R * 0.7);
      ctx.lineTo(lp.x - nx * 4, lp.y - ny * 4);
      ctx.closePath(); ctx.fill();
      // brighter core of the beam
      ctx.fillStyle = 'rgba(255,252,230,0.07)';
      ctx.beginPath();
      ctx.moveTo(lp.x, lp.y);
      ctx.lineTo(ss.x + nx * R * 0.4, ss.y + ny * R * 0.28);
      ctx.lineTo(ss.x - nx * R * 0.4, ss.y - ny * R * 0.28);
      ctx.closePath(); ctx.fill();
      // dust motes drifting through the light (deterministic, no particles)
      ctx.fillStyle = '#fff8dc';
      for (let i = 0; i < 14; i++) {
        const u = ((i * 0.618 + this.t * 0.05 * (1 + (i % 3) * 0.4)) % 1);
        const w = Math.sin(i * 12.9898 + this.t * 0.7) * (0.15 + u * 0.85);
        const px = lp.x + v.dx * u + nx * R * w * u, py = lp.y + v.dy * u + ny * R * 0.7 * w * u;
        ctx.globalAlpha = 0.25 + 0.35 * Math.abs(Math.sin(this.t * 2 + i));
        ctx.fillRect(px, py, 1.4, 1.4);
      }
      // lamp glare
      ctx.globalAlpha = 0.85;
      ctx.drawImage(D.blob('#fff6d0'), lp.x - 16, lp.y - 16, 32, 32);
      ctx.globalAlpha = 0.35;
      ctx.drawImage(D.blob('#fff6d0'), lp.x - 34, lp.y - 6, 68, 12);
      ctx.restore();
      TD.PostFX.glowDotS(lp.x, lp.y, 22, '#fff6d0', 0.8);
      TD.PostFX.light(this.x, this.y, lz, 120, '#fff1c4', 0.35);
    }

    drawGroundExtras(ctx) {
      const g = this.game;
      for (const w of this.auxWeapons) if (w.drawGround) w.drawGround(ctx);
      if (this.tier >= 2) {
        // 🔦 ground pool of the searchlight: soft wedge (= the reveal zone) + bright elliptical hot-spot
        const a = this.searchA, L = 460, wd = 0.17;
        const o = g.project(this.x, this.y, 0);
        ctx.save();
        ctx.globalCompositeOperation = 'lighter';
        const p1 = g.project(this.x + Math.cos(a - wd) * L, this.y + Math.sin(a - wd) * L, 0);
        const p2 = g.project(this.x + Math.cos(a + wd) * L, this.y + Math.sin(a + wd) * L, 0);
        const pe = g.project(this.x + Math.cos(a) * L * 0.92, this.y + Math.sin(a) * L * 0.92, 0);
        const gr = ctx.createLinearGradient(o.x, o.y, pe.x, pe.y);
        gr.addColorStop(0, 'rgba(255,250,210,0.0)'); gr.addColorStop(0.3, 'rgba(255,250,210,0.06)'); gr.addColorStop(1, 'rgba(255,250,210,0.13)');
        ctx.fillStyle = gr;
        ctx.beginPath(); ctx.moveTo(o.x, o.y); ctx.lineTo(p1.x, p1.y); ctx.lineTo(p2.x, p2.y); ctx.closePath(); ctx.fill();
        const sp = this.searchSpot();
        const ss = g.project(sp.x, sp.y, 0), sr = sp.r;
        const flick = 0.92 + 0.08 * Math.sin(this.t * 31) * Math.sin(this.t * 13);
        ctx.globalAlpha = 0.34 * flick;
        ctx.save(); ctx.translate(ss.x, ss.y); ctx.rotate(TD.Camera.screenAngle(a)); ctx.scale(1, 0.62);
        ctx.drawImage(D.blob('#fff6c8'), -sr * 1.25, -sr, sr * 2.5, sr * 2);
        ctx.globalAlpha = 0.22 * flick;
        ctx.drawImage(D.blob('#ffffff', 0.4), -sr * 0.6, -sr * 0.5, sr * 1.2, sr);
        ctx.restore();
        ctx.restore();
        TD.PostFX.light(sp.x, sp.y, 6, sr * 2.6, '#fff1c4', 0.55 * flick);
      }
      // nuke silo hatch beside the tower
      if (this.branchId === 'nuke' && TD.S3 && TD.S3.has('nuke_silo')) {
        const s = g.project(this.x - 92, this.y + 36, 0);
        TD.S3.draw(ctx, 'nuke_silo', s.x, s.y, Math.PI / 2, this.branch.hatch > 0.05 ? 1 : 0);
        if (this.branch.hatch > 0.05) { ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = this.branch.hatch; ctx.drawImage(D.blob('#ff8a30'), s.x - 26, s.y - 20, 52, 28); ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over'; }
      } else if (this.branchId === 'nuke') {
        const s = g.project(this.x - 92, this.y + 36, 0);
        const open = this.branch.hatch;
        D.ellipse(ctx, s.x, s.y, 30, 16, '#3a3d3a', '#151715', 2);
        D.ellipse(ctx, s.x, s.y, 24, 12.5, open > 0.05 ? '#0a0a0a' : '#c9b237', null, 0);
        if (open <= 0.05) {
          ctx.fillStyle = '#151515';
          for (let i = 0; i < 3; i++) {
            const a0 = -Math.PI / 2 + i * (Math.PI * 2 / 3) - 0.5;
            ctx.beginPath(); ctx.moveTo(s.x, s.y); ctx.ellipse(s.x, s.y, 18, 9.5, 0, a0, a0 + 1.0); ctx.closePath(); ctx.fill();
          }
          D.ellipse(ctx, s.x, s.y, 4, 2.2, '#c9b237', null, 0);
        } else {
          ctx.globalCompositeOperation = 'lighter';
          ctx.globalAlpha = open;
          ctx.drawImage(D.blob('#ff8a30'), s.x - 26, s.y - 14, 52, 28);
          ctx.globalAlpha = 1;
          ctx.globalCompositeOperation = 'source-over';
        }
      }
    }

    /* ----- drawing ----- */
    draw(ctx) {
      const g = this.game;
      const base = g.project(this.x, this.y, 0);
      const rx = this.radius, ry = rx * g.ISO;
      const sq = Math.sin(this.squash * Math.PI) * 0.035;
      D.shadow(ctx, base.x + 14, base.y + 8, rx * 1.6, ry * 1.5, 0.35);

      ctx.save();
      ctx.translate(base.x, base.y);
      ctx.scale(1 + sq, 1 - sq);

      // priority: custom PNG → baked 3D model → vector art
      const png = towerPng(this.tier);
      const s3 = TD.S3 && TD.S3.has('tower_tier' + this.tier);
      if (png) {
        // base on the ground at (0,0); the deck lands exactly at -hDisp (stretch smoothly while rising a tier)
        const { img, iw, m, s } = png;
        const sy = s * (png.deck > 0 ? this.hDisp / png.deck : 1);
        D.ellipse(ctx, 0, 6, rx * 1.38, ry * 1.38, 'rgba(40,42,38,0.5)', null, 0);
        ctx.drawImage(img, 0, 0, iw, m.crop, -iw / 2 * s, -m.gy * sy, iw * s, m.crop * sy);
      } else if (s3) {
        D.ellipse(ctx, 0, 6, rx * 1.38, ry * 1.38, 'rgba(40,42,38,0.55)', null, 0);
        TD.S3.draw(ctx, 'tower_tier' + this.tier, 0, 0);
      } else {
        this.drawBody(ctx, rx, ry);
      }
      this.drawTop(ctx, rx, ry);

      if (this.flash > 0) {
        if (png) {
          // v10: hit flash tints the tower's own silhouette (no more red box)
          const { img, iw, m, s } = png, sy = s * (png.deck > 0 ? this.hDisp / png.deck : 1);
          const w = Math.ceil(iw * s), h = Math.ceil(m.crop * sy);
          const c = this._tint || (this._tint = document.createElement('canvas'));
          if (c.width !== w || c.height !== h) { c.width = w; c.height = h; }
          const x = c.getContext('2d');
          x.globalCompositeOperation = 'copy'; x.drawImage(img, 0, 0, iw, m.crop, 0, 0, w, h);
          x.globalCompositeOperation = 'source-atop'; x.fillStyle = '#ff3b2b'; x.fillRect(0, 0, w, h);
          ctx.globalAlpha = this.flash * 0.45;
          ctx.drawImage(c, -iw / 2 * s, -m.gy * sy, w, h);
        } else {
          ctx.globalAlpha = this.flash * 0.35;
          ctx.fillStyle = '#ff3b2b';
          D.roundRect(ctx, -rx * 1.05, -this.hDisp - 10, rx * 2.1, this.hDisp + ry + 10, 16);
          ctx.fill();
        }
        ctx.globalAlpha = 1;
      }
      ctx.restore();
    }

    /** One cylindrical floor from z0 to z1. */
    floor(ctx, rx, ry, z0, z1, color, opt = {}) {
      if (z1 <= z0) return;
      ctx.fillStyle = D.metal(ctx, -rx, rx, color);
      ctx.beginPath();
      ctx.moveTo(-rx, -z1);
      ctx.lineTo(-rx, -z0);
      ctx.ellipse(0, -z0, rx, ry, 0, Math.PI, 0, true);
      ctx.lineTo(rx, -z1);
      ctx.ellipse(0, -z1, rx, ry, 0, 0, Math.PI, false);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = 'rgba(0,0,0,0.55)'; ctx.lineWidth = 1.5; ctx.stroke();
      // vertical panel seams + rivets
      ctx.save();
      ctx.beginPath();
      ctx.moveTo(-rx, -z1); ctx.lineTo(-rx, -z0); ctx.ellipse(0, -z0, rx, ry, 0, Math.PI, 0, true); ctx.lineTo(rx, -z1); ctx.ellipse(0, -z1, rx, ry, 0, 0, Math.PI, false);
      ctx.clip();
      ctx.strokeStyle = 'rgba(0,0,0,0.28)'; ctx.lineWidth = 1.2;
      const N = opt.panels || 8;
      for (let i = 1; i < N; i++) {
        const a = Math.PI - (i / N) * Math.PI;
        const x = Math.cos(a) * rx, y = Math.sin(a) * ry;
        ctx.beginPath(); ctx.moveTo(x, -z0 + y); ctx.lineTo(x, -z1 + y); ctx.stroke();
        if (opt.rivets !== false) {
          ctx.fillStyle = 'rgba(255,255,255,0.3)';
          for (const zz of [z0 + 6, z1 - 6]) { ctx.beginPath(); ctx.arc(x + 3, -zz + y, 1.3, 0, Math.PI * 2); ctx.fill(); }
        }
      }
      // horizontal band
      ctx.strokeStyle = 'rgba(0,0,0,0.35)';
      ctx.beginPath(); ctx.ellipse(0, -z0 - 4, rx, ry, 0, 0, Math.PI); ctx.stroke();
      ctx.strokeStyle = 'rgba(255,255,255,0.12)';
      ctx.beginPath(); ctx.ellipse(0, -z1 + 3, rx, ry, 0, 0, Math.PI); ctx.stroke();
      // windows
      if (opt.windows) {
        const zc = (z0 + z1) / 2;
        for (const a of opt.windows) {
          const x = Math.cos(a) * rx * 0.98, y = Math.sin(a) * ry;
          const w = 12 * Math.abs(Math.sin(a)) + 3;
          ctx.fillStyle = '#0b0e10';
          ctx.fillRect(x - w / 2, -zc + y - opt.winH / 2, w, opt.winH);
          ctx.fillStyle = opt.winColor || 'rgba(140,255,120,0.75)';
          ctx.fillRect(x - w / 2 + 1, -zc + y - opt.winH / 2 + 1, w - 2, opt.winH * 0.35);
        }
      }
      if (opt.hazard) {
        ctx.save();
        ctx.beginPath(); ctx.rect(-rx, -z0 - 9, rx * 2, 9 + ry); ctx.clip();
        for (let i = -12; i < 12; i++) {
          ctx.fillStyle = i % 2 ? '#1a1a1a' : '#f0c020';
          ctx.beginPath();
          const x = i * 10;
          ctx.moveTo(x, -z0 + ry); ctx.lineTo(x + 10, -z0 + ry); ctx.lineTo(x + 20, -z0 - 9); ctx.lineTo(x + 10, -z0 - 9); ctx.closePath(); ctx.fill();
        }
        ctx.restore();
      }
      if (opt.glass) {
        const zc = (z0 + z1) / 2;
        ctx.fillStyle = 'rgba(80,200,255,0.55)';
        ctx.beginPath();
        ctx.ellipse(0, -zc + 4, rx * 0.99, ry, 0, 0.12 * Math.PI, 0.88 * Math.PI);
        ctx.ellipse(0, -zc - 6, rx * 0.99, ry, 0, 0.88 * Math.PI, 0.12 * Math.PI, true);
        ctx.closePath(); ctx.fill();
        ctx.fillStyle = 'rgba(255,255,255,0.35)';
        ctx.fillRect(-rx * 0.5, -zc - 2, rx * 0.25, 2);
      }
      ctx.restore();
      // top cap
      D.ellipse(ctx, 0, -z1, rx, ry, D.shade(color, 0.15), 'rgba(0,0,0,0.5)', 1.5);
    }

    drawBody(ctx, rx, ry) {
      const H = this.hDisp;
      const g = this.game;
      // concrete foundation
      D.ellipse(ctx, 0, 6, rx * 1.38, ry * 1.38, '#5d605a', '#2a2c28', 2);
      D.ellipse(ctx, 0, 3, rx * 1.3, ry * 1.3, '#7b7e76', null, 0);
      // hazard ring on the pad
      ctx.save();
      ctx.lineWidth = 6;
      ctx.setLineDash([10, 10]);
      ctx.strokeStyle = '#e4b81c';
      ctx.beginPath(); ctx.ellipse(0, 3, rx * 1.2, ry * 1.2, 0, 0, Math.PI * 2); ctx.stroke();
      ctx.restore();

      const zs = [0, TIER_H[0], TIER_H[1], TIER_H[2], TIER_H[3]];
      const sc = TOP_SCALE;
      // Floor 0 — reinforced bunker
      this.floor(ctx, rx, ry, 0, Math.min(H, zs[1]), '#6a7262', { panels: 9, windows: [0.62 * Math.PI, 0.5 * Math.PI, 0.38 * Math.PI], winH: 7, winColor: 'rgba(255,80,40,0.7)', hazard: true });
      // armored door
      if (H > 40) {
        ctx.fillStyle = '#2d322a';
        D.roundRect(ctx, -14, ry - 40, 28, 38, 3); ctx.fill();
        ctx.fillStyle = '#4a5244';
        D.roundRect(ctx, -11, ry - 37, 22, 34, 2); ctx.fill();
        ctx.fillStyle = '#e4b81c'; ctx.fillRect(-11, ry - 37, 22, 3);
        D.rivets(ctx, -8, ry - 28, 8, ry - 28, 4, 1);
      }
      // sandbags in front of the bunker
      for (let i = 0; i < 7; i++) {
        const a = 0.2 * Math.PI + (i / 6) * 0.6 * Math.PI;
        const x = Math.cos(a) * rx * 1.15, y = Math.sin(a) * ry * 1.15 + 2;
        if (Math.abs(x) < 20) continue;
        D.ellipse(ctx, x, y - 3, 11, 5, '#a98f5a', '#5c4b2a', 1.2);
        D.ellipse(ctx, x + 5, y - 9, 10, 4.5, '#b9a06a', '#5c4b2a', 1.2);
      }
      if (this.tier >= 1 && H > zs[1]) this.floor(ctx, rx * sc[1], ry * sc[1], zs[1], Math.min(H, zs[2]), '#5c6650', { panels: 8, windows: [0.7 * Math.PI, 0.5 * Math.PI, 0.3 * Math.PI], winH: 10, winColor: 'rgba(255,220,120,0.8)' });
      if (this.tier >= 2 && H > zs[2]) this.floor(ctx, rx * sc[2], ry * sc[2], zs[2], Math.min(H, zs[3]), '#55606a', { panels: 7, windows: [0.65 * Math.PI, 0.35 * Math.PI], winH: 9, winColor: 'rgba(120,230,255,0.85)' });
      if (this.tier >= 3 && H > zs[3]) this.floor(ctx, rx * sc[3], ry * sc[3], zs[3], H, '#4d5560', { panels: 6, glass: true, rivets: false });
      // armor plates / cracks when hurt
      const hpPct = this.hp / this.maxHp;
      if (hpPct < 0.6) {
        ctx.strokeStyle = 'rgba(0,0,0,0.7)'; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.moveTo(-rx * 0.6, -H * 0.3); ctx.lineTo(-rx * 0.45, -H * 0.22); ctx.lineTo(-rx * 0.55, -H * 0.12); ctx.stroke();
      }
      if (hpPct < 0.3) {
        ctx.beginPath(); ctx.moveTo(rx * 0.5, -H * 0.5); ctx.lineTo(rx * 0.35, -H * 0.4); ctx.lineTo(rx * 0.55, -H * 0.3); ctx.stroke();
      }
      void g;
    }

    drawTop(ctx, rx, ry) {
      const g = this.game;
      const H = this.hDisp;
      const k = this.topScale;
      const trx = rx * k, tryy = ry * k;
      if (towerPng(this.tier) || (TD.S3 && TD.S3.has('tower_tier' + this.tier))) {
        // PNG / 3D model already has its own roof → only mount the weapons
        const all = this.deckWeapons();
        for (const w of all) w.draw(ctx, w.mount.ox * k, -H + w.mount.oy * k * g.ISO);
        return;
      }
      // platform deck + railing (back half)
      D.ellipse(ctx, 0, -H, trx * 0.94, tryy * 0.94, '#3a4038', null, 0);
      ctx.strokeStyle = 'rgba(255,255,255,0.08)'; ctx.lineWidth = 1;
      for (let i = -3; i <= 3; i++) { ctx.beginPath(); ctx.moveTo(i * trx * 0.25, -H - tryy * 0.8); ctx.lineTo(i * trx * 0.25, -H + tryy * 0.8); ctx.stroke(); }
      this.railing(ctx, trx, tryy, H, true);

      // masts / radar (back)
      if (this.tier >= 2) this.drawRadar(ctx, trx * 0.62, -H - tryy * 0.55, this.tier >= 3 ? 1.25 : 1);
      if (this.tier >= 1) this.drawAntenna(ctx, -trx * 0.7, -H - tryy * 0.4, 30 + this.tier * 10);
      if (this.tier >= 3) this.drawAntenna(ctx, -trx * 0.25, -H - tryy * 0.75, 52);
      if (this.branchId === 'bomber') this.drawBeacon(ctx, trx * 0.15, -H - tryy * 0.7);

      // weapons: back mounts first, minigun, front mounts
      const all = this.deckWeapons();
      for (const w of all) {
        const sx = w.mount.ox * k, sy = -H + w.mount.oy * k * g.ISO;
        w.draw(ctx, sx, sy);
      }
      this.railing(ctx, trx, tryy, H, false);
      // tier-3 warning lights
      if (this.tier >= 3) {
        const on = Math.sin(this.t * 6) > 0;
        for (const a of [0.15 * Math.PI, 0.85 * Math.PI]) {
          const x = Math.cos(a) * trx, y = -H + Math.sin(a) * tryy - 10;
          ctx.fillStyle = on ? '#ff3020' : '#5a1410';
          ctx.beginPath(); ctx.arc(x, y, 3, 0, Math.PI * 2); ctx.fill();
          if (on) { ctx.globalCompositeOperation = 'lighter'; ctx.drawImage(D.blob('#ff3020'), x - 14, y - 14, 28, 28); ctx.globalCompositeOperation = 'source-over'; }
        }
      }
    }

    /** Everything mounted on the roof, back → front (aux weapons, 🎯 sub-turrets, main minigun). */
    deckWeapons() {
      return [...this.auxWeapons, ...this.subTurrets, this.minigun].filter((w) => w.mount).sort((a, b) => a.mount.oy - b.mount.oy);
    }

    railing(ctx, rx, ry, H, back) {
      ctx.strokeStyle = back ? '#3b4246' : '#6a757c';
      ctx.lineWidth = 2;
      const a0 = back ? Math.PI : 0, a1 = back ? Math.PI * 2 : Math.PI;
      ctx.beginPath(); ctx.ellipse(0, -H - 9, rx, ry, 0, a0, a1); ctx.stroke();
      for (let i = 0; i <= 10; i++) {
        const a = a0 + (a1 - a0) * (i / 10);
        const x = Math.cos(a) * rx, y = Math.sin(a) * ry;
        ctx.beginPath(); ctx.moveTo(x, -H + y); ctx.lineTo(x, -H + y - 9); ctx.stroke();
      }
    }

    drawAntenna(ctx, x, y, h) {
      ctx.strokeStyle = '#2a2f33'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x, y - h); ctx.stroke();
      ctx.lineWidth = 1;
      for (let i = 1; i < 4; i++) { ctx.beginPath(); ctx.moveTo(x - 5 + i, y - h * (i / 4)); ctx.lineTo(x + 5 - i, y - h * (i / 4)); ctx.stroke(); }
      const on = Math.sin(this.t * 4 + x) > 0.3;
      ctx.fillStyle = on ? '#ff4030' : '#601a14';
      ctx.beginPath(); ctx.arc(x, y - h, 2.5, 0, Math.PI * 2); ctx.fill();
    }

    drawBeacon(ctx, x, y) {
      ctx.fillStyle = '#333'; ctx.fillRect(x - 3, y - 14, 6, 14);
      const on = Math.sin(this.t * 8) > 0;
      ctx.fillStyle = on ? '#40c0ff' : '#103040';
      ctx.beginPath(); ctx.arc(x, y - 17, 4, 0, Math.PI * 2); ctx.fill();
      if (on) { ctx.globalCompositeOperation = 'lighter'; ctx.drawImage(D.blob('#40c0ff'), x - 16, y - 33, 32, 32); ctx.globalCompositeOperation = 'source-over'; }
    }

    drawRadar(ctx, x, y, s) {
      ctx.strokeStyle = '#2a2f33'; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x, y - 26 * s); ctx.stroke();
      // dome
      D.ellipse(ctx, x - 16 * s, y + 4, 9 * s, 5 * s, '#d9dcd6', null, 0);
      ctx.fillStyle = '#e6e9e2';
      ctx.beginPath(); ctx.arc(x - 16 * s, y + 3, 9 * s, Math.PI, 0); ctx.fill();
      // rotating dish
      const w = Math.cos(this.radarA) * 18 * s;
      ctx.save();
      ctx.translate(x, y - 28 * s);
      ctx.fillStyle = Math.cos(this.radarA) > 0 ? '#c9cec8' : '#8e948e';
      ctx.beginPath(); ctx.ellipse(0, 0, Math.max(2, Math.abs(w)), 10 * s, 0, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = '#3a3f3a'; ctx.lineWidth = 1.2; ctx.stroke();
      ctx.strokeStyle = '#3a3f3a';
      ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(w * 0.8, 0); ctx.stroke();
      ctx.restore();
    }
  }

  TD.Tower = Tower;
  TD.Wall = Wall;
  TD.WALL_LV = WALL_LV;
  TD.STAT_MAX = STAT_MAX;
  TD.AUX_MAX = AUX_MAX;
})(window.TD);
