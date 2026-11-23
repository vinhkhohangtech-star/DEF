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

  /** Thermal fireball tiers: white-hot → bright yellow → orange → soot red (cached radial sprites). */
  const TIERS = [
    [[0, '255,255,255,1'], [0.3, '255,252,236,0.95'], [0.65, '255,240,200,0.45'], [1, '255,230,180,0']],
    [[0, '255,250,210,1'], [0.3, '255,226,110,0.95'], [0.68, '255,180,50,0.5'], [1, '255,150,30,0']],
    [[0, '255,196,96,0.95'], [0.35, '255,128,36,0.85'], [0.7, '214,70,16,0.45'], [1, '160,40,10,0']],
    [[0, '190,64,22,0.8'], [0.4, '130,34,12,0.6'], [0.75, '70,20,10,0.3'], [1, '40,14,8,0']],
  ];
  const TIER_GLOW = ['#fff6e0', '#ffd060', '#ff7a20', '#a8300c'];
  const _tier = [];
  function tierSprite(i) {
    if (_tier[i]) return _tier[i];
    const c = document.createElement('canvas'); c.width = c.height = 96;
    const x = c.getContext('2d'), g = x.createRadialGradient(48, 48, 0, 48, 48, 48);
    for (const [o, col] of TIERS[i]) g.addColorStop(o, `rgba(${col})`);
    x.fillStyle = g; x.fillRect(0, 0, 96, 96);
    return (_tier[i] = c);
  }
  /** Nuke mushroom proportions (v10: peak height ≈ 60 % of the v6 cloud, never covers the top HUD). */
  const NUKE_H = 0.6, NUKE_W = 0.72;
  function mushroomCapZ(R, age, groundY) { return Math.max(40, Math.min(Math.min(1, age / 1.6) * R * 0.85 * NUKE_H + 30, groundY - 190)); }

  /** Volumetric smoke puff: shadowed body + sun-lit crown + optional fire under-glow. */
  function drawPuff(ctx, x, y, r, body, lit, a, hot = 0, hard = 0.45, litA = 0.5) {
    if (r < 1 || a <= 0.01) return;
    ctx.globalAlpha = a;
    ctx.drawImage(D.blob(body, hard), x - r, y - r, r * 2, r * 2);
    ctx.globalAlpha = a * litA;
    ctx.drawImage(D.blob(lit, 0.25), x - r * 0.9, y - r * 1.02, r * 1.5, r * 1.25);
    if (hot > 0.02) {
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = a * hot * 0.75;
      ctx.drawImage(D.blob('#ff7a2a'), x - r * 0.85, y - r * 0.25, r * 1.7, r * 1.3);
      ctx.globalCompositeOperation = 'source-over';
    }
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
        g: -900, drag: 0.6, rot: rand(0, 6), vr: rand(-22, 22), tumble: rand(0, 6), vt: rand(18, 34), life: rand(1.6, 2.2), size: 3, bounces: 0,
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
    shrapnel(x, y, z = 10, { count = 8, speed = 320, delay = 0 } = {}) {
      for (let i = 0; i < count; i++) {
        const a = Math.random() * Math.PI * 2;
        const sp = speed * rand(0.45, 1.15);
        this.spawn({
          type: 'shrapnel', x, y, z: z + rand(0, 8),
          vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, vz: rand(140, 420),
          g: -900, drag: 0.5, size: rand(1.6, 3), life: rand(1.2, 1.5), trailT: 0, stuck: false, bounces: 0,
          delay: delay ? rand(delay * 0.5, delay) : 0,
        });
      }
    }

    /** Spark cone around a WORLD direction (ricochet deflection, impact spall). */
    cone(x, y, z, dir, spread = 0.45, { count = 8, color = '#e8f6ff', speed = 420, life = 0.22, size = 2 } = {}) {
      const C = TD.Camera, n = C.norm(dir), { e1, e2 } = C.basis(n);
      for (let i = 0; i < count; i++) {
        const a = Math.random() * Math.PI * 2, r = Math.tan(spread) * Math.sqrt(Math.random());
        const d = C.norm({ x: n.x + (e1.x * Math.cos(a) + e2.x * Math.sin(a)) * r, y: n.y + (e1.y * Math.cos(a) + e2.y * Math.sin(a)) * r, z: n.z + (e1.z * Math.cos(a) + e2.z * Math.sin(a)) * r });
        const sp = speed * rand(0.55, 1.1);
        this.spawn({ type: 'spark', x, y, z, vx: d.x * sp, vy: d.y * sp, vz: d.z * sp, g: -420, drag: 2.5, color: i % 3 ? color : '#ffffff', life: life * rand(0.6, 1.2), size: size * rand(0.7, 1.2) });
      }
    }

    /** Elemental ammo trail micro-particles (called by tracers). */
    ember(x, y, z) {
      this.spawn({ type: 'ember', x: x + rand(-2, 2), y: y + rand(-2, 2), z, vx: rand(-25, 25), vy: rand(-25, 25), vz: rand(10, 45), drag: 1.5, size: rand(1.2, 2.2), life: rand(0.3, 0.6), color: pick(['#ffd060', '#ff8a2a', '#ff5a14']) });
    }
    mist(x, y, z) {
      this.spawn({ type: 'smoke', x, y, z, vx: rand(-14, 14), vy: rand(-14, 14), vz: rand(-6, 10), size: rand(2.5, 4), grow: 2.6, color: '#dff8ff', alpha: 0.32, life: rand(0.35, 0.55), drag: 2 });
      if (Math.random() < 0.35) this.spawn({ type: 'spark', x, y, z, vx: rand(-40, 40), vy: rand(-40, 40), vz: rand(-20, 30), drag: 3, color: '#f0ffff', life: 0.18, size: 1.2 });
    }
    drip(x, y, z) {
      this.spawn({ type: 'drop', x, y, z, vx: rand(-20, 20), vy: rand(-20, 20), vz: rand(-30, 20), g: -700, size: rand(1.2, 2), life: 0.9, color: pick(['#b8ff3a', '#8aff20', '#dcff6a']) });
    }

    /** Expanding shockwave with atmospheric refraction (screen-space distortion ring). */
    shockwave(x, y, radius = 120, life = 0.45, strength = 0.07, delay = 0) {
      TD.PostFX.shock(x, y, radius, life, strength, delay);
    }

    /** 📡 EMP: refractive double pulse + electric ground front (flat on the ISO plane, zero tilt). */
    emp(x, y, R = 1000) {
      const FX = TD.PostFX;
      FX.shock(x, y, R, 0.9, 0.09);
      FX.shock(x, y, R * 0.55, 0.6, 0.06, 0.12);
      FX.flash(x, y, 60, 760, '#7fe8ff', 1.3, 0.7);
      this.ring(x, y, { radius: R, color: '#8af4ff', width: 18, life: 0.9 });
      this.ring(x, y, { radius: R * 0.6, color: '#ffffff', width: 9, life: 0.55 });
      this.spawn({ type: 'empfront', layer: 'top', x, y, z: 0, size: R, life: 0.9 });
      this.flash(x, y, 60, { size: 220, color: '170,240,255', life: 0.2 });
    }

    /** Lingering crater decal (15 s, slow fade). */
    crater(x, y, radius = 50, life = rand(10, 15)) {
      let n = 0;
      for (let i = this.list.length - 1; i >= 0; i--) if (this.list[i].type === 'scorch' && ++n > 70) { this.list.splice(i, 1); break; }
      this.spawn({ type: 'scorch', layer: 'ground', x, y, size: radius, life, rot: rand(0, 6), crater: true, seed: Math.random() * 100 });
    }

    /** Tunnel / eruption soil chunks + dust. */
    soil(x, y, { count = 6, speed = 160, dust = 3 } = {}) {
      this.debris(x, y, 2, { count, color: pick(['#6b5636', '#58462b', '#7d6640']), speed, size: 4 });
      if (dust) this.smoke(x, y, 4, { count: dust, size: 14, speed: speed * 0.3, life: 0.9, rise: 25, color: '#9c8a68', alpha: 0.5 });
    }

    /** 🎯 v12: stray round slapping into the dirt — tiny spark flash + kicked-up dirt spray + dust. */
    dirtHit(x, y, { strength = 1 } = {}) {
      if (this.list.length > 1800) return;
      this.spawn({ type: 'flash', x, y, z: 2, size: 14 * strength, color: '255,220,150', life: 0.05 });
      for (let i = 0; i < 2; i++) this.spawn({ type: 'spark', x, y, z: 1, vx: rand(-90, 90), vy: rand(-60, 60), vz: rand(80, 170), g: -700, color: pick(['#ffe2a0', '#ffc060']), life: rand(0.1, 0.18), size: 1.2 });
      for (let i = 0; i < 4; i++) this.spawn({ type: 'debris', x, y, z: 1, vx: rand(-40, 40), vy: rand(-30, 30), vz: rand(120, 230) * strength, g: -900, drag: 0.6, color: pick(['#6b5636', '#58462b', '#7d6640', '#8a7552']), size: rand(0.9, 1.8), rot: rand(0, 6), vr: rand(-12, 12), life: rand(0.35, 0.6) });
      this.spawn({ type: 'smoke', x, y, z: 2, vx: rand(-8, 8), vy: rand(-6, 6), vz: rand(25, 45), size: rand(3, 4.5) * strength, grow: 2.4, color: pick(['#a8967a', '#9c8a68']), alpha: 0.45, life: rand(0.5, 0.8), drag: 1.5 });
      TD.PostFX.flash(x, y, 4, 40 * strength, '#ffd890', 0.35, 0.06);
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
     * 4-phase cinematic high-explosive blast. scale ~ radius/80.
     *  P1 0.00–0.08 s  pressure: white-hot flash + ground-hugging ISO distortion ring
     *  P2 0.05–0.40 s  thermal fireball lobes  (white → yellow → orange → soot red)
     *  P3 0.20–1.50 s  incandescent shrapnel parabolas (bounce + spark trails) + curling soot pillows
     *  P4              locked scorch decal (alpha fades over 10–15 s, zero jitter)
     */
    explosion(x, y, z = 0, radius = 80, { smoke = true, scorch = true, debris = true, quiet = false } = {}) {
      const s = radius / 80, sc = Math.min(2.2, s);
      const g = this.game, FX = TD.PostFX;
      if (!quiet && g.blast) g.blast(radius);
      // ---- P1: pressure wave
      this.flash(x, y, z + 10, { size: radius * 1.35, color: '255,255,250', life: 0.08 });
      if (z < 40) this.ring(x, y, { radius: radius * 1.25, color: '#fff8e8', width: 2 + 2.5 * Math.sqrt(s), life: 0.16 });
      if (radius >= 30) FX.shock(x, y, radius * 1.8, 0.34 + 0.06 * sc, 0.045 + 0.02 * sc, 0, Math.max(0, z * 0.3));
      FX.flash(x, y, z + 25, radius * 2.8, '#ffb070', Math.min(0.9, 0.45 + 0.2 * sc), 0.3 + 0.12 * sc);
      // ---- P2: thermal fireball
      this.spawn({ type: 'tfire', x, y, z: z + radius * 0.18, size: radius * 0.62, life: 0.36, delay: 0.03, vz: 30 * s });
      const lobes = Math.round(3 + 2.5 * sc);
      for (let i = 0; i < lobes; i++) {
        const a = Math.random() * Math.PI * 2, d = radius * rand(0.12, 0.42);
        this.spawn({ type: 'tfire', x: x + Math.cos(a) * d, y: y + Math.sin(a) * d, z: z + rand(4, radius * 0.3), size: radius * rand(0.3, 0.48),
          life: rand(0.27, 0.35), delay: rand(0.04, 0.09), vx: Math.cos(a) * radius * 0.4, vy: Math.sin(a) * radius * 0.4, vz: rand(20, 70) * s, drag: 4 });
      }
      this.sparks(x, y, z + 10, { count: Math.round(6 + 4 * sc), color: '#ffe08a', speed: 240 + 110 * sc, life: 0.32 });
      // ---- P3: shrapnel + volumetric soot
      if (debris) this.shrapnel(x, y, z + 6, { count: Math.round(3 + 4 * sc), speed: 210 + 110 * sc, delay: 0.2 });
      if (smoke) {
        const n = Math.round(4 + 3.5 * sc);
        for (let i = 0; i < n; i++) {
          const a = Math.random() * Math.PI * 2, d = radius * rand(0, 0.35);
          this.spawn({ type: 'soot', x: x + Math.cos(a) * d, y: y + Math.sin(a) * d, z: z + radius * rand(0.1, 0.35),
            vx: Math.cos(a) * radius * 0.25, vy: Math.sin(a) * radius * 0.25, vz: rand(40, 85) * Math.sqrt(s),
            size: (12 * Math.sqrt(s) + 7) * rand(0.8, 1.2), grow: 1.5, color: pick(['#1c1a17', '#24211e', '#2c2824']), alpha: 0.88,
            life: rand(1.05, 1.3), drag: 1.2, delay: rand(0.18, 0.28), fadeIn: 0.12, curl: rand(30, 60) * Math.sqrt(s), cph: rand(0, 6), cf: rand(2, 4) });
        }
        if (z < 30) this.smoke(x, y, 3, { count: Math.round(2 + 2 * sc), size: 12 * Math.sqrt(s) + 6, speed: radius * 1.5, life: 0.9, rise: 12, color: '#7a6a52', alpha: 0.4, fadeIn: 0.1 });
      }
      // ---- P4: static scorch decal
      if (scorch && z < 30) this.crater(x, y, radius * 0.62);
    }

    /** ☢ Nuclear detonation: chromatic flash, double shockwave, fireball, rolling mushroom (60 % height). */
    nuke(x, y, radius) {
      const FX = TD.PostFX;
      this.spawn({ type: 'mushroom', x, y, z: 0, size: radius, life: 6.5 });
      this.flash(x, y, 40, { size: radius * 2.4, color: '255,255,240', life: 0.5 });
      FX.flash(x, y, 80, 1300, '#fff0d0', 2.2, 1.6);
      FX.flash(x, y, 60, 700, '#ff9a40', 1.2, 3.2, 0.4);
      // double shockwave: primary pressure front + reflected ground wave
      FX.shock(x, y, Math.min(760, radius * 2.4), 1.0, 0.12);
      FX.shock(x, y, Math.min(1000, radius * 3.2), 1.3, 0.08, 0.35);
      this.ring(x, y, { radius: radius * 1.6, color: '#fff6d0', width: 18, life: 0.7 });
      this.spawn({ type: 'ring', layer: 'ground', x, y, size: radius * 2.4, color: '#ffb347', width: 12, life: 0.95, delay: 0.35 });
      this.spawn({ type: 'tfire', x, y, z: 40, size: radius * 0.95, life: 0.9, vz: 90 });
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI * 2 + rand(-0.3, 0.3), d = radius * rand(0.25, 0.55);
        this.spawn({ type: 'tfire', x: x + Math.cos(a) * d, y: y + Math.sin(a) * d, z: rand(10, 60), size: radius * rand(0.35, 0.5), life: rand(0.6, 0.85), delay: rand(0.03, 0.15), vz: rand(30, 90) });
      }
      this.smoke(x, y, 10, { count: 18, size: 34, speed: radius * 1.9, life: 2.4, rise: 22, color: '#6a5a48', alpha: 0.6, grow: 1.6, fadeIn: 0.3 });
      this.sparks(x, y, 30, { count: 60, color: '#fff2a0', speed: 800, life: 0.8 });
      this.debris(x, y, 20, { count: 22, speed: 620, size: 6 });
      this.shrapnel(x, y, 30, { count: 30, speed: 820, delay: 0.2 });
      this.crater(x, y, radius * 0.9, 15);
      this.spawn({ type: 'fallout', layer: 'ground', x, y, size: radius * 0.8, life: 5.5 });
    }

    /* ---------------- simulation ---------------- */
    update(dt) {
      const L = this.list;
      for (let i = L.length - 1; i >= 0; i--) {
        const p = L[i];
        if (p.delay > 0) { p.delay -= dt; continue; }
        p.life -= dt;
        if (p.life <= 0) { L.splice(i, 1); continue; }
        if (p.type === 'mushroom') { this.updateMushroom(p, dt); continue; }
        if (p.type === 'shrapnel') {
          if (p.stuck) continue;
          p.trailT -= dt;
          if (p.trailT <= 0 && this.list.length < MAX_PARTICLES - 250) {
            p.trailT = 0.04;
            this.spawn({ type: 'spark', x: p.x, y: p.y, z: p.z, vx: p.vx * 0.05, vy: p.vy * 0.05, vz: p.vz * 0.05, color: '#ff9a3a', life: 0.14, size: 1.3 });
            if (Math.random() < 0.3) this.spawn({ type: 'smoke', x: p.x, y: p.y, z: p.z, size: 2.5, grow: 2.5, color: '#4a4540', alpha: 0.3, life: 0.4 });
          }
          if (p.z <= 0 && p.vz < 0) {
            if (p.bounces < 2 && p.vz < -120) {        // skip off the dirt, lose energy
              p.bounces++; p.z = 0; p.vz *= -0.32; p.vx *= 0.55; p.vy *= 0.55;
              if (this.list.length < MAX_PARTICLES - 250) this.spawn({ type: 'smoke', x: p.x, y: p.y, z: 1, size: 3, grow: 2, color: '#8a7a60', alpha: 0.35, life: 0.35 });
            } else { p.z = 0; p.stuck = true; p.life = Math.min(p.life, 0.9); p.max = Math.max(p.life, 0.01); continue; }
          }
        }
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        p.z += p.vz * dt;
        p.vz += p.g * dt;
        if (p.curl) {                                // soot pillows curl as they rise
          const age = p.max - p.life;
          p.vx += Math.cos(p.cph + age * p.cf) * p.curl * dt;
          p.vy += Math.sin(p.cph + age * p.cf) * p.curl * dt;
        }
        if (p.drag) {
          const f = Math.max(0, 1 - p.drag * dt);
          p.vx *= f; p.vy *= f;
          if (p.type === 'smoke' || p.type === 'fire' || p.type === 'soot') p.vz *= f;
        }
        if (p.type === 'drop' && p.z <= 0) { p.z = 0; p.g = 0; p.vx = p.vy = p.vz = 0; p.type = 'splat'; p.life = Math.min(p.life, 0.5); p.max = 0.5; continue; }
        if (p.g < 0 && p.z < 0) {
          p.z = 0;
          p.vz *= -0.35;
          p.vx *= 0.55; p.vy *= 0.55;
          p.vr *= 0.5;
          if (p.type === 'gear' && !p.rest) {      // 🪖 helmets / rifles / scrap: clank, bounce, settle
            p.bounces++;
            if (p.bounces === 1 && p.kind === 'scrap' && p.hot) this.spawn({ type: 'spark', x: p.x, y: p.y, z: 1, vx: rand(-60, 60), vy: rand(-40, 40), vz: rand(60, 120), g: -500, color: '#ffc870', life: 0.25, size: 1.3 });
            if (p.vz < 40 || p.bounces > 3) { p.vz = 0; p.g = 0; p.rest = true; p.drag = 8; p.vr *= 0.2; p.layer = 'ground'; }
          }
          if (p.type === 'casing') {               // brass: damped bounces, then lies still on the dirt
            p.vt *= 0.45; p.bounces++;
            if (p.vz < 45 || p.bounces > 3) { p.vz = 0; p.g = 0; p.rest = true; p.drag = 7; p.vr *= 0.3; p.vt = 0; }
          }
        }
        p.rot += p.vr * dt;
        if (p.vt) p.tumble += p.vt * dt;
        if (p.rest) p.vr *= Math.max(0, 1 - dt * 6);
      }
    }

    updateMushroom(p, dt) {
      // emit rolling smoke into the stem & cap while the cloud forms
      const age = p.max - p.life;
      if (age < 3.2 && Math.random() < 0.5) {
        const gy = this.game.project(p.x, p.y, 0).y;
        const capZ = mushroomCapZ(p.size, age, gy);
        const a = Math.random() * Math.PI * 2;
        const r = p.size * NUKE_W * (0.25 + Math.min(1, age / 1.2) * 0.35) * Math.sqrt(Math.random());
        this.spawn({
          type: 'soot', x: p.x + Math.cos(a) * r, y: p.y + Math.sin(a) * r * 0.6, z: capZ + rand(-20, 20),
          vx: Math.cos(a) * 30, vy: Math.sin(a) * 18, vz: rand(5, 25), size: rand(16, 26), grow: 0.8, fadeIn: 0.2,
          color: pick(['#5a4a3c', '#4e4034', '#43372e']), lit: '#d6c2a4', litA: 0.55, hard: 0.55, nohot: true, alpha: 0.85, life: rand(1.6, 2.6), drag: 1,
        });
      }
    }

    draw(ctx, layer) {
      const g = this.game, FX = TD.PostFX, C = TD.Camera;
      let glowBudget = 160;                      // emissive writes per layer per frame
      for (const p of this.list) {
        if (p.layer !== layer || p.delay > 0) continue;
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
            if (glowBudget-- > 0) FX.glowDotS(s.x, s.y, r * 1.3, p.color, Math.min(1, t * 1.6) * 0.5);
            break;
          }
          case 'ember': {
            const fl = 0.6 + 0.4 * Math.sin((p.max - p.life) * 40 + p.x);
            ctx.globalCompositeOperation = 'lighter';
            ctx.globalAlpha = Math.min(1, t * 2) * fl;
            ctx.drawImage(D.blob(p.color), s.x - p.size * 2.5, s.y - p.size * 2.5, p.size * 5, p.size * 5);
            ctx.fillStyle = '#fff2c0'; ctx.fillRect(s.x - p.size * 0.4, s.y - p.size * 0.4, p.size * 0.8, p.size * 0.8);
            ctx.globalCompositeOperation = 'source-over';
            break;
          }
          case 'drop': {
            ctx.globalAlpha = Math.min(1, t * 3);
            ctx.fillStyle = p.color;
            ctx.beginPath(); ctx.ellipse(s.x, s.y, p.size * 0.7, p.size * 1.15, 0, 0, Math.PI * 2); ctx.fill();
            break;
          }
          case 'splat': {
            const gS = C.project(p.x, p.y, 0);
            ctx.globalAlpha = t * 0.8; ctx.fillStyle = p.splatColor || '#9cff2a';
            ctx.beginPath(); ctx.ellipse(gS.sx, gS.sy, p.size * 2.2 * (1.4 - t * 0.4), p.size * 2.2 * C.ISO * (1.4 - t * 0.4), 0, 0, Math.PI * 2); ctx.fill();
            break;
          }
          case 'exhaust': {                        // 💨 v12 diesel puff: dark smoke ring that widens as it rises
            const age = 1 - t, r = p.size * (1 + age * p.grow);
            const a = Math.min(1, t * 1.6) * p.alpha * Math.min(1, age * 12 + 0.2);
            drawPuff(ctx, s.x, s.y, r, p.color, '#8a847a', a * 0.85, 0, 0.4, 0.35);
            ctx.globalAlpha = a * 0.5;
            ctx.strokeStyle = '#6a655d'; ctx.lineWidth = Math.max(0.8, r * 0.22);
            ctx.beginPath(); ctx.ellipse(s.x, s.y, r * 0.78, r * 0.48, 0, 0, Math.PI * 2); ctx.stroke();
            break;
          }
          case 'stain': {                          // 🩸 v12 blood / oil pool spreading on the dirt (ground decal)
            const age = p.max - p.life, gr = 0.35 + 0.65 * Math.min(1, age / 0.7), r = p.size * gr;
            ctx.save();
            ctx.translate(s.x, s.y); ctx.scale(1, g.ISO);
            ctx.globalAlpha = p.alpha * Math.min(1, t * 3);
            const b = D.blob(p.color, 0.65);
            for (const [lx, ly, lr] of p.lobes) ctx.drawImage(b, lx * r - lr * r, ly * r - lr * r, lr * r * 2, lr * r * 2);
            ctx.drawImage(b, -r * 0.7, -r * 0.7, r * 1.4, r * 1.4);
            ctx.restore();
            break;
          }
          case 'gear': {                           // 🪖 v12 death debris: helmet / rifle / blade / scrap / wheel
            ctx.globalAlpha = Math.min(1, t * 4);
            const gS = C.project(p.x, p.y, 0), sz = p.size;
            ctx.fillStyle = 'rgba(0,0,0,0.25)';
            ctx.beginPath(); ctx.ellipse(gS.sx, gS.sy + 0.5, Math.max(3, sz * (p.kind === 'rifle' ? 0.5 : 0.9)), 1.6, 0, 0, Math.PI * 2); ctx.fill();
            ctx.save();
            ctx.translate(s.x, s.y); ctx.rotate(p.rot);
            if (p.kind === 'helmet') {
              ctx.fillStyle = p.color;
              ctx.beginPath(); ctx.arc(0, 0, sz, Math.PI, 0); ctx.closePath(); ctx.fill();
              ctx.fillStyle = 'rgba(0,0,0,0.35)'; ctx.fillRect(-sz - 1, -0.6, sz * 2 + 2, 1.6);
              ctx.fillStyle = 'rgba(255,255,255,0.22)'; ctx.beginPath(); ctx.arc(-sz * 0.3, -sz * 0.45, sz * 0.35, 0, Math.PI * 2); ctx.fill();
            } else if (p.kind === 'rifle') {
              ctx.fillStyle = '#1e1f1c'; ctx.fillRect(-sz / 2, -1.1, sz, 2.2);
              ctx.fillStyle = '#5a3d22'; ctx.fillRect(-sz / 2 - 1, -1.6, sz * 0.3, 3.2);
              if (p.mag) { ctx.fillStyle = '#2a2a26'; ctx.fillRect(sz * 0.05, 0.8, 2.2, 3.4); }
              else { ctx.fillStyle = '#111'; ctx.fillRect(-sz * 0.05, -3, sz * 0.25, 1.8); }
            } else if (p.kind === 'blade') {
              ctx.fillStyle = '#c9ccd0'; ctx.fillRect(-1, -1, sz, 2);
              ctx.fillStyle = '#2a1d12'; ctx.fillRect(-4, -1.4, 4, 2.8);
            } else if (p.kind === 'wheel') {
              ctx.fillStyle = p.color; ctx.beginPath(); ctx.arc(0, 0, sz, 0, Math.PI * 2); ctx.fill();
              ctx.fillStyle = '#5a5a5a'; ctx.beginPath(); ctx.arc(0, 0, sz * 0.5, 0, Math.PI * 2); ctx.fill();
            } else {
              ctx.fillStyle = p.color;
              ctx.beginPath();
              ctx.moveTo(-sz, -sz * 0.3); ctx.lineTo(-sz * 0.1, -sz * 0.9); ctx.lineTo(sz, -sz * 0.2); ctx.lineTo(sz * 0.4, sz * 0.7); ctx.lineTo(-sz * 0.8, sz * 0.5);
              ctx.closePath(); ctx.fill();
              ctx.fillStyle = 'rgba(255,255,255,0.18)'; ctx.fillRect(-sz * 0.5, -sz * 0.5, sz * 0.9, 1);
              if (p.hot && !p.rest) { ctx.globalCompositeOperation = 'lighter'; ctx.fillStyle = '#ff7a2a'; ctx.fillRect(-sz * 0.3, -sz * 0.2, sz * 0.6, sz * 0.4); ctx.globalCompositeOperation = 'source-over'; }
            }
            ctx.restore();
            break;
          }
          case 'soot': {                           // ⑶ volumetric soot pillow, curling up the Z axis
            const age = p.max - p.life, r = p.size * (1 + (1 - t) * p.grow);
            const a = Math.min(1, t * 2.2) * p.alpha * Math.min(1, age / p.fadeIn);
            drawPuff(ctx, s.x, s.y, r, p.color, p.lit || '#6d645a', a, p.nohot ? 0 : Math.max(0, 1 - age / 0.45), p.hard || 0.45, p.litA || 0.5);
            break;
          }
          case 'tfire': {                          // ⑵ thermal fireball lobe — temperature-graded
            const k = 1 - t, e = 1 - Math.pow(1 - k, 3);
            const r = p.size * (0.3 + 0.8 * e);
            const f = Math.min(2.999, 3 * Math.pow(k, 0.6)), i = Math.floor(f), w = f - i;
            const I = (1 - k * 0.35) * 0.8;
            ctx.globalCompositeOperation = 'lighter';
            ctx.globalAlpha = (1 - w) * I; ctx.drawImage(tierSprite(i), s.x - r, s.y - r, r * 2, r * 2);
            ctx.globalAlpha = w * I; ctx.drawImage(tierSprite(i + 1), s.x - r, s.y - r, r * 2, r * 2);
            ctx.globalCompositeOperation = 'source-over';
            if (k > 0.5) {                         // cooling skin turns to soot
              ctx.globalAlpha = Math.min(0.7, (k - 0.5) * 1.6);
              const rr = r * 1.04;
              ctx.drawImage(D.blob('#1d1a17'), s.x - rr, s.y - rr * 1.02, rr * 2, rr * 2);
            }
            if (glowBudget-- > 0) FX.glowDotS(s.x, s.y, r * 1.3, TIER_GLOW[i], 0.55 * (1 - k));
            if (p.size > 30 && k < 0.6) FX.light(p.x, p.y, p.z, p.size * 3, TIER_GLOW[Math.min(2, i)], 0.4 * (1 - k));
            break;
          }
          case 'empfront': {                       // electric arcs crawling along the EMP ground front
            const k = 1 - t, R = p.size * (1 - Math.pow(1 - k, 2.4));
            if (R < 20) break;
            const N = 44, pts = [];
            ctx.globalCompositeOperation = 'lighter'; ctx.lineJoin = 'round';
            for (let j = 0; j <= N; j++) {
              const a = (j / N) * Math.PI * 2, rr = R + (j % N ? rand(-14, 14) : 0);
              const q = C.project(p.x + Math.cos(a) * rr, p.y + Math.sin(a) * rr, j % N ? rand(0, 12) : 0);
              pts.push({ x: q.sx, y: q.sy });
            }
            pts[N] = pts[0];
            const path = () => { ctx.beginPath(); ctx.moveTo(pts[0].x, pts[0].y); for (let j = 1; j <= N; j++) ctx.lineTo(pts[j].x, pts[j].y); ctx.stroke(); };
            ctx.globalAlpha = t * 0.55; ctx.strokeStyle = '#5ae0ff'; ctx.lineWidth = 6; path();
            ctx.globalAlpha = t; ctx.strokeStyle = '#e8fdff'; ctx.lineWidth = 1.6; path();
            ctx.globalCompositeOperation = 'source-over';
            FX.glowPath(pts, 10, '#5ae0ff', t);
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
            const gS = C.project(p.x, p.y, 0);
            ctx.fillStyle = 'rgba(0,0,0,0.28)';
            ctx.beginPath(); ctx.ellipse(gS.sx, gS.sy + 0.5, 3.6, 1.4, 0, 0, Math.PI * 2); ctx.fill();
            const ct = Math.cos(p.tumble), len = 2.2 + 5 * Math.abs(ct);    // end-over-end tumble foreshortening
            ctx.save();
            ctx.translate(s.x, s.y); ctx.rotate(p.rot);
            ctx.fillStyle = '#d9a43c'; ctx.fillRect(-len / 2, -1.3, len, 2.6);
            ctx.fillStyle = '#f6d27a'; ctx.fillRect(-len / 2, -1.3, len, 0.9);
            ctx.fillStyle = '#7a5216'; ctx.fillRect(len / 2 - 1.1, -1.3, 1.1, 2.6);
            if (!p.rest && Math.abs(ct) > 0.92) { ctx.globalCompositeOperation = 'lighter'; ctx.fillStyle = '#fff3c8'; ctx.fillRect(-1, -1.3, 2, 1); ctx.globalCompositeOperation = 'source-over'; }
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
            ctx.beginPath(); C.groundEllipse(ctx, p.x, p.y, r, p.z); ctx.stroke();
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
            if (t > 0.5 || p.size > 50) FX.light(p.x, p.y, p.z, p.size * 2.4, `rgb(${p.color})`, Math.min(0.9, 0.45 * t * Math.min(1.6, p.size / 40)));
            if (glowBudget-- > 0) FX.glowDotS(s.x, s.y, Math.min(r * 0.6, 60), `rgb(${p.color})`, 0.6 * t);
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
            FX.glowPath(pts, 9, '#7ff3ff', Math.min(1, t * 2.5));
            { const e0 = p.points[p.points.length - 1]; FX.light(e0.x, e0.y, e0.z, 150, '#7fdcff', 0.7 * t); }
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
            FX.glowLineS(a.x, a.y, b.x, b.y, p.width * 3, p.color, t);
            break;
          }
          case 'scorch': {
            const r = p.size;
            ctx.save();
            ctx.translate(s.x, s.y); ctx.scale(1, g.ISO); ctx.rotate(p.rot);
            if (p.crater) {
              const age = p.max - p.life;
              ctx.globalAlpha = 0.62 * Math.pow(p.life / p.max, 0.75);      // locked decal: alpha-only fade
              ctx.drawImage(D.blob('#0d0b08', 0.35), -r * 1.25, -r * 1.25, r * 2.5, r * 2.5);
              ctx.drawImage(craterSprite(), -r * 0.75, -r * 0.75, r * 1.5, r * 1.5);
              if (age < 3) { // glowing embers still cooling in the crater
                ctx.globalCompositeOperation = 'lighter';
                ctx.globalAlpha = (1 - age / 3) * 0.55;
                ctx.drawImage(D.blob('#ff5a1a'), -r * 0.55, -r * 0.55, r * 1.1, r * 1.1);
                ctx.globalCompositeOperation = 'source-over';
                if (age < 1.5) FX.light(p.x, p.y, 4, r * 2.2, '#ff6a20', 0.35 * (1 - age / 1.5));
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
            if (glowBudget-- > 0) FX.glowLineS(s.x, s.y, e.x, e.y, p.size * 3, '#ff8a30', 0.8);
            break;
          }
          case 'shock': break;            // (v10) refraction lives in TD.PostFX.distort
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
            FX.glowLineS(a.x, a.y, b.x, b.y, w * 4, `rgb(${p.glow})`, t);
            FX.light(p.a.x, p.a.y, p.a.z, 180, `rgb(${p.glow})`, 0.8 * t);
            FX.light(p.b.x, p.b.y, p.b.z, 160, `rgb(${p.glow})`, 0.9 * t);
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
            FX.light(p.x, p.y, 10, p.size * 1.4, '#7dff40', 0.25 * Math.min(1, t * 2));
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

    /** ☢ Mushroom cloud (v10, ≈60 % of the v6 height): base surge → dense stem → condensation skirt → rolling toroidal cap. */
    drawMushroom(ctx, p, t) {
      const g = this.game, FX = TD.PostFX;
      const age = p.max - p.life;
      const R = p.size;
      const grow = Math.min(1, age / 1.6), eg = 1 - Math.pow(1 - grow, 2);
      const base = g.project(p.x, p.y, 0);
      const capZ = mushroomCapZ(R, age, base.y);
      const fade = Math.min(1, p.life / 2.2);
      const hot = Math.max(0, 1 - age / 2.4);
      const top = g.project(p.x, p.y, capZ);
      const capR = R * NUKE_W * (0.3 + 0.42 * eg);
      const stemW = R * NUKE_W * (0.13 + 0.05 * eg);
      const body = (k) => (k ? '#43372e' : '#54463a'), lit = '#e2cdae';
      // ① base surge: rolling dust ring hugging the ground (ISO ellipse)
      const surge = R * (0.55 + 0.9 * Math.min(1, age / 2.2));
      const N0 = 16;
      for (let i = 0; i < N0; i++) {
        const a = (i / N0) * Math.PI * 2 + age * 0.25;
        if (Math.sin(a) > 0) continue;                   // back half first
        drawPuff(ctx, base.x + Math.cos(a) * surge, base.y + Math.sin(a) * surge * TD.Camera.ISO - 10, R * 0.16, '#6b5d4c', '#c4b294', 0.6 * fade, 0, 0.5, 0.45);
      }
      // cloud shadow cast on the ground (sun from the top-left)
      ctx.globalAlpha = 0.35 * fade * eg;
      ctx.drawImage(D.blob('#000000'), base.x + capR * 0.1, base.y - capR * 0.12, capR * 1.8, capR * 0.75);
      // ② stem: stacked puffs from the ground to the cap underside (hot core early)
      const steps = 9;
      for (let i = 0; i <= steps; i++) {
        const k = i / steps, y = base.y + (top.y + capR * 0.15 - base.y) * k;
        const w = stemW * (1.7 - 0.9 * Math.sin(k * Math.PI * 0.9)) * (0.9 + 0.1 * Math.sin(age * 3 + i));
        drawPuff(ctx, base.x + Math.sin(age * 1.7 + i * 0.8) * stemW * 0.12, y, w, body(i % 2), lit, 0.95 * fade, hot * (1 - k * 0.5), 0.6, 0.35);
      }
      // ③ condensation skirt (Wilson ring) around the stem
      const rp = g.project(p.x, p.y, capZ * 0.5);
      ctx.globalAlpha = 0.45 * fade * Math.min(1, age / 0.8);
      ctx.drawImage(D.blob('#d8d0c4', 0.3), rp.x - capR * 0.95, rp.y - capR * 0.14, capR * 1.9, capR * 0.28);
      // ④ cap: toroidal roll — back ring, crown, front ring (rotating = rolling)
      const ring = (front) => {
        const N = 14;
        for (let i = 0; i < N; i++) {
          const a = (i / N) * Math.PI * 2 + age * 0.55;
          const sn = Math.sin(a);
          if ((sn > 0) !== front) continue;
          const roll = Math.sin(age * 2.2 + i * 1.3) * capR * 0.06;
          const bx = top.x + Math.cos(a) * capR * 0.78, by = top.y + sn * capR * 0.3 + roll;
          drawPuff(ctx, bx, by, capR * (0.4 + 0.06 * sn), body(i % 2), lit, 0.97 * fade, hot * (front ? 0.5 : 0.9), 0.62, front ? 0.6 : 0.4);
        }
      };
      ring(false);
      drawPuff(ctx, top.x, top.y - capR * 0.22, capR * 0.72, '#5a4b3e', lit, 0.97 * fade, hot * 0.6, 0.62, 0.7);   // crown dome
      ring(true);
      // ⑤ incandescent core in the cap + stem foot (early seconds)
      if (hot > 0) {
        ctx.globalCompositeOperation = 'lighter';
        ctx.globalAlpha = hot * 0.85;
        ctx.drawImage(D.blob('#ff7a2a'), top.x - capR * 0.7, top.y - capR * 0.25, capR * 1.4, capR * 0.6);
        ctx.drawImage(D.blob('#ffd080'), base.x - stemW * 2, base.y - stemW * 2.2, stemW * 4, stemW * 2.6);
        ctx.globalCompositeOperation = 'source-over';
        FX.glowDotS(top.x, top.y, capR * 1.1, '#ff8a3a', hot * 0.7, 0.55);
        FX.light(p.x, p.y, capZ, R * 2.4, '#ff8a3a', 0.8 * hot);
      }
      ctx.globalAlpha = 1;
    }
  }

  TD.ParticleSystem = ParticleSystem;
})(window.TD);
