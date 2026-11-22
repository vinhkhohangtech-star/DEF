/* =========================================================
   ParticleSystem.js — military FX: soft smoke, fire, sparks,
   brass casings, debris, shockwaves, tracer lines, neon
   bolts, scorch marks and a full nuclear mushroom cloud.
   Particles live in WORLD space (x, y ground plane, z height)
   and are projected to the 2.5D screen when drawn.
   Layers: 'ground' (under units) and 'top' (above units).
   ========================================================= */
(function (TD) {
  'use strict';
  const { rand, pick } = TD.util;
  const D = TD.Draw;
  const MAX_PARTICLES = 2200;

  class Particle {
    constructor(o) {
      this.x = 0; this.y = 0; this.z = 0;
      this.vx = 0; this.vy = 0; this.vz = 0;
      this.g = 0;
      this.drag = 0;
      this.life = 1;
      this.size = 6;
      this.grow = 0;
      this.color = '#fff';
      this.type = 'smoke';
      this.rot = 0; this.vr = 0;
      this.layer = 'top';
      this.alpha = 1;
      Object.assign(this, o);
      this.max = this.life;
    }
  }

  /** Cached fireball gradient: blinding white core → incandescent yellow → deep orange → soot edge. */
  let _fireball = null, _crater = null;
  function fireballSprite() {
    if (_fireball) return _fireball;
    const c = document.createElement('canvas'); c.width = c.height = 128;
    const x = c.getContext('2d');
    const g = x.createRadialGradient(64, 64, 0, 64, 64, 64);
    g.addColorStop(0, 'rgba(255,255,255,1)');
    g.addColorStop(0.16, 'rgba(255,250,215,1)');
    g.addColorStop(0.34, 'rgba(255,214,90,0.95)');
    g.addColorStop(0.58, 'rgba(255,120,30,0.8)');
    g.addColorStop(0.8, 'rgba(150,40,10,0.45)');
    g.addColorStop(1, 'rgba(40,20,10,0)');
    x.fillStyle = g; x.fillRect(0, 0, 128, 128);
    return (_fireball = c);
  }
  function craterSprite() {
    if (_crater) return _crater;
    const c = document.createElement('canvas'); c.width = c.height = 96;
    const x = c.getContext('2d');
    const g = x.createRadialGradient(48, 52, 4, 48, 48, 46);
    g.addColorStop(0, 'rgba(10,8,6,0.95)'); g.addColorStop(0.55, 'rgba(30,24,18,0.85)');
    g.addColorStop(0.78, 'rgba(90,74,52,0.65)'); g.addColorStop(0.9, 'rgba(140,120,85,0.45)'); g.addColorStop(1, 'rgba(0,0,0,0)');
    x.fillStyle = g; x.beginPath(); x.arc(48, 48, 46, 0, Math.PI * 2); x.fill();
    x.strokeStyle = 'rgba(10,8,6,0.5)'; x.lineWidth = 2;
    for (let i = 0; i < 9; i++) {
      const a = (i / 9) * Math.PI * 2 + Math.random() * 0.4;
      x.beginPath(); x.moveTo(48 + Math.cos(a) * 18, 48 + Math.sin(a) * 18);
      x.lineTo(48 + Math.cos(a + 0.15) * (34 + Math.random() * 10), 48 + Math.sin(a + 0.15) * (34 + Math.random() * 10)); x.stroke();
    }
    return (_crater = c);
  }

  /** Graphics toggles (perf profiling / low-end fallback). */
  TD.FX = TD.FX || { refraction: true, shimmer: true };

  class ParticleSystem {
    constructor(game) {
      this.game = game;
      this.list = [];
    }

    clear() { this.list.length = 0; }

    spawn(o) {
      if (this.list.length >= MAX_PARTICLES) this.list.splice(0, 40);
      const p = new Particle(o);
      this.list.push(p);
      return p;
    }

    /* ---------------- emitters ---------------- */

    /** Soft drifting smoke. */
    smoke(x, y, z = 0, { count = 6, color = '#7a7a72', size = 18, speed = 60, life = 1.1, rise = 50, grow = 1.4, alpha = 0.7, fadeIn = 0 } = {}) {
      for (let i = 0; i < count; i++) {
        const a = Math.random() * Math.PI * 2;
        const sp = speed * rand(0.3, 1.1);
        this.spawn({
          type: 'smoke', x, y, z: z + rand(-4, 8),
          vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, vz: rise * rand(0.4, 1.4),
          size: size * rand(0.7, 1.25), grow, color, alpha, life: life * rand(0.7, 1.3), drag: 2.4, fadeIn,
        });
      }
    }
    /** Back-compat alias used by older call sites. */
    puff(x, y, z = 0, o = {}) { this.smoke(x, y, z, { count: o.count, color: o.color || '#cfcac0', size: o.size, speed: o.speed, life: o.life || 0.6, rise: o.rise, alpha: 0.75 }); }

    /** Additive fireball blobs. */
    fire(x, y, z = 0, { count = 8, size = 26, speed = 140, life = 0.45, rise = 60 } = {}) {
      for (let i = 0; i < count; i++) {
        const a = Math.random() * Math.PI * 2;
        const sp = speed * rand(0.2, 1);
        this.spawn({
          type: 'fire', x, y, z: z + rand(0, 10),
          vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, vz: rise * rand(0.3, 1.5),
          size: size * rand(0.6, 1.3), grow: 0.6, color: pick(['#ffd36b', '#ff9a3c', '#ff6a2a']),
          life: life * rand(0.6, 1.2), drag: 3,
        });
      }
    }

    sparks(x, y, z = 20, { count = 10, color = '#ffd23f', speed = 320, life = 0.32, up = 0.8 } = {}) {
      for (let i = 0; i < count; i++) {
        const a = Math.random() * Math.PI * 2;
        const sp = speed * rand(0.4, 1.1);
        this.spawn({
          type: 'spark', x, y, z,
          vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, vz: rand(-0.3, 1) * sp * up,
          g: -500, color, life: life * rand(0.6, 1.2), drag: 3, size: rand(1.5, 3.2),
        });
      }
    }

    /** Ejected brass shell casing. */
    casing(x, y, z, ang) {
      const a = ang + Math.PI / 2 + rand(-0.4, 0.4);
      const sp = rand(90, 160);
      this.spawn({
        type: 'casing', x, y, z, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, vz: rand(140, 230),
        g: -900, drag: 0.6, rot: rand(0, 6), vr: rand(-25, 25), life: rand(0.9, 1.4), size: 3,
      });
    }

    debris(x, y, z = 10, { count = 6, color = '#5d5a52', speed = 200, size = 5 } = {}) {
      for (let i = 0; i < count; i++) {
        const a = Math.random() * Math.PI * 2;
        const sp = speed * rand(0.4, 1.1);
        this.spawn({
          type: 'debris', x, y, z,
          vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, vz: rand(160, 340),
          g: -980, drag: 0.7, color, size: size * rand(0.5, 1.3),
          rot: rand(0, 6), vr: rand(-12, 12), life: rand(0.8, 1.4),
        });
      }
    }

    /** Expanding ground shockwave ring. */
    ring(x, y, { radius = 80, color = '#ffffff', life = 0.4, width = 6 } = {}) {
      this.spawn({ type: 'ring', layer: 'ground', x, y, size: radius, color, life, width });
    }

    /** Short bright flash (muzzle / explosion core). color = 'r,g,b'. */
    flash(x, y, z = 0, { size = 60, color = '255,236,170', life = 0.12 } = {}) {
      this.spawn({ type: 'flash', x, y, z, size, color, life });
    }

    /** Neon electric bolt between world points [{x,y,z}, ...]. */
    bolt(points, { color = '#7ff3ff', glow = 'rgba(80,180,255,0.45)', life = 0.22, jag = 16 } = {}) {
      const pts = [];
      for (let i = 0; i < points.length - 1; i++) {
        const a = points[i], b = points[i + 1];
        const steps = 7;
        for (let s = 0; s < steps; s++) {
          const t = s / steps;
          const off = s === 0 ? 0 : jag;
          pts.push({ x: a.x + (b.x - a.x) * t + rand(-off, off), y: a.y + (b.y - a.y) * t + rand(-off, off), z: a.z + (b.z - a.z) * t + rand(-off, off) });
        }
      }
      pts.push(points[points.length - 1]);
      // a few side branches
      const branches = [];
      for (let k = 0; k < Math.min(4, pts.length / 5); k++) {
        const p0 = pick(pts);
        const br = [p0];
        let q = p0;
        for (let s = 0; s < 3; s++) { q = { x: q.x + rand(-26, 26), y: q.y + rand(-26, 26), z: q.z + rand(-20, 10) }; br.push(q); }
        branches.push(br);
      }
      this.spawn({ type: 'bolt', points: pts, branches, color, glow, life });
    }

    /** Straight tracer / laser line between two world points. */
    line(a, b, { color = '#fff6c0', width = 3, glow = 'rgba(255,200,80,0.35)', life = 0.08 } = {}) {
      this.spawn({ type: 'line', a, b, color, width, glow, life });
    }

    scorch(x, y, radius = 60, life = 6) {
      this.spawn({ type: 'scorch', layer: 'ground', x, y, size: radius, life, rot: rand(0, 6) });
    }

    /** Green "+" healing / repair signs. */
    plus(x, y, z = 60, count = 10) {
      for (let i = 0; i < count; i++) {
        this.spawn({ type: 'plus', x: x + rand(-60, 60), y: y + rand(-40, 40), z: z + rand(0, 80), vz: rand(60, 120), size: rand(16, 26), life: rand(0.8, 1.3) });
      }
    }

    /** Back-compat: celebratory sparkles (now: tactical green/gold sparks). */
    confetti(x, y, z = 30, count = 24, power = 1) {
      for (let i = 0; i < count; i++) {
        const a = Math.random() * Math.PI * 2;
        const sp = rand(60, 220) * power;
        this.spawn({
          type: 'spark', x, y, z, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, vz: rand(120, 360) * power,
          g: -500, drag: 1.6, color: pick(['#b8ff5a', '#ffd23f', '#ffffff', '#5ae0ff']), life: rand(0.6, 1.1), size: rand(2, 3.5),
        });
      }
    }

    /** Incandescent molten shrapnel: physics arc, smoky spark trail, embeds & glows on the ground. */
    shrapnel(x, y, z = 10, { count = 8, speed = 320 } = {}) {
      for (let i = 0; i < count; i++) {
        const a = Math.random() * Math.PI * 2;
        const sp = speed * rand(0.45, 1.15);
        this.spawn({
          type: 'shrapnel', x, y, z: z + rand(0, 8),
          vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, vz: rand(140, 420),
          g: -900, drag: 0.5, size: rand(1.6, 3), life: rand(1.6, 2.6), trailT: 0, stuck: false,
        });
      }
    }

    /** Expanding shockwave with atmospheric refraction (screen-space distortion ring). */
    shockwave(x, y, radius = 120, life = 0.45) {
      this.spawn({ type: 'shock', layer: 'top', x, y, z: 0, size: radius, life });
    }

    /** Lingering crater decal (15 s, slow fade). */
    crater(x, y, radius = 50, life = 15) {
      let n = 0;
      for (let i = this.list.length - 1; i >= 0; i--) if (this.list[i].type === 'scorch' && ++n > 70) { this.list.splice(i, 1); break; }
      this.spawn({ type: 'scorch', layer: 'ground', x, y, size: radius, life, rot: rand(0, 6), crater: true, seed: Math.random() * 100 });
    }

    /** Tunnel / eruption soil chunks + dust. */
    soil(x, y, { count = 6, speed = 160, dust = 3 } = {}) {
      this.debris(x, y, 2, { count, color: pick(['#6b5636', '#58462b', '#7d6640']), speed, size: 4 });
      if (dust) this.smoke(x, y, 4, { count: dust, size: 14, speed: speed * 0.3, life: 0.9, rise: 25, color: '#9c8a68', alpha: 0.5 });
    }

    /** Particles streaking inward to (x, y) — gravity vortex. */
    streaks(x, y, r, { count = 3, color = '#c48aff' } = {}) {
      for (let i = 0; i < count; i++) {
        const a = Math.random() * Math.PI * 2;
        const rr = r * rand(0.6, 1);
        const T = rand(0.35, 0.6);
        this.spawn({ type: 'spark', x: x + Math.cos(a) * rr, y: y + Math.sin(a) * rr, z: rand(4, 30),
          vx: -Math.cos(a) * rr / T, vy: -Math.sin(a) * rr / T, vz: 0, color, life: T, size: rand(1.5, 2.6) });
      }
    }

    /** Hypersonic hitscan beam (railgun / reflected bolt). a, b = world points. */
    beam(a, b, { core = '#ffffff', glow = '80,220,255', width = 5, life = 0.35 } = {}) {
      this.spawn({ type: 'beam', a, b, core, glow, width, life });
    }

    /** Crumpled parachute fabric left on the ground. */
    chute(x, y, burnt = false) { this.spawn({ type: 'chute', layer: 'ground', x, y, life: 9, rot: rand(-0.4, 0.4), burnt }); }

    /* ---------------- composite explosions ---------------- */

    /**
     * Multi-layered high-explosive blast. scale ~ radius/80.
     * L1 screen whiteout pop • L2 fireball (white core → yellow → orange → soot)
     * L3 refraction shockwave • L4 molten shrapnel • L5 15 s crater decal.
     */
    explosion(x, y, z = 0, radius = 80, { smoke = true, scorch = true, debris = true, quiet = false } = {}) {
      const s = radius / 80;
      const g = this.game;
      if (!quiet && g.blast) g.blast(radius);
      this.flash(x, y, z + 10, { size: radius * 1.6, color: '255,250,235', life: 0.12 });
      this.fire(x, y, z + 4, { count: Math.round(5 + 4 * s), size: 18 * Math.sqrt(s) + 8, speed: radius * 1.4, life: 0.38 + 0.08 * s, rise: 70 * s });
      if (smoke) {
        // rolling, billowing black soot
        this.smoke(x, y, z + 14, { count: Math.round(5 + 4 * s), size: 22 * Math.sqrt(s) + 10, speed: radius * 0.8, life: 1.5 + 0.4 * s, rise: 70 * s, color: '#24211e', alpha: 0.62, grow: 1.8, fadeIn: 0.28 });
        this.smoke(x, y, z + 6, { count: Math.round(2 + 2 * s), size: 18 * Math.sqrt(s) + 8, speed: radius * 1.2, life: 1.1, rise: 25, color: '#6d655a', alpha: 0.45, fadeIn: 0.2 });
      }
      // fireball(s)
      this.spawn({ type: 'fireball', x, y, z: z + radius * 0.25, size: radius * 0.75, life: 0.5 + 0.12 * s, vz: 40 * s });
      if (s > 0.8) for (let i = 0; i < Math.min(5, Math.round(s * 2)); i++) {
        const a = Math.random() * Math.PI * 2, d = radius * rand(0.2, 0.5);
        this.spawn({ type: 'fireball', x: x + Math.cos(a) * d, y: y + Math.sin(a) * d, z: z + rand(5, radius * 0.4), size: radius * rand(0.35, 0.55), life: rand(0.4, 0.65), vz: rand(30, 90) });
      }

      this.sparks(x, y, z + 10, { count: Math.round(8 + 6 * s), color: '#ffd76a', speed: 260 + 120 * s, life: 0.4 });
      if (debris) this.shrapnel(x, y, z + 6, { count: Math.round(3 + 4 * s), speed: 200 + 110 * s });
      this.ring(x, y, { radius: radius * 1.1, color: '#ffe7b0', width: 5 * Math.sqrt(s) + 2, life: 0.3 });
      if (radius >= 55) this.shockwave(x, y, radius * 1.7, 0.35 + 0.08 * s);
      if (scorch && z < 30) this.crater(x, y, radius * 0.62, 15);
    }

    /** ☢ Nuclear detonation: mushroom cloud + layered shockwaves. */
    nuke(x, y, radius) {
      this.spawn({ type: 'mushroom', x, y, z: 0, size: radius, life: 6.5 });
      this.flash(x, y, 40, { size: radius * 3.2, color: '255,255,235', life: 0.6 });
      for (let i = 0; i < 4; i++) {
        this.spawn({ type: 'ring', layer: 'ground', x, y, size: radius * (1.3 + i * 0.55), color: i % 2 ? '#ffb347' : '#fff6d0', width: 22 - i * 4, life: 0.7 + i * 0.25 });
      }
      this.fire(x, y, 10, { count: 46, size: 60, speed: radius * 2.4, life: 0.9, rise: 120 });
      this.smoke(x, y, 10, { count: 26, size: 46, speed: radius * 1.9, life: 2.6, rise: 30, color: '#6a5a48', alpha: 0.65, grow: 1.6 });
      this.sparks(x, y, 30, { count: 90, color: '#fff2a0', speed: 900, life: 0.9 });
      this.debris(x, y, 20, { count: 34, speed: 700, size: 7 });
      this.shrapnel(x, y, 30, { count: 40, speed: 900 });
      this.spawn({ type: 'fireball', x, y, z: 60, size: radius * 1.3, life: 1.1, vz: 120 });
      this.shockwave(x, y, Math.min(330, radius * 1.4), 0.7);
      this.crater(x, y, radius * 0.9, 18);
      this.spawn({ type: 'fallout', layer: 'ground', x, y, size: radius * 0.8, life: 5.5 });
    }

    /* ---------------- simulation ---------------- */
    update(dt) {
      const L = this.list;
      for (let i = L.length - 1; i >= 0; i--) {
        const p = L[i];
        p.life -= dt;
        if (p.life <= 0) { L.splice(i, 1); continue; }
        if (p.type === 'mushroom') { this.updateMushroom(p, dt); continue; }
        if (p.type === 'shrapnel') {
          if (p.stuck) continue;
          p.trailT -= dt;
          if (p.trailT <= 0 && this.list.length < MAX_PARTICLES - 200) {
            p.trailT = 0.07;
            this.spawn({ type: 'smoke', x: p.x, y: p.y, z: p.z, size: 3, grow: 2.5, color: '#4a4540', alpha: 0.35, life: 0.45 });
          }
          if (p.z <= 0 && p.vz < 0) { p.z = 0; p.stuck = true; p.life = Math.min(p.life, 1.4); p.max = 1.4; continue; }
        }
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        p.z += p.vz * dt;
        p.vz += p.g * dt;
        if (p.drag) {
          const f = Math.max(0, 1 - p.drag * dt);
          p.vx *= f; p.vy *= f;
          if (p.type === 'smoke' || p.type === 'fire') p.vz *= f;
        }
        if (p.g < 0 && p.z < 0) {
          p.z = 0;
          p.vz *= -0.35;
          p.vx *= 0.55; p.vy *= 0.55;
          p.vr *= 0.5;
        }
        p.rot += p.vr * dt;
      }
    }

    updateMushroom(p, dt) {
      // emit rolling smoke into the stem & cap while the cloud forms
      const age = p.max - p.life;
      if (age < 3.2 && Math.random() < 0.9) {
        const gy = this.game.project(p.x, p.y, 0).y;
        const capZ = Math.max(60, Math.min(Math.min(1, age / 1.6) * p.size * 0.85 + 40, gy - 150));
        const a = Math.random() * Math.PI * 2;
        const r = p.size * (0.25 + Math.min(1, age / 1.2) * 0.35) * Math.sqrt(Math.random());
        this.spawn({
          type: 'smoke', x: p.x + Math.cos(a) * r, y: p.y + Math.sin(a) * r * 0.6, z: capZ + rand(-20, 20),
          vx: Math.cos(a) * 30, vy: Math.sin(a) * 18, vz: rand(5, 25), size: rand(28, 46), grow: 0.8,
          color: age < 0.9 ? '#ff9a4a' : pick(['#7a6a58', '#8d7b66', '#5e5246']), alpha: 0.75, life: rand(1.6, 2.6), drag: 1,
        });
      }
    }

    draw(ctx, layer) {
      const g = this.game;
      this._refr = 0;
      for (const p of this.list) {
        if (p.layer !== layer) continue;
        const t = p.life / p.max;   // 1 -> 0
        const s = g.project(p.x, p.y, p.z);
        switch (p.type) {
          case 'smoke': {
            const r = p.size * (1 + (1 - t) * p.grow);
            ctx.globalAlpha = Math.min(1, t * 1.8) * p.alpha * (p.fadeIn ? Math.min(1, (p.max - p.life) / p.fadeIn) : 1);
            ctx.drawImage(D.blob(p.color), s.x - r, s.y - r, r * 2, r * 2);
            break;
          }
          case 'fire': {
            const r = p.size * (1 + (1 - t) * p.grow);
            ctx.globalCompositeOperation = 'lighter';
            ctx.globalAlpha = Math.min(1, t * 1.6);
            ctx.drawImage(D.blob(p.color), s.x - r, s.y - r, r * 2, r * 2);
            ctx.globalCompositeOperation = 'source-over';
            break;
          }
          case 'spark': {
            const e = g.project(p.x - p.vx * 0.03, p.y - p.vy * 0.03, p.z - p.vz * 0.03);
            ctx.globalAlpha = Math.min(1, t * 2);
            ctx.strokeStyle = p.color;
            ctx.lineWidth = p.size * (0.5 + t);
            ctx.lineCap = 'round';
            ctx.beginPath(); ctx.moveTo(s.x, s.y); ctx.lineTo(e.x, e.y); ctx.stroke();
            break;
          }
          case 'casing': {
            ctx.globalAlpha = Math.min(1, t * 3);
            ctx.save();
            ctx.translate(s.x, s.y); ctx.rotate(p.rot);
            ctx.fillStyle = '#e8b54a';
            ctx.fillRect(-3.5, -1.3, 7, 2.6);
            ctx.fillStyle = '#8a5e1a';
            ctx.fillRect(2.5, -1.3, 1.2, 2.6);
            ctx.restore();
            break;
          }
          case 'debris': {
            ctx.globalAlpha = Math.min(1, t * 3);
            ctx.save();
            ctx.translate(s.x, s.y); ctx.rotate(p.rot);
            ctx.fillStyle = p.color;
            ctx.beginPath();
            ctx.moveTo(-p.size, -p.size * 0.4); ctx.lineTo(-p.size * 0.2, -p.size);
            ctx.lineTo(p.size, -p.size * 0.3); ctx.lineTo(p.size * 0.6, p.size * 0.8);
            ctx.lineTo(-p.size * 0.7, p.size * 0.7); ctx.closePath();
            ctx.fill();
            ctx.restore();
            break;
          }
          case 'ring': {
            const r = p.size * (1 - t * t * 0.85);
            ctx.globalAlpha = t;
            ctx.strokeStyle = p.color;
            ctx.lineWidth = p.width * t + 1;
            ctx.beginPath();
            ctx.ellipse(s.x, s.y, r, r * g.ISO, 0, 0, Math.PI * 2);
            ctx.stroke();
            break;
          }
          case 'flash': {
            const r = p.size * (1.2 - t * 0.4);
            const grd = ctx.createRadialGradient(s.x, s.y, 0, s.x, s.y, r);
            grd.addColorStop(0, `rgba(${p.color},${t})`);
            grd.addColorStop(1, `rgba(${p.color},0)`);
            ctx.globalAlpha = 1;
            ctx.globalCompositeOperation = 'lighter';
            ctx.fillStyle = grd;
            ctx.beginPath(); ctx.arc(s.x, s.y, r, 0, Math.PI * 2); ctx.fill();
            ctx.globalCompositeOperation = 'source-over';
            break;
          }
          case 'bolt': {
            ctx.globalAlpha = Math.min(1, t * 2.5);
            ctx.lineJoin = 'round'; ctx.lineCap = 'round';
            const pts = p.points.map((q) => g.project(q.x, q.y, q.z));
            const path = (arr) => { ctx.beginPath(); ctx.moveTo(arr[0].x, arr[0].y); for (let i = 1; i < arr.length; i++) ctx.lineTo(arr[i].x, arr[i].y); ctx.stroke(); };
            ctx.globalCompositeOperation = 'lighter';
            ctx.strokeStyle = p.glow; ctx.lineWidth = 12; path(pts);
            ctx.strokeStyle = p.color; ctx.lineWidth = 4; path(pts);
            ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 1.6; path(pts);
            ctx.strokeStyle = p.color; ctx.lineWidth = 1.5;
            for (const br of p.branches) path(br.map((q) => g.project(q.x, q.y, q.z)));
            ctx.globalCompositeOperation = 'source-over';
            break;
          }
          case 'line': {
            const a = g.project(p.a.x, p.a.y, p.a.z), b = g.project(p.b.x, p.b.y, p.b.z);
            ctx.globalAlpha = Math.min(1, t * 1.5);
            ctx.lineCap = 'round';
            ctx.globalCompositeOperation = 'lighter';
            ctx.strokeStyle = p.glow; ctx.lineWidth = p.width * 3.5;
            ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
            ctx.strokeStyle = p.color; ctx.lineWidth = p.width;
            ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
            ctx.globalCompositeOperation = 'source-over';
            break;
          }
          case 'scorch': {
            const r = p.size;
            ctx.save();
            ctx.translate(s.x, s.y); ctx.scale(1, g.ISO); ctx.rotate(p.rot);
            if (p.crater) {
              const age = p.max - p.life;
              ctx.globalAlpha = Math.min(0.62, (p.life / p.max) * 1.6);
              ctx.drawImage(D.blob('#0d0b08', 0.35), -r * 1.25, -r * 1.25, r * 2.5, r * 2.5);
              ctx.drawImage(craterSprite(), -r * 0.75, -r * 0.75, r * 1.5, r * 1.5);
              if (age < 3) { // glowing embers still cooling in the crater
                ctx.globalCompositeOperation = 'lighter';
                ctx.globalAlpha = (1 - age / 3) * 0.55;
                ctx.drawImage(D.blob('#ff5a1a'), -r * 0.55, -r * 0.55, r * 1.1, r * 1.1);
                ctx.globalCompositeOperation = 'source-over';
              }
            } else {
              ctx.globalAlpha = Math.min(0.5, t * 0.9);
              ctx.drawImage(D.blob('#0d0b08', 0.35), -r, -r, r * 2, r * 2);
            }
            ctx.restore();
            break;
          }
          case 'fireball': {
            const k = 1 - t;                       // 0 -> 1
            const e = 1 - (1 - k) * (1 - k);
            const r = p.size * (0.35 + 0.85 * e);
            if (k < 0.55) {
              ctx.globalCompositeOperation = 'lighter';
              ctx.globalAlpha = Math.min(1, (0.55 - k) * 2.6);
              ctx.drawImage(fireballSprite(), s.x - r, s.y - r, r * 2, r * 2);
              ctx.globalCompositeOperation = 'source-over';
            }
            if (k > 0.3) {
              ctx.globalAlpha = Math.min(0.75, (k - 0.3) * 2.4) * t * 1.4;
              const rr = r * 1.05;
              ctx.drawImage(D.blob('#1d1a17'), s.x - rr, s.y - rr * 1.05, rr * 2, rr * 2);
            }
            break;
          }
          case 'shrapnel': {
            if (p.stuck) {
              ctx.globalCompositeOperation = 'lighter';
              ctx.globalAlpha = t;
              ctx.drawImage(D.blob('#ff6a20'), s.x - 5, s.y - 3, 10, 6);
              ctx.globalCompositeOperation = 'source-over';
              ctx.fillStyle = t > 0.5 ? '#ffd080' : '#a04010';
              ctx.fillRect(s.x - 1, s.y - 1, 2, 2);
              break;
            }
            const e = g.project(p.x - p.vx * 0.05, p.y - p.vy * 0.05, p.z - p.vz * 0.05);
            ctx.globalAlpha = 1;
            ctx.lineCap = 'round';
            ctx.strokeStyle = 'rgba(255,120,30,0.55)'; ctx.lineWidth = p.size * 2.2;
            ctx.beginPath(); ctx.moveTo(s.x, s.y); ctx.lineTo(e.x, e.y); ctx.stroke();
            ctx.strokeStyle = '#fff1b0'; ctx.lineWidth = p.size;
            ctx.beginPath(); ctx.moveTo(s.x, s.y); ctx.lineTo((s.x + e.x) / 2, (s.y + e.y) / 2); ctx.stroke();
            break;
          }
          case 'shock': this.drawShock(ctx, p, t, s); break;
          case 'beam': {
            const a = g.project(p.a.x, p.a.y, p.a.z), b = g.project(p.b.x, p.b.y, p.b.z);
            const w = p.width * (0.4 + t * 0.6);
            ctx.lineCap = 'round';
            ctx.globalCompositeOperation = 'lighter';
            const layers = [[w * 7, 0.10], [w * 4.2, 0.2], [w * 2.4, 0.45], [w * 1.4, 0.8]];
            for (const [lw, al] of layers) {
              ctx.globalAlpha = al * t;
              ctx.strokeStyle = `rgb(${p.glow})`; ctx.lineWidth = lw;
              ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
            }
            ctx.globalAlpha = Math.min(1, t * 1.6);
            ctx.strokeStyle = p.core; ctx.lineWidth = Math.max(1.2, w * 0.7);
            ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
            // helix ion trail
            ctx.strokeStyle = `rgba(${p.glow},${0.6 * t})`; ctx.lineWidth = 1.4;
            ctx.beginPath();
            const L = Math.hypot(b.x - a.x, b.y - a.y) || 1, nx = -(b.y - a.y) / L, ny = (b.x - a.x) / L;
            for (let i = 0; i <= 60; i++) {
              const k = i / 60, off = Math.sin(k * L * 0.12 + (1 - t) * 20) * w * 1.8 * (1 - t * 0.5);
              const px = a.x + (b.x - a.x) * k + nx * off, py = a.y + (b.y - a.y) * k + ny * off;
              i ? ctx.lineTo(px, py) : ctx.moveTo(px, py);
            }
            ctx.stroke();
            ctx.globalCompositeOperation = 'source-over';
            break;
          }
          case 'chute': {
            ctx.globalAlpha = Math.min(1, t * 3) * 0.9;
            ctx.save(); ctx.translate(s.x, s.y); ctx.rotate(p.rot);
            ctx.fillStyle = p.burnt ? '#2b2620' : '#5f6a3c';
            ctx.beginPath();
            ctx.moveTo(-22, 0); ctx.quadraticCurveTo(-14, -9, -4, -4); ctx.quadraticCurveTo(4, -11, 12, -3);
            ctx.quadraticCurveTo(22, -6, 24, 2); ctx.quadraticCurveTo(10, 7, -6, 5); ctx.closePath(); ctx.fill();
            ctx.strokeStyle = 'rgba(0,0,0,0.35)'; ctx.lineWidth = 1;
            ctx.beginPath(); ctx.moveTo(-10, -3); ctx.lineTo(-6, 4); ctx.moveTo(4, -6); ctx.lineTo(6, 4); ctx.moveTo(14, -3); ctx.lineTo(16, 3); ctx.stroke();
            if (!p.burnt) { ctx.fillStyle = '#7b8650'; ctx.beginPath(); ctx.ellipse(-12, -3, 5, 2, 0.3, 0, Math.PI * 2); ctx.ellipse(8, -5, 4, 1.6, -0.2, 0, Math.PI * 2); ctx.fill(); }
            ctx.restore();
            break;
          }
          case 'fallout': {
            const pulse = 0.5 + 0.5 * Math.sin(p.life * 8);
            ctx.globalAlpha = Math.min(1, t * 2) * (0.22 + pulse * 0.12);
            ctx.save();
            ctx.translate(s.x, s.y); ctx.scale(1, g.ISO);
            ctx.globalCompositeOperation = 'lighter';
            ctx.drawImage(D.blob('#8dff4a'), -p.size, -p.size, p.size * 2, p.size * 2);
            ctx.restore();
            ctx.globalCompositeOperation = 'source-over';
            break;
          }
          case 'mushroom': this.drawMushroom(ctx, p, t); break;
          case 'plus': {
            ctx.globalAlpha = Math.min(1, t * 2);
            ctx.font = `700 ${p.size}px 'Rajdhani', sans-serif`;
            ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
            ctx.lineWidth = 4; ctx.strokeStyle = '#0b120b';
            ctx.strokeText('+', s.x, s.y);
            ctx.fillStyle = '#6dff6d';
            ctx.fillText('+', s.x, s.y);
            break;
          }
        }
      }
      ctx.globalAlpha = 1;
    }

    /** Shockwave ring that refracts (lenses) the already-rendered scene underneath it. */
    drawShock(ctx, p, t, s) {
      const g = this.game;
      const k = 1 - t;
      const R = p.size * (0.15 + 0.85 * (1 - (1 - k) * (1 - k)));
      const band = Math.max(6, p.size * 0.14) * (0.5 + t * 0.5);
      // Refraction: lens the pre-rendered terrain (static canvas → no GPU readback of the live frame)
      if (TD.FX.refraction && this._refr < 4 && R > 20 && g.bg) {
        this._refr++;
        const BS = g.bgScale || 1.5;
        ctx.save();
        ctx.beginPath();
        ctx.ellipse(s.x, s.y, R + band, (R + band) * g.ISO, 0, 0, Math.PI * 2);
        ctx.ellipse(s.x, s.y, Math.max(1, R - band), Math.max(1, (R - band) * g.ISO), 0, 0, Math.PI * 2);
        ctx.clip('evenodd');
        const zoom = 1 + 0.08 * t;
        const dw = (R + band) * 2, dh = (R + band) * 2 * g.ISO;
        const sw = dw / zoom, sh = dh / zoom;
        ctx.globalAlpha = 0.9;
        try { ctx.drawImage(g.bg, (s.x - sw / 2) * BS, (s.y - sh / 2) * BS, sw * BS, sh * BS, s.x - dw / 2, s.y - dh / 2, dw, dh); } catch (e) { /* out of bounds */ }
        ctx.globalAlpha = 0.12 * t;
        ctx.fillStyle = '#fff6dc'; ctx.fillRect(s.x - dw / 2, s.y - dh / 2, dw, dh);
        ctx.restore();
      }
      ctx.globalAlpha = 0.5 * t;
      ctx.strokeStyle = '#fffdf0'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.ellipse(s.x, s.y, R + band * 0.6, (R + band * 0.6) * g.ISO, 0, 0, Math.PI * 2); ctx.stroke();
      ctx.globalAlpha = 0.25 * t;
      ctx.strokeStyle = '#000'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.ellipse(s.x, s.y, Math.max(1, R - band * 0.6), Math.max(1, (R - band * 0.6) * g.ISO), 0, 0, Math.PI * 2); ctx.stroke();
      ctx.globalAlpha = 1;
    }

    drawMushroom(ctx, p, t) {
      const g = this.game;
      const age = p.max - p.life;
      const R = p.size;
      const grow = Math.min(1, age / 1.6);
      const base = g.project(p.x, p.y, 0);
      const capZ = Math.max(60, Math.min(grow * R * 0.85 + 40, base.y - 150));
      const fade = Math.min(1, p.life / 2.2);
      const top = g.project(p.x, p.y, capZ);
      // stem
      ctx.globalAlpha = 0.85 * fade;
      const stemW = R * (0.18 + 0.06 * grow);
      const sg = ctx.createLinearGradient(base.x - stemW, 0, base.x + stemW, 0);
      sg.addColorStop(0, '#4d4036'); sg.addColorStop(0.45, age < 1.4 ? '#ffb15a' : '#8d7a64'); sg.addColorStop(1, '#3a3029');
      ctx.fillStyle = sg;
      ctx.beginPath();
      ctx.moveTo(base.x - stemW * 1.8, base.y);
      ctx.quadraticCurveTo(base.x - stemW * 0.6, (base.y + top.y) / 2, base.x - stemW * 0.9, top.y + 10);
      ctx.lineTo(base.x + stemW * 0.9, top.y + 10);
      ctx.quadraticCurveTo(base.x + stemW * 0.6, (base.y + top.y) / 2, base.x + stemW * 1.8, base.y);
      ctx.closePath();
      ctx.fill();
      // skirt ring around the stem
      ctx.globalAlpha = 0.5 * fade;
      const ringZ = capZ * 0.45;
      const rp = g.project(p.x, p.y, ringZ);
      ctx.drawImage(D.blob('#a89580'), rp.x - R * 0.55, rp.y - R * 0.16, R * 1.1, R * 0.32);
      // cap: rolling blobs
      const capR = R * (0.3 + 0.42 * grow);
      const blobs = 14;
      for (let i = 0; i < blobs; i++) {
        const a = (i / blobs) * Math.PI * 2 + age * 0.6;
        const bx = top.x + Math.cos(a) * capR * 0.75;
        const by = top.y + Math.sin(a) * capR * 0.28 - 6;
        const br = capR * 0.42;
        ctx.globalAlpha = fade;
        ctx.drawImage(D.blob(age < 1.2 ? '#ff8a3a' : (i % 2 ? '#8d7b66' : '#6e604f'), 0.35), bx - br, by - br, br * 2, br * 2);
      }
      ctx.globalAlpha = 0.95 * fade;
      ctx.drawImage(D.blob(age < 1.5 ? '#ffc070' : '#9d8a74', 0.4), top.x - capR, top.y - capR * 0.7, capR * 2, capR * 1.2);
      // inner fire glow
      if (age < 2.6) {
        ctx.globalCompositeOperation = 'lighter';
        ctx.globalAlpha = (1 - age / 2.6) * 0.9;
        ctx.drawImage(D.blob('#ff7a2a'), top.x - capR * 0.8, top.y - capR * 0.5, capR * 1.6, capR);
        ctx.drawImage(D.blob('#ffd080'), base.x - stemW * 2, base.y - stemW * 2.5, stemW * 4, stemW * 3);
        ctx.globalCompositeOperation = 'source-over';
      }
      ctx.globalAlpha = 1;
    }
  }

  TD.ParticleSystem = ParticleSystem;
})(window.TD);
