/* =========================================================
   Weapon.js — everything the fortress shoots with
   • Minigun           : main rotary turret (gold shop stats)
   • Auxiliary (cards) : RocketPod, TeslaCoil, SamLauncher, LaserSweeper
   • Red-line branches : Minefield, BomberWing, NukeSilo (Lv1..3)
   Mount offsets are WORLD units on the top platform of the tower.
   ========================================================= */
(function (TD) {
  'use strict';
  const { rand, dist, lerpAngle, clamp, pick } = TD.util;
  const D = TD.Draw;
  const P = TD.Projectiles;
  const angDiff = (a, b) => { let d = ((a - b + Math.PI) % (Math.PI * 2)) - Math.PI; if (d < -Math.PI) d += Math.PI * 2; return Math.abs(d); };

  /** Screen angle of a world direction (2.5D squash). */
  function screenAngle(game, a) { return Math.atan2(Math.sin(a) * game.ISO, Math.cos(a)); }

  /* =========================================================
     MAIN MINIGUN
     ========================================================= */
  /** Baked 3D minigun rig (measured from the atlas): the model faces 180° away from its bake heading,
      its pedestal sits 12 px from the bake anchor, the barrel tip is 40 px in front of the pedestal
      and 31 px above the deck. Turning only swings the barrel — the pedestal stays on the mount. */
  const MG3D = { flip: Math.PI, pivot: 12.15, len: 40, z: 31, rear: 12 };
  const mg3d = () => TD.S3 && TD.S3.has('minigun');
  class Minigun {
    constructor(tower) {
      this.tower = tower; this.game = tower.game;
      this.aim = -Math.PI / 2;
      this.spin = 0; this.spinV = 0;
      this.timer = 0; this.recoil = 0; this.flashT = 0;
      this.target = null;
      this.mount = { ox: 0, oy: 12 };
    }
    muzzle() {
      const m = this.tower.mountPos(this.mount);
      const L = mg3d() ? MG3D.len : 34, Z = mg3d() ? MG3D.z : 16;
      return { x: m.x + Math.cos(this.aim) * L, y: m.y + Math.sin(this.aim) * L, z: m.z + Z };
    }
    /** Ejection port at the back of the receiver (brass flies out here, never at the muzzle). */
    breech() {
      const m = this.tower.mountPos(this.mount);
      const B = mg3d() ? MG3D.rear : 8, Z = mg3d() ? MG3D.z - 3 : 12;
      return { x: m.x - Math.cos(this.aim) * B, y: m.y - Math.sin(this.aim) * B, z: m.z + Z };
    }
    update(dt) {
      const t = this.tower;
      this.recoil = Math.max(0, this.recoil - dt * 18);
      this.flashT = Math.max(0, this.flashT - dt);
      const target = this.pickTarget(t.range);
      this.target = target;
      if (target) {
        const desired = Math.atan2(target.y - t.y, target.x - t.x);
        this.aim = lerpAngle(this.aim, desired, Math.min(1, dt * 16));
        this.spinV = Math.min(34, this.spinV + dt * 90);
      } else {
        this.spinV = Math.max(0, this.spinV - dt * 22);
      }
      this.spin += this.spinV * dt;
      // ☠️ Overclock Protocol: molten barrels, the fortress pays 1% max HP / s while firing
      const oc = t.cards.overclock > 0;
      this.heat = clamp((this.heat || 0) + (oc && target ? dt * 0.8 : -dt * 0.6), 0, 1);
      if (oc && target) {
        t.hp = Math.max(1, t.hp - t.maxHp * 0.01 * dt);
        if (Math.random() < dt * 14) {
          const m = this.muzzle();
          this.game.particles.spawn({ type: 'smoke', x: m.x - Math.cos(this.aim) * 10, y: m.y - Math.sin(this.aim) * 10, z: m.z + 4, vz: 70, vx: rand(-15, 15), vy: rand(-15, 15), size: 5, grow: 3, color: '#f4f4f0', alpha: 0.45, life: 0.7 });
        }
      }
      this.timer -= dt;
      if (target && this.timer <= 0) {
        let n = 0;
        while (this.timer <= 0 && n < 4) { this.fire(target); this.timer += 1 / t.fireRate; n++; }
        if (this.timer < -0.05) this.timer = 0;
      } else if (!target && this.timer < 0) this.timer = 0;
    }
    /** Incoming Katyusha rockets first (closest to the tower), then the nearest enemy. */
    pickTarget(range) {
      const t = this.tower, g = this.game;
      let best = null, bd = Infinity;
      for (const r of g.rockets) {
        if (r.dead) continue;
        const d = dist(r.x, r.y, t.x, t.y);
        if (d <= range && d < bd) { bd = d; best = r; }
      }
      if (best) return best;
      for (const e of g.enemies) {
        if (!e.targetable) continue;
        const d = dist(e.x, e.y, t.x, t.y) - e.radius;
        if (d <= range && d < bd) { bd = d; best = e; }
      }
      return best;
    }
    fire(target) {
      const t = this.tower, g = this.game;
      const m = this.muzzle();
      const targets = [target];      // 🎯 'multi' card now spawns independent SubTurrets (below)
      const c = t.cards;
      const ammo = (c.cryo || c.incend || c.acid) ? { cryo: c.cryo || 0, incend: c.incend || 0, acid: c.acid || 0 } : null;
      const rico = c.ricochet || 0;
      const exLv = t.cards.explosive || 0;
      for (const e of targets) {
        const d = dist(m.x, m.y, e.x, e.y);
        const time = d / 2600;
        const lx = e.x + (e.vx || 0) * time, ly = e.y + (e.vy || 0) * time;
        const crit = Math.random() < t.critChance;
        const explosive = exLv > 0 && Math.random() < 0.25 ? { mult: [1.5, 1.75, 2.0][exLv - 1] } : null;
        const tz = e.isRocket ? e.z : (e.z || 0) + Math.min(28, e.height * 0.5);
        g.projectiles.push(new P.Tracer(g, {
          x: m.x, y: m.y, z: m.z, angle: Math.atan2(ly - m.y, lx - m.x) + rand(-0.02, 0.02),
          dmg: t.damage * (crit ? t.critMult : 1), crit, range: t.range + 40, tz, travel: time, explosive,
          ammo, pierce: [0, 1, 2, 2][rico], bounce: rico >= 3,
        }));
      }
      // juice
      this.recoil = 1; this.flashT = 0.045;
      g.particles.flash(m.x, m.y, m.z, { size: 34, life: 0.05 });
      if (Math.random() < 0.7) { const b = this.breech(); g.particles.casing(b.x, b.y, b.z, this.aim); }
      if (Math.random() < 0.25) g.particles.spawn({ type: 'smoke', x: m.x, y: m.y, z: m.z, size: 6, grow: 2, color: '#c8c4bb', alpha: 0.35, life: 0.5, vz: 25 });
      g.audio.play('mg');
    }
    draw(ctx, sx, sy) {
      const g = this.game;
      const a = screenAngle(g, this.aim);
      if (mg3d()) {
        // pedestal pinned on the mount; recoil nudges the whole gun back along the barrel a little
        const rk = this.recoil * 2, ca = Math.cos(this.aim), sa = Math.sin(this.aim);
        TD.S3.drawPivot(ctx, 'minigun', sx - ca * rk, sy + 4 - sa * rk * g.ISO, this.aim + MG3D.flip, MG3D.pivot, g.ISO);
        const L = MG3D.len - rk;
        const mx = sx + ca * L, my = sy - MG3D.z + sa * L * g.ISO;       // barrel tip on screen
        if ((this.heat || 0) > 0.05) {
          ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = this.heat * 0.7;
          const hx = sx + ca * L * 0.6, hy = sy - MG3D.z + sa * L * 0.6 * g.ISO;   // glow along the barrels
          ctx.drawImage(D.blob('#ff3a10'), hx - 16, hy - 12, 32, 24);
          ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
        }
        if (this.flashT > 0) {
          // star-shaped muzzle flash pushed slightly ahead of the barrel tip
          const fx = mx + ca * 7, fy = my + sa * 7 * g.ISO, a = screenAngle(g, this.aim);
          ctx.globalCompositeOperation = 'lighter';
          ctx.drawImage(D.blob('#ffbb55'), fx - 18, fy - 16, 36, 32);
          ctx.save(); ctx.translate(fx, fy); ctx.rotate(a);
          ctx.fillStyle = '#fff6c8'; ctx.beginPath();
          for (let i = 0; i < 8; i++) { const r = i % 2 ? 4 : 9 + Math.random() * 6, an = (i / 8) * Math.PI * 2; ctx.lineTo(Math.cos(an) * r * 1.3, Math.sin(an) * r * 0.6); }
          ctx.closePath(); ctx.fill(); ctx.restore();
          ctx.drawImage(D.blob('#fff6c8'), fx - 7, fy - 7, 14, 14);
          ctx.globalCompositeOperation = 'source-over';
        }
        return;
      }
      // turret ring
      D.ellipse(ctx, sx, sy + 4, 22, 11, '#2c3236', '#0d1012', 2);
      D.ellipse(ctx, sx, sy + 1, 18, 9, '#4a535a', null, 0);
      ctx.save();
      ctx.translate(sx, sy - 10);
      ctx.rotate(a);
      if (Math.cos(a) < 0) ctx.scale(1, -1);
      ctx.translate(-this.recoil * 3, 0);
      // ammo box & belt
      ctx.fillStyle = '#3c4a2c';
      D.roundRect(ctx, -22, 4, 16, 11, 2); ctx.fill();
      ctx.fillStyle = '#c9a227';
      for (let i = 0; i < 5; i++) ctx.fillRect(-6 + i * 3, 7 + Math.sin(this.spin * 0.5 + i) * 0.6, 2, 5);
      // housing
      ctx.fillStyle = D.metal(ctx, -18, 14, '#58636b');
      D.roundRect(ctx, -18, -9, 30, 18, 4); ctx.fill();
      ctx.strokeStyle = '#0d1012'; ctx.lineWidth = 1.5; ctx.stroke();
      D.rivets(ctx, -14, -6, 8, -6, 4, 1.1);
      // shield plate
      ctx.fillStyle = '#4b5a3a';
      ctx.beginPath(); ctx.moveTo(10, -15); ctx.lineTo(16, -13); ctx.lineTo(16, 13); ctx.lineTo(10, 15); ctx.closePath(); ctx.fill();
      // rotating barrels (sorted back→front)
      const barrels = [];
      for (let i = 0; i < 6; i++) { const ph = this.spin + (i * Math.PI) / 3; barrels.push({ y: Math.sin(ph) * 4.2, d: Math.cos(ph) }); }
      barrels.sort((p, q) => p.d - q.d);
      const heat = this.heat || 0;
      for (const b of barrels) {
        const shade = 0.5 + b.d * 0.35;
        const r0 = 70 + 90 * shade, g0 = 75 + 90 * shade, b0 = 80 + 90 * shade;
        ctx.lineWidth = 2.6; ctx.lineCap = 'butt';
        if (heat > 0.02) {
          // barrels glow molten red from the receiver outward
          const gr = ctx.createLinearGradient(14, 0, 44, 0);
          gr.addColorStop(0, `rgb(${Math.round(r0)},${Math.round(g0)},${Math.round(b0)})`);
          gr.addColorStop(0.35, `rgb(${Math.round(r0 + (255 - r0) * heat)},${Math.round(g0 + (70 - g0) * heat)},${Math.round(b0 + (20 - b0) * heat)})`);
          gr.addColorStop(1, `rgb(${Math.round(r0 + (255 - r0) * heat)},${Math.round(g0 + (190 - g0) * heat * heat)},${Math.round(b0 + (90 - b0) * heat)})`);
          ctx.strokeStyle = gr;
        } else ctx.strokeStyle = `rgb(${Math.round(r0)},${Math.round(g0)},${Math.round(b0)})`;
        ctx.beginPath(); ctx.moveTo(14, b.y); ctx.lineTo(44, b.y); ctx.stroke();
      }
      if (heat > 0.05) {
        ctx.globalCompositeOperation = 'lighter';
        ctx.globalAlpha = heat * (0.55 + 0.25 * Math.sin(this.game.time * 30));
        ctx.drawImage(D.blob('#ff3a10'), 16, -12, 34, 24);
        ctx.globalAlpha = 1;
        ctx.globalCompositeOperation = 'source-over';
      }
      ctx.fillStyle = '#2a2f33';
      ctx.fillRect(22, -6, 3, 12); ctx.fillRect(40, -6, 3, 12);
      // muzzle flash
      if (this.flashT > 0) {
        ctx.globalCompositeOperation = 'lighter';
        ctx.drawImage(D.blob('#ffbb55'), 34, -18, 40, 36);
        ctx.fillStyle = '#fff6c8';
        ctx.beginPath();
        for (let i = 0; i < 8; i++) {
          const r = i % 2 ? 6 : 15 + Math.random() * 8;
          const an = (i / 8) * Math.PI * 2;
          ctx.lineTo(50 + Math.cos(an) * r, Math.sin(an) * r * 0.7);
        }
        ctx.closePath(); ctx.fill();
        ctx.globalCompositeOperation = 'source-over';
      }
      ctx.restore();
    }
  }


  /* =========================================================
     🎯 SUB-TURRET — "Bắn Nhiều Đối Tượng" card (Lv1/2/3 → 1/2/3 turrets)
     Small twin-MG turret on the roof rim with its own aim, target, recoil and flash.
     Prefers an enemy nobody else is shooting at (main gun + other sub-turrets).
     ========================================================= */
  const SUB_DMG = 0.7, SUB_RATE = 0.65, SUB_TURN = 10;
  class SubTurret {
    constructor(tower, slot) {
      this.tower = tower; this.game = tower.game; this.id = 'subturret'; this.slot = slot;
      this.mount = { ox: 0, oy: 0 };
      this.aim = Math.PI / 2 + slot * 2.1; this.target = null; this.retarget = 0;
      this.timer = rand(0, 0.3); this.recoil = 0; this.flashT = 0; this.barrel = 0; this.spin = 0;
    }
    base() { return this.tower.mountPos(this.mount); }
    muzzle() {
      const m = this.base();
      return { x: m.x + Math.cos(this.aim) * 20, y: m.y + Math.sin(this.aim) * 20, z: m.z + 11 };
    }
    /** Targets already claimed by the main gun / other sub-turrets. */
    claimed() {
      const t = this.tower, set = new Set();
      if (t.minigun.target) set.add(t.minigun.target);
      for (const o of t.subTurrets) if (o !== this && o.target) set.add(o.target);
      return set;
    }
    valid(e, range) {
      if (!e || e.dead) return false;
      if (!e.isRocket && !e.targetable) return false;
      const t = this.tower;
      return dist(e.x, e.y, t.x, t.y) - (e.radius || 0) <= range;
    }
    pickTarget(range) {
      const t = this.tower, g = this.game, taken = this.claimed(), m = this.base();
      let free = null, fd = Infinity, any = null, ad = Infinity;
      const consider = (e) => {
        if (!this.valid(e, range)) return;
        // nearest to the fortress, with a small bonus for staying close to where we already point
        const d = dist(e.x, e.y, t.x, t.y) + angDiff(Math.atan2(e.y - m.y, e.x - m.x), this.aim) * 40;
        if (!taken.has(e) && d < fd) { fd = d; free = e; }
        if (d < ad) { ad = d; any = e; }
      };
      for (const r of g.rockets) consider(r);
      for (const e of g.enemies) consider(e);
      return free || any;
    }
    update(dt) {
      const t = this.tower, g = this.game;
      const range = t.range;
      this.recoil = Math.max(0, this.recoil - dt * 14);
      this.flashT = Math.max(0, this.flashT - dt);
      this.retarget -= dt;
      // keep a valid, un-shared target; re-evaluate a few times per second
      const shared = this.target && this.claimed().has(this.target);
      if (!this.valid(this.target, range) || this.retarget <= 0 || shared) {
        this.target = this.pickTarget(range);
        this.retarget = 0.3;
      }
      const tg = this.target;
      if (!tg) { this.spin = Math.max(0, this.spin - dt * 4); if (this.timer < 0) this.timer = 0; this.timer -= dt; return; }
      const m = this.base();
      const desired = Math.atan2(tg.y - m.y, tg.x - m.x);
      this.aim = lerpAngle(this.aim, desired, Math.min(1, dt * SUB_TURN));
      this.timer -= dt;
      if (this.timer <= 0 && angDiff(this.aim, desired) < 0.3) {
        this.fire(tg);
        this.timer += 1 / Math.max(0.5, t.fireRate * SUB_RATE);
        if (this.timer < -0.05) this.timer = 0;
      } else if (this.timer < 0) this.timer = 0;
    }
    fire(e) {
      const t = this.tower, g = this.game, c = t.cards;
      const m = this.muzzle();
      const d = dist(m.x, m.y, e.x, e.y);
      const time = d / 2600;
      const lx = e.x + (e.vx || 0) * time, ly = e.y + (e.vy || 0) * time;
      const crit = Math.random() < t.critChance;
      const ammo = (c.cryo || c.incend || c.acid) ? { cryo: c.cryo || 0, incend: c.incend || 0, acid: c.acid || 0 } : null;
      const tz = e.isRocket ? e.z : (e.z || 0) + Math.min(28, (e.height || 20) * 0.5);
      g.projectiles.push(new P.Tracer(g, {
        x: m.x, y: m.y, z: m.z, angle: Math.atan2(ly - m.y, lx - m.x) + rand(-0.025, 0.025),
        dmg: t.damage * SUB_DMG * (crit ? t.critMult : 1), crit, range: t.range + 40, tz, travel: time, ammo,
      }));
      this.recoil = 1; this.flashT = 0.05; this.barrel ^= 1;
      g.particles.flash(m.x, m.y, m.z, { size: 22, life: 0.045 });
      if (Math.random() < 0.5) g.particles.casing(m.x - Math.cos(this.aim) * 12, m.y - Math.sin(this.aim) * 12, m.z - 4, this.aim);
      if (Math.random() < 0.35) g.audio.play('mg');
    }
    draw(ctx, sx, sy) {
      const g = this.game;
      const a = screenAngle(g, this.aim);
      // sponson ring bolted to the roof rim
      D.ellipse(ctx, sx, sy + 3, 15, 7.5, '#22282b', '#0b0d0e', 1.5);
      D.ellipse(ctx, sx, sy + 1, 12, 6, '#4b555b', null, 0);
      ctx.save();
      ctx.translate(sx, sy - 7);
      ctx.rotate(a);
      if (Math.cos(a) < 0) ctx.scale(1, -1);
      ctx.translate(-this.recoil * 2.5, 0);
      // twin barrels (alternate firing → independent recoil per barrel)
      for (const [by, k] of [[-2.6, 0], [2.6, 1]]) {
        const kick = this.barrel === k ? this.recoil * 2.5 : 0;
        ctx.strokeStyle = '#7f8a90'; ctx.lineWidth = 2.2; ctx.lineCap = 'butt';
        ctx.beginPath(); ctx.moveTo(6 - kick, by); ctx.lineTo(24 - kick, by); ctx.stroke();
        ctx.fillStyle = '#2a2f33'; ctx.fillRect(21 - kick, by - 1.6, 3, 3.2);
      }
      // housing + armour shield
      ctx.fillStyle = D.metal(ctx, -10, 8, '#5d6a52');
      D.roundRect(ctx, -10, -6.5, 18, 13, 3); ctx.fill();
      ctx.strokeStyle = '#0d1012'; ctx.lineWidth = 1.2; ctx.stroke();
      ctx.fillStyle = '#3e4a33';
      ctx.beginPath(); ctx.moveTo(6, -9); ctx.lineTo(10, -7.5); ctx.lineTo(10, 7.5); ctx.lineTo(6, 9); ctx.closePath(); ctx.fill();
      ctx.fillStyle = '#c9a227'; ctx.fillRect(-9, 3.5, 6, 2.5);   // ammo belt
      // muzzle flash
      if (this.flashT > 0) {
        const fy = this.barrel ? 2.6 : -2.6;
        ctx.globalCompositeOperation = 'lighter';
        ctx.drawImage(D.blob('#ffbb55'), 18, fy - 11, 24, 22);
        ctx.fillStyle = '#fff6c8';
        ctx.beginPath();
        for (let i = 0; i < 8; i++) {
          const r = i % 2 ? 3 : 8 + Math.random() * 5;
          const an = (i / 8) * Math.PI * 2;
          ctx.lineTo(28 + Math.cos(an) * r, fy + Math.sin(an) * r * 0.7);
        }
        ctx.closePath(); ctx.fill();
        ctx.globalCompositeOperation = 'source-over';
      }
      ctx.restore();
    }
  }

  /* =========================================================
     AUXILIARY WEAPONS (from green-line cards)
     ========================================================= */
  class Aux {
    constructor(tower, id, mount) {
      this.tower = tower; this.game = tower.game; this.id = id;
      this.mount = mount; this.timer = rand(0.5, 1.5); this.aim = -Math.PI / 2; this.recoil = 0;
    }
    get lv() { return this.tower.cards[this.id] || 0; }
    get up() { return 1 + 0.2 * (this.tower.aux[this.id] || 0); }
    pos(dz = 0) { const m = this.tower.mountPos(this.mount); m.z += dz; return m; }
    drawTop() {}
  }

  class RocketPod extends Aux {
    constructor(tower) { super(tower, 'rocket', { ox: -40, oy: -2 }); this.salvo = []; this.salvoT = 0; }
    get count() { return [1, 3, 5][this.lv - 1] || 1; }
    get dmg() { return 42 * this.up; }
    update(dt) {
      const g = this.game, t = this.tower;
      this.recoil = Math.max(0, this.recoil - dt * 5);
      if (this.salvo.length) {
        this.salvoT -= dt;
        if (this.salvoT <= 0) { this.salvoT = 0.09; this.launch(this.salvo.shift()); }
        return;
      }
      this.timer -= dt;
      if (this.timer > 0) return;
      const list = g.targetsByDistance(t.x, t.y, Math.max(720, t.range + 140), true);
      if (!list.length) { this.timer = 0.25; return; }
      for (let i = 0; i < this.count; i++) this.salvo.push(list[i % list.length]);
      this.timer = 2.4;
      this.aim = Math.atan2(list[0].y - t.y, list[0].x - t.x);
    }
    launch(target) {
      const g = this.game;
      const m = this.pos(14);
      g.projectiles.push(new P.HomingRocket(g, {
        x: m.x, y: m.y, z: m.z, target, angle: this.aim + rand(-0.5, 0.5), dmg: this.dmg, splash: 58,
      }));
      g.particles.smoke(m.x, m.y, m.z, { count: 3, size: 9, speed: 40, life: 0.6, color: '#d6d2c8', alpha: 0.6 });
      this.recoil = 1;
      g.audio.play('rocket');
    }
    draw(ctx, sx, sy) {
      const a = screenAngle(this.game, this.aim);
      D.ellipse(ctx, sx, sy + 3, 13, 7, '#2c3236', null, 0);
      ctx.save();
      ctx.translate(sx, sy - 12);
      const flip = Math.cos(a) < 0 ? -1 : 1;
      ctx.scale(flip, 1);
      ctx.rotate(-0.35 - this.recoil * 0.08);
      ctx.fillStyle = '#4f5b3c';
      D.roundRect(ctx, -12, -10, 26, 20, 3); ctx.fill();
      ctx.strokeStyle = '#141814'; ctx.lineWidth = 1.5; ctx.stroke();
      ctx.fillStyle = '#1a1d1a';
      for (let r = 0; r < 2; r++) for (let c = 0; c < 3; c++) { ctx.beginPath(); ctx.arc(14, -6 + c * 6 + (r ? 0 : 0), 2.2, 0, Math.PI * 2); ctx.fill(); }
      ctx.fillStyle = '#e0c040'; ctx.fillRect(-10, -10, 4, 20);
      ctx.restore();
    }
  }

  class TeslaCoil extends Aux {
    constructor(tower) { super(tower, 'tesla', { ox: 40, oy: -2 }); this.charge = 0; }
    get chain() { return [3, 5, 7][this.lv - 1] || 3; }
    get dmg() { return 28 * this.up; }
    update(dt) {
      const g = this.game, t = this.tower;
      this.charge = Math.min(1, this.charge + dt / 1.4);
      this.timer -= dt;
      if (this.timer > 0) return;
      const first = g.nearestEnemy(t.x, t.y, 330, false);
      if (!first) { this.timer = 0.2; return; }
      const chain = [first];
      let cur = first;
      while (chain.length < this.chain) {
        let best = null, bd = 200;
        for (const o of g.enemies) {
          if (!o.targetable || chain.includes(o)) continue;
          const d = dist(cur.x, cur.y, o.x, o.y);
          if (d < bd) { bd = d; best = o; }
        }
        if (!best) break;
        chain.push(best); cur = best;
      }
      const top = this.pos(46);
      const pts = [top];
      chain.forEach((e, i) => {
        pts.push({ x: e.x, y: e.y, z: (e.z || 0) + e.height * 0.55 });
        g.damageEnemy(e, this.dmg * Math.pow(0.9, i), { source: 'tesla', style: 'shock' });
        e.shockT = 0.25;
        g.particles.sparks(e.x, e.y, (e.z || 0) + e.height * 0.55, { count: 5, color: '#9ff6ff', speed: 180, life: 0.25 });
      });
      g.particles.bolt(pts);
      g.particles.flash(top.x, top.y, top.z, { size: 50, color: '160,240,255', life: 0.15 });
      g.audio.play('zap');
      this.charge = 0;
      this.timer = 1.5;
    }
    draw(ctx, sx, sy) {
      const t = this.game.time;
      if (TD.S3 && TD.S3.has('tesla')) {
        TD.S3.draw(ctx, 'tesla', sx, sy + 3);
        const gy = sy - TD.S3.height('tesla') * 0.86, pulse = 0.6 + 0.4 * Math.sin(t * 9) * this.charge;
        ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = 0.3 + this.charge * 0.6;
        ctx.drawImage(D.blob('#5ae0ff'), sx - 24 * pulse, gy - 24 * pulse, 48 * pulse, 48 * pulse);
        ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
        return;
      }
      D.ellipse(ctx, sx, sy + 2, 12, 6, '#2c3236', null, 0);
      ctx.fillStyle = D.metal(ctx, sx - 6, sx + 6, '#5d6a72');
      ctx.fillRect(sx - 5, sy - 34, 10, 34);
      for (let i = 0; i < 5; i++) {
        const yy = sy - 6 - i * 6.5;
        D.ellipse(ctx, sx, yy, 10 - i * 0.8, 3.2, '#b87333', '#4a2a10', 1);
      }
      const gy = sy - 44;
      const pulse = 0.6 + 0.4 * Math.sin(t * 9) * this.charge;
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = 0.35 + this.charge * 0.5;
      ctx.drawImage(D.blob('#5ae0ff'), sx - 26 * pulse, gy - 26 * pulse, 52 * pulse, 52 * pulse);
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = 'source-over';
      D.circle(ctx, sx, gy, 7.5, '#bff8ff', '#2a6b80', 1.5);
      if (Math.random() < 0.25 * this.charge) {
        const a = Math.random() * Math.PI * 2;
        ctx.strokeStyle = '#aaf6ff'; ctx.lineWidth = 1.2;
        ctx.beginPath(); ctx.moveTo(sx, gy);
        ctx.lineTo(sx + Math.cos(a) * 9 + rand(-3, 3), gy + Math.sin(a) * 9); ctx.lineTo(sx + Math.cos(a) * 16, gy + Math.sin(a) * 14);
        ctx.stroke();
      }
    }
  }

  class SamLauncher extends Aux {
    constructor(tower) { super(tower, 'sam', { ox: -22, oy: -32 }); this.timer = 2; this.loaded = 1; }
    get interval() { return [6, 4.5, 3.2][this.lv - 1] || 6; }
    get dmg() { return 210 * this.up; }
    update(dt) {
      const g = this.game;
      this.loaded = Math.min(1, this.loaded + dt / 1.2);
      this.timer -= dt;
      if (this.timer > 0) return;
      const target = g.pickSamTarget();
      if (!target) { this.timer = 0.3; return; }
      const m = this.pos(22);
      const scr = g.jamFactor > 0 && Math.random() < 0.5;
      g.projectiles.push(new P.SamMissile(g, { x: m.x, y: m.y, z: m.z, target, dmg: this.dmg, splash: 95, jitX: scr ? rand(-160, 160) : 0, jitY: scr ? rand(-120, 120) : 0 }));
      if (scr) g.ui.float(m.x, m.y, m.z + 40, '📡 NHIỄU!', 'shock');
      g.particles.smoke(m.x, m.y, m.z - 10, { count: 8, size: 14, speed: 90, life: 1.0, color: '#e2ded4', alpha: 0.6, rise: 20 });
      g.particles.flash(m.x, m.y, m.z, { size: 60, life: 0.12 });
      g.audio.play('sam');
      this.loaded = 0;
      this.timer = this.interval;
    }
    draw(ctx, sx, sy) {
      if (TD.S3 && TD.S3.has('sam')) { ctx.globalAlpha = 0.55 + 0.45 * this.loaded; TD.S3.draw(ctx, 'sam', sx, sy + 3); ctx.globalAlpha = 1; return; }
      D.ellipse(ctx, sx, sy + 2, 14, 7, '#2c3236', null, 0);
      ctx.save();
      ctx.translate(sx, sy - 6);
      ctx.fillStyle = '#4c5a3a';
      ctx.fillRect(-12, -6, 24, 8);
      ctx.rotate(-1.15);
      ctx.fillStyle = '#5d6b48';
      D.roundRect(ctx, -2, -11, 34, 22, 3); ctx.fill();
      ctx.strokeStyle = '#151a12'; ctx.lineWidth = 1.2; ctx.stroke();
      if (this.loaded > 0.95) {
        for (const yy of [-5, 5]) {
          ctx.fillStyle = '#e8ebe4'; ctx.fillRect(30, yy - 2.5, 10, 5);
          ctx.fillStyle = '#c33'; ctx.beginPath(); ctx.moveTo(40, yy - 2.5); ctx.lineTo(45, yy); ctx.lineTo(40, yy + 2.5); ctx.fill();
        }
      }
      ctx.restore();
    }
  }

  class LaserSweeper extends Aux {
    constructor(tower) { super(tower, 'laser', { ox: 24, oy: -32 }); this.sweep = null; this.timer = 2; this.glow = 0; }
    get arc() { return ([45, 70, 100][this.lv - 1] || 45) * Math.PI / 180; }
    get cd() { return [5, 4, 3.2][this.lv - 1] || 5; }
    get dmg() { return 58 * this.up; }
    get length() { return Math.max(620, this.tower.range + 160); }
    update(dt) {
      const g = this.game, t = this.tower;
      this.glow = Math.max(0, this.glow - dt * 2);
      if (this.sweep) {
        const s = this.sweep;
        s.t += dt;
        const k = Math.min(1, s.t / s.T);
        const prev = s.ang;
        s.ang = s.a0 + (s.a1 - s.a0) * k;
        this.aim = s.ang;
        for (const e of g.enemies) {
          if (e.dead || s.hit.has(e) || e.cloaked || e.burrowed) continue;
          const d = dist(e.x, e.y, t.x, t.y);
          if (d > this.length) continue;
          const ea = Math.atan2(e.y - t.y, e.x - t.x);
          const tol = Math.atan2(e.radius + 6, Math.max(1, d));
          const lo = Math.min(prev, s.ang) - tol, hi = Math.max(prev, s.ang) + tol;
          const mid = (lo + hi) / 2;
          if (angDiff(ea, mid) <= (hi - lo) / 2) {
            s.hit.add(e);
            g.damageEnemy(e, this.dmg, { source: 'laser', style: 'laser' });
            e.burnT = 0.4;
            g.particles.sparks(e.x, e.y, (e.z || 0) + e.height * 0.5, { count: 6, color: '#ff4df0', speed: 200, life: 0.3 });
            g.particles.smoke(e.x, e.y, (e.z || 0) + e.height * 0.5, { count: 1, size: 8, color: '#504a50', life: 0.6, alpha: 0.5 });
          }
        }
        if (k >= 1) { this.sweep = null; this.timer = this.cd; }
        return;
      }
      this.timer -= dt;
      if (this.timer > 0) return;
      // aim the cone at the densest group
      const list = g.enemies.filter((e) => e.targetable && dist(e.x, e.y, t.x, t.y) < this.length);
      if (!list.length) { this.timer = 0.25; return; }
      let bestA = 0, bestN = -1;
      for (const e of list) {
        const a = Math.atan2(e.y - t.y, e.x - t.x);
        let n = 0;
        for (const o of list) if (angDiff(Math.atan2(o.y - t.y, o.x - t.x), a) <= this.arc / 2) n++;
        if (n > bestN) { bestN = n; bestA = a; }
      }
      const dir = Math.random() < 0.5 ? 1 : -1;
      this.sweep = { a0: bestA - (this.arc / 2) * dir, a1: bestA + (this.arc / 2) * dir, ang: bestA - (this.arc / 2) * dir, t: 0, T: 0.55 + this.arc * 0.45, hit: new Set(), center: bestA };
      this.glow = 1;
      g.audio.play('laser');
    }
    draw(ctx, sx, sy) {
      const a = screenAngle(this.game, this.aim);
      if (TD.S3 && TD.S3.has('laser')) {
        TD.S3.draw(ctx, 'laser', sx, sy + 3, this.aim);
        const on = this.sweep ? 1 : this.glow * 0.5;
        ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = 0.3 + on * 0.7;
        ctx.drawImage(D.blob('#ff3ce6'), sx + Math.cos(this.aim) * 14 - 10, sy - 16 + Math.sin(this.aim) * 7 - 10, 20, 20);
        ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
        return;
      }
      D.ellipse(ctx, sx, sy + 2, 12, 6, '#2c3236', null, 0);
      ctx.save();
      ctx.translate(sx, sy - 14);
      ctx.fillStyle = '#3a3f46';
      ctx.fillRect(-4, 4, 8, 10);
      ctx.rotate(a);
      if (Math.cos(a) < 0) ctx.scale(1, -1);
      ctx.fillStyle = D.metal(ctx, -10, 10, '#7a8794');
      D.roundRect(ctx, -10, -6, 26, 12, 5); ctx.fill();
      ctx.fillStyle = '#20252b'; ctx.fillRect(14, -3.5, 8, 7);
      const on = this.sweep ? 1 : this.glow * 0.5;
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = 0.4 + on * 0.6;
      ctx.drawImage(D.blob('#ff3ce6'), 12, -10, 20, 20);
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = 'source-over';
      ctx.restore();
    }
    /** Beam & cone, drawn above the battlefield. */
    drawTop(ctx) {
      if (!this.sweep) return;
      const g = this.game, t = this.tower, s = this.sweep;
      const o = this.pos(18);
      const os = g.project(o.x, o.y, o.z);
      const c = g.project(t.x, t.y, 0);
      const L = this.length;
      // cone
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = 0.12;
      ctx.fillStyle = '#ff40e0';
      ctx.beginPath(); ctx.moveTo(c.x, c.y);
      const lo = Math.min(s.a0, s.a1), hi = Math.max(s.a0, s.a1);
      for (let i = 0; i <= 18; i++) { const a = lo + (hi - lo) * (i / 18); const p = g.project(t.x + Math.cos(a) * L, t.y + Math.sin(a) * L, 0); ctx.lineTo(p.x, p.y); }
      ctx.closePath(); ctx.fill();
      // beam: solid white core inside multi-layered neon bloom
      const end = g.project(t.x + Math.cos(s.ang) * L, t.y + Math.sin(s.ang) * L, 6);
      const fl = 0.85 + 0.15 * Math.sin(g.time * 70);
      ctx.lineCap = 'round';
      for (const [w, col, al] of [[44, '255,30,200', 0.07], [30, '255,40,220', 0.12], [18, '255,80,235', 0.25], [10, '255,140,245', 0.55], [5.5, '255,210,252', 0.9]]) {
        ctx.globalAlpha = al * fl;
        ctx.strokeStyle = `rgb(${col})`; ctx.lineWidth = w;
        ctx.beginPath(); ctx.moveTo(os.x, os.y); ctx.lineTo(end.x, end.y); ctx.stroke();
      }
      ctx.globalAlpha = 1;
      ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 2.6;
      ctx.beginPath(); ctx.moveTo(os.x, os.y); ctx.lineTo(end.x, end.y); ctx.stroke();
      ctx.drawImage(D.blob('#ff6af0'), os.x - 18, os.y - 18, 36, 36);
      // impact point: plasma bloom + continuous crackling arcs
      ctx.drawImage(D.blob('#ff6af0'), end.x - 34, end.y - 22, 68, 44);
      ctx.drawImage(D.blob('#ffffff'), end.x - 12, end.y - 8, 24, 16);
      ctx.strokeStyle = '#ffd6fb'; ctx.lineWidth = 1.4;
      for (let i = 0; i < 4; i++) {
        let px = end.x, py = end.y;
        ctx.beginPath(); ctx.moveTo(px, py);
        const a = Math.random() * Math.PI * 2;
        for (let k = 1; k <= 4; k++) { px = end.x + Math.cos(a) * k * 7 + rand(-5, 5); py = end.y + Math.sin(a) * k * 4 + rand(-4, 4); ctx.lineTo(px, py); }
        ctx.stroke();
      }
      ctx.restore();
      if (Math.random() < 0.5) {
        const ep = { x: t.x + Math.cos(s.ang) * L, y: t.y + Math.sin(s.ang) * L };
        g.particles.spawn({ type: 'spark', x: ep.x, y: ep.y, z: 6, vx: rand(-140, 140), vy: rand(-140, 140), vz: rand(120, 300), g: -700, color: pick(['#ffffff', '#ffb3f6', '#ff5ae8']), life: 0.35, size: 2.2 });
      }
      if (Math.random() < 0.6) {
        const d = rand(80, L);
        g.particles.spawn({ type: 'spark', x: t.x + Math.cos(s.ang) * d, y: t.y + Math.sin(s.ang) * d, z: 4, vx: rand(-60, 60), vy: rand(-60, 60), vz: rand(60, 160), g: -500, color: '#ff8af4', life: 0.3, size: 2 });
      }
    }
  }

  /* =========================================================
     EQUIPMENT SUB-SKILLS (green cards — Part II)
     Values: TD.Config.sub(id, key, lv)  (Skill Game → "Trang Bị P2")
     ========================================================= */
  class SubAux extends Aux {
    v(key) { return TD.Config.sub(this.id, key, this.lv); }
  }

  /** 🚁 Attack Drone Swarm — snipes the lowest-HP targets, then docks to recharge. */
  class UavSwarm extends SubAux {
    constructor(tower) { super(tower, 'uav', { ox: 46, oy: 24 }); this.state = 'dock'; this.timer = 1.5; this.drones = []; this.flyT = 0; }
    get dmg() { return this.v('dmg') * this.up; }
    update(dt) {
      const g = this.game;
      if (this.state === 'dock') {
        this.timer -= dt;
        if (this.timer <= 0) {
          if (!g.enemies.some((e) => e.targetable)) { this.timer = 0.5; return; }
          this.launch();
        }
        return;
      }
      this.flyT -= dt;
      const recall = this.flyT <= 0;
      let home = true;
      for (const d of this.drones) { this.updateDrone(d, dt, recall); if (!d.home) home = false; }
      if (recall && home) { this.state = 'dock'; this.drones = []; this.timer = this.v('cd'); g.audio.play('click'); }
    }
    launch() {
      const pad = this.pos(6);
      this.drones = [];
      for (let i = 0; i < this.v('count'); i++) this.drones.push({ x: pad.x, y: pad.y, z: pad.z, a: i * 2.1, target: null, fireT: 0.4 + i * 0.13, home: false, rot: 0, tilt: 0, vx: 0, vy: 0, flash: 0 });
      this.state = 'fly'; this.flyT = this.v('duration');
      this.game.audio.play('uav');
    }
    pickTarget() {
      const g = this.game, t = this.tower;
      let best = null;
      for (const e of g.enemies) {
        if (!e.targetable || dist(e.x, e.y, t.x, t.y) > 660) continue;
        if (!best || e.hp < best.hp) best = e;
      }
      return best;
    }
    updateDrone(d, dt, recall) {
      const t = this.tower;
      d.rot += dt * 60; d.flash = Math.max(0, d.flash - dt * 12);
      let gx, gy, gz;
      if (recall) { const pad = this.pos(6); gx = pad.x; gy = pad.y; gz = pad.z; }
      else {
        if (!d.target || !d.target.targetable) d.target = this.pickTarget();
        d.a += dt * 1.7;
        if (d.target) { gx = d.target.x + Math.cos(d.a) * 95; gy = d.target.y + Math.sin(d.a) * 75; }
        else { gx = t.x + Math.cos(d.a * 0.6) * 210; gy = t.y + Math.sin(d.a * 0.6) * 160; }
        gz = 150 + Math.sin(d.a * 2) * 12;
      }
      const dx = gx - d.x, dy = gy - d.y, dz = gz - d.z;
      const L = Math.hypot(dx, dy) || 1;
      const sp = Math.min(L / Math.max(dt, 1e-3), 400);
      d.vx = (dx / L) * sp; d.vy = (dy / L) * sp;
      d.x += d.vx * dt; d.y += d.vy * dt; d.z += clamp(dz * 3, -220, 220) * dt;
      d.tilt += (clamp(d.vx / 400, -1, 1) - d.tilt) * Math.min(1, dt * 6);
      if (recall) { d.home = L < 10 && Math.abs(dz) < 12; return; }
      d.fireT -= dt;
      if (d.target && d.fireT <= 0 && dist(d.x, d.y, d.target.x, d.target.y) < 280) { d.fireT = 0.38; this.shoot(d, d.target); }
    }
    shoot(d, e) {
      const g = this.game;
      const ez = (e.z || 0) + e.height * 0.5;
      const miss = g.jamAt(d.x, d.y) && Math.random() < 0.5;   // 📡 scrambled targeting
      const tx = miss ? e.x + rand(-55, 55) : e.x, ty = miss ? e.y + rand(-45, 45) : e.y;
      g.particles.line({ x: d.x, y: d.y, z: d.z - 6 }, { x: tx, y: ty, z: miss ? 0 : ez }, { color: '#d8fbff', width: 2, glow: 'rgba(60,200,255,0.5)', life: 0.08 });
      if (miss) g.particles.soil(tx, ty, { count: 2, speed: 90, dust: 1 });
      else {
        g.damageEnemy(e, this.dmg, { source: 'uav' });
        g.particles.sparks(e.x, e.y, ez, { count: 4, color: '#9ff6ff', speed: 180, life: 0.2 });
      }
      d.flash = 1;
      g.audio.play('uavshot');
    }
    get ready() { return this.state === 'fly' ? 1 : 1 - clamp(this.timer / this.v('cd'), 0, 1); }
    draw(ctx, sx, sy) {
      // landing pad
      D.ellipse(ctx, sx, sy + 2, 16, 8, '#2a3034', '#11161a', 1.5);
      ctx.strokeStyle = '#ffd400'; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.ellipse(sx, sy + 2, 12, 6, 0, 0, Math.PI * 2); ctx.stroke();
      ctx.fillStyle = '#ffd400'; ctx.font = "700 8px 'Rajdhani', sans-serif"; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText('H', sx, sy + 2.5);
      if (this.state === 'dock') {
        const k = this.ready;
        if (TD.S3 && TD.S3.has('uav')) TD.S3.draw(ctx, 'uav', sx, sy + 2, Math.PI / 2, 0, 0.6);
        else this.drawQuad(ctx, sx, sy - 3, 0.6, this.game.time * 4 * k, 0);
        ctx.fillStyle = 'rgba(0,0,0,0.6)'; ctx.fillRect(sx - 10, sy + 9, 20, 3);
        ctx.fillStyle = '#5ae0ff'; ctx.fillRect(sx - 10, sy + 9, 20 * k, 3);
      }
    }
    drawQuad(ctx, x, y, s, rot, tilt, flash = 0) {
      ctx.save(); ctx.translate(x, y); ctx.rotate(tilt * 0.3); ctx.scale(s, s);
      ctx.strokeStyle = '#1d2226'; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.moveTo(-16, -4); ctx.lineTo(16, 4); ctx.moveTo(-16, 4); ctx.lineTo(16, -4); ctx.stroke();
      for (const [rx, ry] of [[-16, -4], [16, 4], [-16, 4], [16, -4]]) {
        ctx.fillStyle = 'rgba(200,210,215,0.28)';
        ctx.beginPath(); ctx.ellipse(rx, ry - 3, 10, 3.2, 0, 0, Math.PI * 2); ctx.fill();
        ctx.strokeStyle = 'rgba(30,30,30,0.6)'; ctx.lineWidth = 1.2;
        ctx.beginPath(); ctx.moveTo(rx - Math.cos(rot) * 9, ry - 3 - Math.sin(rot) * 2.5); ctx.lineTo(rx + Math.cos(rot) * 9, ry - 3 + Math.sin(rot) * 2.5); ctx.stroke();
      }
      ctx.fillStyle = '#3d474d'; D.roundRect(ctx, -8, -5, 16, 9, 3); ctx.fill();
      ctx.fillStyle = '#5a6870'; ctx.fillRect(-6, -5, 12, 2.5);
      ctx.fillStyle = '#111'; ctx.beginPath(); ctx.arc(0, 5, 2.6, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = Math.sin(this.game.time * 9) > 0 ? '#ff3020' : '#30ff50';
      ctx.fillRect(-9, -2, 2, 2); ctx.fillRect(7, -2, 2, 2);
      if (flash > 0) { ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = flash; ctx.drawImage(D.blob('#7ff3ff'), -8, -2, 16, 16); ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over'; }
      ctx.restore();
    }
    drawTop(ctx) {
      if (this.state !== 'fly') return;
      const g = this.game;
      for (const d of this.drones) {
        const sh = g.project(d.x, d.y, 0);
        D.shadow(ctx, sh.x, sh.y, 14, 5, 0.22);
        const s = g.project(d.x, d.y, d.z);
        if (TD.S3 && TD.S3.has('uav')) {
          ctx.save(); ctx.translate(s.x, s.y); ctx.rotate(d.tilt * 0.3); TD.S3.draw(ctx, 'uav', 0, 8, Math.PI / 2); ctx.restore();
          if (d.flash > 0) { ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = d.flash; ctx.drawImage(D.blob('#7ff3ff'), s.x - 10, s.y, 20, 18); ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over'; }
        } else this.drawQuad(ctx, s.x, s.y, 1, d.rot, d.tilt, d.flash);
      }
    }
  }

  /** 🎯 Anti-Material Railgun — hitscan hypersonic beam, highest-HP priority. */
  class Railgun extends SubAux {
    constructor(tower) { super(tower, 'railgun', { ox: 0, oy: -46 }); this.timer = 2.5; this.charge = 0; this.target = null; }
    update(dt) {
      const g = this.game, t = this.tower;
      this.recoil = Math.max(0, this.recoil - dt * 3);
      const T = this.v('fireInterval');
      this.timer -= dt;
      this.charge = clamp(1 - this.timer / T, 0, 1);
      if (!this.target || !this.target.targetable) {
        this.target = null;
        for (const e of g.enemies) if (e.targetable && dist(e.x, e.y, t.x, t.y) < 1150 && (!this.target || e.hp > this.target.hp)) this.target = e;
      }
      if (this.target) this.aim = lerpAngle(this.aim, Math.atan2(this.target.y - t.y, this.target.x - t.x), Math.min(1, dt * 6));
      if (this.timer > 0) {
        if (this.timer < 0.7 && this.target && Math.random() < dt * 25) {
          const m = this.pos(24);
          g.particles.sparks(m.x, m.y, m.z, { count: 1, color: '#9ff6ff', speed: 90, life: 0.18 });
        }
        if (this.timer < 0.7 && this.timer + dt >= 0.7 && this.target) g.audio.play('railcharge');
        return;
      }
      if (!this.target) { this.timer = 0.3; return; }
      this.fire(this.target);
      this.timer = T;
    }
    fire(tg) {
      const g = this.game;
      const m = this.pos(24);
      const a = Math.atan2(tg.y - m.y, tg.x - m.x);
      this.aim = a;
      const pierce = this.v('pierce') > 0;
      const crit = Math.random() < this.v('crit');
      const dmg = this.v('dmg') * this.up * (crit ? 2 : 1);
      const L = 1500, cx = Math.cos(a), cy = Math.sin(a);
      const hits = [];
      if (pierce) {
        for (const e of g.enemies) {
          if (e.dead || e.burrowed) continue;
          const rx = e.x - m.x, ry = e.y - m.y;
          const k = rx * cx + ry * cy;
          if (k < 0 || k > L) continue;
          if (Math.abs(rx * -cy + ry * cx) < e.radius + 12) hits.push(e);
        }
        for (const r of g.rockets) {
          const rx = r.x - m.x, ry = r.y - m.y, k = rx * cx + ry * cy;
          if (k > 0 && Math.abs(rx * -cy + ry * cx) < 20) r.intercept();
        }
      } else hits.push(tg);
      for (const e of hits) {
        const z = (e.z || 0) + e.height * 0.5;
        g.damageEnemy(e, dmg, { source: 'rail', crit, style: crit ? 'crit' : 'normal' });
        if (crit && !e.dead) e.stun(2);
        g.particles.sparks(e.x, e.y, z, { count: 14, color: '#d8fbff', speed: 380, life: 0.3 });
        g.particles.flash(e.x, e.y, z, { size: 46, color: '160,240,255', life: 0.1 });
      }
      const tz = (tg.z || 0) + tg.height * 0.5;
      const end = pierce ? { x: m.x + cx * L, y: m.y + cy * L, z: Math.max(0, tz - 40) } : { x: tg.x, y: tg.y, z: tz };
      g.particles.beam(m, end, { width: crit ? 7 : 5, glow: crit ? '255,220,120' : '80,220,255' });
      g.particles.flash(m.x, m.y, m.z, { size: 70, color: '200,245,255', life: 0.12 });
      g.particles.ring(m.x, m.y, { radius: 70, color: '#bff6ff', width: 5, life: 0.25 });
      if (crit) g.ui.float(tg.x, tg.y, tz + 60, '⚡ CHÍ MẠNG ×2 + CHOÁNG', 'crit');
      this.recoil = 1; this.charge = 0;
      g.shake(5);
      g.audio.play('railgun');
    }
    draw(ctx, sx, sy) {
      const a = screenAngle(this.game, this.aim);
      if (TD.S3 && TD.S3.has('railgun')) {
        const rk = this.recoil * 4;
        TD.S3.drawPivot(ctx, 'railgun', sx - Math.cos(this.aim) * rk, sy + 3 - Math.sin(this.aim) * rk * 0.6, this.aim, -10.66, this.game.ISO);   // base stays on the mount
        if (this.charge > 0.15) {
          ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = this.charge * (0.5 + 0.4 * Math.sin(this.game.time * 40));
          ctx.drawImage(D.blob('#40d8ff'), sx + Math.cos(this.aim) * 14 - 22, sy - 26 + Math.sin(this.aim) * 7 - 12, 44, 24);
          ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
        }
        return;
      }
      D.ellipse(ctx, sx, sy + 3, 15, 7.5, '#272d31', '#0e1214', 1.5);
      ctx.fillStyle = '#3a4249'; ctx.fillRect(sx - 5, sy - 10, 10, 12);
      ctx.save();
      ctx.translate(sx, sy - 14);
      ctx.rotate(a);
      if (Math.cos(a) < 0) ctx.scale(1, -1);
      ctx.translate(-this.recoil * 7, 0);
      ctx.fillStyle = D.metal(ctx, -14, 14, '#69747c');
      D.roundRect(ctx, -14, -7, 22, 14, 3); ctx.fill();
      ctx.strokeStyle = '#0e1214'; ctx.lineWidth = 1.2; ctx.stroke();
      // twin rails + coils
      ctx.fillStyle = '#2b3237'; ctx.fillRect(6, -5.5, 46, 3.2); ctx.fillRect(6, 2.3, 46, 3.2);
      const ch = this.charge;
      for (let i = 0; i < 5; i++) {
        const lit = ch > (i + 1) / 6;
        ctx.fillStyle = lit ? '#7ff3ff' : '#44525a';
        ctx.fillRect(10 + i * 8, -7, 3, 14);
      }
      if (ch > 0.15) {
        ctx.globalCompositeOperation = 'lighter';
        ctx.globalAlpha = ch * (0.6 + 0.4 * Math.sin(this.game.time * 40));
        ctx.drawImage(D.blob('#40d8ff'), 4, -9, 52, 18);
        ctx.globalAlpha = 1;
        ctx.globalCompositeOperation = 'source-over';
      }
      ctx.restore();
    }
  }

  /** 🛡️ Aegis Forcefield — spherical bubble eats ranged projectiles, auto-collapses on timeout. */
  class AegisShield extends SubAux {
    constructor(tower) { super(tower, 'aegis', { ox: -46, oy: 22 }); this.state = 'ready'; this.timer = 0; this.hp = 0; this.T = 0; this.ripples = []; this.anim = 0; this.sprites = {}; }
    get R() { return this.tower.wall.lv > 0 ? 212 : 150; }
    get shieldMax() { return this.v('hp') * this.up; }
    get active() { return this.state === 'on'; }
    get ready() { return this.state === 'on' ? 1 : this.state === 'ready' ? 1 : 1 - clamp(this.timer / this.v('cd'), 0, 1); }
    update(dt) {
      const g = this.game;
      this.anim = this.active ? Math.min(1, this.anim + dt * 3.5) : Math.max(0, this.anim - dt * 3);
      for (const r of this.ripples) r.t += dt;
      this.ripples = this.ripples.filter((r) => r.t < 0.55);
      if (this.state === 'cd') { this.timer -= dt; if (this.timer <= 0) this.state = 'ready'; return; }
      if (this.state === 'ready') { if (this.threat()) this.activate(); return; }
      this.T -= dt;
      if (this.T <= 0) this.collapse(false);       // ⚠️ auto-expire even with HP left
      else if (this.hp <= 0) this.collapse(true);
    }
    threat() {
      const g = this.game, P2 = TD.Projectiles;
      for (const p of g.projectiles) if (!p.dead && (p instanceof P2.EnemyBullet || p instanceof P2.EnemyRocket || p instanceof P2.EnemyBomb)) return true;
      return g.enemies.some((e) => !e.dead && e.type === 'sniper' && e.aimT > 0.4);
    }
    activate() {
      const g = this.game;
      this.state = 'on'; this.hp = this.shieldMax; this.T = this.v('duration');
      g.particles.ring(this.tower.x, this.tower.y, { radius: this.R, color: '#7ff3ff', width: 10, life: 0.5 });
      g.audio.play('shield_up');
    }
    collapse(broken) {
      const g = this.game, t = this.tower;
      this.state = 'cd'; this.timer = this.v('cd');
      for (let i = 0; i < 26; i++) {
        const a = rand(0, Math.PI * 2), el = rand(0.1, 1.3);
        const x = t.x + Math.cos(a) * this.R * Math.cos(el), y = t.y + Math.sin(a) * this.R * Math.cos(el);
        g.particles.spawn({ type: 'spark', x, y, z: Math.sin(el) * this.R, vx: Math.cos(a) * 120, vy: Math.sin(a) * 120, vz: rand(-60, 60), g: -300, color: pick(['#bff6ff', '#5ae0ff', '#ffffff']), life: rand(0.4, 0.8), size: 2.6 });
      }
      g.ui.float(t.x, t.y, this.R + 40, broken ? '🛡️ KHIÊN VỠ!' : '🛡️ KHIÊN HẾT HẠN', 'shock');
      g.audio.play('shield_down');
    }
    /** Called by Game.shieldCatch. */
    absorb(x, y, z, dmg, attacker) {
      const g = this.game;
      this.hp -= dmg;
      this.ripples.push({ x, y, z, t: 0 });
      g.particles.sparks(x, y, z, { count: 6, color: '#bff6ff', speed: 200, life: 0.25 });
      g.audio.play('shield_hit');
      if (attacker && !attacker.dead && Math.random() < this.v('reflect')) {
        g.projectiles.push(new P.ReflectShot(g, { x, y, z, target: attacker, dmg: Math.max(30, dmg * 4) }));
      }
    }
    domeSprite(R) {
      if (this.sprites[R]) return this.sprites[R];
      const ISO = this.game.ISO, pad = 6;
      const w = R * 2 + pad * 2, h = R + R * ISO + pad * 2;
      const c = document.createElement('canvas'); c.width = w; c.height = h;
      const x = c.getContext('2d');
      const cx = w / 2, cy = pad + R;
      const path = () => { x.beginPath(); x.ellipse(cx, cy, R, R, 0, Math.PI, Math.PI * 2); x.ellipse(cx, cy, R, R * ISO, 0, 0, Math.PI); x.closePath(); };
      const gr = x.createRadialGradient(cx, cy - R * 0.3, R * 0.1, cx, cy - R * 0.2, R * 1.05);
      gr.addColorStop(0, 'rgba(90,220,255,0.03)'); gr.addColorStop(0.65, 'rgba(90,220,255,0.10)');
      gr.addColorStop(0.9, 'rgba(120,235,255,0.32)'); gr.addColorStop(1, 'rgba(200,250,255,0.6)');
      path(); x.fillStyle = gr; x.fill();
      x.save(); path(); x.clip();
      x.strokeStyle = 'rgba(160,245,255,0.22)'; x.lineWidth = 1;
      const hs = 16;
      for (let row = -2; row < (h / (hs * 1.5)) + 2; row++) {
        for (let col = -2; col < w / (hs * 1.73) + 2; col++) {
          const hx = col * hs * 1.73 + (row % 2 ? hs * 0.866 : 0), hy = row * hs * 1.5;
          x.beginPath();
          for (let i = 0; i < 6; i++) { const a = Math.PI / 6 + (i * Math.PI) / 3; x.lineTo(hx + Math.cos(a) * hs, hy + Math.sin(a) * hs); }
          x.closePath(); x.stroke();
        }
      }
      x.restore();
      path(); x.strokeStyle = 'rgba(200,250,255,0.75)'; x.lineWidth = 2; x.stroke();
      return (this.sprites[R] = { c, cx, cy });
    }
    draw(ctx, sx, sy) {
      const on = this.active, k = this.ready;
      if (TD.S3 && TD.S3.has('aegis_emitter')) {
        TD.S3.draw(ctx, 'aegis_emitter', sx, sy + 3);
        const gy = sy - TD.S3.height('aegis_emitter') * 0.8;
        ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = on ? 0.9 : 0.2 + 0.5 * k;
        ctx.drawImage(D.blob('#5ae0ff'), sx - 16, gy - 16, 32, 32);
        ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
        return;
      }
      D.ellipse(ctx, sx, sy + 2, 11, 5.5, '#2a3034', null, 0);
      ctx.fillStyle = D.metal(ctx, sx - 5, sx + 5, '#5d6a72');
      ctx.fillRect(sx - 4, sy - 26, 8, 26);
      for (let i = 0; i < 3; i++) D.ellipse(ctx, sx, sy - 8 - i * 7, 7, 2.6, '#3a8fb0', '#123040', 1);
      const gy = sy - 32;
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = on ? 0.9 : 0.25 + 0.5 * k;
      ctx.drawImage(D.blob('#5ae0ff'), sx - 16, gy - 16, 32, 32);
      ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
      D.circle(ctx, sx, gy, 5, on ? '#e8fdff' : '#7fb8c8', '#1e4a5a', 1.2);
    }
    drawTop(ctx) {
      if (this.anim <= 0) return;
      const g = this.game, t = this.tower;
      const R = this.R;
      const spr = this.domeSprite(R);
      const c = g.project(t.x, t.y, 0);
      const hpK = this.active ? clamp(this.hp / this.shieldMax, 0, 1) : 0;
      const warn = this.active && this.T < 2 ? (Math.sin(g.time * 30) > 0 ? 0.45 : 1) : 1;
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = this.anim * (0.55 + 0.35 * hpK) * (0.88 + 0.12 * Math.sin(g.time * 5)) * warn;
      const sc = 0.85 + 0.15 * this.anim;
      ctx.translate(c.x, c.y); ctx.scale(sc, sc);
      ctx.drawImage(spr.c, -spr.cx, -spr.cy);
      ctx.restore();
      // impact ripples
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      for (const r of this.ripples) {
        const s = g.project(r.x, r.y, r.z);
        const k = r.t / 0.55;
        ctx.globalAlpha = 1 - k;
        ctx.strokeStyle = '#e0fdff'; ctx.lineWidth = 3 * (1 - k) + 1;
        ctx.beginPath();
        for (let i = 0; i < 6; i++) { const a = (i * Math.PI) / 3; ctx.lineTo(s.x + Math.cos(a) * (8 + 34 * k), s.y + Math.sin(a) * (6 + 24 * k)); }
        ctx.closePath(); ctx.stroke();
        ctx.drawImage(D.blob('#7ff3ff'), s.x - 22, s.y - 18, 44, 36);
      }
      ctx.restore();
      // HP arc over the dome
      if (this.active) {
        ctx.strokeStyle = 'rgba(0,0,0,0.5)'; ctx.lineWidth = 6;
        ctx.beginPath(); ctx.arc(c.x, c.y, R * sc + 8, Math.PI * 1.25, Math.PI * 1.75); ctx.stroke();
        ctx.strokeStyle = '#7ff3ff'; ctx.lineWidth = 3.5;
        ctx.beginPath(); ctx.arc(c.x, c.y, R * sc + 8, Math.PI * 1.25, Math.PI * (1.25 + 0.5 * hpK)); ctx.stroke();
      }
      ctx.globalAlpha = 1;
    }
  }

  /** 🔥 Napalm Flamethrower — 4 corner nozzles, conical firestorm vs melee units. */
  class Flamethrower extends SubAux {
    constructor(tower) {
      super(tower, 'flamer', null);
      this.noz = [0, 1, 2, 3].map((i) => ({ base: Math.PI / 4 + (i * Math.PI) / 2, aim: Math.PI / 4 + (i * Math.PI) / 2, on: 0 }));
    }
    nozPos(n) { return { x: this.tower.x + Math.cos(n.base) * 76, y: this.tower.y + Math.sin(n.base) * 76, z: 20 }; }
    update(dt) {
      const g = this.game;
      const R = this.v('range'), half = 0.42, sweep = this.v('sweep') > 0, plasma = this.v('plasma') > 0;
      const dps = this.v('dmg') * this.up;
      let firing = false;
      for (const n of this.noz) {
        const p = this.nozPos(n);
        let best = null, bd = Infinity;
        for (const e of g.enemies) {
          if (e.dead || e.air || e.burrowed) continue;
          const d = dist(p.x, p.y, e.x, e.y) - e.radius;
          if (d > R || d >= bd) continue;
          const a = Math.atan2(e.y - p.y, e.x - p.x);
          if (!sweep && angDiff(a, n.base) > 0.8) continue;
          bd = d; best = e;
        }
        if (best) {
          n.on = Math.min(1, n.on + dt * 6);
          n.aim = lerpAngle(n.aim, Math.atan2(best.y - p.y, best.x - p.x), Math.min(1, dt * 8));
        } else {
          n.on = Math.max(0, n.on - dt * 4);
          n.aim = sweep ? n.aim + dt * 1.3 : lerpAngle(n.aim, n.base, Math.min(1, dt * 3));
        }
        if (n.on < 0.3) continue;
        firing = true;
        for (const e of g.enemies) {
          if (e.dead || e.air || e.burrowed) continue;
          const d = dist(p.x, p.y, e.x, e.y);
          if (d > R + e.radius) continue;
          const a = Math.atan2(e.y - p.y, e.x - p.x);
          if (angDiff(a, n.aim) > half + Math.atan2(e.radius, Math.max(1, d))) continue;
          g.damageEnemy(e, dps * dt, { source: 'flame', style: 'burn', dot: true });
          e.ignite(dps * 0.3, 3);
          if (plasma && !e.meltDone && e.armor > 0) {
            e.armor *= 0.5; e.meltDone = true;
            g.ui.float(e.x, e.y, e.height + 40, '🔵 GIÁP TAN 50%', 'shock');
          }
        }
        // conical flame stream
        const cols = plasma ? ['#ffffff', '#c8ecff', '#7ec2ff', '#3f78ff'] : ['#fff1a8', '#ffb347', '#ff6a1a', '#ff3a10'];
        for (let i = 0; i < 3; i++) {
          const sp = R * rand(2.2, 2.8);
          const a = n.aim + rand(-half, half) * 0.75;
          g.particles.spawn({ type: 'fire', x: p.x, y: p.y, z: p.z, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, vz: rand(-10, 40), size: rand(4, 7), grow: 3.2, color: pick(cols), life: (R / sp) * rand(0.9, 1.15), drag: 0.7 });
        }
        if (Math.random() < dt * 8) g.particles.spawn({ type: 'smoke', x: p.x + Math.cos(n.aim) * R * 0.9, y: p.y + Math.sin(n.aim) * R * 0.9, z: 20, vz: 40, size: 12, grow: 2, color: '#2a2520', alpha: 0.4, life: 1 });
      }
      if (firing) g.audio.play('flame');
    }
    renderItems(ctx, list) {
      for (const n of this.noz) {
        const p = this.nozPos(n);
        list.push({ y: p.y, d: () => this.drawNozzle(ctx, n, p) });
      }
    }
    drawNozzle(ctx, n, p) {
      const g = this.game;
      const s = g.project(p.x, p.y, 0);
      const plasma = this.v('plasma') > 0;
      if (TD.S3 && TD.S3.has('flamer_nozzle')) {
        TD.S3.draw(ctx, 'flamer_nozzle', s.x, s.y, n.aim);
        if (n.on > 0.1) {
          const fx = s.x + Math.cos(n.aim) * 16, fy = s.y - 14 + Math.sin(n.aim) * 8;
          ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = n.on;
          ctx.drawImage(D.blob(plasma ? '#6fb6ff' : '#ff8a30'), fx - 12, fy - 10, 24, 20);
          ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
        }
        return;
      }
      D.shadow(ctx, s.x, s.y + 2, 12, 5, 0.3);
      ctx.fillStyle = '#7a1f14'; D.roundRect(ctx, s.x - 7, s.y - 18, 14, 18, 4); ctx.fill();
      ctx.fillStyle = '#f0c020'; ctx.fillRect(s.x - 7, s.y - 12, 14, 2.5);
      ctx.fillStyle = '#2b2f33'; D.roundRect(ctx, s.x - 4, s.y - 24, 8, 7, 2); ctx.fill();
      const a = screenAngle(g, n.aim);
      ctx.save(); ctx.translate(s.x, s.y - 20); ctx.rotate(a);
      ctx.fillStyle = '#3d4449'; ctx.fillRect(0, -2.5, 14, 5);
      ctx.fillStyle = '#1a1d20'; ctx.fillRect(12, -3.5, 4, 7);
      if (n.on > 0.1) {
        ctx.globalCompositeOperation = 'lighter';
        ctx.globalAlpha = n.on;
        ctx.drawImage(D.blob(plasma ? '#6fb6ff' : '#ff8a30'), 8, -10, 24, 20);
        ctx.globalCompositeOperation = 'source-over'; ctx.globalAlpha = 1;
      } else {
        ctx.fillStyle = plasma ? '#5aa0ff' : '#ff7a2a';
        ctx.beginPath(); ctx.arc(16, 0, 1.4, 0, Math.PI * 2); ctx.fill();   // pilot light
      }
      ctx.restore();
    }
  }

  /** 🧪 Toxic Gas Mortar — constant launch interval, persistent corrosive clouds. */
  class GasMortar extends SubAux {
    constructor(tower) { super(tower, 'gas', null); this.timer = 2; this.clouds = []; this.bursts = 0; this.aim = -Math.PI / 4; }
    get wpos() { return { x: this.tower.x + 106, y: this.tower.y - 72, z: 18 }; }
    get dps() { return this.v('dmg') * this.up; }
    update(dt) {
      const g = this.game;
      this.recoil = Math.max(0, this.recoil - dt * 4);
      this.bursts = Math.max(0, this.bursts - dt * 3);
      const slow = this.v('slow') > 0;
      for (const c of this.clouds) {
        c.t -= dt; c.rot += dt * 0.4;
        for (const e of g.enemies) {
          if (e.dead || e.air || e.burrowed) continue;
          if (dist(e.x, e.y, c.x, c.y) > c.r + e.radius * 0.5) continue;
          g.damageEnemy(e, c.dps * dt, { source: 'gas', style: 'acid', dot: true });
          e.gasT = 0.4;
          if (slow) e.gasSlowT = 0.35;
        }
        if (Math.random() < dt * 5) g.particles.spawn({ type: 'smoke', x: c.x + rand(-c.r, c.r) * 0.7, y: c.y + rand(-c.r, c.r) * 0.6, z: 2, vz: rand(10, 30), size: rand(8, 14), grow: 1.6, color: pick(['#86d43a', '#5fa82a', '#a8e85a']), alpha: 0.35, life: 1.4 });
      }
      this.clouds = this.clouds.filter((c) => c.t > 0);
      this.timer -= dt;
      if (this.timer > 0) return;
      const t = this.tower;
      const pool = g.enemies.filter((e) => !e.dead && e.active && !e.air && !e.burrowed && dist(e.x, e.y, t.x, t.y) < 760);
      const c = g.densestPoint(pool);
      if (!c) { this.timer = 0.5; return; }
      this.launch(c);
      this.timer = this.v('fireInterval');            // ⚠️ constant at every level
    }
    launch(tg) {
      const g = this.game, m = this.wpos;
      const tx = tg.x + (tg.vx || 0) * 1.1, ty = tg.y + (tg.vy || 0) * 1.1;
      this.aim = Math.atan2(ty - m.y, tx - m.x);
      g.projectiles.push(new P.GasCanister(g, { x: m.x, y: m.y, z: m.z + 22, tx, ty, owner: this, T: 1.15 }));
      g.particles.smoke(m.x, m.y, m.z + 24, { count: 5, size: 12, speed: 50, life: 0.8, color: '#d8d4c6', alpha: 0.6 });
      g.particles.flash(m.x, m.y, m.z + 24, { size: 34, life: 0.08 });
      this.recoil = 1;
      g.audio.play('mortar');
    }
    land(x, y) {
      const g = this.game;
      const dur = this.v('duration');
      g.splashDamage(x, y, 55, 18, { source: 'mortar', ground: true });
      g.particles.smoke(x, y, 6, { count: 10, size: 22, speed: 120, life: 1.4, rise: 20, color: '#8ee04a', alpha: 0.5 });
      g.particles.sparks(x, y, 8, { count: 8, color: '#d8ff7a', speed: 200 });
      this.clouds.push({ x, y, r: 108, t: dur, max: dur, dps: this.dps, rot: rand(0, 6), seed: Math.random() * 10 });
      g.audio.play('gas');
    }
    /** Lv3: units killed inside the gas release secondary poison bursts. */
    burst(x, y) {
      const g = this.game;
      if (this.v('burst') <= 0 || this.bursts > 4) return;
      this.bursts++;
      g.splashDamage(x, y, 85, this.dps * 0.8, { source: 'gas', ground: true });
      g.particles.smoke(x, y, 10, { count: 8, size: 16, speed: 160, life: 1.0, rise: 30, color: '#b6ff4a', alpha: 0.6 });
      this.clouds.push({ x, y, r: 64, t: 2.5, max: 2.5, dps: this.dps * 0.6, rot: rand(0, 6), seed: Math.random() * 10 });
      g.audio.play('gaspop');
    }
    drawGround(ctx) {
      const g = this.game;
      for (const c of this.clouds) {
        const s = g.project(c.x, c.y, 0);
        const fade = Math.min(1, c.t / 0.8) * Math.min(1, (c.max - c.t) / 0.3 + 0.2);
        ctx.save();
        ctx.globalAlpha = 0.16 * fade;
        ctx.drawImage(D.blob('#3f7a18'), s.x - c.r * 1.1, s.y - c.r * 0.68, c.r * 2.2, c.r * 1.36);
        for (let i = 0; i < 7; i++) {
          const a = c.rot * (i % 2 ? 1 : -1) + i * 0.9 + c.seed;
          const rr = c.r * (0.25 + 0.4 * ((i * 37) % 10) / 10);
          const bx = s.x + Math.cos(a) * rr, by = s.y + Math.sin(a) * rr * g.ISO - 6;
          const br = c.r * (0.45 + 0.1 * Math.sin(g.time * 2 + i));
          ctx.globalAlpha = 0.2 * fade;
          ctx.drawImage(D.blob(i % 3 ? '#7ed13a' : '#b6f05a'), bx - br, by - br * 0.7, br * 2, br * 1.4);
        }
        ctx.restore();
      }
    }
    renderItems(ctx, list) { const m = this.wpos; list.push({ y: m.y, d: () => this.drawMortar(ctx) }); }
    drawMortar(ctx) {
      const g = this.game, m = this.wpos;
      const s = g.project(m.x, m.y, 0);
      if (TD.S3 && TD.S3.has('gas_mortar')) { D.shadow(ctx, s.x, s.y + 2, 24, 10, 0.3); TD.S3.draw(ctx, 'gas_mortar', s.x, s.y, this.aim); return; }
      D.shadow(ctx, s.x, s.y + 2, 24, 10, 0.3);
      for (let i = 0; i < 6; i++) { const a = Math.PI + (i / 5) * Math.PI; D.ellipse(ctx, s.x + Math.cos(a) * 20, s.y + Math.sin(a) * 8, 8, 4.5, i % 2 ? '#b8a06c' : '#a88f5c', '#5c4b2a', 1); }
      D.ellipse(ctx, s.x, s.y - 2, 12, 6, '#3a4030', '#15180f', 1.5);
      const a = screenAngle(g, this.aim);
      ctx.save(); ctx.translate(s.x, s.y - 6);
      ctx.scale(Math.cos(a) < 0 ? -1 : 1, 1);
      ctx.rotate(-1.05 + this.recoil * 0.12);
      ctx.fillStyle = D.metal(ctx, -4, 4, '#55613c');
      ctx.fillRect(-2 - this.recoil * 3, -4, 30, 8);
      ctx.fillStyle = '#d8e83a'; ctx.fillRect(22 - this.recoil * 3, -4, 3, 8);
      ctx.fillStyle = '#111'; ctx.fillRect(27 - this.recoil * 3, -3, 2, 6);
      ctx.restore();
      ctx.strokeStyle = '#2c3020'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(s.x - 8, s.y); ctx.lineTo(s.x + 2, s.y - 14); ctx.moveTo(s.x + 10, s.y); ctx.lineTo(s.x + 2, s.y - 14); ctx.stroke();
    }
  }

  /** 🪓 Shock Barbed Perimeter — electrified razor wire (mutually exclusive with the Wall). */
  class BarbedWire extends SubAux {
    constructor(tower) { super(tower, 'barbed', null); this.R = 120; this.tick = 0; this.strikes = 0; this.glow = 0; this.N = 26; }
    update(dt) {
      const g = this.game;
      this.glow = Math.max(0, this.glow - dt * 3);
      this.tick -= dt;
      if (this.tick > 0) return;
      this.tick = 0.4;
      const dmg = this.v('dmg') * this.up * 0.4;
      const zapped = [];
      for (const e of g.enemies) {
        if (e.dead || e.air || e.burrowed) continue;
        if (dist(e.x, e.y, this.tower.x, this.tower.y) <= this.R + e.radius + 16) { this.zap(e, dmg, null); zapped.push(e); }
      }
      const arcs = this.v('arc');
      if (arcs > 0) {
        for (const z of zapped) {
          let n = 0;
          for (const o of g.enemies) {
            if (n >= arcs) break;
            if (o.dead || o.air || o.burrowed || zapped.includes(o) || dist(o.x, o.y, z.x, z.y) > 130) continue;
            this.zap(o, dmg * 0.6, z); n++;
          }
        }
      }
      if (zapped.length) { this.glow = 1; g.audio.play('zap'); }
    }
    zap(e, dmg, from) {
      const g = this.game, t = this.tower;
      e.barbT = 0.8;                                 // -35% attack speed
      if (e.cloaked) e.reveal();
      g.damageEnemy(e, dmg, { source: 'barbed', style: 'shock', dot: true });
      e.shockT = 0.25;
      const a = Math.atan2(e.y - t.y, e.x - t.x);
      const p0 = from ? { x: from.x, y: from.y, z: from.height * 0.5 } : { x: t.x + Math.cos(a) * this.R, y: t.y + Math.sin(a) * this.R, z: 10 };
      g.particles.bolt([p0, { x: e.x, y: e.y, z: (e.z || 0) + e.height * 0.5 }], { jag: 8, life: 0.16 });
    }
    /** Lv3: every 5th melee strike on the fortress → 360° Shock Pulse (80 px knock-back). */
    onStrike() {
      if (this.v('pulse') <= 0) return;
      if (++this.strikes % 5) return;
      const g = this.game, t = this.tower;
      for (const e of g.enemies) {
        if (e.dead || e.air || e.burrowed || e.range > 0) continue;
        const d = dist(e.x, e.y, t.x, t.y);
        if (d > this.R + 140) continue;
        const f = (e.type === 'boss' ? 0.2 : e.heavy ? 0.5 : 1) * 640;
        e.knockX += ((e.x - t.x) / (d || 1)) * f; e.knockY += ((e.y - t.y) / (d || 1)) * f;
        g.damageEnemy(e, this.v('dmg') * this.up * 0.6, { source: 'barbed', style: 'shock' });
        e.stun(0.4);
      }
      g.particles.ring(t.x, t.y, { radius: this.R + 150, color: '#8af4ff', width: 14, life: 0.45 });
      g.particles.ring(t.x, t.y, { radius: this.R + 60, color: '#ffffff', width: 6, life: 0.3 });
      g.shake(6);
      g.audio.play('pulse');
      g.ui.float(t.x, t.y, 150, '⚡ XUNG SỐC!', 'shock');
    }
    renderItems(ctx, list) {
      for (let i = 0; i < this.N; i++) {
        const a = ((i + 0.5) / this.N) * Math.PI * 2;
        list.push({ y: Math.sin(a) * this.R, d: () => this.drawSeg(ctx, i) });
      }
    }
    drawSeg(ctx, i) {
      const g = this.game, t = this.tower, R = this.R;
      const a0 = (i / this.N) * Math.PI * 2, a1 = ((i + 1) / this.N) * Math.PI * 2;
      if (TD.S3 && TD.S3.has('barbed_wire')) {
        const mid = (a0 + a1) / 2, p = g.project(t.x + Math.cos(mid) * R, t.y + Math.sin(mid) * R, 0);
        const N = TD.S3.count('barbed_wire');
        TD.S3.drawIndex(ctx, 'barbed_wire', p.x, p.y, Math.floor(((i + 0.5) / this.N) * N) % N);
        if (this.glow > 0 && Math.random() < 0.7) { ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = 0.6 * this.glow; ctx.drawImage(D.blob('#8af4ff'), p.x - 18, p.y - 22, 36, 26); ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over'; }
        return;
      }
      const post = g.project(t.x + Math.cos(a0) * R, t.y + Math.sin(a0) * R, 0);
      ctx.strokeStyle = '#4a3a28'; ctx.lineWidth = 2.5;
      ctx.beginPath(); ctx.moveTo(post.x, post.y); ctx.lineTo(post.x, post.y - 18); ctx.stroke();
      const loops = 3;
      const live = this.glow > 0 && Math.random() < 0.7;
      for (let k = 0; k < loops; k++) {
        const a = a0 + (a1 - a0) * ((k + 0.5) / loops);
        const p = g.project(t.x + Math.cos(a) * R, t.y + Math.sin(a) * R, 9);
        ctx.strokeStyle = '#8b9196'; ctx.lineWidth = 1.3;
        ctx.beginPath(); ctx.ellipse(p.x, p.y, 6.5, 8.5, 0.25, 0, Math.PI * 2); ctx.stroke();
        ctx.strokeStyle = '#c9cfd4'; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(p.x - 2, p.y - 9); ctx.lineTo(p.x + 1, p.y - 12); ctx.moveTo(p.x + 5, p.y + 3); ctx.lineTo(p.x + 8, p.y + 5); ctx.stroke();
        if (live) {
          ctx.globalCompositeOperation = 'lighter';
          ctx.strokeStyle = `rgba(140,240,255,${0.5 * this.glow})`; ctx.lineWidth = 2.5;
          ctx.beginPath(); ctx.ellipse(p.x, p.y, 6.5, 8.5, 0.25, 0, Math.PI * 2); ctx.stroke();
          ctx.globalCompositeOperation = 'source-over';
        }
      }
      if (Math.random() < 0.012) {
        const p = g.project(t.x + Math.cos(a0) * R, t.y + Math.sin(a0) * R, 14);
        ctx.fillStyle = '#e8fdff'; ctx.fillRect(p.x - 1, p.y - 1, 2, 2);
      }
    }
  }

  /** 🧲 Vortex Trap — special mines that open a gravity anomaly (150 px pull). */
  class VortexTraps extends SubAux {
    constructor(tower) { super(tower, 'vortex', null); this.slots = []; this.vortices = []; this.build(); }
    get cfgLv() { const L = clamp(this.lv, 1, 3) - 1; return { n: [2, 3, 4][L], cd: [10, 8, 6.5][L], dur: [2.2, 2.6, 3.0][L], dmg: [60, 90, 130][L] }; }
    v() { return 0; }
    build() {
      const n = this.cfgLv.n;
      if (this.slots.length === n) return;
      this.slots = [];
      for (let i = 0; i < n; i++) this.slots.push({ a: (i / n) * Math.PI * 2 + 0.7, armed: true, t: 0, blink: rand(0, 2) });
    }
    slotPos(s) { return { x: this.tower.x + Math.cos(s.a) * 300, y: this.tower.y + Math.sin(s.a) * 300 }; }
    spawnVortex(x, y) {
      const c = this.cfgLv;
      this.vortices.push({ x, y, r: 150, t: c.dur, max: c.dur, dmg: c.dmg, spin: 0 });
      this.game.particles.ring(x, y, { radius: 150, color: '#b070ff', width: 8, life: 0.4 });
      this.game.audio.play('vortex');
    }
    update(dt) {
      const g = this.game;
      this.build();
      const c = this.cfgLv;
      for (const s of this.slots) {
        s.blink += dt;
        if (!s.armed) { s.t -= dt; if (s.t <= 0) s.armed = true; continue; }
        const p = this.slotPos(s);
        for (const e of g.enemies) {
          if (e.dead || e.air || !e.active) continue;
          if (dist(e.x, e.y, p.x, p.y) < e.radius + 24) { s.armed = false; s.t = c.cd; this.spawnVortex(p.x, p.y); g.particles.explosion(p.x, p.y, 0, 40, { quiet: true, debris: false }); break; }
        }
      }
      for (const v of this.vortices) {
        v.t -= dt; v.spin += dt * 6;
        for (const e of g.enemies) {
          if (e.dead || e.air) continue;
          const dx = v.x - e.x, dy = v.y - e.y, d = Math.hypot(dx, dy);
          if (d > v.r || d < 4) continue;
          const k = e.type === 'boss' ? 0.2 : e.heavy ? 0.45 : 1;
          const pull = (170 * (1 - d / v.r) + 70) * k;
          e.x += (dx / d) * pull * dt; e.y += (dy / d) * pull * dt;
          g.damageEnemy(e, 22 * dt, { source: 'vortex', dot: true });
        }
        if (Math.random() < dt * 30) g.particles.streaks(v.x, v.y, v.r, { count: 2 });
        if (v.t <= 0) {
          g.splashDamage(v.x, v.y, 95, v.dmg, { source: 'vortex', ground: true, knock: 120 });
          g.particles.explosion(v.x, v.y, 0, 70);
          g.particles.ring(v.x, v.y, { radius: 120, color: '#d0a0ff', width: 10, life: 0.4 });
          g.audio.play('boom_m');
        }
      }
      this.vortices = this.vortices.filter((v) => v.t > 0);
    }
    drawGround(ctx) {
      const g = this.game;
      for (const s of this.slots) {
        const sp = g.project(this.slotPos(s).x, this.slotPos(s).y, 0);
        if (!s.armed) { D.ellipse(ctx, sp.x, sp.y, 7, 3.5, 'rgba(40,20,60,0.5)', null, 0); continue; }
        if (TD.S3 && TD.S3.has('vortex_mine')) TD.S3.draw(ctx, 'vortex_mine', sp.x, sp.y);
        else {
          D.ellipse(ctx, sp.x, sp.y + 1, 13, 6.5, 'rgba(0,0,0,0.35)', null, 0);
          D.ellipse(ctx, sp.x, sp.y, 12, 6, '#2e2440', '#120c1c', 1.5);
          D.ellipse(ctx, sp.x, sp.y - 1.5, 6.5, 3.2, '#6a40a8', null, 0);
        }
        const on = (s.blink % 1.2) < 0.25;
        if (on) { ctx.globalCompositeOperation = 'lighter'; ctx.drawImage(D.blob('#b070ff'), sp.x - 12, sp.y - 13, 24, 22); ctx.globalCompositeOperation = 'source-over'; }
      }
      for (const v of this.vortices) {
        const s = g.project(v.x, v.y, 0);
        const fade = Math.min(1, v.t / 0.4) * Math.min(1, (v.max - v.t) / 0.25);
        ctx.save();
        ctx.translate(s.x, s.y); ctx.scale(1, g.ISO);
        ctx.globalAlpha = 0.7 * fade;
        ctx.drawImage(D.blob('#140626'), -v.r, -v.r, v.r * 2, v.r * 2);
        ctx.globalCompositeOperation = 'lighter';
        ctx.lineCap = 'round';
        for (let arm = 0; arm < 5; arm++) {
          ctx.strokeStyle = arm % 2 ? 'rgba(170,90,255,0.55)' : 'rgba(220,170,255,0.4)';
          ctx.lineWidth = 3 + (arm % 2) * 2;
          ctx.beginPath();
          for (let i = 0; i <= 24; i++) {
            const k = i / 24, rr = v.r * (1 - k) * 0.95;
            const a = v.spin + arm * (Math.PI * 2 / 5) + k * 4.2;
            i ? ctx.lineTo(Math.cos(a) * rr, Math.sin(a) * rr) : ctx.moveTo(Math.cos(a) * rr, Math.sin(a) * rr);
          }
          ctx.globalAlpha = fade;
          ctx.stroke();
        }
        ctx.globalAlpha = fade * 0.8;
        ctx.drawImage(D.blob('#c48aff'), -26, -26, 52, 52);
        ctx.restore();
      }
    }
  }

  const AUX_CLASSES = {
    rocket: RocketPod, tesla: TeslaCoil, sam: SamLauncher, laser: LaserSweeper,
    uav: UavSwarm, railgun: Railgun, aegis: AegisShield, flamer: Flamethrower, gas: GasMortar, barbed: BarbedWire, vortex: VortexTraps,
  };

  /* =========================================================
     RED-LINE BRANCHES
     ========================================================= */
  class Branch {
    constructor(tower, id) { this.tower = tower; this.game = tower.game; this.id = id; this.lv = 1; }
    val(key) { return TD.Config.branch(this.id, key, this.lv); }
    setLevel(lv) { this.lv = clamp(lv, 1, 3); }
    drawGround() {} drawTop() {} ultimate() {}
    /** 0..1 readiness, for the HUD. */
    get ready() { return 0; }
  }

  /** 💣 Minefield — mines scattered at random over the whole battlefield (outside the fortress base,
      inside the enemy approach zone). A detonated mine re-arms after `cd` at a NEW random spot.
      Count: CFG.branch.mine.count × [1, 1.75, 2.5] (8 / 14 / 20 by default). */
  class Minefield extends Branch {
    constructor(tower) { super(tower, 'mine'); this.slots = []; this.build(); }
    setLevel(lv) { super.setLevel(lv); this.build(); }
    build() {
      const n = Math.max(1, Math.round(this.val('count')));
      const old = this.slots;
      this.slots = [];
      for (let i = 0; i < n; i++) {
        const prev = old[i];
        const s = prev ? { x: prev.x, y: prev.y, armed: prev.armed, t: prev.t, blink: prev.blink } : { armed: true, t: 0, blink: rand(0, 2) };
        if (!prev) this.place(s);
        this.slots.push(s);
      }
    }
    /** Inner exclusion radius (fortress base + wall). Skill Game: "Khoảng cách tối thiểu từ tháp". */
    get radius() { return Math.max(190, TD.CFG.branch.mine.radius || 230); }
    /** Pick a random spot in the arena: away from the base, the edge and the other mines. */
    place(s) {
      const g = this.game, t = this.tower, { hw, hh } = g.ARENA;
      const minR = this.radius;
      let best = null, bestD = -1;
      for (let k = 0; k < 40; k++) {
        const x = rand(-hw + 50, hw - 50), y = rand(-hh + 50, hh - 50);
        if (Math.hypot(x - t.x, y - t.y) < minR) continue;
        let near = Infinity;
        for (const o of this.slots) if (o !== s && o.x !== undefined) near = Math.min(near, Math.hypot(o.x - x, o.y - y));
        if (near > 90) { best = { x, y }; break; }        // good enough
        if (near > bestD) { bestD = near; best = { x, y }; }
      }
      if (!best) { const a = rand(0, Math.PI * 2); best = { x: t.x + Math.cos(a) * (minR + 40), y: t.y + Math.sin(a) * (minR + 40) }; }
      s.x = best.x; s.y = best.y;
    }
    slotPos(s) { return { x: s.x, y: s.y }; }
    get ready() { return this.slots.filter((s) => s.armed).length / Math.max(1, this.slots.length); }
    rearm(s) {
      this.place(s);                       // 🎲 replacement goes to a new random position
      s.armed = true; s.t = 0;
      this.game.particles.ring(s.x, s.y, { radius: 26, color: '#ff5040', width: 3, life: 0.4 });
    }
    update(dt) {
      const g = this.game;
      const cd = this.val('cd');
      for (const s of this.slots) {
        s.blink += dt;
        if (!s.armed) {
          s.t -= dt;
          if (s.t <= 0) this.rearm(s);
          continue;
        }
        for (const e of g.enemies) {
          if (e.dead || e.air || !e.active) continue;
          if (dist(e.x, e.y, s.x, s.y) < e.radius + 22) { this.detonate(s, 1); s.t = cd; break; }
        }
      }
    }
    detonate(s, mult) {
      const g = this.game;
      const p = this.slotPos(s);
      s.armed = false;
      this.count = (this.count || 0) + 1;
      const vt = this.tower.auxWeapons.find((w) => w.id === 'vortex');
      if (vt && this.count % 3 === 0) vt.spawnVortex(p.x, p.y);
      const blast = this.val('blast');
      g.splashDamage(p.x, p.y, blast, this.val('dmg') * mult, { source: 'mine', ground: true, knock: this.val('knock') });
      g.particles.explosion(p.x, p.y, 0, blast);
      g.audio.play('boom_m');
      g.shake(4);
    }
    ultimate() {
      for (const s of this.slots) this.detonate(s, 1.5);
      for (const s of this.slots) this.rearm(s);
      this.game.ui.banner('💥 BÃI MÌN TỐI THƯỢNG', 'Toàn bộ bãi mìn kích nổ & cài lại ở vị trí mới', 'perk');
    }
    drawGround(ctx) {
      const g = this.game;
      for (const s of this.slots) {
        const sp = g.project(s.x, s.y, 0);
        if (!s.armed) {
          ctx.strokeStyle = 'rgba(30,30,30,0.5)'; ctx.lineWidth = 2;
          ctx.beginPath(); ctx.moveTo(sp.x - 5, sp.y - 3); ctx.lineTo(sp.x + 5, sp.y + 3); ctx.moveTo(sp.x + 5, sp.y - 3); ctx.lineTo(sp.x - 5, sp.y + 3); ctx.stroke();
          continue;
        }
        const on = (s.blink % 1.2) < 0.18;
        if (TD.S3 && TD.S3.has('mine')) {
          TD.S3.draw(ctx, 'mine', sp.x, sp.y);
          if (on) { ctx.globalCompositeOperation = 'lighter'; ctx.drawImage(D.blob('#ff3020'), sp.x - 10, sp.y - 13, 20, 18); ctx.globalCompositeOperation = 'source-over'; }
          continue;
        }
        D.ellipse(ctx, sp.x, sp.y + 1, 12, 6, 'rgba(0,0,0,0.35)', null, 0);
        D.ellipse(ctx, sp.x, sp.y, 11, 5.5, '#4b5238', '#1b1e14', 1.5);
        D.ellipse(ctx, sp.x, sp.y - 1.5, 6, 3, '#6b7350', null, 0);
        if (on) {
          ctx.globalCompositeOperation = 'lighter';
          ctx.drawImage(D.blob('#ff3020'), sp.x - 9, sp.y - 11, 18, 18);
          ctx.globalCompositeOperation = 'source-over';
        }
        ctx.fillStyle = on ? '#ff6050' : '#701a14';
        ctx.beginPath(); ctx.arc(sp.x, sp.y - 2, 1.8, 0, Math.PI * 2); ctx.fill();
      }
    }
  }

  class BomberWing extends Branch {
    constructor(tower) { super(tower, 'bomber'); this.timer = 4; this.planes = []; }
    get ready() { return 1 - clamp(this.timer / this.val('cd'), 0, 1); }
    update(dt) {
      const g = this.game;
      for (const p of this.planes) this.updatePlane(p, dt);
      this.planes = this.planes.filter((p) => !p.done);
      this.timer -= dt;
      if (this.timer <= 0) {
        if (!g.enemies.some((e) => !e.dead && e.active)) { this.timer = 0.5; return; }
        this.sortie(this.val('planes'), 1);
        this.timer = this.val('cd');
      }
    }
    sortie(n, mult) {
      const g = this.game;
      const targets = g.enemies.filter((e) => e.targetable && !e.air);
      const pool = targets.length ? targets : g.enemies.filter((e) => !e.dead && !e.air);
      if (!pool.length) return;
      for (let i = 0; i < n; i++) {
        const c = g.densestPoint(pool) || pool[0];
        const tx = c.x + rand(-60, 60), ty = c.y + rand(-60, 60);
        const dir = rand(0, Math.PI * 2);
        const off = (i - (n - 1) / 2) * 70;
        const nx = -Math.sin(dir), ny = Math.cos(dir);
        this.planes.push({
          cx: tx + nx * off, cy: ty + ny * off, dir, s: -1500 - i * 220, speed: 1000,
          z: 340, dropAcc: 0, mult, done: false, x: 0, y: 0,
        });
      }
      g.audio.play('jet');
      g.ui.float(0, 0, 260, '✈️ KHÔNG KÍCH!', 'info');
    }
    updatePlane(p, dt) {
      const g = this.game;
      p.s += p.speed * dt;
      p.x = p.cx + Math.cos(p.dir) * p.s;
      p.y = p.cy + Math.sin(p.dir) * p.s;
      if (Math.abs(p.s) < 330) {
        p.dropAcc += p.speed * dt;
        while (p.dropAcc >= 62) {
          p.dropAcc -= 62;
          g.projectiles.push(new P.Bomb(g, {
            x: p.x, y: p.y, z: p.z - 10, vx: Math.cos(p.dir) * p.speed * 0.32, vy: Math.sin(p.dir) * p.speed * 0.32,
            dmg: this.val('dmg') * p.mult, radius: this.val('radius'),
          }));
        }
      }
      if (p.s > 1600) p.done = true;
      if (Math.random() < 0.5) g.particles.spawn({ type: 'smoke', x: p.x - Math.cos(p.dir) * 40, y: p.y - Math.sin(p.dir) * 40, z: p.z, size: 5, grow: 3, color: '#f0f0f0', alpha: 0.35, life: 0.8 });
    }
    ultimate() {
      this.sortie(this.val('planes') + 2, 1.5);
      this.game.ui.banner('✈️ KHÔNG KÍCH TỐI THƯỢNG', 'Phi đội ném bom rải thảm', 'perk');
    }
    drawTop(ctx) {
      const g = this.game;
      for (const p of this.planes) {
        const sh = g.project(p.x + 60, p.y + 90, 0);
        const s = g.project(p.x, p.y, p.z);
        const a = screenAngle(g, p.dir);
        // ground shadow
        ctx.save();
        ctx.translate(sh.x, sh.y); ctx.rotate(a); ctx.scale(1, 0.6);
        ctx.fillStyle = 'rgba(0,0,0,0.22)';
        this.jetPath(ctx, 1.1); ctx.fill();
        ctx.restore();
        if (TD.S3 && TD.S3.has('bomber_jet')) {
          ctx.save(); ctx.translate(s.x, s.y); ctx.rotate(a); ctx.globalCompositeOperation = 'lighter';
          ctx.drawImage(D.blob('#ffa040'), -72, -10, 34, 20); ctx.restore();
          TD.S3.draw(ctx, 'bomber_jet', s.x, s.y + 12, p.dir);
          continue;
        }
        ctx.save();
        ctx.translate(s.x, s.y); ctx.rotate(a);
        ctx.globalCompositeOperation = 'lighter';
        ctx.drawImage(D.blob('#ffa040'), -70, -10, 34, 20);
        ctx.globalCompositeOperation = 'source-over';
        ctx.fillStyle = '#6b7884';
        this.jetPath(ctx, 1); ctx.fill();
        ctx.strokeStyle = '#2b3138'; ctx.lineWidth = 1.5; ctx.stroke();
        ctx.fillStyle = '#9fd7ff';
        ctx.beginPath(); ctx.ellipse(22, 0, 9, 3.5, 0, 0, Math.PI * 2); ctx.fill();
        ctx.restore();
      }
    }
    jetPath(ctx, k) {
      ctx.beginPath();
      ctx.moveTo(44 * k, 0);
      ctx.lineTo(24 * k, -6 * k); ctx.lineTo(4 * k, -8 * k); ctx.lineTo(-12 * k, -36 * k); ctx.lineTo(-22 * k, -36 * k);
      ctx.lineTo(-16 * k, -8 * k); ctx.lineTo(-34 * k, -7 * k); ctx.lineTo(-42 * k, -18 * k); ctx.lineTo(-48 * k, -18 * k);
      ctx.lineTo(-44 * k, 0);
      ctx.lineTo(-48 * k, 18 * k); ctx.lineTo(-42 * k, 18 * k); ctx.lineTo(-34 * k, 7 * k); ctx.lineTo(-16 * k, 8 * k);
      ctx.lineTo(-22 * k, 36 * k); ctx.lineTo(-12 * k, 36 * k); ctx.lineTo(4 * k, 8 * k); ctx.lineTo(24 * k, 6 * k);
      ctx.closePath();
    }
  }

  class NukeSilo extends Branch {
    constructor(tower) { super(tower, 'nuke'); this.timer = 10; this.hatch = 0; }
    get ready() { return 1 - clamp(this.timer / this.val('cd'), 0, 1); }
    update(dt) {
      const g = this.game;
      this.hatch = Math.max(0, this.hatch - dt * 0.5);
      this.timer -= dt;
      if (this.timer > 0) return;
      if (this.launch(1)) this.timer = this.val('cd');
      else this.timer = 0.5;
    }
    launch(mult) {
      const g = this.game;
      const target = g.highestHpEnemy();
      if (!target) return false;
      g.projectiles.push(new P.NukeWarhead(g, { target, dmg: this.val('dmg') * mult, radius: this.val('radius') }));
      g.audio.play('siren');
      g.ui.float(target.x, target.y, target.height + 60, '☢ KHÓA MỤC TIÊU', 'big');
      const m = this.tower.mountPos({ ox: -46, oy: 20 });
      g.particles.smoke(m.x, m.y, 30, { count: 16, size: 22, speed: 120, life: 1.6, color: '#e6e1d6', rise: 80 });
      this.hatch = 1;
      return true;
    }
    ultimate() {
      if (this.launch(1.5)) this.game.ui.banner('☢ ĐÒN HẠT NHÂN TỐI THƯỢNG', 'Sát thương ×1.5', 'perk');
      this.timer = Math.min(this.timer, this.val('cd') * 0.5);
    }
  }

  const BRANCH_CLASSES = { mine: Minefield, bomber: BomberWing, nuke: NukeSilo };

  TD.Weapons = { Minigun, SubTurret, AUX_CLASSES, BRANCH_CLASSES, screenAngle };
})(window.TD);
