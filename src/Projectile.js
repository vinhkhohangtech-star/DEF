/* =========================================================
   Projectile.js — every moving shot in the battle
   Player side : Tracer (minigun), HomingRocket (rocket pod),
                 SamMissile, Bomb (bomber), NukeWarhead,
                 ArtyShell (skill [1])
   Enemy side  : EnemyBullet (AK), TankShell, EnemyRocket
                 (Katyusha — INTERCEPTABLE, has its own HP)
   All positions are WORLD coordinates (ground plane + z height).
   ========================================================= */
(function (TD) {
  'use strict';
  const { rand, dist, clamp, lerpAngle } = TD.util;
  const D = TD.Draw;

  class Projectile {
    constructor(game, o) {
      this.game = game;
      this.dead = false;
      this.x = 0; this.y = 0; this.z = 0;
      Object.assign(this, o);
      this.hitSet = new Set();
      this.pierceLeft = o.pierce || 0;
    }
    update() {}
    draw() {}
  }

  /** Draw a small missile body at screen point s, pointing along screen angle a. */
  function drawMissile(ctx, s, a, len, body, flame = true, t = 0, sid = null) {
    if (flame) {
      const ex = s.x - Math.cos(a) * len * 0.7, ey = s.y - Math.sin(a) * len * 0.7;
      TD.PostFX.glowDotS(ex, ey, len * 0.9, '#ffa040', 0.8);
      const w = TD.Camera.unproject(ex, ey);
      TD.PostFX.light(w.x, w.y, 0, 90, '#ffa040', 0.35);
    }
    if (sid && TD.S3 && TD.S3.has(sid)) {
      if (flame) {
        ctx.save(); ctx.translate(s.x, s.y); ctx.rotate(a);
        ctx.globalCompositeOperation = 'lighter';
        const fl = len * (0.7 + Math.sin(t * 60) * 0.25);
        ctx.drawImage(D.blob('#ffb347'), -len * 0.5 - fl, -len * 0.28, fl * 1.2, len * 0.56);
        ctx.drawImage(D.blob('#fff3c0'), -len * 0.5 - fl * 0.4, -len * 0.14, fl * 0.5, len * 0.28);
        ctx.restore();
      }
      TD.S3.drawRot(ctx, sid, s.x, s.y, a, len * 1.2);
      return;
    }
    ctx.save();
    ctx.translate(s.x, s.y);
    ctx.rotate(a);
    if (flame) {
      ctx.globalCompositeOperation = 'lighter';
      const fl = len * (0.7 + Math.sin(t * 60) * 0.25);
      ctx.drawImage(D.blob('#ffb347'), -len * 0.5 - fl, -len * 0.28, fl * 1.2, len * 0.56);
      ctx.drawImage(D.blob('#fff3c0'), -len * 0.5 - fl * 0.4, -len * 0.14, fl * 0.5, len * 0.28);
      ctx.globalCompositeOperation = 'source-over';
    }
    ctx.fillStyle = body;
    ctx.beginPath();
    ctx.moveTo(len * 0.55, 0);
    ctx.lineTo(len * 0.3, -len * 0.12); ctx.lineTo(-len * 0.5, -len * 0.12);
    ctx.lineTo(-len * 0.5, len * 0.12); ctx.lineTo(len * 0.3, len * 0.12);
    ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#1b1f22';
    ctx.beginPath(); ctx.moveTo(-len * 0.5, -len * 0.12); ctx.lineTo(-len * 0.62, -len * 0.3); ctx.lineTo(-len * 0.32, -len * 0.12); ctx.fill();
    ctx.beginPath(); ctx.moveTo(-len * 0.5, len * 0.12); ctx.lineTo(-len * 0.62, len * 0.3); ctx.lineTo(-len * 0.32, len * 0.12); ctx.fill();
    ctx.fillStyle = '#d33';
    ctx.fillRect(len * 0.18, -len * 0.12, len * 0.08, len * 0.24);
    ctx.restore();
  }

  /* ================= PLAYER ================= */

  /* ---------- tracer streak sprites (cached): vapor trail + white-hot core, tail → head ---------- */
  const STREAK = {
    std:    { vapor: '255,184,84',  core: '255,251,232', w: 4.5, glow: '#ffb050', light: '#ffc070' },
    incend: { vapor: '255,104,26',  core: '255,236,170', w: 5.2, glow: '#ff6a1a', light: '#ff7a2a' },
    cryo:   { vapor: '120,232,255', core: '244,255,255', w: 5.0, glow: '#7fe8ff', light: '#8aeeff' },
    acid:   { vapor: '160,255,48',  core: '242,255,206', w: 5.0, glow: '#9dff2a', light: '#a8ff40' },
    he:     { vapor: '255,140,48',  core: '255,255,250', w: 6.0, glow: '#ff8a30', light: '#ffa050' },
    rico:   { vapor: '170,220,255', core: '255,255,255', w: 4.0, glow: '#bfe4ff', light: '#cfeaff' },
    enemy:  { vapor: '255,80,56',   core: '255,214,190', w: 4.0, glow: '#ff5038', light: '#ff6040' },
  };
  const _str = {};
  function streakSprite(rgbStr, core) {
    const key = rgbStr + (core ? 'c' : 'v');
    if (_str[key]) return _str[key];
    const c = document.createElement('canvas'); c.width = 96; c.height = 12;
    const x = c.getContext('2d');
    const h = x.createLinearGradient(0, 0, 96, 0);
    if (core) { h.addColorStop(0, `rgba(${rgbStr},0)`); h.addColorStop(0.55, `rgba(${rgbStr},0.85)`); h.addColorStop(1, `rgba(255,255,255,1)`); }
    else { h.addColorStop(0, `rgba(${rgbStr},0)`); h.addColorStop(0.35, `rgba(${rgbStr},0.25)`); h.addColorStop(0.85, `rgba(${rgbStr},0.85)`); h.addColorStop(1, `rgba(${rgbStr},1)`); }
    x.fillStyle = h; x.fillRect(0, 0, 96, 12);
    x.globalCompositeOperation = 'destination-in';
    const v = x.createLinearGradient(0, 0, 0, 12);
    v.addColorStop(0, 'rgba(0,0,0,0)'); v.addColorStop(0.5, core ? 'rgba(0,0,0,1)' : 'rgba(0,0,0,0.95)'); v.addColorStop(1, 'rgba(0,0,0,0)');
    x.fillStyle = v; x.fillRect(0, 0, 96, 12);
    return (_str[key] = c);
  }
  /**
   * Draw a hypersonic streak from WORLD point tail → head. The angle comes from TD.Camera.screenVector,
   * so the streak lies exactly on the projected 3D flight line (no skew).
   */
  function drawStreak(ctx, tail, head, st, k = 1, light = false) {
    const C = TD.Camera;
    const sv = C.screenVector(tail, head);
    if (sv.length < 0.5) return;
    const h = C.project(head.x, head.y, head.z);
    const L = sv.length, w = st.w * k;
    ctx.save();
    ctx.translate(h.sx, h.sy); ctx.rotate(sv.angle);
    ctx.globalCompositeOperation = 'lighter';
    ctx.drawImage(streakSprite(st.vapor, false), -L, -w / 2, L, w);              // tracer vapor (≤ 6 px)
    ctx.drawImage(streakSprite(st.core, true), -L * 0.62, -0.9, L * 0.62 + 1, 1.8);  // white-hot core
    ctx.fillStyle = '#ffffff'; ctx.fillRect(-1.6, -1, 2.6, 2);                   // incandescent tip
    ctx.restore();
    const t = C.project(tail.x, tail.y, tail.z);
    TD.PostFX.glowLineS(t.sx, t.sy, h.sx, h.sy, w * 2.4, st.glow, 0.75);
    if (light) TD.PostFX.light(head.x, head.y, head.z, 70, st.light, 0.3);
  }

  /** Minigun tracer round. */
  class Tracer extends Projectile {
    constructor(game, o) {
      super(game, o);
      this.speed = 2600;
      this.vx = Math.cos(o.angle) * this.speed;
      this.vy = Math.sin(o.angle) * this.speed;
      this.traveled = 0;
      this.maxDist = (o.range || 420) * 1.15;
      this.vz = o.tz != null ? ((o.tz - o.z) / Math.max(0.05, (o.travel || 0.2))) : -60;
      this.ox = o.x; this.oy = o.y; this.oz = o.z;      // muzzle / ricochet origin: streak never extends behind it
      this.seq = (Tracer.n = (Tracer.n || 0) + 1);
      this.fxT = 0;
      if (o.homing) this.aimAt(o.homing);
    }
    /** Ricochet round: velocity locked on the straight 3D line to the target's centre of mass. */
    comZ(e) { return (e.z || 0) + Math.min(28, e.height * 0.5); }
    aimAt(e) {
      const dx = e.x - this.x, dy = e.y - this.y, dz = this.comZ(e) - this.z;
      const L = Math.hypot(dx, dy, dz) || 1;
      this.vx = dx / L * this.speed; this.vy = dy / L * this.speed; this.vz = dz / L * this.speed;
      return L;
    }
    style() {
      if (this.bounced) return STREAK.rico;
      if (this.explosive) return STREAK.he;
      const am = this.ammo;
      if (am) { if (am.incend) return STREAK.incend; if (am.cryo) return STREAK.cryo; if (am.acid) return STREAK.acid; }
      return STREAK.std;
    }
    update(dt) {
      const g = this.game;
      const steps = Math.ceil((this.speed * dt) / 20);
      const sdt = dt / steps;
      for (let i = 0; i < steps && !this.dead; i++) {
        const hm = this.homing;
        if (hm) {
          if (hm.dead) this.homing = null;
          else if (this.aimAt(hm) < hm.radius + 6) { this.hitSet.add(hm); this.x = hm.x; this.y = hm.y; this.z = this.comZ(hm); this.onHit(hm); this.dead = true; break; }
        }
        this.x += this.vx * sdt;
        this.y += this.vy * sdt;
        this.z = hm ? this.z + this.vz * sdt : Math.max(8, this.z + this.vz * sdt);
        this.traveled += this.speed * sdt;
        // interceptable enemy rockets
        for (const r of g.rockets) {
          if (r.dead || this.hitSet.has(r)) continue;
          if (dist(this.x, this.y, r.x, r.y) < r.radius + 8) { this.hitSet.add(r); g.damageRocket(r, this.dmg, this.crit); this.dead = true; break; }
        }
        if (this.dead) break;
        for (const e of g.enemies) {
          if (e.dead || this.hitSet.has(e) || e.cloaked || e.burrowed) continue;
          if (dist(this.x, this.y, e.x, e.y) < e.radius + 6) {
            this.hitSet.add(e);
            this.onHit(e);
            if (this.pierceLeft-- <= 0) { this.dead = true; this.ricochet(e); break; }
            g.particles.sparks(this.x, this.y, this.z, { count: 3, color: '#ffffff', speed: 260, life: 0.15 });
          }
        }
      }
      if (this.traveled > this.maxDist) this.dead = true;
      // elemental micro-particles along the flight path
      const am = this.ammo;
      if (am && !this.dead && (this.fxT -= dt) <= 0) {
        this.fxT = 0.018;
        const P = g.particles;
        if (am.incend) P.ember(this.x, this.y, this.z);
        else if (am.cryo) P.mist(this.x, this.y, this.z);
        else if (am.acid && Math.random() < 0.6) P.drip(this.x, this.y, this.z);
      }
    }
    /** ⚡ Ricochet Lv3: deflection spark cone off Enemy 1, then a dead-straight round COM₁ → COM₂. */
    ricochet(from) {
      const g = this.game, C = TD.Camera;
      if (!this.bounce || this.bounced) return;
      let best = null, bd = 230;
      for (const o of g.enemies) {
        if (o === from || o.dead || this.hitSet.has(o) || !o.targetable) continue;
        const d = dist(from.x, from.y, o.x, o.y);
        if (d < bd) { bd = d; best = o; }
      }
      if (!best) return;
      const z = this.comZ(from);
      // impact point on the target's hull, its surface normal and the reflected spark cone
      const din = C.norm({ x: this.vx, y: this.vy, z: this.vz });
      const ip = { x: from.x - din.x * from.radius * 0.8, y: from.y - din.y * from.radius * 0.8, z: Math.max(4, z - din.z * from.radius * 0.8) };
      let n = C.norm({ x: ip.x - from.x, y: ip.y - from.y, z: (ip.z - z) + 0.15 * from.radius });
      let rf = C.reflect(din, n);
      if (rf.x * n.x + rf.y * n.y + rf.z * n.z < 0.1) rf = n;
      g.particles.cone(ip.x, ip.y, ip.z, rf, 0.5, { count: 10, color: '#cfeaff', speed: 440, life: 0.22 });
      g.particles.flash(ip.x, ip.y, ip.z, { size: 26, color: '200,240,255', life: 0.06 });
      TD.PostFX.flash(ip.x, ip.y, ip.z, 110, '#cfeaff', 0.8, 0.12);
      const tr = new Tracer(g, {
        x: from.x, y: from.y, z, angle: Math.atan2(best.y - from.y, best.x - from.x), dmg: this.dmg * 0.75, crit: this.crit,
        range: bd + 80, ammo: this.ammo, bounced: true, homing: best,
      });
      tr.hitSet.add(from);
      g.projectiles.push(tr);
      g.audio.play('ricochet');
    }
    onHit(e) {
      const g = this.game;
      let dmg = this.dmg;
      if (this.explosive) {
        dmg *= this.explosive.mult;
        g.splashDamage(this.x, this.y, 62, this.dmg * 0.5, { exclude: e, source: 'he' });
        g.particles.explosion(e.x, e.y, 14, 38, { debris: false, scorch: false, quiet: true });
        g.audio.play('he');
      }
      const am = this.ammo;
      if (am) {
        if (am.cryo) e.chill([0.3, 0.4, 0.5][am.cryo - 1], 3);
        if (am.incend) e.ignite(e.maxHp * [0.015, 0.025, 0.035][am.incend - 1] * (e.type === 'boss' ? 0.25 : e.heavy ? 0.6 : 1), 4);
        if (am.acid) e.corrode(3, am.acid);
      }
      const sp = Math.hypot(this.vx, this.vy) || 1;
      g.damageEnemy(e, dmg, { crit: this.crit, source: 'mg', dir: { x: this.vx / sp, y: this.vy / sp }, knock: { x: this.x - this.vx, y: this.y - this.vy, f: 26 } });
      const hz = Math.min(e.height * 0.5, 40) + e.z;
      g.particles.sparks(e.x, e.y, hz, { count: this.crit ? 9 : 4, color: this.crit ? '#ffe14d' : am && am.cryo ? '#bff4ff' : am && am.acid ? '#c8ff5a' : '#ffd890', speed: 220, life: 0.22 });
      if (am && am.acid) for (let i = 0; i < 2; i++) g.particles.drip(e.x, e.y, hz);
      if (this.seq % 2 === 0) TD.PostFX.flash(e.x, e.y, hz, 60, this.style().light, 0.45, 0.07);
      g.audio.play('hit');
    }
    draw(ctx) {
      // velocity-based motion blur: 16 ms exposure, clamped so it never reaches behind the muzzle / ricochet origin
      const exp = 0.016, v = this.speed;
      const back = Math.min(v * exp, Math.hypot(this.x - this.ox, this.y - this.oy, this.z - this.oz));
      const k = back / v;
      const tail = { x: this.x - this.vx * k, y: this.y - this.vy * k, z: this.z - this.vz * k };
      drawStreak(ctx, tail, this, this.style(), 1, this.seq % 3 === 0);
    }
  }

  /** Rocket pod missile with smoke trail. Homes on an enemy or enemy rocket. */
  class HomingRocket extends Projectile {
    constructor(game, o) {
      super(game, o);
      this.speed = 300;
      this.angle = o.angle;
      this.vz = 140;
      this.t = 0; this.trail = 0; this.life = 4;
      this.px = this.x; this.py = this.y; this.pz = this.z;
    }
    update(dt) {
      const g = this.game;
      this.t += dt; this.life -= dt;
      this.px = this.x; this.py = this.y; this.pz = this.z;
      const tg = this.target;
      if (!tg || tg.dead) {
        this.target = g.nearestEnemy(this.x, this.y, 520);
      }
      this.speed = Math.min(980, this.speed + dt * 1300);
      let tz = 20;
      if (this.target) {
        const desired = Math.atan2(this.target.y - this.y, this.target.x - this.x);
        this.angle = lerpAngle(this.angle, desired, Math.min(1, dt * (3 + this.t * 6)));
        tz = (this.target.z || 0) + (this.target.isRocket ? 0 : Math.min(30, this.target.height * 0.5));
      }
      this.x += Math.cos(this.angle) * this.speed * dt;
      this.y += Math.sin(this.angle) * this.speed * dt;
      const climb = this.t < 0.25 ? 260 : (tz - this.z) * 4;
      this.z += clamp(climb, -900, 600) * dt;
      this.trail -= dt;
      if (this.trail <= 0) {
        this.trail = 0.018;
        g.particles.spawn({ type: 'smoke', x: this.x, y: this.y, z: this.z, size: rand(5, 8), grow: 2.2, color: '#d8d4cc', alpha: 0.55, life: rand(0.5, 0.8), vz: 6, drag: 2 });
      }
      if (this.target) {
        const hitR = this.target.isRocket ? 22 : this.target.radius + 10;
        if (dist(this.x, this.y, this.target.x, this.target.y) < hitR && Math.abs(this.z - tz) < 70) return this.explode();
      }
      if (this.life <= 0 || this.z < 0) this.explode();
    }
    explode() {
      const g = this.game;
      this.dead = true;
      if (this.target && this.target.isRocket && !this.target.dead) g.damageRocket(this.target, this.dmg * 3, false);
      g.splashDamage(this.x, this.y, this.splash, this.dmg, { source: 'rocket', knock: 90 });
      g.particles.explosion(this.x, this.y, Math.max(0, this.z), this.splash, { debris: this.z < 30 });
      g.audio.play('boom_s');
      g.shake(2);
    }
    draw(ctx) {
      const g = this.game;
      const s = g.project(this.x, this.y, this.z);
      drawMissile(ctx, s, TD.Camera.screenVector({ x: this.px, y: this.py, z: this.pz }, this).angle, 16, '#c8ccc4', true, this.t, 'rocket');
    }
  }

  /** SAM: launches straight up, then dives onto its target. */
  class SamMissile extends Projectile {
    constructor(game, o) {
      super(game, o);
      this.phase = 0; this.t = 0; this.trail = 0;
      this.vz = 200; this.speed = 0;
      this.px = this.x; this.py = this.y; this.pz = this.z;
    }
    update(dt) {
      const g = this.game;
      this.t += dt;
      this.px = this.x; this.py = this.y; this.pz = this.z;
      if (this.phase === 0) {
        this.vz = Math.min(1300, this.vz + dt * 2600);
        this.z += this.vz * dt;
        this.x += (Math.random() - 0.5) * 30 * dt;
        if (this.z > 620) { this.phase = 1; this.speed = 700; }
      } else {
        if (!this.target || this.target.dead) this.target = g.pickSamTarget();
        // 📡 scrambled by an EW jammer → guidance error, often misses
        const tx = (this.target ? this.target.x : this.x) + (this.jitX || 0) * Math.sin(this.t * 5);
        const ty = (this.target ? this.target.y : this.y) + (this.jitY || 0);
        const tz = this.target ? (this.target.z || 0) + (this.target.isRocket ? 0 : 15) : 0;
        this.speed = Math.min(1700, this.speed + dt * 2400);
        const dx = tx - this.x, dy = ty - this.y, dz = tz - this.z;
        const L = Math.hypot(dx, dy, dz) || 1;
        const step = this.speed * dt;
        if (L <= step + 10 || this.z <= 0) { this.x = tx; this.y = ty; this.z = Math.max(0, tz); return this.explode(); }
        this.x += (dx / L) * step; this.y += (dy / L) * step; this.z += (dz / L) * step;
      }
      this.trail -= dt;
      if (this.trail <= 0) {
        this.trail = 0.015;
        g.particles.spawn({ type: 'smoke', x: this.x, y: this.y, z: this.z, size: rand(7, 11), grow: 2.4, color: '#e6e2da', alpha: 0.6, life: rand(0.7, 1.1), vz: 4, drag: 1.5 });
      }
    }
    explode() {
      const g = this.game;
      this.dead = true;
      if (this.target && this.target.isRocket && !this.target.dead) g.damageRocket(this.target, this.dmg, true);
      g.splashDamage(this.x, this.y, this.splash, this.dmg, { source: 'sam', crit: true, knock: 160 });
      g.particles.explosion(this.x, this.y, this.z, this.splash * 1.2);
      g.audio.play('boom_m');
      g.shake(6);
    }
    draw(ctx) {
      const g = this.game;
      const s = g.project(this.x, this.y, this.z);
      const a = TD.Camera.screenVector({ x: this.px, y: this.py, z: this.pz }, this).angle;
      drawMissile(ctx, s, isFinite(a) ? a : -Math.PI / 2, 26, '#e9ecef', true, this.t, 'sam_missile');
    }
  }

  /** Bomber's falling cluster bomb. */
  class Bomb extends Projectile {
    constructor(game, o) { super(game, o); this.vz = -40; this.rot = Math.atan2(o.vy, o.vx); }
    update(dt) {
      this.vz -= 900 * dt;
      this.x += this.vx * dt; this.y += this.vy * dt; this.z += this.vz * dt;
      this.vx *= 1 - dt * 0.6; this.vy *= 1 - dt * 0.6;
      if (this.z <= 0) {
        const g = this.game;
        this.dead = true;
        g.splashDamage(this.x, this.y, this.radius, this.dmg, { source: 'bomb', ground: true, knock: 140 });
        g.particles.explosion(this.x, this.y, 0, this.radius);
        g.audio.play('boom_m');
        g.shake(4);
      }
    }
    draw(ctx) {
      const g = this.game;
      const sh = g.project(this.x, this.y, 0);
      D.shadow(ctx, sh.x, sh.y, 7, 3, 0.3);
      const s = g.project(this.x, this.y, this.z);
      if (TD.S3 && TD.S3.has('bomb')) { TD.S3.drawRot(ctx, 'bomb', s.x, s.y, Math.PI / 2 - 0.4 * Math.sign(this.vx || 1), 20); return; }
      ctx.save();
      ctx.translate(s.x, s.y);
      ctx.rotate(Math.PI / 2 - 0.4 * Math.sign(this.vx || 1));
      ctx.fillStyle = '#3d4436';
      D.roundRect(ctx, -9, -4, 18, 8, 4); ctx.fill();
      ctx.fillStyle = '#c9a227'; ctx.fillRect(2, -4, 2, 8);
      ctx.fillStyle = '#20241d';
      ctx.beginPath(); ctx.moveTo(-9, 0); ctx.lineTo(-14, -6); ctx.lineTo(-14, 6); ctx.closePath(); ctx.fill();
      ctx.restore();
    }
  }

  /** ☢ Tactical nuke — locks onto the highest-HP unit, falls with a siren warning. */
  class NukeWarhead extends Projectile {
    constructor(game, o) {
      super(game, o);
      this.t = 0; this.T = 1.9;
      this.lock = 1.1;
      this.tx = o.target.x; this.ty = o.target.y;
    }
    update(dt) {
      this.t += dt;
      if (this.t < this.lock && this.target && !this.target.dead) {
        this.tx += (this.target.x - this.tx) * Math.min(1, dt * 8);
        this.ty += (this.target.y - this.ty) * Math.min(1, dt * 8);
      }
      const k = clamp(this.t / this.T, 0, 1);
      this.x = this.tx; this.y = this.ty;
      this.z = 1500 * (1 - k * k);
      if (Math.random() < 0.8) this.game.particles.spawn({ type: 'smoke', x: this.x + rand(-4, 4), y: this.y, z: this.z + 40, size: rand(9, 14), grow: 2, color: '#e8e4dc', alpha: 0.6, life: 0.9, vz: 10, drag: 1 });
      if (k >= 1) { this.dead = true; this.game.nukeDetonate(this.tx, this.ty, this.dmg, this.radius); }
    }
    draw(ctx) {
      const g = this.game;
      const gs = g.project(this.tx, this.ty, 0);
      const pulse = 0.5 + 0.5 * Math.sin(this.t * 24);
      ctx.save();
      ctx.strokeStyle = `rgba(255,60,40,${0.5 + pulse * 0.45})`;
      ctx.lineWidth = 4;
      ctx.setLineDash([16, 10]); ctx.lineDashOffset = -this.t * 80;
      ctx.beginPath(); ctx.ellipse(gs.x, gs.y, this.radius, this.radius * g.ISO, 0, 0, Math.PI * 2); ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = `rgba(255,40,20,${0.08 + pulse * 0.08})`; ctx.fill();
      // crosshair + trefoil
      ctx.strokeStyle = `rgba(255,230,80,${0.7 + pulse * 0.3})`; ctx.lineWidth = 3;
      const r = 34;
      ctx.beginPath(); ctx.arc(gs.x, gs.y, r, 0, Math.PI * 2);
      ctx.moveTo(gs.x - r - 14, gs.y); ctx.lineTo(gs.x + r + 14, gs.y);
      ctx.moveTo(gs.x, gs.y - r - 14); ctx.lineTo(gs.x, gs.y + r + 14); ctx.stroke();
      ctx.fillStyle = `rgba(255,230,80,${0.6 + pulse * 0.4})`;
      for (let i = 0; i < 3; i++) {
        const a0 = -Math.PI / 2 + i * (Math.PI * 2 / 3) - 0.5;
        ctx.beginPath(); ctx.moveTo(gs.x, gs.y); ctx.arc(gs.x, gs.y, 20, a0, a0 + 1.0); ctx.closePath(); ctx.fill();
      }
      ctx.restore();
      const s = g.project(this.x, this.y, this.z);
      drawMissile(ctx, s, Math.PI / 2, 46, '#dfe3d6', true, this.t);
      ctx.fillStyle = '#ffd400';
      ctx.beginPath(); ctx.arc(s.x, s.y - 3, 4, 0, Math.PI * 2); ctx.fill();
    }
  }

  /** Skill [1]: a single artillery shell falling from the sky. */
  class ArtyShell extends Projectile {
    constructor(game, o) { super(game, o); this.t = -(o.delay || 0); this.T = 0.75; }
    update(dt) {
      this.t += dt;
      if (this.t < 0) return;
      const k = Math.min(1, this.t / this.T);
      this.z = 900 * (1 - k * k);
      if (k >= 1) {
        const g = this.game;
        this.dead = true;
        g.splashDamage(this.x, this.y, this.radius, this.dmg, { source: 'arty', crit: true, ground: false, knock: 200 });
        g.particles.explosion(this.x, this.y, 0, this.radius * 1.1);
        g.audio.play('boom_m');
        g.shake(7);
      }
    }
    draw(ctx) {
      const g = this.game;
      const gs = g.project(this.x, this.y, 0);
      const pulse = 0.5 + 0.5 * Math.sin((this.t + 2) * 22);
      ctx.strokeStyle = `rgba(255,70,40,${0.35 + pulse * 0.4})`; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.ellipse(gs.x, gs.y, this.radius, this.radius * g.ISO, 0, 0, Math.PI * 2); ctx.stroke();
      if (this.t < 0) return;
      const s = g.project(this.x, this.y, this.z);
      drawMissile(ctx, s, Math.PI / 2, 18, '#4d5640', false, 0, 'artillery_shell');
    }
  }

  /* ================= ENEMY ================= */

  /** AK / generic hostile bullet: travels to a point, then applies its payload. */
  class EnemyBullet extends Projectile {
    constructor(game, o) {
      super(game, o);
      this.sx = o.x; this.sy = o.y; this.sz = o.z;
      const d = Math.hypot(o.tx - o.x, o.ty - o.y);
      this.T = d / (o.speed || 1300);
      this.t = 0;
    }
    update(dt) {
      this.t += dt;
      const k = Math.min(1, this.t / this.T);
      this.x = this.sx + (this.tx - this.sx) * k;
      this.y = this.sy + (this.ty - this.sy) * k;
      this.z = this.sz + (this.tz - this.sz) * k;
      if (this.game.shieldCatch(this)) return;
      if (k >= 1) { this.dead = true; this.game.applyEnemyHit(this.payload, this.x, this.y, this.z); }
    }
    draw(ctx) {
      const g = this.game;
      const k = Math.min(1, this.t / this.T);
      const k0 = Math.max(0, k - 0.12);
      const tail = { x: this.sx + (this.tx - this.sx) * k0, y: this.sy + (this.ty - this.sy) * k0, z: this.sz + (this.tz - this.sz) * k0 };
      drawStreak(ctx, tail, this, STREAK.enemy, 1, false);
    }
  }

  /** Tank HE shell: flat arc, explodes on arrival. */
  class TankShell extends EnemyBullet {
    constructor(game, o) { super(game, Object.assign({ speed: 900 }, o)); this.h = 30 + Math.hypot(o.tx - o.x, o.ty - o.y) * 0.08; }
    update(dt) {
      this.t += dt;
      const k = Math.min(1, this.t / this.T);
      this.x = this.sx + (this.tx - this.sx) * k;
      this.y = this.sy + (this.ty - this.sy) * k;
      this.z = this.sz + (this.tz - this.sz) * k + 4 * this.h * k * (1 - k);
      if (Math.random() < 0.5) this.game.particles.spawn({ type: 'smoke', x: this.x, y: this.y, z: this.z, size: 5, grow: 1.5, color: '#bbb5aa', alpha: 0.4, life: 0.4 });
      if (this.game.shieldCatch(this)) return;
      if (k >= 1) {
        const g = this.game;
        this.dead = true;
        g.particles.explosion(this.x, this.y, this.z, 46, { scorch: false });
        g.audio.play('boom_s');
        g.shake(3);
        g.applyEnemyHit(this.payload, this.x, this.y, this.z);
      }
    }
    draw(ctx) {
      const s = this.game.project(this.x, this.y, this.z);
      ctx.globalCompositeOperation = 'lighter';
      ctx.drawImage(D.blob('#ffb050'), s.x - 10, s.y - 10, 20, 20);
      ctx.globalCompositeOperation = 'source-over';
      ctx.fillStyle = '#ffe9b0';
      ctx.beginPath(); ctx.arc(s.x, s.y, 3, 0, Math.PI * 2); ctx.fill();
    }
  }

  /** Katyusha rocket — high arc, has HP, can be shot down by the tower. */
  class EnemyRocket extends Projectile {
    constructor(game, o) {
      super(game, o);
      this.isRocket = true;
      this.hostile = true;
      this.radius = 12;
      this.height = 0;
      this.maxHp = o.hp; this.hp = o.hp;
      this.sx = o.x; this.sy = o.y; this.sz = o.z;
      const d = Math.hypot(o.tx - o.x, o.ty - o.y);
      this.T = Math.max(1.2, d / 360);
      this.h = 160 + d * 0.32;
      this.t = 0; this.trail = 0;
      this.px = this.x; this.py = this.y; this.pz = this.z;
      this.wob = rand(0, 6);
    }
    update(dt) {
      const g = this.game;
      this.t += dt;
      this.px = this.x; this.py = this.y; this.pz = this.z;
      const k = Math.min(1, this.t / this.T);
      const wob = Math.sin(this.t * 7 + this.wob) * 10 * (1 - k);
      this.x = this.sx + (this.tx - this.sx) * k + wob;
      this.y = this.sy + (this.ty - this.sy) * k;
      this.z = this.sz * (1 - k) + this.tz * k + 4 * this.h * k * (1 - k);
      this.trail -= dt;
      if (this.trail <= 0) {
        this.trail = 0.02;
        g.particles.spawn({ type: 'smoke', x: this.x, y: this.y, z: this.z, size: rand(6, 9), grow: 2.2, color: '#a39d92', alpha: 0.55, life: rand(0.8, 1.2), vz: 4, drag: 1.2 });
      }
      if (g.shieldCatch(this)) return;
      if (k >= 1) {
        this.dead = true;
        g.particles.explosion(this.x, this.y, this.z, 58);
        g.audio.play('boom_m');
        g.shake(4);
        g.applyEnemyHit(this.payload, this.x, this.y, this.z);
      }
    }
    /** Shot down mid-air by the tower. */
    intercept() {
      const g = this.game;
      this.dead = true;
      g.particles.explosion(this.x, this.y, this.z, 34, { scorch: false, debris: false });
      g.particles.debris(this.x, this.y, this.z, { count: 4, speed: 120, size: 3 });
      g.audio.play('intercept');
    }
    draw(ctx) {
      const g = this.game;
      const sh = g.project(this.x, this.y, 0);
      D.shadow(ctx, sh.x, sh.y, 8, 3, 0.25);
      const s = g.project(this.x, this.y, this.z);
      drawMissile(ctx, s, TD.Camera.screenVector({ x: this.px, y: this.py, z: this.pz }, this).angle, 20, '#6f7a4c', true, this.t, 'rocket');
      // red threat marker
      const pulse = 0.5 + 0.5 * Math.sin(this.t * 18);
      ctx.strokeStyle = `rgba(255,60,50,${0.4 + pulse * 0.5})`; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(s.x, s.y, 13, 0, Math.PI * 2); ctx.stroke();
      if (this.hp < this.maxHp) {
        ctx.fillStyle = '#000a'; ctx.fillRect(s.x - 12, s.y - 22, 24, 4);
        ctx.fillStyle = '#ff5040'; ctx.fillRect(s.x - 12, s.y - 22, 24 * (this.hp / this.maxHp), 4);
      }
    }
  }

  /** 🧪 Toxic gas canister lobbed by the mortar — tumbling arc, green smoke, bursts into a cloud. */
  class GasCanister extends Projectile {
    constructor(game, o) {
      super(game, o);
      this.sx = o.x; this.sy = o.y; this.sz = o.z;
      this.t = 0; this.T = o.T || 1.15; this.h = 230; this.rot = 0;
    }
    update(dt) {
      this.t += dt;
      const k = Math.min(1, this.t / this.T);
      this.x = this.sx + (this.tx - this.sx) * k;
      this.y = this.sy + (this.ty - this.sy) * k;
      this.z = this.sz * (1 - k) + 4 * this.h * k * (1 - k);
      this.rot += dt * 12;
      if (Math.random() < 0.6) this.game.particles.spawn({ type: 'smoke', x: this.x, y: this.y, z: this.z, size: 5, grow: 2.4, color: '#8fd14a', alpha: 0.45, life: 0.6 });
      if (k >= 1) { this.dead = true; this.owner.land(this.x, this.y); }
    }
    draw(ctx) {
      const g = this.game;
      const sh = g.project(this.x, this.y, 0);
      D.shadow(ctx, sh.x, sh.y, 6, 3, 0.3);
      const s = g.project(this.x, this.y, this.z);
      if (TD.S3 && TD.S3.has('gas_canister')) { TD.S3.drawRot(ctx, 'gas_canister', s.x, s.y, this.rot, 16); return; }
      ctx.save(); ctx.translate(s.x, s.y); ctx.rotate(this.rot);
      ctx.fillStyle = '#4d5a2a'; D.roundRect(ctx, -8, -4, 16, 8, 3); ctx.fill();
      ctx.fillStyle = '#d8e83a'; ctx.fillRect(-2, -4, 4, 8);
      ctx.fillStyle = '#222'; ctx.fillRect(6, -3, 3, 6);
      ctx.restore();
    }
  }

  /** 🛸 Carpet-bomb from the enemy Heavy Bomber — parabolic drop, white fin smoke trail. */
  class EnemyBomb extends Projectile {
    constructor(game, o) { super(game, o); this.vz = -20; this.hostile = true; this.t = 0; this.sx = o.x; this.sy = o.y; }
    update(dt) {
      const g = this.game;
      this.t += dt;
      this.vz -= 520 * dt;
      this.x += this.vx * dt; this.y += this.vy * dt; this.z += this.vz * dt;
      this.vx *= 1 - dt * 0.5; this.vy *= 1 - dt * 0.5;
      if (Math.random() < 0.9) g.particles.spawn({ type: 'smoke', x: this.x, y: this.y, z: this.z + 6, size: 3.5, grow: 2.2, color: '#f2f2ee', alpha: 0.5, life: 0.7 });
      if (g.shieldCatch(this)) return;
      if (this.z <= 0) { this.dead = true; g.enemyBombHit(this.x, this.y, this.dmg, this.radius); }
    }
    draw(ctx) {
      const g = this.game;
      const sh = g.project(this.x, this.y, 0);
      D.shadow(ctx, sh.x, sh.y, 9, 4, 0.35);
      const s = g.project(this.x, this.y, this.z);
      const a = TD.Camera.screenAngleOfVelocity(this.vx, this.vy, this.vz);
      if (TD.S3 && TD.S3.has('bomb')) { TD.S3.drawRot(ctx, 'bomb', s.x, s.y, Math.PI / 2 - Math.min(1.2, Math.max(-1.2, a * 0.3)), 24); return; }
      ctx.save(); ctx.translate(s.x, s.y); ctx.rotate(Math.PI / 2 - Math.min(1.2, Math.max(-1.2, a * 0.3)));
      ctx.fillStyle = '#2f342b'; D.roundRect(ctx, -11, -4.5, 22, 9, 4.5); ctx.fill();
      ctx.fillStyle = '#c93020'; ctx.fillRect(4, -4.5, 2.5, 9);
      ctx.fillStyle = '#1b1e19';
      ctx.beginPath(); ctx.moveTo(-10, 0); ctx.lineTo(-16, -7); ctx.lineTo(-16, 7); ctx.closePath(); ctx.fill();
      ctx.restore();
    }
  }

  /** 🛡️ Aegis Lv3 — absorbed shot reflected back at its shooter. */
  class ReflectShot extends Projectile {
    constructor(game, o) { super(game, o); this.t = 0; this.px = o.x; this.py = o.y; this.pz = o.z; }
    update(dt) {
      const tg = this.target;
      if (!tg || tg.dead) { this.dead = true; return; }
      this.px = this.x; this.py = this.y; this.pz = this.z;
      const tz = (tg.z || 0) + tg.height * 0.5;
      const dx = tg.x - this.x, dy = tg.y - this.y, dz = tz - this.z;
      const L = Math.hypot(dx, dy, dz) || 1, step = 1500 * dt;
      if (L <= step + 8) {
        this.dead = true;
        this.game.damageEnemy(tg, this.dmg, { source: 'reflect', style: 'shock' });
        this.game.particles.sparks(tg.x, tg.y, tz, { count: 8, color: '#9ff6ff', speed: 220 });
        return;
      }
      this.x += (dx / L) * step; this.y += (dy / L) * step; this.z += (dz / L) * step;
    }
    draw(ctx) {
      const g = this.game;
      const a = g.project(this.px, this.py, this.pz), b = g.project(this.x, this.y, this.z);
      const sv = TD.Camera.screenVector({ x: this.px, y: this.py, z: this.pz }, this);
      const ex = b.x + sv.dx * 2, ey = b.y + sv.dy * 2;
      TD.PostFX.glowLineS(a.x, a.y, ex, ey, 12, '#5ae0ff', 0.9);
      ctx.globalCompositeOperation = 'lighter'; ctx.lineCap = 'round';
      ctx.strokeStyle = 'rgba(90,230,255,0.55)'; ctx.lineWidth = 7;
      ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(ex, ey); ctx.stroke();
      ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(ex, ey); ctx.stroke();
      ctx.globalCompositeOperation = 'source-over';
    }
  }

  TD.Projectiles = { drawStreak, STREAK, Projectile, Tracer, HomingRocket, SamMissile, Bomb, NukeWarhead, ArtyShell, EnemyBullet, TankShell, EnemyRocket, GasCanister, EnemyBomb, ReflectShot, drawMissile };
})(window.TD);
