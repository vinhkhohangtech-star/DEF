/* =========================================================
   Enemy.js — 7 modern military units + the MAMMOTH boss
   knife (melee) • ak (mid-range bursts) • sniper (long range)
   biker (kamikaze) • tank (armored, shells) • drone (air kamikaze)
   katyusha (artillery truck — interceptable rocket volleys)
   + WaveSpawner (ground units spawn at a random 360° angle on the outer ring)
   Live stats come from TD.CFG.enemies (Skill Game → tab 4).
   ========================================================= */
(function (TD) {
  'use strict';
  const { rand, randInt, pick, dist, clamp, lerpAngle } = TD.util;
  const D = TD.Draw;
  const PR = TD.Projectiles;

  /** Fixed (non-tunable) per-type data. */
  const TYPES = {
    knife:    { name: 'Lính Dao',            kind: 'melee',   radius: 14, height: 40, armor: 0, gold: 5,   score: 10 },
    ak:       { name: 'Lính AK',             kind: 'ranged',  radius: 14, height: 42, armor: 0, gold: 7,   score: 14 },
    sniper:   { name: 'Lính Bắn Tỉa',        kind: 'ranged',  radius: 14, height: 40, armor: 0, gold: 11,  score: 22 },
    biker:    { name: 'Xe Máy Cảm Tử',       kind: 'suicide', radius: 18, height: 40, armor: 0, gold: 8,   score: 18 },
    tank:     { name: 'Xe Tăng Thiết Giáp',  kind: 'ranged',  radius: 34, height: 46, armor: 4, gold: 26,  score: 60, heavy: true },
    drone:    { name: 'Máy Bay Cảm Tử',      kind: 'air',     radius: 16, height: 14, armor: 0, gold: 8,   score: 16 },
    katyusha: { name: 'Xe Tên Lửa Katyusha', kind: 'ranged',  radius: 34, height: 44, armor: 2, gold: 22,  score: 50, heavy: true },
    boss:     { name: 'Siêu Tăng MAMMOTH',   kind: 'ranged',  radius: 60, height: 74, armor: 5, gold: 220, score: 600, heavy: true, from: 'tank', hpMult: 4.5, dmgMult: 0.6, husk: true },
    // ---- Part III: 7 new units (stats from TD.CFG.foes) ----
    dozer:   { name: 'Xe Ủi Phá Tường',      kind: 'melee',   radius: 38, height: 50, armor: 5, gold: 30, score: 70,  heavy: true, husk: true,
      stats: (f) => ({ hp: f.hp, dmg: f.damageToWall, range: 0, speed: f.speed, atk: 1.4 }) },
    jammer:  { name: 'Xe Gây Nhiễu EW',      kind: 'support', radius: 34, height: 52, armor: 2, gold: 34, score: 80,  heavy: true, husk: true,
      stats: (f) => ({ hp: f.hp, dmg: 0, range: 470, speed: 40, atk: 99 }) },
    medic:   { name: 'Xe Cứu Thương APC',    kind: 'support', radius: 32, height: 46, armor: 3, gold: 30, score: 70,  heavy: true, husk: true,
      stats: (f) => ({ hp: f.hp, dmg: 0, range: 0, speed: 46, atk: 99 }) },
    para:    { name: 'Lính Dù',              kind: 'melee',   radius: 14, height: 40, armor: 0, gold: 6,  score: 12,
      stats: (f) => ({ hp: f.hp, dmg: f.damage, range: 0, speed: 70, atk: 0.9 }) },
    stealth: { name: 'Đặc Công Tàng Hình',   kind: 'melee',   radius: 14, height: 40, armor: 0, gold: 14, score: 30,
      stats: (f) => ({ hp: f.hp, dmg: f.c4Damage, range: 0, speed: f.speed, atk: 1 }) },
    hbomber: { name: 'Pháo Đài Bay',         kind: 'air',     radius: 46, height: 20, armor: 3, gold: 45, score: 110,
      stats: (f) => ({ hp: f.hp, dmg: f.bombDamage, range: 0, speed: f.speed, atk: 99 }) },
    sapper:  { name: 'Công Binh Đào Hầm',    kind: 'melee',   radius: 15, height: 38, armor: 1, gold: 12, score: 26,
      stats: (f) => ({ hp: f.hp, dmg: f.popDamage, range: 0, speed: f.tunnelSpeed, atk: 1.1 }) },
  };
  /** type → baked 3D sprite id (assets/sprites3d). Paratroopers reuse the AK rifleman body. */
  const S3MAP = { knife: 'knife', ak: 'ak', sniper: 'sniper', biker: 'biker', tank: 'tank', boss: 'boss', drone: 'drone', para: 'ak' };
  const SEISMIC = new Set(['mine', 'arty', 'bomb', 'nuke', 'mortar', 'vortex', 'fallout']);

  class Enemy {
    constructor(game, type, x, y, scale) {
      const meta = TYPES[type];
      const c = meta.stats ? meta.stats(TD.CFG.foes[type]) : TD.CFG.enemies[meta.from || type];
      this.game = game;
      this.type = type;
      this.cfg = meta;
      this.x = x; this.y = y; this.z = meta.kind === 'air' ? 85 : 0;
      this.vx = 0; this.vy = 0;
      this.air = meta.kind === 'air';
      this.heavy = !!meta.heavy;
      this.radius = meta.radius;
      this.height = meta.height;
      this.maxHp = Math.max(1, Math.round(c.hp * (meta.hpMult || 1) * scale.hp));
      this.hp = this.maxHp;
      this.baseSpeed = c.speed * (type === 'boss' ? 0.8 : 1) * scale.speed * rand(0.92, 1.08);
      this.range = c.range;
      this.atkCd = Math.max(0.15, c.atk);
      this.dmg = c.dmg * (meta.dmgMult || 1) * scale.dmg;
      this.armor = meta.armor * scale.armor;
      this.gold = Math.round(meta.gold * scale.gold);
      this.score = meta.score;
      this.rocketHp = Math.round(12 * Math.sqrt(scale.hp));
      this.dead = false;
      this.active = false;
      this.atkTimer = rand(0.3, 1.0);
      this.attackAnim = 0;
      this.attacking = false;
      this.stunT = 0; this.shockT = 0; this.burnT = 0;
      this.hitFlash = 0; this.squash = 0;
      this.walkT = Math.random() * 10;
      this.facing = x < 0 ? 1 : -1;
      this.wobbleSeed = Math.random() * 10;
      this.knockX = 0; this.knockY = 0;
      this.turretA = Math.atan2(-y, -x);
      this.recoil = 0;
      this.burst = 0; this.burstT = 0;
      this.aimT = 0;
      this.deploy = 0;
      this.volley = 0; this.volleyT = 0;
      this.shots = 0;
      this.stompT = 0;
      this.wallSeg = null;
      this.flashT = 0;
      // status effects (Part I cards + sub-skills)
      this.chillT = 0; this.chillPct = 0;
      this.igniteT = 0; this.igniteDps = 0;
      this.acidT = 0; this.corroded = 0;
      this.gasT = 0; this.gasSlowT = 0; this.barbT = 0; this.adrenaT = 0;
      this.cloaked = false; this.burrowed = false; this.meltDone = false;
      // 💰 Bounty Hunter: +20% HP & speed, ×2 gold
      if (game.tower && game.tower.cards.bounty) {
        this.maxHp = Math.round(this.maxHp * 1.2); this.hp = this.maxHp;
        this.baseSpeed *= 1.2; this.gold *= 2; this.bounty = true;
      }
    }

    /** Baked 3D sprite for this unit (null → vector art). */
    get s3() { const k = S3MAP[this.type]; return k && TD.S3 && TD.S3.has(k) ? k : null; }
    /** Facing used to pick the sprite heading: travel direction, else toward the target. */
    viewHeading() {
      let a;
      if (Math.abs(this.vx) + Math.abs(this.vy) > 2) a = Math.atan2(this.vy, this.vx);
      else { const t = this.currentTarget(); a = Math.atan2(t.y - this.y, t.x - this.x); }
      this.viewA = this.viewA == null ? a : lerpAngle(this.viewA, a, 0.2);
      return this.viewA;
    }
    drawS3(ctx) {
      if (!this.air) ctx.scale(this.facing, 1);           // undo the vector-art mirror
      const id = this.s3;
      const m = TD.S3.M[id];
      const moving = !this.attacking && !this.frozen;
      const frame = m.frames > 1 && moving ? Math.floor(this.walkT * 0.85) % m.frames : 0;
      // 1-frame infantry (AK, sniper, para): procedural leg scissor instead of a static glide
      if (m.frames === 1 && TD.Loco && TD.Loco.kind(this) === 'inf') TD.Loco.drawGait(ctx, id, this.viewHeading(), this);
      else TD.S3.draw(ctx, id, 0, 0, this.viewHeading(), frame);
      if (this.recoil > 0.7 && (this.type === 'tank' || this.type === 'boss')) {
        const a = this.turretA, L = this.type === 'boss' ? 80 : 48;
        this.muzzleFlash(ctx, Math.cos(a) * L, -(this.type === 'boss' ? 40 : 22) + Math.sin(a) * L * this.game.ISO, this.type === 'boss' ? 20 : 12);
      } else if (this.flashT > 0) {
        const a = this.viewA || 0;
        this.muzzleFlash(ctx, Math.cos(a) * 16, -26 + Math.sin(a) * 8, 8);
      }
    }

    /** Can be auto-targeted by direct-fire weapons. */
    get targetable() { return !this.dead && this.active && !this.cloaked && !this.burrowed; }
    get moveMult() {
      let m = 1;
      if (this.chillT > 0) m *= 1 - this.chillPct;
      if (this.gasSlowT > 0) m *= 0.6;
      if (this.adrenaT > 0) m *= 2;
      return m;
    }
    get atkMult() {
      let m = 1;
      if (this.chillT > 0) m *= 1 - this.chillPct;
      if (this.barbT > 0) m *= 0.65;
      return m;
    }
    chill(pct, dur) { if (this.type === 'boss') pct *= 0.5; this.chillPct = Math.max(this.chillT > 0 ? this.chillPct : 0, pct); this.chillT = Math.max(this.chillT, dur); }
    ignite(dps, dur) { this.igniteDps = Math.max(this.igniteT > 0 ? this.igniteDps : 0, dps); this.igniteT = Math.max(this.igniteT, dur); }
    /** 🧪 Acid Melt: strips armor permanently. */
    corrode(n, lv) {
      this.acidT = 1.2;
      this.corroded = Math.max(this.corroded, lv);
      if (this.armor > 0) {
        this.armor = Math.max(0, this.armor - n * 0.25);
        if (this.armor === 0 && !this.acidMsg) { this.acidMsg = true; this.game.ui.float(this.x, this.y, this.height + 46, '🧪 HẾT GIÁP', 'acid'); }
      }
    }
    heal(n) {
      if (this.dead || this.hp >= this.maxHp) return 0;
      const b = this.hp; this.hp = Math.min(this.maxHp, this.hp + n); return this.hp - b;
    }
    reveal() {}

    get frozen() { return this.stunT > 0; }
    get slowed() { return false; }
    stun(dur) { this.stunT = Math.max(this.stunT, this.type === 'boss' ? dur * 0.4 : dur); this.aimT = 0; }
    freeze(dur) { this.stun(dur); }
    applySlow() {}

    currentTarget() {
      const g = this.game;
      if (g.decoy) return { x: g.decoy.x, y: g.decoy.y, r: 24, decoy: true };
      return { x: g.tower.x, y: g.tower.y, r: g.tower.radius, decoy: false };
    }

    /** Point where my shot lands + what it hits. */
    shotTarget(tgt, blockable) {
      const g = this.game;
      if (tgt.decoy) return { x: tgt.x + rand(-8, 8), y: tgt.y + rand(-6, 6), z: rand(20, 50), payload: { kind: 'decoy', dmg: this.dmg } };
      const a = Math.atan2(this.y - tgt.y, this.x - tgt.x);
      if (blockable && this.wallSeg && this.wallSeg.hp > 0) {
        const R = g.tower.wall.R + 6;
        return { x: Math.cos(a) * R + rand(-6, 6), y: Math.sin(a) * R + rand(-4, 4), z: rand(6, 22), payload: { kind: 'wall', seg: this.wallSeg, dmg: this.dmg, attacker: this } };
      }
      const r = tgt.r * 0.9;
      return { x: tgt.x + Math.cos(a) * r + rand(-10, 10), y: tgt.y + Math.sin(a) * r * 0.8, z: rand(20, g.tower.height * 0.85), payload: { kind: 'tower', dmg: this.dmg, attacker: this } };
    }

    update(dt) {
      if (TD.Loco) TD.Loco.update(this, dt);           // 🏃 procedural gait / suspension (v12)
      if (!this.tickCommon(dt)) return;
      this.think(dt);
    }

    /** Timers, status effects, knock-back, stun. Returns false while the unit can't act. */
    tickCommon(dt) {
      const g = this.game;
      this.hitFlash = Math.max(0, this.hitFlash - dt * 8);
      this.squash = Math.max(0, this.squash - dt * 6);
      this.attackAnim = Math.max(0, this.attackAnim - dt * 4);
      this.recoil = Math.max(0, this.recoil - dt * 4);
      this.flashT = Math.max(0, this.flashT - dt);
      this.shockT = Math.max(0, this.shockT - dt);
      this.burnT = Math.max(0, this.burnT - dt);
      this.chillT = Math.max(0, this.chillT - dt);
      this.acidT = Math.max(0, this.acidT - dt);
      this.gasT = Math.max(0, this.gasT - dt);
      this.gasSlowT = Math.max(0, this.gasSlowT - dt);
      this.barbT = Math.max(0, this.barbT - dt);
      this.adrenaT = Math.max(0, this.adrenaT - dt);
      this.statusFx(dt);
      if (this.dead) return false;

      this.x += this.knockX * dt; this.y += this.knockY * dt;
      this.knockX *= Math.max(0, 1 - dt * 8); this.knockY *= Math.max(0, 1 - dt * 8);
      if (!this.active && Math.abs(this.x) < g.ARENA.hw && Math.abs(this.y) < g.ARENA.hh) this.active = true;

      if (this.stunT > 0) {
        this.stunT -= dt;
        this.vx = 0; this.vy = 0;
        if (Math.random() < dt * 6) g.particles.sparks(this.x, this.y, this.z + this.height * 0.6, { count: 2, color: '#7fe8ff', speed: 90, life: 0.2 });
        return false;
      }
      return true;
    }

    /** Status VFX + damage over time. */
    statusFx(dt) {
      const g = this.game, P = g.particles;
      const zc = (this.z || 0) + this.height * 0.5;
      if (this.igniteT > 0) {
        this.igniteT -= dt;
        g.damageEnemy(this, this.igniteDps * dt, { source: 'burn', style: 'burn', dot: true });
        if (Math.random() < dt * 16) P.spawn({ type: 'fire', x: this.x + rand(-this.radius, this.radius) * 0.6, y: this.y, z: (this.z || 0) + rand(4, this.height), vz: rand(40, 90), vx: rand(-10, 10), size: rand(5, 9), grow: 0.4, color: pick(['#ffb347', '#ff6a1a', '#ff3a10']), life: rand(0.25, 0.45), drag: 1 });
        if (Math.random() < dt * 5) P.spawn({ type: 'smoke', x: this.x, y: this.y, z: (this.z || 0) + this.height, vz: 50, size: 6, grow: 2.4, color: '#1e1b18', alpha: 0.45, life: 0.9 });
      }
      if (this.chillT > 0 && Math.random() < dt * 9) P.spawn({ type: 'spark', x: this.x + rand(-this.radius, this.radius), y: this.y + rand(-4, 4), z: (this.z || 0) + rand(this.height * 0.6, this.height * 1.2), vz: -25, g: -40, color: pick(['#ffffff', '#cdf6ff', '#8ee8ff']), life: 0.8, size: rand(1.4, 2.4), drag: 0.5 });
      if (this.acidT > 0 && Math.random() < dt * 8) P.spawn({ type: 'smoke', x: this.x + rand(-this.radius, this.radius) * 0.7, y: this.y, z: rand(4, zc + 10), vz: rand(20, 45), size: rand(3, 6), grow: 2, color: pick(['#b6ff3a', '#7ad12a', '#d8ff7a']), alpha: 0.5, life: 0.7 });
      if (this.adrenaT > 0 && !this.air && Math.random() < dt * 24) P.spawn({ type: 'fire', layer: 'ground', x: this.x + rand(-5, 5), y: this.y + rand(-3, 3), z: 0, size: rand(5, 8), grow: 0.2, color: '#ff2a2a', life: 0.45 });
    }

    think(dt) {
      const g = this.game;
      const tgt = this.currentTarget();
      if (this.air) return this.updateAir(dt, tgt);

      const dx = tgt.x - this.x, dy = tgt.y - this.y;
      const d = Math.hypot(dx, dy) || 1;
      if (Math.abs(dx) > 3) this.facing = dx > 0 ? 1 : -1;
      this.turretA = lerpAngle(this.turretA, Math.atan2(dy, dx), Math.min(1, dt * 2.5));

      // perimeter wall between me and the base?
      this.wallSeg = null;
      let wallDist = Infinity;
      const wall = g.tower.wall;
      if (!tgt.decoy && wall.lv > 0) {
        const dc = Math.hypot(this.x - g.tower.x, this.y - g.tower.y);
        if (dc > wall.R - 4) {
          const seg = wall.segAt(Math.atan2(this.y - g.tower.y, this.x - g.tower.x));
          if (seg) { this.wallSeg = seg; wallDist = dc - wall.R - this.radius - 6; }
        }
      }

      const kind = this.cfg.kind;
      if (kind === 'ranged') {
        const inRange = d - tgt.r <= this.range;
        if (inRange || wallDist <= 0) { this.halt(dt); return this.rangedAttack(dt, tgt, d); }
        this.aimT = 0; this.deploy = Math.max(0, this.deploy - dt);
      } else {
        if (wallDist <= 0) { this.halt(dt); return this.meleeAttack(dt, tgt, this.wallSeg); }
        if (d <= tgt.r + this.radius - 4) { this.halt(dt); return this.meleeAttack(dt, tgt, null); }
      }
      this.move(dt, dx / d, dy / d);
    }

    halt(dt) { this.attacking = true; this.vx = 0; this.vy = 0; this.walkT += dt * 1.5; }
    onDeath() {}
    /** World point the unit is heading toward (used by bulldozer plow facing). */
    heading() { const g = this.game; const L = Math.hypot(g.tower.x - this.x, g.tower.y - this.y) || 1; return { x: (g.tower.x - this.x) / L, y: (g.tower.y - this.y) / L }; }

    move(dt, nx, ny) {
      const g = this.game;
      this.attacking = false;
      const speed = this.baseSpeed * this.moveMult;
      const wob = this.heavy ? 0 : Math.sin(this.walkT * 0.6 + this.wobbleSeed) * 0.22;
      this.vx = (nx - ny * wob) * speed;
      this.vy = (ny + nx * wob) * speed;
      this.x += this.vx * dt;
      this.y += this.vy * dt;
      this.walkT += dt * (6 + speed * 0.05);
      if (this.type === 'biker' && Math.random() < dt * 14) {
        g.particles.smoke(this.x - nx * 18, this.y - ny * 10, 4, { count: 1, size: 8, speed: 20, life: 0.5, color: '#b9a98a', alpha: 0.45, rise: 15 });
      }
      if (this.heavy && Math.random() < dt * 6) {
        g.particles.smoke(this.x - nx * 30, this.y - ny * 16, 4, { count: 1, size: 10, speed: 15, life: 0.7, color: '#a89878', alpha: 0.35, rise: 10 });
      }
      if (this.type === 'boss') {
        this.stompT -= dt;
        if (this.stompT <= 0) { this.stompT = 0.8; g.shake(2.5); g.audio.play('stomp'); }
      }
    }

    updateAir(dt, tgt) {
      const g = this.game;
      const dx = tgt.x - this.x, dy = tgt.y - this.y;
      const d = Math.hypot(dx, dy) || 1;
      this.facing = dx > 0 ? 1 : -1;
      const sp = this.baseSpeed * this.moveMult * (d < 220 ? 1.5 : 1);
      this.vx = (dx / d) * sp; this.vy = (dy / d) * sp;
      this.x += this.vx * dt; this.y += this.vy * dt;
      this.walkT += dt * 30;
      const cruise = 85 + Math.sin(this.walkT * 0.08 + this.wobbleSeed) * 6;
      const goalZ = tgt.decoy ? 20 : g.tower.height * 0.7;
      this.z = d < 220 ? goalZ + (cruise - goalZ) * ((d - tgt.r) / 160) : cruise;
      this.z = Math.max(goalZ, Math.min(cruise, this.z));
      if (Math.random() < dt * 20) g.particles.spawn({ type: 'smoke', x: this.x - (dx / d) * 14, y: this.y - (dy / d) * 14, z: this.z, size: 4, grow: 2, color: '#dcd8cf', alpha: 0.35, life: 0.5 });
      if (d <= tgt.r + 10) this.selfDestruct(tgt.decoy ? null : { kind: 'tower' }, 60);
    }

    /** Kamikaze units: explode, deal damage, die without giving rewards. */
    selfDestruct(hit, radius) {
      const g = this.game;
      if (this.dead) return;
      this.dead = true;
      g.particles.explosion(this.x, this.y, this.z, radius);
      g.audio.play('boom_m');
      g.shake(6);
      if (hit) {
        if (hit.kind === 'wall') g.tower.wall.damage(hit.seg, this.dmg * 1.4);
        else g.tower.takeDamage(this.dmg, this);
      }
    }

    meleeAttack(dt, tgt, seg) {
      const g = this.game;
      if (this.type === 'biker') {
        if (tgt.decoy) return this.selfDestruct(null, 70);
        return this.selfDestruct(seg ? { kind: 'wall', seg } : { kind: 'tower' }, 75);
      }
      this.atkTimer -= dt * this.atkMult;
      if (this.atkTimer > 0) return;
      this.atkTimer = this.atkCd;
      this.attackAnim = 1;
      if (seg) g.tower.wall.damage(seg, this.dmg);
      else if (tgt.decoy) g.damageDecoy(this.dmg, tgt.x, tgt.y);
      else { g.tower.takeDamage(this.dmg, this); g.onMeleeStrike(this); }
      g.audio.play('slash');
    }

    rangedAttack(dt, tgt, d) {
      const g = this.game;
      const t = this.type;
      if (t === 'ak') {
        if (this.burst > 0) {
          this.burstT -= dt;
          if (this.burstT <= 0) {
            this.burstT = 0.09; this.burst--;
            const st = this.shotTarget(tgt, true);
            const m = { x: this.x + this.facing * 18, y: this.y, z: 25 };
            g.projectiles.push(new PR.EnemyBullet(g, { x: m.x, y: m.y, z: m.z, tx: st.x, ty: st.y, tz: st.z, payload: st.payload }));
            this.flashT = 0.05; this.recoil = 1;
            g.audio.play('ak');
          }
          return;
        }
        this.atkTimer -= dt * this.atkMult;
        if (this.atkTimer <= 0) { this.atkTimer = this.atkCd; this.burst = 3; this.burstT = 0; }
        return;
      }
      if (t === 'sniper') {
        this.aimT += dt * this.atkMult;
        this.atkTimer -= dt * this.atkMult;
        if (this.atkTimer <= 0 && this.aimT > 1.1) {
          this.atkTimer = this.atkCd; this.aimT = 0;
          const st = this.shotTarget(tgt, false);
          const m = { x: this.x + this.facing * 26, y: this.y, z: 22 };
          const blk = g.shieldBlockLine(m, st, this.dmg, this);   // 🛡️ Aegis eats hitscan rounds too
          const hit = blk || st;
          g.particles.line(m, { x: hit.x, y: hit.y, z: hit.z }, { color: '#ffffff', width: 2.5, glow: 'rgba(255,255,255,0.35)', life: 0.14 });
          g.particles.flash(m.x, m.y, m.z, { size: 40, life: 0.08 });
          g.particles.sparks(hit.x, hit.y, hit.z, { count: 6, color: '#ffffff', speed: 200 });
          if (!blk) g.applyEnemyHit(st.payload, st.x, st.y, st.z);
          this.flashT = 0.06; this.recoil = 1;
          g.audio.play('sniper');
          this.creep(28);
        }
        return;
      }
      if (t === 'tank' || t === 'boss') {
        if (this.volley > 0) {
          this.volleyT -= dt;
          if (this.volleyT <= 0) { this.volleyT = 0.2; this.volley--; this.fireRocket(tgt); }
        }
        this.atkTimer -= dt * this.atkMult;
        if (this.atkTimer > 0) return;
        this.atkTimer = this.atkCd;
        this.shots++;
        const barrels = t === 'boss' ? [-1, 1] : [0];
        for (const b of barrels) {
          const st = this.shotTarget(tgt, true);
          const a = this.turretA;
          const L = t === 'boss' ? 70 : 42;
          const m = { x: this.x + Math.cos(a) * L - Math.sin(a) * b * 8, y: this.y + Math.sin(a) * L + Math.cos(a) * b * 8, z: t === 'boss' ? 54 : 36 };
          g.projectiles.push(new PR.TankShell(g, { x: m.x, y: m.y, z: m.z, tx: st.x, ty: st.y, tz: st.z, payload: st.payload }));
          g.particles.flash(m.x, m.y, m.z, { size: 50, life: 0.1 });
          g.particles.smoke(m.x, m.y, m.z, { count: 5, size: 12, speed: 70, life: 0.9, color: '#bdb6a6', alpha: 0.55 });
        }
        this.recoil = 1;
        g.audio.play('tank');
        if (t === 'boss' && this.shots % 3 === 0) { this.volley = 4; this.volleyT = 0.4; }
        return;
      }
      if (t === 'katyusha') {
        this.deploy = Math.min(1, this.deploy + dt / 1.2);
        if (this.volley > 0) {
          this.volleyT -= dt;
          if (this.volleyT <= 0) {
            this.volleyT = 0.22; this.volley--;
            this.fireRocket(tgt);
          }
          return;
        }
        if (this.deploy < 1) return;
        this.atkTimer -= dt * this.atkMult;
        if (this.atkTimer <= 0) { this.atkTimer = this.atkCd; this.volley = 6; this.volleyT = 0; g.audio.play('siren_s'); this.creep(45); }
      }
    }

    /** Long-range units reposition a little closer after firing (no endless stalemates). */
    creep(d) {
      const g = this.game;
      if (this.range < 300) return;
      const dx = g.tower.x - this.x, dy = g.tower.y - this.y;
      const L = Math.hypot(dx, dy) || 1;
      if (L < 330) return;
      this.range = Math.max(260, this.range - d);
    }

    fireRocket(tgt) {
      const g = this.game;
      const st = this.shotTarget(tgt, false);
      const m = { x: this.x - this.facing * 10, y: this.y, z: 46 };
      g.projectiles.push(new PR.EnemyRocket(g, { x: m.x, y: m.y, z: m.z, tx: st.x, ty: st.y, tz: st.z, hp: this.rocketHp, payload: st.payload }));
      g.particles.smoke(m.x, m.y, m.z, { count: 4, size: 12, speed: 60, life: 0.9, color: '#d8d2c6', alpha: 0.6 });
      g.particles.flash(m.x, m.y, m.z, { size: 36, life: 0.08 });
      g.audio.play('rocket');
    }

    separate(others, dt) {
      if (this.air || this.frozen || this.burrowed) return;
      for (const o of others) {
        if (o === this || o.dead || o.air || o.burrowed) continue;
        const dx = this.x - o.x, dy = this.y - o.y;
        const min = (this.radius + o.radius) * 0.85;
        const d2 = dx * dx + dy * dy;
        if (d2 > 0.01 && d2 < min * min) {
          const d = Math.sqrt(d2);
          const push = ((min - d) / min) * 90 * dt;
          const wt = o.radius / (this.radius + o.radius);
          this.x += (dx / d) * push * wt * 2;
          this.y += (dy / d) * push * wt * 2;
        }
      }
      const t = this.game.tower;
      const tdx = this.x - t.x, tdy = this.y - t.y;
      const td = Math.hypot(tdx, tdy) || 1;
      const tmin = t.radius + this.radius * 0.6;
      if (td < tmin) { this.x = t.x + (tdx / td) * tmin; this.y = t.y + (tdy / td) * tmin; }
      // don't walk through an intact wall segment
      const w = t.wall;
      if (w.lv > 0 && !this.game.decoy) {
        const seg = w.segAt(Math.atan2(tdy, tdx));
        const wmin = w.R + this.radius + 4;
        if (seg && td < wmin && td > w.R - 20) { this.x = t.x + (tdx / td) * wmin; this.y = t.y + (tdy / td) * wmin; }
      }
    }

    hitReact(knock) {
      this.squash = 1;
      this.hitFlash = 1;
      if (TD.Loco) TD.Loco.flinch(this, knock || this.game.tower);
      if (knock && this.type !== 'boss') {
        const dx = this.x - knock.x, dy = this.y - knock.y;
        const d = Math.hypot(dx, dy) || 1;
        const f = knock.f * (this.heavy ? 0.15 : this.air ? 0.4 : 1);
        this.knockX += (dx / d) * f;
        this.knockY += (dy / d) * f;
      }
    }

    /* =========================== drawing =========================== */
    draw(ctx) {
      const g = this.game;
      const gs = g.project(this.x, this.y, 0);
      const r = this.radius;
      D.shadow(ctx, gs.x, gs.y, r * (this.air ? 0.8 : 1.15), r * (this.air ? 0.3 : 0.42), this.air ? 0.2 : 0.32);
      const s = g.project(this.x, this.y, this.z);
      const moving = !this.attacking && !this.frozen;
      // 🏃 v12: stride bob / lean / sway (infantry), rumble / pitch / recoil (vehicles) from TD.Loco
      const lk = TD.Loco && TD.Loco.on && TD.Loco.kind(this);
      const pose = lk ? TD.Loco.pose(this) : null;
      const bounce = pose ? pose.lift : moving && !this.heavy && !this.air && this.type !== 'biker' ? Math.abs(Math.sin(this.walkT)) * 2.5 : 0;
      const hs = this.squash * (this.heavy ? 0.3 : 1);

      ctx.save();
      ctx.translate(s.x + (pose ? pose.dx : 0), s.y - bounce + (pose ? pose.dy : 0));
      if (pose && (pose.rot || pose.sy !== 1)) { ctx.rotate(pose.rot); ctx.scale(1, pose.sy); }
      if (!this.air) ctx.scale(this.facing * (1 + hs * 0.12), 1 - hs * 0.1);
      const usedSprite = !this.air && TD.Assets.drawSprite(ctx, this.type, 0, 0, r * 2.8);
      if (!usedSprite) { if (this.s3) this.drawS3(ctx); else this.drawBody(ctx); }
      if (this.hitFlash > 0) {
        ctx.globalAlpha = this.hitFlash * 0.55;
        ctx.globalCompositeOperation = 'lighter';
        ctx.drawImage(D.blob('#ffffff'), -r * 1.2, -this.height * 1.1 - 4, r * 2.4, this.height * 1.25);
        ctx.globalCompositeOperation = 'source-over';
        ctx.globalAlpha = 1;
      }
      ctx.restore();
      this.drawStatus(ctx, s, r, bounce);
    }

    drawBody(ctx) {
        switch (this.type) {
          case 'knife': this.drawSoldier(ctx, { uniform: '#2b2b2b', vest: '#3a3a3a', pants: '#2e2e30', head: 'bandana', hat: '#c0262b', weapon: 'knife' }); break;
          case 'ak': this.drawSoldier(ctx, { uniform: '#6b6a3e', vest: '#4f5530', pants: '#5d5b38', head: 'helmet', hat: '#4a5232', weapon: 'ak' }); break;
          case 'sniper': this.drawSoldier(ctx, { uniform: '#4f6a36', vest: '#3e5a2a', pants: '#455e30', head: 'ghillie', hat: '#5d7a3a', weapon: 'sniper' }); break;
          case 'biker': this.drawBiker(ctx); break;
          case 'tank': this.drawTank(ctx, 1, '#59633e', '#3f4a2a'); break;
          case 'boss': this.drawTank(ctx, 1.75, '#3d4038', '#25281f', true); break;
          case 'katyusha': this.drawKatyusha(ctx); break;
          case 'drone': this.drawDrone(ctx); break;
        }
    }

    drawStatus(ctx, s, r, bounce) {
      const g = this.game;
      // ❄️ chill shimmer • 🔥 burning • 🧪 acid
      if (this.chillT > 0 || this.igniteT > 0 || this.acidT > 0) {
        ctx.save();
        ctx.globalCompositeOperation = 'lighter';
        const bx = s.x - r * 1.25, by = s.y - this.height - 8, bw = r * 2.5, bh = this.height + 14;
        if (this.chillT > 0) {
          ctx.globalAlpha = 0.32 + 0.12 * Math.sin(g.time * 9 + this.wobbleSeed);
          ctx.drawImage(D.blob('#7fe8ff'), bx, by, bw, bh);
          ctx.fillStyle = '#ffffff';
          for (let i = 0; i < 3; i++) { const fx = s.x + Math.sin(g.time * 3 + i * 2.1 + this.wobbleSeed) * r * 0.7, fy = s.y - this.height * (0.2 + 0.3 * i); ctx.globalAlpha = 0.5 + 0.5 * Math.sin(g.time * 12 + i); ctx.fillRect(fx - 1, fy - 1, 2, 2); }
        }
        if (this.igniteT > 0) {
          ctx.globalAlpha = 0.35 + 0.25 * Math.random();
          ctx.drawImage(D.blob('#ff6a20'), bx, by + bh * 0.2, bw, bh * 0.85);
        }
        if (this.acidT > 0) {
          ctx.globalAlpha = 0.28;
          ctx.drawImage(D.blob('#9cff2a'), bx, by, bw, bh);
          ctx.globalCompositeOperation = 'source-over';
          ctx.globalAlpha = 0.85;
          ctx.fillStyle = '#9be32a';
          for (let i = 0; i < 4; i++) { const a = g.time * 2 + i * 1.6 + this.wobbleSeed; ctx.beginPath(); ctx.arc(s.x + Math.cos(a) * r * 0.9, s.y - this.height * (0.25 + 0.15 * (i % 3)), 1.5 + (i % 2), 0, Math.PI * 2); ctx.fill(); }
        }
        ctx.restore();
      }
      // status overlays
      if (this.stunT > 0 || this.shockT > 0) {
        ctx.save();
        ctx.globalCompositeOperation = 'lighter';
        ctx.strokeStyle = '#8af4ff'; ctx.lineWidth = 1.5;
        for (let i = 0; i < 3; i++) {
          ctx.beginPath();
          let px = s.x + rand(-r, r), py = s.y - rand(0, this.height);
          ctx.moveTo(px, py);
          for (let k = 0; k < 3; k++) { px += rand(-8, 8); py += rand(-8, 8); ctx.lineTo(px, py); }
          ctx.stroke();
        }
        ctx.globalAlpha = 0.25;
        ctx.drawImage(D.blob('#40d0ff'), s.x - r * 1.3, s.y - this.height - 6, r * 2.6, this.height + 12);
        ctx.restore();
      }
      if (this.burnT > 0) {
        ctx.globalCompositeOperation = 'lighter';
        ctx.globalAlpha = this.burnT * 1.5;
        ctx.drawImage(D.blob('#ff40e0'), s.x - r, s.y - this.height, r * 2, this.height);
        ctx.globalAlpha = 1;
        ctx.globalCompositeOperation = 'source-over';
      }
      // sniper laser sight
      if (this.type === 'sniper' && this.aimT > 0.05 && !this.frozen) {
        const tgt = this.currentTarget();
        const m = g.project(this.x + this.facing * 26, this.y, 22);
        const e = g.project(tgt.x, tgt.y, 40);
        const k = clamp(this.aimT / 1.1, 0, 1);
        ctx.strokeStyle = `rgba(255,30,30,${0.25 + k * 0.55})`;
        ctx.lineWidth = 1 + k;
        ctx.beginPath(); ctx.moveTo(m.x, m.y); ctx.lineTo(e.x, e.y); ctx.stroke();
        ctx.fillStyle = `rgba(255,40,40,${0.5 + k * 0.5})`;
        ctx.beginPath(); ctx.arc(e.x, e.y, 3 + k * 2, 0, Math.PI * 2); ctx.fill();
      }
      if (this.type !== 'boss' && this.hp < this.maxHp && !this.cloaked && !this.burrowed) {
        D.hpBar(ctx, s.x, s.y - this.height - 14 - bounce, Math.max(26, r * 1.8), this.hp / this.maxHp, '#ff5a3c');
      }
    }

    /** Generic modern infantry. Faces right, feet at 0. */
    drawSoldier(ctx, o) {
      const moving = !this.attacking && !this.frozen;
      const step = moving ? Math.sin(this.walkT) : 0;
      const kneel = this.type === 'sniper' && this.attacking ? 7 : 0;
      // legs
      ctx.lineCap = 'round';
      ctx.strokeStyle = o.pants; ctx.lineWidth = 5;
      ctx.beginPath();
      ctx.moveTo(-2, -16 + kneel); ctx.lineTo(-3 + step * 6, -1);
      ctx.moveTo(2, -16 + kneel); ctx.lineTo(kneel ? 9 : 3 - step * 6, kneel ? -2 : -1);
      ctx.stroke();
      ctx.fillStyle = '#1b1b1b';
      ctx.fillRect(-6 + step * 6, -3, 7, 3); ctx.fillRect((kneel ? 7 : 0) - step * 6, -3, 7, 3);
      // torso
      ctx.save(); ctx.translate(0, kneel);
      ctx.fillStyle = o.uniform;
      D.roundRect(ctx, -6, -31, 12, 17, 4); ctx.fill();
      ctx.fillStyle = o.vest;
      D.roundRect(ctx, -6, -29, 11, 12, 3); ctx.fill();
      ctx.fillStyle = 'rgba(0,0,0,0.35)';
      ctx.fillRect(-4, -26, 3, 4); ctx.fillRect(1, -26, 3, 4);
      ctx.fillStyle = '#2a2418'; ctx.fillRect(-6, -17, 12, 2.5);
      // head
      ctx.fillStyle = '#c99b74';
      ctx.beginPath(); ctx.arc(1, -36, 5, 0, Math.PI * 2); ctx.fill();
      if (o.head === 'helmet') {
        ctx.fillStyle = o.hat;
        ctx.beginPath(); ctx.arc(1, -37.5, 6, Math.PI, 0); ctx.fill();
        ctx.fillRect(-5.5, -38, 13, 2.4);
        ctx.fillStyle = '#1c1c1c'; ctx.fillRect(3, -36.5, 4, 1.8);
      } else if (o.head === 'bandana') {
        ctx.fillStyle = o.hat;
        ctx.beginPath(); ctx.arc(1, -37.5, 5.4, Math.PI, 0); ctx.fill();
        ctx.beginPath(); ctx.moveTo(-4, -38); ctx.lineTo(-11, -40 + Math.sin(this.walkT * 2) * 2); ctx.lineTo(-10, -35); ctx.closePath(); ctx.fill();
        ctx.fillStyle = '#222'; ctx.fillRect(-4, -34, 10, 3);
      } else {
        // ghillie hood
        ctx.fillStyle = o.hat;
        ctx.beginPath(); ctx.arc(1, -37, 7, Math.PI * 0.9, Math.PI * 2.1); ctx.fill();
        ctx.strokeStyle = '#3b5226'; ctx.lineWidth = 1.5;
        for (let i = 0; i < 6; i++) { ctx.beginPath(); ctx.moveTo(-5 + i * 2.4, -42); ctx.lineTo(-6 + i * 2.6, -46 - (i % 2) * 2); ctx.stroke(); }
      }
      ctx.fillStyle = '#111'; ctx.beginPath(); ctx.arc(4, -36, 0.9, 0, Math.PI * 2); ctx.fill();
      // weapon & arms
      const rk = -this.recoil * 2;
      if (o.weapon === 'ak') {
        ctx.save(); ctx.translate(rk, 0);
        ctx.fillStyle = '#5a3a1e'; ctx.fillRect(-8, -25, 7, 4);               // stock
        ctx.fillStyle = '#222'; ctx.fillRect(-1, -26, 16, 4.5);               // receiver
        ctx.fillRect(14, -25, 8, 2);                                          // barrel
        ctx.fillStyle = '#5a3a1e'; ctx.fillRect(9, -26, 5, 3.5);              // handguard
        ctx.fillStyle = '#2d2d2d';
        ctx.beginPath(); ctx.moveTo(4, -21.5); ctx.quadraticCurveTo(5, -16, 9, -15); ctx.lineTo(10, -17); ctx.quadraticCurveTo(8, -18, 8, -21.5); ctx.fill(); // curved mag
        ctx.strokeStyle = o.uniform; ctx.lineWidth = 3.5;
        ctx.beginPath(); ctx.moveTo(-2, -28); ctx.lineTo(2, -22); ctx.lineTo(10, -24); ctx.stroke();
        if (this.flashT > 0) this.muzzleFlash(ctx, 23, -24, 9);
        ctx.restore();
      } else if (o.weapon === 'sniper') {
        ctx.save(); ctx.translate(rk, 0);
        ctx.fillStyle = '#3b3f2c'; ctx.fillRect(-9, -26, 10, 4.5);
        ctx.fillStyle = '#2a2d22'; ctx.fillRect(0, -26, 16, 4);
        ctx.fillStyle = '#151515'; ctx.fillRect(16, -25, 15, 2);
        ctx.fillStyle = '#111'; D.roundRect(ctx, 2, -31, 11, 4, 2); ctx.fill();
        ctx.fillStyle = '#ff3030'; ctx.fillRect(12, -30, 1.5, 2);
        ctx.strokeStyle = o.uniform; ctx.lineWidth = 3.5;
        ctx.beginPath(); ctx.moveTo(-2, -28); ctx.lineTo(3, -22); ctx.lineTo(12, -24); ctx.stroke();
        if (this.flashT > 0) this.muzzleFlash(ctx, 32, -24, 12);
        ctx.restore();
      } else {
        // combat knife slash
        const sw = this.attackAnim > 0 ? -1.6 + this.attackAnim * 2.6 : Math.sin(this.walkT) * 0.4;
        ctx.save(); ctx.translate(3, -26); ctx.rotate(sw);
        ctx.strokeStyle = o.uniform; ctx.lineWidth = 3.5;
        ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(9, 4); ctx.stroke();
        ctx.fillStyle = '#222'; ctx.fillRect(8, 2, 4, 3);
        ctx.fillStyle = '#e8eef2';
        ctx.beginPath(); ctx.moveTo(12, 2); ctx.lineTo(22, 1); ctx.lineTo(12, 5); ctx.closePath(); ctx.fill();
        ctx.restore();
        if (this.attackAnim > 0.5) {
          ctx.strokeStyle = `rgba(255,255,255,${this.attackAnim - 0.4})`; ctx.lineWidth = 2;
          ctx.beginPath(); ctx.arc(6, -24, 18, -1.2, 0.8); ctx.stroke();
        }
      }
      ctx.restore();
    }

    muzzleFlash(ctx, x, y, s) {
      ctx.globalCompositeOperation = 'lighter';
      ctx.drawImage(D.blob('#ffb040'), x - s, y - s, s * 2.2, s * 2);
      ctx.fillStyle = '#fff2b0';
      ctx.beginPath(); ctx.moveTo(x - 2, y - 2); ctx.lineTo(x + s * 1.2, y); ctx.lineTo(x - 2, y + 2); ctx.closePath(); ctx.fill();
      ctx.globalCompositeOperation = 'source-over';
    }

    drawBiker(ctx) {
      const spin = this.walkT * 3;
      // speed lines
      if (!this.attacking) {
        ctx.strokeStyle = 'rgba(255,255,255,0.45)'; ctx.lineWidth = 2;
        for (let i = 0; i < 3; i++) { ctx.beginPath(); ctx.moveTo(-26 - i * 5, -10 - i * 7); ctx.lineTo(-44 - i * 6, -10 - i * 7); ctx.stroke(); }
      }
      const wheel = (x) => {
        D.circle(ctx, x, -8, 8, '#151515', null, 0);
        D.circle(ctx, x, -8, 4.5, '#5a5a5a', null, 0);
        ctx.strokeStyle = '#999'; ctx.lineWidth = 1;
        for (let k = 0; k < 3; k++) { const a = spin + (k * Math.PI) / 3; ctx.beginPath(); ctx.moveTo(x - Math.cos(a) * 4.5, -8 - Math.sin(a) * 4.5); ctx.lineTo(x + Math.cos(a) * 4.5, -8 + Math.sin(a) * 4.5); ctx.stroke(); }
      };
      wheel(-15); wheel(16);
      // frame
      ctx.fillStyle = '#8a1c1c';
      ctx.beginPath(); ctx.moveTo(-14, -12); ctx.lineTo(-4, -20); ctx.lineTo(10, -20); ctx.lineTo(16, -10); ctx.lineTo(4, -12); ctx.closePath(); ctx.fill();
      ctx.strokeStyle = '#222'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(16, -8); ctx.lineTo(11, -24); ctx.lineTo(14, -26); ctx.stroke();
      // explosive barrels strapped behind
      for (const [bx, by] of [[-14, -22], [-8, -27]]) {
        ctx.fillStyle = '#c42c1d'; D.roundRect(ctx, bx - 5, by - 5, 10, 9, 2); ctx.fill();
        ctx.fillStyle = '#f0c020'; ctx.fillRect(bx - 5, by - 2, 10, 2);
      }
      const blink = Math.sin(this.walkT * 2.5) > 0;
      ctx.fillStyle = blink ? '#ff2a2a' : '#5a0f0f';
      ctx.beginPath(); ctx.arc(-11, -33, 2.2, 0, Math.PI * 2); ctx.fill();
      if (blink) { ctx.globalCompositeOperation = 'lighter'; ctx.drawImage(D.blob('#ff2a2a'), -21, -43, 20, 20); ctx.globalCompositeOperation = 'source-over'; }
      // rider leaning forward
      ctx.strokeStyle = '#2c2c2c'; ctx.lineWidth = 4.5; ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(-2, -22); ctx.lineTo(4, -16); ctx.stroke();
      ctx.fillStyle = '#3a3a2a';
      ctx.save(); ctx.translate(0, -28); ctx.rotate(0.5);
      D.roundRect(ctx, -5, -8, 10, 14, 3); ctx.fill();
      ctx.restore();
      ctx.strokeStyle = '#3a3a2a'; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.moveTo(4, -30); ctx.lineTo(12, -25); ctx.stroke();
      ctx.fillStyle = '#c99b74'; ctx.beginPath(); ctx.arc(7, -36, 4.5, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#d02020'; ctx.beginPath(); ctx.arc(7, -37.5, 5, Math.PI, 0); ctx.fill();
      ctx.beginPath(); ctx.moveTo(2, -38); ctx.lineTo(-6, -41 + Math.sin(this.walkT * 3) * 2); ctx.lineTo(-5, -36); ctx.fill();
    }

    /** Tank (and the MAMMOTH boss with k = 1.75, twin barrels). */
    drawTank(ctx, k, body, dark, twin) {
      const g = this.game;
      const roll = this.walkT * 4;
      ctx.save();
      ctx.scale(k, k);
      // tracks
      ctx.fillStyle = '#1e201b';
      D.roundRect(ctx, -34, -16, 68, 16, 8); ctx.fill();
      ctx.fillStyle = '#3a3c35';
      for (let i = 0; i < 6; i++) D.circle(ctx, -26 + i * 10.4, -8, 4.6, '#4a4c44', '#1a1a17', 1.2);
      ctx.strokeStyle = '#55584e'; ctx.lineWidth = 1.2;
      for (let i = 0; i < 14; i++) {
        const x = -32 + ((i * 5 + roll * 3) % 66);
        ctx.beginPath(); ctx.moveTo(x, -16); ctx.lineTo(x, -14); ctx.moveTo(x, -2); ctx.lineTo(x, 0); ctx.stroke();
      }
      // hull
      ctx.fillStyle = body;
      ctx.beginPath(); ctx.moveTo(-36, -16); ctx.lineTo(-30, -27); ctx.lineTo(28, -27); ctx.lineTo(38, -17); ctx.closePath(); ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,0.12)'; ctx.fillRect(-30, -27, 58, 3);
      ctx.fillStyle = dark; ctx.fillRect(-34, -19, 70, 3);
      // camo patches
      ctx.fillStyle = 'rgba(30,25,15,0.35)';
      ctx.beginPath(); ctx.ellipse(-12, -22, 8, 3, 0.2, 0, Math.PI * 2); ctx.ellipse(14, -21, 6, 2.5, -0.3, 0, Math.PI * 2); ctx.fill();
      if (twin) {
        ctx.fillStyle = '#7a1414'; ctx.fillRect(-30, -24, 58, 2);
        // side rocket pods
        ctx.fillStyle = '#2a2d26'; D.roundRect(ctx, -26, -38, 14, 9, 2); ctx.fill();
        ctx.fillStyle = '#c33'; for (let i = 0; i < 3; i++) { ctx.beginPath(); ctx.arc(-12, -36 + i * 3, 1.2, 0, Math.PI * 2); ctx.fill(); }
      }
      // turret (barrel aims at the target in screen space)
      const tgt = this.currentTarget();
      const sa = Math.atan2((tgt.y - this.y) * g.ISO - 10, (tgt.x - this.x));
      let la = this.facing > 0 ? sa : Math.PI - sa;
      la = clamp(la, -0.45, 0.25);
      ctx.save();
      ctx.translate(2, -31);
      ctx.fillStyle = D.shade(body, 0.05);
      ctx.beginPath(); ctx.ellipse(0, 0, 17, 8, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,0.12)'; ctx.beginPath(); ctx.ellipse(-2, -3, 12, 3.5, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = dark; ctx.fillRect(-6, -10, 8, 4);
      ctx.rotate(la);
      const rk = -this.recoil * 6;
      ctx.fillStyle = '#2a2d26';
      if (twin) { ctx.fillRect(10 + rk, -5, 34, 3.2); ctx.fillRect(10 + rk, 0.5, 34, 3.2); }
      else ctx.fillRect(10 + rk, -2, 32, 4);
      ctx.fillRect(38 + rk, twin ? -6 : -3, 6, twin ? 10.5 : 6);
      ctx.restore();
      ctx.restore();
      if (this.recoil > 0.8) {
        const L = (twin ? 46 : 46) * k;
        this.muzzleFlash(ctx, Math.cos(la) * L, -31 * k + Math.sin(la) * L, 12 * k);
      }
    }

    drawKatyusha(ctx) {
      const roll = this.walkT * 3;
      // wheels
      for (const x of [-22, -6, 22]) {
        D.circle(ctx, x, -7, 7, '#151515', null, 0);
        D.circle(ctx, x, -7, 3.5, '#5c5f52', null, 0);
        ctx.strokeStyle = '#333'; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(x + Math.cos(roll) * 3, -7 + Math.sin(roll) * 3); ctx.lineTo(x - Math.cos(roll) * 3, -7 - Math.sin(roll) * 3); ctx.stroke();
      }
      // chassis
      ctx.fillStyle = '#3c4430'; ctx.fillRect(-32, -16, 66, 6);
      // cab
      ctx.fillStyle = '#566240';
      ctx.beginPath(); ctx.moveTo(14, -16); ctx.lineTo(14, -34); ctx.lineTo(26, -34); ctx.lineTo(34, -24); ctx.lineTo(34, -16); ctx.closePath(); ctx.fill();
      ctx.fillStyle = '#9fd0e0'; ctx.beginPath(); ctx.moveTo(22, -32); ctx.lineTo(26, -32); ctx.lineTo(31, -25); ctx.lineTo(22, -25); ctx.closePath(); ctx.fill();
      ctx.fillStyle = '#2b3122'; ctx.fillRect(14, -22, 20, 2);
      // launcher rails (raise when deploying)
      ctx.save();
      ctx.translate(-26, -18);
      ctx.rotate(-0.08 - this.deploy * 0.42);
      ctx.fillStyle = '#4a5436'; ctx.fillRect(0, -4, 40, 5);
      for (let r = 0; r < 3; r++) {
        ctx.fillStyle = '#3a4229'; ctx.fillRect(0, -8 - r * 4, 40, 3);
        if (this.volley > r * 2 || this.deploy < 1 || this.atkTimer > 1.2) {
          ctx.fillStyle = '#7d8a5a'; ctx.fillRect(4, -10 - r * 4, 30, 2.5);
          ctx.fillStyle = '#c0392b'; ctx.fillRect(34, -10 - r * 4, 4, 2.5);
        }
      }
      ctx.restore();
      ctx.fillStyle = 'rgba(30,25,15,0.35)';
      ctx.beginPath(); ctx.ellipse(-10, -13, 9, 2.5, 0, 0, Math.PI * 2); ctx.fill();
    }

    drawDrone(ctx) {
      const g = this.game;
      const tgt = this.currentTarget();
      const a = Math.atan2((tgt.y - this.y) * g.ISO, tgt.x - this.x);
      ctx.save();
      ctx.rotate(a);
      // delta wing (Shahed-like)
      ctx.fillStyle = '#9aa0a0';
      ctx.beginPath(); ctx.moveTo(22, 0); ctx.lineTo(-10, -20); ctx.lineTo(-14, -20); ctx.lineTo(-12, 0); ctx.lineTo(-14, 20); ctx.lineTo(-10, 20); ctx.closePath(); ctx.fill();
      ctx.fillStyle = '#6e7474';
      ctx.beginPath(); ctx.moveTo(22, 0); ctx.lineTo(-10, -4); ctx.lineTo(-14, 0); ctx.lineTo(-10, 4); ctx.closePath(); ctx.fill();
      ctx.fillStyle = '#2b2f2f'; ctx.fillRect(-14, -21, 4, 6); ctx.fillRect(-14, 15, 4, 6);
      ctx.fillStyle = '#c0392b'; ctx.beginPath(); ctx.arc(18, 0, 2.5, 0, Math.PI * 2); ctx.fill();
      // spinning prop
      ctx.strokeStyle = 'rgba(30,30,30,0.7)'; ctx.lineWidth = 2;
      const pa = this.walkT * 2;
      ctx.beginPath(); ctx.moveTo(-15, Math.sin(pa) * 7); ctx.lineTo(-15, -Math.sin(pa) * 7); ctx.stroke();
      ctx.restore();
      const blink = Math.sin(this.walkT * 0.6) > 0;
      if (blink) { ctx.globalCompositeOperation = 'lighter'; ctx.drawImage(D.blob('#ff3020'), -9, -9, 18, 18); ctx.globalCompositeOperation = 'source-over'; }
    }
  }

  /* =========================================================
     PART III — 7 NEW UNITS
     ========================================================= */
  const screenA = (g, a) => Math.atan2(Math.sin(a) * g.ISO, Math.cos(a));

  /** 🚜 Breacher Bulldozer — 75% frontal bullet reduction, smashes walls. */
  class Bulldozer extends Enemy {
    damageFilter(dmg, opts) {
      if (opts.source !== 'mg' || !opts.dir) return dmg;
      const h = this.heading();
      if (opts.dir.x * h.x + opts.dir.y * h.y < -0.35) {        // bullet travelling into the plow
        const g = this.game;
        const px = this.x + h.x * this.radius, py = this.y + h.y * this.radius;
        g.particles.sparks(px, py, 18, { count: 5, color: pick(['#fff4c0', '#ffd060', '#ffffff']), speed: 300, life: 0.25, up: 1.2 });
        g.audio.play('clang');
        if (Math.random() < 0.06) g.ui.float(px, py, 60, 'CHẶN!', 'normal');
        return dmg * 0.25;
      }
      return dmg;
    }
    think(dt) {
      super.think(dt);
      if (Math.random() < dt * 9) {
        const h = this.heading();
        this.game.particles.spawn({ type: 'smoke', x: this.x - h.x * 22 + rand(-3, 3), y: this.y - h.y * 12, z: 60, vz: rand(50, 80), vx: -h.x * 20, size: rand(5, 8), grow: 3, color: '#141210', alpha: 0.6, life: rand(0.9, 1.4) });
      }
    }
    meleeAttack(dt, tgt, seg) {
      const g = this.game;
      this.atkTimer -= dt * this.atkMult;
      if (this.atkTimer > 0) return;
      this.atkTimer = this.atkCd;
      this.attackAnim = 1;
      const h = this.heading();
      if (seg) { g.tower.wall.damage(seg, this.dmg); g.shake(3.5); g.audio.play('wallbreak'); }
      else if (tgt.decoy) g.damageDecoy(this.dmg, tgt.x, tgt.y);
      else { g.tower.takeDamage(this.dmg * 0.4, this); g.onMeleeStrike(this); g.audio.play('clang'); }
      g.particles.soil(this.x + h.x * 40, this.y + h.y * 40, { count: 5, speed: 160, dust: 3 });
    }
    drawBody(ctx) {
      const roll = this.walkT * 4;
      const ram = this.attackAnim;
      // tracks
      ctx.fillStyle = '#1b1c18'; D.roundRect(ctx, -36, -16, 64, 16, 8); ctx.fill();
      for (let i = 0; i < 6; i++) D.circle(ctx, -28 + i * 10, -8, 4.4, '#45473f', '#141512', 1.2);
      ctx.strokeStyle = '#5a5d52'; ctx.lineWidth = 1.2;
      for (let i = 0; i < 13; i++) { const x = -34 + ((i * 5 + roll * 3) % 62); ctx.beginPath(); ctx.moveTo(x, -16); ctx.lineTo(x, -14); ctx.moveTo(x, -2); ctx.lineTo(x, 0); ctx.stroke(); }
      // chassis (olive camo, riveted)
      ctx.fillStyle = '#4f5634';
      ctx.beginPath(); ctx.moveTo(-36, -16); ctx.lineTo(-32, -32); ctx.lineTo(14, -32); ctx.lineTo(26, -18); ctx.lineTo(28, -16); ctx.closePath(); ctx.fill();
      ctx.fillStyle = 'rgba(30,26,14,0.45)';
      ctx.beginPath(); ctx.ellipse(-18, -24, 9, 4, 0.2, 0, Math.PI * 2); ctx.ellipse(4, -27, 7, 3, -0.3, 0, Math.PI * 2); ctx.ellipse(-4, -20, 6, 2.5, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = 'rgba(120,130,80,0.35)'; ctx.beginPath(); ctx.ellipse(-26, -20, 5, 2.5, 0, 0, Math.PI * 2); ctx.ellipse(10, -22, 5, 2, 0, 0, Math.PI * 2); ctx.fill();
      D.rivets(ctx, -32, -29, 12, -29, 8, 1);
      // armored cab
      ctx.fillStyle = '#3e4428';
      ctx.beginPath(); ctx.moveTo(-26, -32); ctx.lineTo(-24, -48); ctx.lineTo(-2, -48); ctx.lineTo(4, -32); ctx.closePath(); ctx.fill();
      ctx.fillStyle = '#1a1e14'; ctx.fillRect(-20, -44, 18, 5);
      ctx.fillStyle = 'rgba(255,140,40,0.55)'; ctx.fillRect(-19, -43, 16, 1.5);
      // twin exhaust stacks
      for (const ex of [-30, -25]) { ctx.fillStyle = '#2a2a26'; ctx.fillRect(ex, -60, 3.5, 28); ctx.fillStyle = '#111'; ctx.fillRect(ex - 0.5, -62, 4.5, 3); }
      // hydraulic arms + massive curved plow with saw teeth
      ctx.save();
      ctx.translate(ram * 4, -ram * 3);
      ctx.strokeStyle = '#2c2f2a'; ctx.lineWidth = 3.5;
      ctx.beginPath(); ctx.moveTo(10, -22); ctx.lineTo(32, -14); ctx.moveTo(14, -30); ctx.lineTo(33, -30); ctx.stroke();
      const gr = ctx.createLinearGradient(30, 0, 50, 0);
      gr.addColorStop(0, '#5d6266'); gr.addColorStop(0.45, '#a4aaae'); gr.addColorStop(1, '#43484c');
      ctx.fillStyle = gr;
      ctx.beginPath();
      ctx.moveTo(32, -46); ctx.quadraticCurveTo(48, -40, 50, -26); ctx.quadraticCurveTo(52, -12, 46, 0);
      for (let i = 0; i < 5; i++) { ctx.lineTo(44 - i * 3, 3); ctx.lineTo(42 - i * 3, -1); }
      ctx.lineTo(32, -2); ctx.quadraticCurveTo(38, -24, 32, -46); ctx.closePath(); ctx.fill();
      ctx.strokeStyle = '#1b1e20'; ctx.lineWidth = 1.5; ctx.stroke();
      ctx.fillStyle = '#e0b31c'; for (let i = 0; i < 3; i++) ctx.fillRect(36 + i * 0.6, -38 + i * 12, 8, 3);
      ctx.fillStyle = 'rgba(255,255,255,0.2)'; ctx.fillRect(38, -42, 2, 34);
      ctx.restore();
    }
  }

  /** 📡 EW Jammer Truck — range debuff + scrambles drones / SAMs, creeps closer over time. */
  class Jammer extends Enemy {
    constructor(...a) { super(...a); this.jamming = false; this.dishA = 0; this.ringT = 0; this.creepT = 6; }
    get jamRadius() { return TD.CFG.foes.jammer.jamRadius; }
    think(dt) {
      const g = this.game, t = g.tower;
      const dx = t.x - this.x, dy = t.y - this.y, d = Math.hypot(dx, dy) || 1;
      if (Math.abs(dx) > 3) this.facing = dx > 0 ? 1 : -1;
      this.dishA += dt * (this.jamming ? 3.2 : 0.8);
      if (d > this.range) { this.jamming = false; this.deploy = Math.max(0, this.deploy - dt); return this.move(dt, dx / d, dy / d); }
      this.halt(dt);
      this.deploy = Math.min(1, this.deploy + dt / 1.2);
      this.jamming = this.deploy >= 1;
      if (!this.jamming) return;
      this.ringT -= dt;
      if (this.ringT <= 0) {
        this.ringT = 0.55;
        this.rc = !this.rc;
        g.particles.ring(this.x, this.y, { radius: this.jamRadius, color: this.rc ? '#b050ff' : '#40e0ff', width: 4, life: 1.3 });
        g.audio.play('jam');
      }
      this.creepT -= dt;
      if (this.creepT <= 0) { this.creepT = 5; this.range = Math.max(230, this.range - 40); }
      if (Math.random() < dt * 8) {
        const a = rand(0, Math.PI * 2), r = rand(20, 70);
        g.particles.bolt([{ x: this.x, y: this.y, z: 62 }, { x: this.x + Math.cos(a) * r, y: this.y + Math.sin(a) * r, z: rand(10, 70) }], { color: Math.random() < 0.5 ? '#d090ff' : '#80f0ff', glow: 'rgba(160,80,255,0.4)', jag: 10, life: 0.12 });
      }
    }
    drawBody(ctx) {
      const roll = this.walkT * 3;
      for (const x of [-24, -12, 20]) {
        D.circle(ctx, x, -7, 7, '#141414', null, 0); D.circle(ctx, x, -7, 3.4, '#565a4e', null, 0);
        ctx.strokeStyle = '#333'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(x + Math.cos(roll) * 3, -7 + Math.sin(roll) * 3); ctx.lineTo(x - Math.cos(roll) * 3, -7 - Math.sin(roll) * 3); ctx.stroke();
      }
      ctx.fillStyle = '#333a2a'; ctx.fillRect(-34, -16, 68, 6);
      // cab
      ctx.fillStyle = '#4c5638';
      ctx.beginPath(); ctx.moveTo(14, -16); ctx.lineTo(14, -36); ctx.lineTo(26, -36); ctx.lineTo(34, -26); ctx.lineTo(34, -16); ctx.closePath(); ctx.fill();
      ctx.fillStyle = '#8fc6d8'; ctx.beginPath(); ctx.moveTo(22, -34); ctx.lineTo(26, -34); ctx.lineTo(31, -27); ctx.lineTo(22, -27); ctx.closePath(); ctx.fill();
      // electronics shelter
      ctx.fillStyle = '#56603e'; D.roundRect(ctx, -34, -40, 46, 24, 3); ctx.fill();
      ctx.strokeStyle = '#2a301e'; ctx.lineWidth = 1.2; ctx.stroke();
      ctx.fillStyle = '#2a301e'; for (let i = 0; i < 4; i++) ctx.fillRect(-30 + i * 10, -36, 6, 2);
      const on = Math.sin(this.game.time * 10) > 0;
      ctx.fillStyle = on && this.jamming ? '#d060ff' : '#40205a'; ctx.fillRect(4, -38, 4, 3);
      // mast + rotating parabolic dish
      const lift = 10 + this.deploy * 16;
      ctx.fillStyle = '#2b2f2a'; ctx.fillRect(-14, -40 - lift, 4, lift);
      ctx.save(); ctx.translate(-12, -44 - lift);
      const w = Math.cos(this.dishA) * 16;
      ctx.fillStyle = Math.cos(this.dishA) > 0 ? '#d8dcd4' : '#9aa096';
      ctx.beginPath(); ctx.ellipse(0, 0, Math.max(2, Math.abs(w)), 13, 0, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = '#3a3f3a'; ctx.lineWidth = 1.2; ctx.stroke();
      ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(w * 0.9, 0); ctx.stroke();
      ctx.fillStyle = '#c33'; ctx.beginPath(); ctx.arc(w * 0.9, 0, 1.8, 0, Math.PI * 2); ctx.fill();
      if (this.jamming) {
        ctx.globalCompositeOperation = 'lighter';
        ctx.globalAlpha = 0.5 + 0.3 * Math.sin(this.game.time * 20);
        ctx.drawImage(D.blob(this.rc ? '#b050ff' : '#40e0ff'), -22, -22, 44, 44);
        ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
      }
      ctx.restore();
      // whip antennas
      ctx.strokeStyle = '#222'; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(8, -40); ctx.quadraticCurveTo(10, -60, 6, -74); ctx.moveTo(-30, -40); ctx.quadraticCurveTo(-32, -58, -28, -68); ctx.stroke();
    }
  }

  /** 🚑 Field Medic APC — heals the column, adrenaline mist on death. */
  class Medic extends Enemy {
    constructor(...a) { super(...a); this.pulseT = 1; this.leader = null; }
    think(dt) {
      const g = this.game, t = g.tower;
      const f = TD.CFG.foes.medic;
      const dT = Math.hypot(this.x - t.x, this.y - t.y);
      if (!this.leader || this.leader.dead || this.leader.burrowed) {
        this.leader = null; let bd = Infinity;
        for (const e of g.enemies) {
          if (e === this || e.dead || e.air || e.type === 'medic' || !e.active) continue;
          const de = Math.hypot(e.x - t.x, e.y - t.y);
          if (de >= dT + 40) continue;
          const sc = Math.hypot(e.x - this.x, e.y - this.y) - (e.heavy ? 250 : 0);
          if (sc < bd) { bd = sc; this.leader = e; }
        }
      }
      let gx, gy;
      if (this.leader) {
        const L = this.leader, dl = Math.hypot(L.x - t.x, L.y - t.y) || 1;
        const back = Math.max(250, dl + 85);
        gx = t.x + ((L.x - t.x) / dl) * back; gy = t.y + ((L.y - t.y) / dl) * back;
      } else {
        const back = Math.max(300, Math.min(dT, 340));
        gx = t.x + ((this.x - t.x) / (dT || 1)) * back; gy = t.y + ((this.y - t.y) / (dT || 1)) * back;
      }
      const dx = gx - this.x, dy = gy - this.y, d = Math.hypot(dx, dy);
      if (Math.abs(t.x - this.x) > 3) this.facing = t.x > this.x ? 1 : -1;
      if (d > 22) this.move(dt, dx / d, dy / d); else this.halt(dt);
      // emerald restorative pulse
      this.pulseT -= dt;
      if (this.pulseT <= 0) {
        this.pulseT = 1;
        g.particles.ring(this.x, this.y, { radius: f.healRadius, color: '#3dff8a', width: 5, life: 0.7 });
        let shown = 0;
        for (const e of g.enemies) {
          if (e.dead || dist(e.x, e.y, this.x, this.y) > f.healRadius) continue;
          const h = e.heal(f.healPerSec * (e === this ? 0.5 : 1));
          if (h > 0.5 && shown < 4) { shown++; g.particles.plus(e.x, e.y, (e.z || 0) + e.height, 1); }
        }
      }
    }
    onDeath() {
      const g = this.game, f = TD.CFG.foes.medic;
      g.particles.smoke(this.x, this.y, 20, { count: 16, size: 34, speed: 170, life: 2.2, rise: 20, color: '#9a0e0e', alpha: 0.5 });
      g.particles.ring(this.x, this.y, { radius: 230, color: '#ff3030', width: 8, life: 0.6 });
      let n = 0;
      for (const e of g.enemies) {
        if (e === this || e.dead || e.air || dist(e.x, e.y, this.x, this.y) > 230) continue;
        e.adrenaT = f.adrenalineDuration; n++;
      }
      if (n) g.ui.float(this.x, this.y, 90, `💉 ADRENALINE ×${n}`, 'hurt');
    }
    drawBody(ctx) {
      const roll = this.walkT * 3;
      for (const x of [-22, -6, 10, 24]) { D.circle(ctx, x, -7, 7, '#151515', null, 0); D.circle(ctx, x, -7, 3.2, '#5a5e54', null, 0); ctx.strokeStyle = '#333'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(x + Math.cos(roll) * 3, -7 + Math.sin(roll) * 3); ctx.lineTo(x - Math.cos(roll) * 3, -7 - Math.sin(roll) * 3); ctx.stroke(); }
      ctx.fillStyle = '#6a7460';
      ctx.beginPath(); ctx.moveTo(-34, -12); ctx.lineTo(-32, -38); ctx.lineTo(18, -38); ctx.lineTo(34, -24); ctx.lineTo(34, -12); ctx.closePath(); ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,0.12)'; ctx.fillRect(-32, -38, 50, 3);
      ctx.strokeStyle = '#2d3328'; ctx.lineWidth = 1.2; ctx.stroke();
      D.rivets(ctx, -30, -15, 30, -15, 10, 0.9);
      ctx.fillStyle = '#8fc6d8'; ctx.beginPath(); ctx.moveTo(20, -35); ctx.lineTo(31, -25); ctx.lineTo(20, -25); ctx.closePath(); ctx.fill();
      // white panel with glowing red cross
      ctx.fillStyle = '#e6e8e0'; D.roundRect(ctx, -22, -34, 24, 18, 2); ctx.fill();
      const glow = 0.55 + 0.45 * Math.sin(this.game.time * 4);
      ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = glow * 0.7;
      ctx.drawImage(D.blob('#ff2020'), -24, -38, 28, 26);
      ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
      ctx.fillStyle = '#d01818'; ctx.fillRect(-13, -31, 6, 12); ctx.fillRect(-16, -28, 12, 6);
      // roof light bar
      const on = Math.sin(this.game.time * 12) > 0;
      ctx.fillStyle = on ? '#ff3030' : '#3060ff'; ctx.fillRect(-6, -42, 8, 4);
      ctx.globalCompositeOperation = 'lighter'; ctx.drawImage(D.blob(on ? '#ff3030' : '#3060ff'), -14, -50, 24, 20); ctx.globalCompositeOperation = 'source-over';
      ctx.fillStyle = '#3dff8a'; ctx.globalAlpha = 0.25 + 0.25 * glow; ctx.fillRect(-30, -12, 62, 2); ctx.globalAlpha = 1;
    }
  }

  /** 🪂 Airborne Paratrooper — dropped into the courtyard; chute catches fire when shot. */
  class Paratrooper extends Enemy {
    constructor(...a) {
      super(...a);
      const f = TD.CFG.foes.para;
      this.air = true; this.z = 300; this.fallMax = Math.max(0.3, f.fallDuration); this.chuteBurn = false; this.sway = rand(0, 6);
      this.active = true;
    }
    damageFilter(dmg) {
      if (this.air && !this.chuteBurn) { this.chuteBurn = true; this.game.audio.play('chute'); }
      return dmg;
    }
    think(dt) {
      const g = this.game;
      if (this.air) {
        this.sway += dt * 2.2;
        if (this.chuteBurn) {
          this.z -= 430 * dt;
          if (Math.random() < dt * 30) g.particles.spawn({ type: 'fire', x: this.x + rand(-10, 10), y: this.y, z: this.z + 62 + rand(-6, 6), vz: 60, size: rand(7, 11), grow: 0.5, color: pick(['#ffb347', '#ff6a1a']), life: 0.35 });
          if (Math.random() < dt * 14) g.particles.spawn({ type: 'smoke', x: this.x, y: this.y, z: this.z + 70, vz: 40, size: 8, grow: 2.5, color: '#2a2622', alpha: 0.5, life: 1.0 });
        } else {
          this.z -= (300 / this.fallMax) * dt;
          this.x += Math.sin(this.sway) * 14 * dt;
        }
        if (this.z <= 0) {
          this.z = 0; this.air = false;
          if (this.chuteBurn) {
            g.particles.chute(this.x + 10, this.y - 4, true);
            g.particles.soil(this.x, this.y, { count: 4, speed: 120, dust: 3 });
            g.damageEnemy(this, this.hp + 9999, { source: 'impact', silent: true });
            return;
          }
          g.particles.chute(this.x + 12, this.y - 5, false);
          g.particles.smoke(this.x, this.y, 2, { count: 3, size: 10, speed: 40, life: 0.6, rise: 10, color: '#a89878', alpha: 0.5 });
        }
        return;
      }
      super.think(dt);
    }
    drawS3(ctx) { super.drawS3(ctx); if (this.air) this.drawCanopy(ctx); }
    drawBody(ctx) {
      this.drawSoldier(ctx, { uniform: '#5a6a3a', vest: '#3e4a28', pants: '#4f5c33', head: 'helmet', hat: '#3e4a28', weapon: 'knife' });
      if (this.air) this.drawCanopy(ctx);
    }
    drawCanopy(ctx) {
      // harness lines + swaying camo canopy
      const sw = Math.sin(this.sway) * 0.18;
      ctx.save();
      ctx.translate(0, -42); ctx.rotate(sw);
      ctx.strokeStyle = 'rgba(30,30,25,0.8)'; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(-3, 10); ctx.lineTo(-22, -30); ctx.moveTo(3, 10); ctx.lineTo(22, -30); ctx.moveTo(0, 10); ctx.lineTo(0, -34); ctx.stroke();
      const burn = this.chuteBurn;
      const cg = ctx.createLinearGradient(0, -56, 0, -28);
      cg.addColorStop(0, burn ? '#3a2a1a' : '#7d8a52'); cg.addColorStop(1, burn ? '#1a1410' : '#4f5a33');
      ctx.fillStyle = cg;
      ctx.beginPath();
      ctx.moveTo(-26, -28); ctx.quadraticCurveTo(-26, -58, 0, -60); ctx.quadraticCurveTo(26, -58, 26, -28);
      for (let i = 0; i < 4; i++) ctx.quadraticCurveTo(26 - i * 13 - 6.5, -34 + Math.sin(this.sway * 3 + i) * 2, 26 - (i + 1) * 13, -28);
      ctx.closePath(); ctx.fill();
      if (!burn) {
        ctx.fillStyle = 'rgba(40,46,24,0.55)';
        ctx.beginPath(); ctx.ellipse(-10, -48, 7, 3.5, 0.3, 0, Math.PI * 2); ctx.ellipse(10, -42, 6, 3, -0.4, 0, Math.PI * 2); ctx.ellipse(2, -54, 5, 2.5, 0, 0, Math.PI * 2); ctx.fill();
        ctx.strokeStyle = 'rgba(0,0,0,0.25)'; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(-13, -29); ctx.quadraticCurveTo(-10, -50, 0, -60); ctx.moveTo(13, -29); ctx.quadraticCurveTo(10, -50, 0, -60); ctx.stroke();
      } else {
        ctx.globalCompositeOperation = 'lighter';
        ctx.globalAlpha = 0.6 + 0.4 * Math.random();
        ctx.drawImage(D.blob('#ff7a20'), -28, -66, 56, 42);
        ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
      }
      ctx.restore();
    }
  }

  /** 🥷 Stealth Infiltrator — optical camo, revealed by AOE / searchlight / walls / sensors, then C4 dash. */
  class Stealth extends Enemy {
    constructor(...a) { super(...a); this.cloaked = true; this.revealT = 0; this.dashing = false; this.glitch = 0; }
    get moveMult() { return super.moveMult * (this.dashing ? 2.4 : 1); }
    reveal() {
      if (!this.cloaked || this.dead) return;
      const g = this.game;
      this.cloaked = false; this.revealT = 0.55; this.glitch = 0.6;
      g.particles.sparks(this.x, this.y, 24, { count: 8, color: '#7ff3ff', speed: 160 });
      g.ui.float(this.x, this.y, this.height + 30, '👁 LỘ DIỆN!', 'shock');
      g.audio.play('glitch');
    }
    think(dt) {
      const g = this.game;
      this.glitch = Math.max(0, this.glitch - dt);
      if (this.zapT > 0) {                                   // ⚡ v12: caught by the searchlight → arcs crawl over the suit
        this.zapT -= dt;
        if (Math.random() < dt * 16) {
          const z0 = rand(4, 40);
          g.particles.bolt([{ x: this.x + rand(-9, 9), y: this.y, z: z0 }, { x: this.x + rand(-11, 11), y: this.y + rand(-3, 3), z: z0 + rand(-14, 14) }], { life: 0.09, jag: 4 });
        }
      }
      if (this.cloaked && Math.hypot(this.x - g.tower.x, this.y - g.tower.y) < 235) this.reveal();   // proximity sensors
      if (!this.cloaked && this.revealT > 0) { this.revealT -= dt; this.halt(dt); return; }
      if (!this.cloaked) {
        if (!this.dashing) g.audio.play('c4');
        this.dashing = true;
      }
      super.think(dt);
    }
    meleeAttack(dt, tgt, seg) {
      if (this.cloaked) { this.reveal(); return; }                 // walking into the wall / fortress exposes him
      if (this.revealT > 0) return;
      this.detonate(tgt);
    }
    detonate(tgt) {
      const g = this.game, f = TD.CFG.foes.stealth, R = f.explosionRadius;
      if (this.dead) return;
      this.dead = true;
      g.particles.explosion(this.x, this.y, 10, R);
      g.audio.play('boom_m');
      g.shake(9);
      if (tgt && tgt.decoy) { g.damageDecoy(this.dmg, tgt.x, tgt.y); return; }
      const t = g.tower;
      if (Math.hypot(this.x - t.x, this.y - t.y) - t.radius <= R) t.takeDamage(this.dmg, this);
      const w = t.wall;
      if (w.lv > 0) for (const s of w.segs) {
        if (s.hp <= 0) continue;
        const a = w.segMid(s);
        if (Math.hypot(this.x - Math.cos(a) * w.R, this.y - Math.sin(a) * w.R) <= R + 20) w.damage(s, this.dmg);
      }
    }
    onDeath() { this.game.particles.explosion(this.x, this.y, 12, 36, { quiet: true, scorch: false }); }
    draw(ctx) {
      if (!this.cloaked) return super.draw(ctx);
      if (!TD.FX.shimmer) return;
      // heat-refraction "predator" shimmer: wavy re-sample of the terrain behind him
      const g = this.game, s = g.project(this.x, this.y, 0);
      if (g.bg) {
        const BS = g.bgScale || 1.5, w = 30, h = 46, n = 7;
        ctx.save();
        ctx.beginPath(); ctx.ellipse(s.x, s.y - h / 2, w / 2, h / 2, 0, 0, Math.PI * 2); ctx.clip();
        for (let i = 0; i < n; i++) {
          const y0 = s.y - h + (i * h) / n;
          const off = Math.sin(g.time * 14 + i * 1.3 + this.wobbleSeed) * 3;
          try { ctx.drawImage(g.bg, (s.x - w / 2) * BS, y0 * BS, w * BS, (h / n) * BS, s.x - w / 2 + off, y0, w * 1.04, h / n + 0.5); } catch (e) { /* ignore */ }
        }
        ctx.restore();
      }
      ctx.save();
      ctx.translate(s.x, s.y);
      ctx.scale(this.facing, 1);
      ctx.globalAlpha = 0.09 + 0.05 * Math.sin(g.time * 7);
      ctx.globalCompositeOperation = 'lighter';
      this.drawSuit(ctx);
      ctx.restore();
    }
    drawBody(ctx) {
      if (this.glitch > 0) {
        // digital static / glitch reveal: sliced, offset, RGB-split
        for (let i = 0; i < 6; i++) {
          ctx.save();
          ctx.beginPath(); ctx.rect(-24, -48 + i * 8, 48, 8); ctx.clip();
          ctx.translate(rand(-6, 6) * (this.glitch / 0.6), 0);
          this.drawSuit(ctx);
          ctx.restore();
        }
        ctx.globalCompositeOperation = 'lighter';
        ctx.globalAlpha = 0.6;
        for (let i = 0; i < 5; i++) { ctx.fillStyle = Math.random() < 0.5 ? '#00f0ff' : '#ff20c0'; ctx.fillRect(rand(-16, 10), rand(-46, -2), rand(4, 14), 2); }
        ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
        return;
      }
      this.drawSuit(ctx);
      if (this.zapT > 0) {                                   // electric shimmer silhouette
        const k = Math.min(1, this.zapT / 0.4), t = this.game.time;
        ctx.save();
        ctx.globalCompositeOperation = 'lighter';
        ctx.globalAlpha = 0.45 * k;
        ctx.drawImage(D.blob('#7ff3ff'), -16, -52, 32, 56);
        ctx.globalAlpha = 0.9 * k;
        ctx.strokeStyle = '#bff8ff'; ctx.lineWidth = 1.1;
        ctx.beginPath();
        for (let i = 0; i <= 16; i++) {
          const u = i / 16, ang = -Math.PI / 2 + u * Math.PI * 2;
          const rx = 10 + Math.sin(t * 60 + i * 2.1) * 2.2, ry = 23 + Math.sin(t * 47 + i * 1.3) * 2.2;
          const px = Math.cos(ang) * rx, py = -22 + Math.sin(ang) * ry;
          if (i) ctx.lineTo(px, py); else ctx.moveTo(px, py);
        }
        ctx.stroke();
        ctx.restore();
      }
    }
    drawSuit(ctx) {
      const step = !this.attacking ? Math.sin(this.walkT) : 0;
      ctx.lineCap = 'round';
      ctx.strokeStyle = '#141619'; ctx.lineWidth = 4.5;
      ctx.beginPath(); ctx.moveTo(-2, -16); ctx.lineTo(-3 + step * 7, -1); ctx.moveTo(2, -16); ctx.lineTo(3 - step * 7, -1); ctx.stroke();
      ctx.fillStyle = '#16181c'; D.roundRect(ctx, -6, -32, 12, 18, 4); ctx.fill();
      ctx.strokeStyle = '#30343a'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(-5, -27); ctx.lineTo(5, -27); ctx.moveTo(0, -32); ctx.lineTo(0, -15); ctx.stroke();
      ctx.fillStyle = '#1b1e22'; ctx.beginPath(); ctx.arc(1, -37, 5.5, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#3dff6a'; ctx.fillRect(1, -38.5, 5, 2);                        // NVG visor
      ctx.globalCompositeOperation = 'lighter'; ctx.drawImage(D.blob('#3dff6a'), -2, -42, 12, 9); ctx.globalCompositeOperation = 'source-over';
      // C4 block held forward, blinking red LED
      ctx.strokeStyle = '#16181c'; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(2, -28); ctx.lineTo(9, -22); ctx.stroke();
      ctx.fillStyle = '#d8cfa0'; ctx.fillRect(7, -26, 9, 6);
      ctx.fillStyle = '#333'; ctx.fillRect(7, -24, 9, 1); ctx.fillStyle = '#b02020'; ctx.fillRect(9, -26, 1, 6); ctx.fillStyle = '#2060c0'; ctx.fillRect(12, -26, 1, 6);
      const on = Math.sin(this.game.time * (this.dashing ? 28 : 10)) > 0;
      ctx.fillStyle = on ? '#ff2020' : '#400808'; ctx.fillRect(14, -28, 2, 2);
      if (on) { ctx.globalCompositeOperation = 'lighter'; ctx.drawImage(D.blob('#ff2020'), 9, -33, 12, 12); ctx.globalCompositeOperation = 'source-over'; }
    }
  }

  /** 🛸 Heavy Bomber — linear high-altitude pass, carpet-bombs the fortress. SAM priority. */
  class HeavyBomber extends Enemy {
    constructor(g, type, x, y, scale, path) {
      super(g, type, x, y, scale);
      this.air = true; this.z = 260;
      const p = path || { dir: Math.atan2(-y, -x), cx: 0, cy: 0 };
      this.dir = p.dir; this.s = -Math.hypot(x - p.cx, y - p.cy);
      this.cx = p.cx; this.cy = p.cy;
      const f = TD.CFG.foes.hbomber;
      const n = Math.max(1, Math.round(f.bombCount));
      const lead = 95, spread = 230;
      this.drops = [];
      for (let i = 0; i < n; i++) this.drops.push(-lead - spread / 2 + (n === 1 ? spread / 2 : (spread * i) / (n - 1)));
      this.prop = 0;
    }
    stun() { /* aircraft ignore EMP stun (but still take the damage) */ }
    hitReact() { this.hitFlash = 1; }
    think(dt) {
      const g = this.game;
      const sp = this.baseSpeed * this.moveMult;
      this.s += sp * dt;
      this.x = this.cx + Math.cos(this.dir) * this.s;
      this.y = this.cy + Math.sin(this.dir) * this.s;
      this.vx = Math.cos(this.dir) * sp; this.vy = Math.sin(this.dir) * sp;
      this.prop += dt * 50;
      while (this.drops.length && this.s >= this.drops[0]) {
        this.drops.shift();
        g.projectiles.push(new PR.EnemyBomb(g, { x: this.x, y: this.y, z: this.z - 14, vx: this.vx * 0.85, vy: this.vy * 0.85, dmg: this.dmg, radius: 95 }));
        g.audio.play('bombdrop');
      }
      if (Math.random() < dt * 10) for (const k of [-1, 1]) {
        const ox = -Math.sin(this.dir) * 34 * k, oy = Math.cos(this.dir) * 34 * k;
        g.particles.spawn({ type: 'smoke', x: this.x + ox - Math.cos(this.dir) * 30, y: this.y + oy - Math.sin(this.dir) * 30, z: this.z, size: 4, grow: 3, color: '#ecece6', alpha: 0.3, life: 1.0 });
      }
      if (this.s > 1250) { this.dead = true; this.escaped = true; }
    }
    onDeath() {
      const g = this.game;
      g.particles.explosion(this.x, this.y, this.z, 110, { scorch: false });
      g.particles.debris(this.x, this.y, this.z, { count: 16, speed: 260, size: 8, color: '#3a3f44' });
      g.particles.fire(this.x, this.y, this.z, { count: 16, size: 30, speed: 160, life: 0.9 });
      g.shake(10);
    }
    draw(ctx) {
      const g = this.game;
      const a = screenA(g, this.dir);
      const sh = g.project(this.x + 70, this.y + 110, 0);
      ctx.save(); ctx.translate(sh.x, sh.y); ctx.rotate(a); ctx.scale(1.5, 0.75);
      ctx.fillStyle = 'rgba(0,0,0,0.25)'; this.wingPath(ctx); ctx.fill();
      ctx.restore();
      const s = g.project(this.x, this.y, this.z);
      ctx.save(); ctx.translate(s.x, s.y); ctx.rotate(a);
      // body
      const gr = ctx.createLinearGradient(0, -60, 0, 60);
      gr.addColorStop(0, '#4b5258'); gr.addColorStop(0.5, '#6d767e'); gr.addColorStop(1, '#3a4045');
      ctx.fillStyle = gr; this.wingPath(ctx); ctx.fill();
      ctx.strokeStyle = '#1c2024'; ctx.lineWidth = 1.5; ctx.stroke();
      // twin fuselage booms
      for (const k of [-1, 1]) {
        ctx.fillStyle = '#596168'; D.roundRect(ctx, -46, k * 18 - 5, 78, 10, 5); ctx.fill();
        ctx.fillStyle = '#9fd7ff'; ctx.beginPath(); ctx.ellipse(28, k * 18, 6, 3, 0, 0, Math.PI * 2); ctx.fill();
      }
      ctx.fillStyle = '#2c3135'; ctx.fillRect(-50, -26, 6, 52);
      ctx.fillStyle = '#e0b31c'; ctx.fillRect(-4, -4, 10, 8);
      // 4 engines with multi-blade propeller motion blur
      for (const ey of [-44, -30, 30, 44]) {
        ctx.fillStyle = '#30363b'; D.roundRect(ctx, 4, ey - 4, 16, 8, 3); ctx.fill();
        ctx.fillStyle = 'rgba(200,205,210,0.22)'; ctx.beginPath(); ctx.ellipse(21, ey, 3, 11, 0, 0, Math.PI * 2); ctx.fill();
        ctx.strokeStyle = 'rgba(30,30,30,0.55)'; ctx.lineWidth = 1.4;
        for (let b = 0; b < 3; b++) { const pa = this.prop + b * 2.1; ctx.beginPath(); ctx.moveTo(21, ey); ctx.lineTo(21 + Math.cos(pa) * 1.5, ey + Math.sin(pa) * 10); ctx.stroke(); }
      }
      ctx.fillStyle = Math.sin(g.time * 8) > 0 ? '#ff3020' : '#30ff40';
      ctx.fillRect(-8, -61, 3, 3); ctx.fillRect(-8, 58, 3, 3);
      if (this.hitFlash > 0) { ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = this.hitFlash * 0.5; ctx.fillStyle = '#fff'; this.wingPath(ctx); ctx.fill(); ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over'; }
      ctx.restore();
      if (this.hp < this.maxHp) D.hpBar(ctx, s.x, s.y - 46, 70, this.hp / this.maxHp, '#ff5a3c');
    }
    wingPath(ctx) {
      ctx.beginPath();
      ctx.moveTo(36, 0); ctx.lineTo(18, -10); ctx.lineTo(-6, -62); ctx.lineTo(-20, -62); ctx.lineTo(-26, -30);
      ctx.lineTo(-40, -22); ctx.lineTo(-40, 22); ctx.lineTo(-26, 30); ctx.lineTo(-20, 62); ctx.lineTo(-6, 62); ctx.lineTo(18, 10);
      ctx.closePath();
    }
  }

  /** ⛏️ Combat Sapper — tunnels under walls, immune to bullets until seismic shock / barbed wire forces him up. */
  class Sapper extends Enemy {
    constructor(...a) { super(...a); this.burrowed = true; this.moundT = 0; this.plantT = 0; this.digT = 0; }
    think(dt) {
      const g = this.game, t = g.tower;
      if (this.burrowed) {
        const dx = t.x - this.x, dy = t.y - this.y, d = Math.hypot(dx, dy) || 1;
        const bw = t.barbed;
        if (d <= 118 || (bw && d <= bw.R + 46)) return this.surface(true);
        const sp = this.baseSpeed * this.moveMult;
        this.vx = (dx / d) * sp; this.vy = (dy / d) * sp;
        this.x += this.vx * dt; this.y += this.vy * dt;
        this.walkT += dt * 6;
        if (Math.abs(dx) > 3) this.facing = dx > 0 ? 1 : -1;
        this.moundT -= dt;
        if (this.moundT <= 0) {
          this.moundT = 0.07;
          g.particles.spawn({ type: 'debris', x: this.x + rand(-8, 8), y: this.y + rand(-4, 4), z: 2, vx: rand(-60, 60), vy: rand(-40, 40), vz: rand(90, 180), g: -900, drag: 0.7, color: pick(['#6b5636', '#58462b', '#7d6640']), size: rand(1.5, 3), rot: rand(0, 6), vr: rand(-10, 10), life: 0.6 });
          if (Math.random() < 0.35) g.particles.spawn({ type: 'smoke', x: this.x, y: this.y, z: 2, vz: 15, size: 9, grow: 1.6, color: '#9c8a68', alpha: 0.4, life: 0.8 });
          if (Math.random() < 0.25) g.particles.spawn({ type: 'scorch', layer: 'ground', x: this.x, y: this.y, size: 12, life: 4, rot: rand(0, 6) });
        }
        this.digT -= dt;
        if (this.digT <= 0) { this.digT = 0.5; g.audio.play('dig'); }
        return;
      }
      if (this.plantT > 0) {
        this.plantT -= dt; this.halt(dt);
        if (this.plantT <= 0) g.placeCharge(this.x, this.y, this.dmg);
        return;
      }
      super.think(dt);
    }
    /** Explosive soil eruption. natural = reached the courtyard on its own. */
    surface(natural) {
      if (!this.burrowed) return;
      const g = this.game, t = g.tower;
      this.burrowed = false;
      g.particles.soil(this.x, this.y, { count: 16, speed: 260, dust: 8 });
      g.particles.explosion(this.x, this.y, 0, 44, { quiet: true, debris: false, smoke: false });
      g.particles.ring(this.x, this.y, { radius: 70, color: '#b39a6a', width: 6, life: 0.4 });
      g.shake(4);
      g.audio.play('erupt');
      if (natural) {
        if (Math.hypot(this.x - t.x, this.y - t.y) - t.radius < 110) t.takeDamage(this.dmg, this);
        this.plantT = 1.6;
        g.ui.float(this.x, this.y, 70, '⛏️ TRỒI LÊN!', 'hurt');
      } else g.ui.float(this.x, this.y, 70, '⛏️ BỊ ÉP TRỒI!', 'info');
    }
    draw(ctx) {
      if (!this.burrowed) return super.draw(ctx);
      const g = this.game, s = g.project(this.x, this.y, 0);
      const k = 1 + Math.sin(this.walkT * 2) * 0.06;
      D.ellipse(ctx, s.x, s.y + 2, 24 * k, 10, 'rgba(20,14,6,0.35)', null, 0);
      ctx.fillStyle = '#6b5636';
      ctx.beginPath(); ctx.ellipse(s.x, s.y - 2, 20 * k, 9, 0, Math.PI, 0); ctx.lineTo(s.x + 20 * k, s.y + 2); ctx.lineTo(s.x - 20 * k, s.y + 2); ctx.closePath(); ctx.fill();
      ctx.fillStyle = '#86704a'; ctx.beginPath(); ctx.ellipse(s.x - 3, s.y - 6, 11, 4, 0, Math.PI, 0); ctx.fill();
      ctx.strokeStyle = '#2b2214'; ctx.lineWidth = 1.3;
      ctx.beginPath(); ctx.moveTo(s.x - 12, s.y - 3); ctx.lineTo(s.x - 4, s.y - 8); ctx.lineTo(s.x + 2, s.y - 4); ctx.moveTo(s.x + 4, s.y - 9); ctx.lineTo(s.x + 11, s.y - 2); ctx.moveTo(s.x - 2, s.y - 9); ctx.lineTo(s.x - 1, s.y - 2); ctx.stroke();
      for (let i = 0; i < 4; i++) { const a = this.walkT * 0.7 + i * 1.6; D.ellipse(ctx, s.x + Math.cos(a) * 15, s.y - 1 + Math.sin(a) * 4, 3, 2, i % 2 ? '#58462b' : '#7d6640', null, 0); }
    }
    drawBody(ctx) {
      this.drawSoldier(ctx, { uniform: '#5c4a30', vest: '#4a3b24', pants: '#4f4029', head: 'helmet', hat: '#5a4a28', weapon: 'knife' });
      ctx.fillStyle = '#ffe680'; ctx.beginPath(); ctx.arc(5, -40, 1.6, 0, Math.PI * 2); ctx.fill();  // helmet lamp
      ctx.globalCompositeOperation = 'lighter'; ctx.drawImage(D.blob('#ffe680'), 0, -45, 12, 10); ctx.globalCompositeOperation = 'source-over';
      if (this.plantT > 0) {
        ctx.fillStyle = '#c0392b'; ctx.fillRect(8, -8, 10, 7);
        ctx.fillStyle = Math.sin(this.game.time * 20) > 0 ? '#ffee55' : '#553300'; ctx.fillRect(12, -10, 2, 2);
      }
    }
  }

  /** ✈️ Transport plane: giant shadow crosses the field and drops a paratrooper squad. */
  class TransportPlane {
    constructor(game, n) {
      this.game = game; this.n = n; this.dropped = 0; this.done = false;
      this.dir = rand(0, Math.PI * 2);
      this.s = -1300; this.speed = 430; this.z = 380;
      this.cx = rand(-60, 60); this.cy = rand(-50, 50);
      this.prop = 0;
      game.audio.play('plane');
    }
    get x() { return this.cx + Math.cos(this.dir) * this.s; }
    get y() { return this.cy + Math.sin(this.dir) * this.s; }
    update(dt) {
      const g = this.game;
      this.s += this.speed * dt; this.prop += dt * 40;
      // drop over the courtyard
      while (this.dropped < this.n && this.s > -120 + this.dropped * (240 / Math.max(1, this.n - 1))) {
        this.dropped++;
        const a = rand(0, Math.PI * 2), r = rand(90, 138);
        const e = makeEnemy(g, 'para', g.tower.x + Math.cos(a) * r, g.tower.y + Math.sin(a) * r, g.spawner.scaleFor(g.wave));
        g.enemies.push(e);
        g.audio.play('chute');
      }
      if (this.s > 1400) this.done = true;
    }
    draw(ctx) {
      const g = this.game;
      const a = screenA(g, this.dir);
      const sh = g.project(this.x + 40, this.y + 80, 0);
      ctx.save(); ctx.translate(sh.x, sh.y); ctx.rotate(a); ctx.scale(2.6, 1.4);
      ctx.fillStyle = 'rgba(0,0,0,0.22)'; this.path(ctx); ctx.fill();
      ctx.restore();
      const s = g.project(this.x, this.y, this.z);
      ctx.save(); ctx.translate(s.x, s.y); ctx.rotate(a); ctx.scale(1.3, 1.3);
      ctx.fillStyle = '#59633e'; this.path(ctx); ctx.fill();
      ctx.strokeStyle = '#262b1a'; ctx.lineWidth = 1.2; ctx.stroke();
      for (const ey of [-34, -18, 18, 34]) {
        ctx.fillStyle = '#3b4229'; D.roundRect(ctx, 0, ey - 3, 14, 6, 2); ctx.fill();
        ctx.fillStyle = 'rgba(200,205,210,0.25)'; ctx.beginPath(); ctx.ellipse(15, ey, 2, 8, 0, 0, Math.PI * 2); ctx.fill();
        ctx.strokeStyle = 'rgba(30,30,30,0.5)'; ctx.beginPath(); ctx.moveTo(15, ey - Math.sin(this.prop) * 8); ctx.lineTo(15, ey + Math.sin(this.prop) * 8); ctx.stroke();
      }
      ctx.fillStyle = '#9fd7ff'; ctx.beginPath(); ctx.ellipse(36, 0, 5, 3, 0, 0, Math.PI * 2); ctx.fill();
      ctx.restore();
    }
    path(ctx) {
      ctx.beginPath();
      ctx.moveTo(44, 0); ctx.quadraticCurveTo(40, -6, 28, -6); ctx.lineTo(8, -6); ctx.lineTo(2, -52); ctx.lineTo(-8, -52); ctx.lineTo(-8, -6);
      ctx.lineTo(-34, -5); ctx.lineTo(-42, -20); ctx.lineTo(-48, -20); ctx.lineTo(-46, 0); ctx.lineTo(-48, 20); ctx.lineTo(-42, 20); ctx.lineTo(-34, 5);
      ctx.lineTo(-8, 6); ctx.lineTo(-8, 52); ctx.lineTo(2, 52); ctx.lineTo(8, 6); ctx.lineTo(28, 6); ctx.quadraticCurveTo(40, 6, 44, 0);
      ctx.closePath();
    }
  }

  const CLASSES = { dozer: Bulldozer, jammer: Jammer, medic: Medic, para: Paratrooper, stealth: Stealth, hbomber: HeavyBomber, sapper: Sapper };
  function makeEnemy(game, type, x, y, scale, extra) {
    const C = CLASSES[type] || Enemy;
    return new C(game, type, x, y, scale, extra);
  }

  /* =========================================================
     WaveSpawner
     ========================================================= */
  class WaveSpawner {
    constructor(game) {
      this.game = game;
      this.wave = 0;
      this.queue = [];
      this.timer = 0;
      this.interval = 1;
      this.spawning = false;
    }

    scaleFor(n) {
      const k = n - 1;
      return {
        hp: 1 + 0.18 * k + 0.03 * k * k,
        speed: 1 + Math.min(0.3, 0.01 * k),
        dmg: 1 + 0.1 * k + 0.004 * k * k,
        armor: 1 + 0.05 * k,
        gold: 1 + 0.035 * k,
      };
    }

    buildQueue(n) {
      const q = [];
      const add = (type, count, swarm = 0) => {
        let left = Math.floor(count);
        while (left > 0) {
          const size = swarm ? Math.min(left, randInt(swarm, swarm + 1)) : 1;
          q.push(size > 1 ? { type, swarm: size } : { type });
          left -= size;
        }
      };
      const late = n > 10 ? (n - 10) : 0;           // extra pressure after wave 10
      add('knife', 6 + n * 2.0 + late);
      if (n >= 2) add('ak', 2 + n * 1.2 + late * 0.8);
      if (n >= 3) add('biker', n * 0.7 + late * 0.4, 2);
      if (n >= 4) add('sniper', (n - 2) / 2);
      if (n >= 5) add('drone', n * 0.6 + late * 0.5, 3);
      if (n >= 6) add('tank', (n - 4) / 2 + late * 0.3);
      if (n >= 7) add('katyusha', 1 + (n - 7) / 3 + late * 0.15);
      // Part III units
      if (n >= 6) add('para', 1 + Math.floor((n - 6) / 4));
      if (n >= 7) add('medic', 1 + (n - 7) / 4);
      if (n >= 8) add('dozer', 1 + (n - 8) / 3);
      if (n >= 9) add('sapper', 2 + (n - 9) * 0.6, 2);
      if (n >= 10) add('stealth', 2 + (n - 10) * 0.6, 2);
      if (n >= 11) add('jammer', 1 + (n - 11) / 5);
      if (n >= 12) add('hbomber', 1 + (n - 12) / 4);
      for (let i = q.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [q[i], q[j]] = [q[j], q[i]]; }
      if (n % 5 === 0) {
        const bosses = 1 + Math.floor(n / 15);
        for (let b = 0; b < bosses; b++) q.splice(Math.floor(q.length * (0.3 + b * 0.25)), 0, { type: 'boss' });
      }
      return q;
    }

    start(n) {
      this.wave = n;
      this.queue = this.buildQueue(n);
      this.interval = Math.max(0.28, 1.1 - n * 0.04);
      this.timer = 0.6;
      this.spawning = true;
    }

    update(dt) {
      if (!this.spawning) return;
      this.timer -= dt;
      if (this.timer > 0) return;
      const item = this.queue.shift();
      if (!item) { this.spawning = false; return; }
      const heavy = ['tank', 'katyusha', 'dozer', 'jammer', 'medic', 'hbomber'].includes(item.type);
      this.timer = this.interval * (heavy ? 1.5 : item.type === 'boss' ? 2.5 : 1) * rand(0.7, 1.2);
      this.spawn(item);
      if (!this.queue.length) this.spawning = false;
    }

    spawn(item) {
      const g = this.game;
      const scale = this.scaleFor(this.wave);
      const count = item.swarm || 1;
      if (item.type === 'boss') {
        scale.hp *= 1 + Math.floor((this.wave - 5) / 5) * 0.3;
        g.onBossSpawn();
      }
      if (item.type === 'para') { g.flyovers.push(new TransportPlane(g, Math.max(1, Math.round(TD.CFG.foes.para.squadSize)))); return; }
      if (item.type === 'hbomber') {
        const dir = rand(0, Math.PI * 2);
        const off = rand(-50, 50);
        const path = { dir, cx: -Math.sin(dir) * off, cy: Math.cos(dir) * off };
        g.enemies.push(makeEnemy(g, 'hbomber', path.cx - Math.cos(dir) * 1150, path.cy - Math.sin(dir) * 1150, scale, path));
        g.audio.play('plane');
        return;
      }
      if (item.type === 'drone') {
        // drones fly in from any direction over the perimeter
        const a = rand(0, Math.PI * 2);
        for (let i = 0; i < count; i++) {
          const R = 980 + i * 40;
          g.enemies.push(makeEnemy(g, 'drone', Math.cos(a + i * 0.06) * R, Math.sin(a + i * 0.06) * R * 0.8, scale));
        }
        g.audio.play('drone');
        return;
      }
      // 🧭 360° spawning: ground units appear at ANY angle on the outer ring (R ≈ 950–1050)
      // and march straight in toward the fortress — no fixed breaches / lanes.
      const a = rand(0, Math.PI * 2);
      const R = rand(950, 1050);
      for (let i = 0; i < count; i++) {
        const jitter = item.swarm ? 30 : 20;
        const r = R + i * 26;                                // swarm members trail behind the leader
        const x = Math.cos(a) * r + rand(-jitter, jitter);
        const y = Math.sin(a) * r + rand(-jitter, jitter);
        g.enemies.push(makeEnemy(g, item.type, x, y, scale));
      }
    }

    get waveDone() {
      return !this.spawning && this.queue.length === 0 && this.game.enemies.every((e) => e.dead) && this.game.flyovers.length === 0;
    }
    get remaining() {
      const sq = Math.max(1, Math.round(TD.CFG.foes.para.squadSize));
      return this.queue.reduce((a, q) => a + (q.type === 'para' ? sq : (q.swarm || 1)), 0) + this.game.enemies.filter((e) => !e.dead).length;
    }
  }

  TD.ENEMY_TYPES = TYPES;
  TD.Enemy = Enemy;
  TD.makeEnemy = makeEnemy;
  TD.TransportPlane = TransportPlane;
  TD.SEISMIC = SEISMIC;
  TD.WaveSpawner = WaveSpawner;
})(window.TD);
