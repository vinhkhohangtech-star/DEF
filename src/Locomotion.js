/* =========================================================
   Locomotion.js — TD.Loco (v12): procedural unit animation.
   The baked 3D sprites of the AK rifleman, sniper, paratrooper
   and the biker have ONE frame (the .glb files carry no run clip),
   so without help they glide across the map. Everything here is
   procedural and runs on top of whatever art the unit uses:

   Infantry   stride bob (|sin| · 3.5 px), forward lean 6–10° into
              the movement vector, ±3° side sway on the cadence,
              a "scissor" leg split for 1-frame sprites (lower body
              drawn twice, sheared/lifted in opposite phase), dirt
              puffs under the alternating planted foot, flinch on hit.
   Vehicles   engine rumble (stronger at idle), suspension pitch on
              acceleration / braking and roll in turns (damped
              springs → they rock and settle), diesel exhaust puffs
              (#3a3835) behind the hull scaled by speed, cannon
              recoil: the whole chassis jerks back 4–6 px and rocks.
   Death      helmets / rifles / scrap fly out and bounce, blood or
              oil stains spread on the dirt.

   API: update(e, dt) · pose(e) → {dx, dy, rot, sy, lift} ·
        drawGait(ctx, id, heading, e) · flinch(e, src) · death(e)
   Off switch: TD.Loco.on = false (F12).
   ========================================================= */
(function (TD) {
  'use strict';
  const { rand, pick, clamp } = TD.util;
  const DEG = Math.PI / 180;
  const TAU = Math.PI * 2;

  /** Units that walk on legs (gait) and those that roll on an engine. */
  const INFANTRY = new Set(['knife', 'ak', 'sniper', 'para', 'stealth', 'sapper']);
  /** back = exhaust distance behind the hull centre, ez = pipe height, k = size factor. */
  const VEHICLE = {
    tank:     { back: 36, ez: 20, k: 1,    kick: 5 },
    boss:     { back: 64, ez: 34, k: 1.7,  kick: 6 },
    katyusha: { back: 34, ez: 22, k: 1,    kick: 2.5 },
    dozer:    { back: 40, ez: 30, k: 1.1,  kick: 0 },
    jammer:   { back: 32, ez: 24, k: 1,    kick: 0 },
    medic:    { back: 30, ez: 20, k: 0.9,  kick: 0 },
    biker:    { back: 17, ez: 9,  k: 0.55, kick: 0, bike: true },
  };
  const STRIDE = 21;            // ground px covered per footstep
  const BOB = 3.5;              // px of stride bounce

  const Loco = {
    on: true,
    INFANTRY, VEHICLE,

    kind(e) {
      if (e._lk !== undefined) return e._lk;
      return (e._lk = INFANTRY.has(e.type) ? 'inf' : VEHICLE[e.type] ? 'veh' : null);
    },
    state(e) {
      return e.loco || (e.loco = {
        phase: rand(0, TAU), amp: 0, spd: 0, acc: 0, hdg: null, yaw: 0,
        lean: 0, flinch: 0, flA: 0,
        pitch: 0, pitchV: 0, roll: 0, rollV: 0,
        kick: 0, kickV: 0, kickA: 0, prevRec: 0,
        exT: rand(0, 0.3), seed: rand(0, 100), foot: 1,
      });
    },

    /* ------------------------------------------------------------ simulation */
    update(e, dt) {
      if (!this.on || dt <= 0) return;
      const k = this.kind(e);
      if (!k) return;
      const L = this.state(e);
      const grounded = !e.air && !e.burrowed && !e.dead;
      const sp = grounded ? Math.hypot(e.vx, e.vy) : 0;
      const prevSpd = L.spd;
      L.spd += (sp - L.spd) * Math.min(1, dt * 10);
      L.acc += ((L.spd - prevSpd) / dt - L.acc) * Math.min(1, dt * 6);
      if (sp > 4) {
        const h = Math.atan2(e.vy, e.vx);
        if (L.hdg == null) L.hdg = h;
        let d = h - L.hdg; d = Math.atan2(Math.sin(d), Math.cos(d));
        L.hdg += d * Math.min(1, dt * 8);
        L.yaw += (d / Math.max(dt, 1e-3) * 0.12 - L.yaw) * Math.min(1, dt * 5);
      } else L.yaw *= Math.max(0, 1 - dt * 4);
      if (L.hdg == null) L.hdg = Math.atan2(-e.y, -e.x);
      L.flinch = Math.max(0, L.flinch - dt * 7);

      // fresh shot? (every unit sets recoil = 1 when it fires)
      if (e.recoil > L.prevRec + 0.5) this.fired(e, L, k);
      L.prevRec = e.recoil;
      // chassis recoil spring  x'' = −ω²x − 2ζωx'
      const W = 24, Z = 0.32;
      L.kickV += (-W * W * L.kick - 2 * Z * W * L.kickV) * dt;
      L.kick += L.kickV * dt;

      if (k === 'inf') this.updateInfantry(e, L, dt, sp);
      else this.updateVehicle(e, L, dt, sp);
    },

    updateInfantry(e, L, dt, sp) {
      const moving = sp > 6 && !e.attacking;
      L.amp += ((moving ? 1 : 0) - L.amp) * Math.min(1, dt * (moving ? 6 : 9));
      if (L.amp > 0.02) {
        const s0 = Math.sin(L.phase);
        L.phase += Math.PI * (Math.max(L.spd, 30) / STRIDE) * dt * (moving ? 1 : 0.5);
        const s1 = Math.sin(L.phase);
        if (moving && s0 * s1 <= 0 && s0 !== s1) this.footPlant(e, L);
      }
      const sprint = e.adrenaT > 0 || e.dashing;
      const tgt = moving ? (sprint ? 10 : 6 + 2 * clamp((L.spd - 40) / 60, 0, 1)) * DEG : 0;
      L.lean += (tgt - L.lean) * Math.min(1, dt * 8);
    },

    footPlant(e, L) {
      L.foot = -L.foot;
      const g = e.game, P = g.particles;
      if (e.cloaked || P.list.length > 1500 || L.spd < 20) return;
      const h = L.hdg, px = -Math.sin(h), py = Math.cos(h);
      const fx = e.x + px * 4 * L.foot + Math.cos(h) * 3, fy = e.y + py * 4 * L.foot + Math.sin(h) * 3;
      const n = e.adrenaT > 0 || e.dashing ? 2 : 1;
      for (let i = 0; i < n; i++) {
        P.spawn({
          type: 'smoke', layer: 'ground', x: fx + rand(-1.5, 1.5), y: fy + rand(-1, 1), z: 1,
          vx: -Math.cos(h) * rand(8, 18) + rand(-6, 6), vy: -Math.sin(h) * rand(8, 18) + rand(-4, 4), vz: rand(5, 14),
          size: rand(2.4, 3.4), grow: 2.3, color: pick(['#a8967a', '#b5a383', '#8f7f63']), alpha: 0.3, life: rand(0.4, 0.6), drag: 2.2,
        });
      }
    },

    updateVehicle(e, L, dt, sp) {
      const V = VEHICLE[e.type];
      const nrm = clamp(L.spd / 90, 0, 1);
      // suspension: nose lifts on acceleration, dips on braking; body rolls into turns
      const pT = clamp(L.acc * 0.0021, -3.5 * DEG, 3.5 * DEG) / Math.sqrt(V.k);
      const rT = clamp(-L.yaw * L.spd * 0.0009, -3 * DEG, 3 * DEG) * (V.bike ? 3.5 : 1);
      const Ws = V.bike ? 11 : 8, Zs = 0.28;
      L.pitchV += ((pT - L.pitch) * Ws * Ws - 2 * Zs * Ws * L.pitchV) * dt; L.pitch += L.pitchV * dt;
      L.rollV += ((rT - L.roll) * Ws * Ws - 2 * Zs * Ws * L.rollV) * dt; L.roll += L.rollV * dt;
      // 💨 diesel exhaust puffs behind the hull
      if (e.dead || e.air) return;
      L.exT -= dt;
      if (L.exT > 0) return;
      const P = e.game.particles;
      L.exT = (sp > 6 ? 0.24 - 0.15 * nrm : 0.42) * rand(0.8, 1.2) * (V.bike ? 0.8 : 1);
      if (P.list.length > 1700) return;
      const h = e.viewA != null ? e.viewA : L.hdg, c = Math.cos(h), s = Math.sin(h);
      const side = V.bike ? 0 : 0.35 * V.back * (L.foot = -L.foot);
      const ex = e.x - c * V.back - s * side * 0.3, ey = e.y - s * V.back + c * side * 0.3;
      const k = V.k * (0.8 + 0.6 * nrm);
      P.spawn({
        type: 'exhaust', x: ex, y: ey, z: V.ez * Math.min(1.4, V.k),
        vx: -c * rand(14, 26) + e.vx * 0.25, vy: -s * rand(14, 26) + e.vy * 0.25, vz: rand(16, 30),
        size: rand(4.6, 6) * k, grow: 2.6, color: V.bike ? '#4a4744' : '#3a3835', alpha: V.bike ? 0.6 : 0.85, life: rand(1.2, 1.7), drag: 1.3,
      });
      // cold-start spurt when pulling away hard
      if (L.acc > 60 && Math.random() < 0.5) P.spawn({ type: 'exhaust', x: ex, y: ey, z: V.ez, vx: -c * 30, vy: -s * 30, vz: 34, size: 4.5 * k, grow: 3, color: '#2a2826', alpha: 0.6, life: 1.2, drag: 1.2 });
    },

    fired(e, L, k) {
      if (k === 'veh') {
        const V = VEHICLE[e.type];
        if (!V.kick) return;
        L.kickA = e.turretA != null ? e.turretA : L.hdg;
        // peak ≈ v0 / ω · e^(−ζ·π/2) → v0 ≈ kick · ω / 0.6
        L.kickV += V.kick * 24 / 0.6;
        L.pitchV += 0.55 / Math.sqrt(V.k);              // nose bucks up, then rocks on the springs
      } else {
        L.kickA = e.viewA != null ? e.viewA : L.hdg;
        L.kickV += (e.type === 'sniper' ? 2.2 : 1.2) * 24 / 0.6;   // shoulder recoil
      }
    },

    /** Hit reaction from a world point (bullet origin / blast centre). */
    flinch(e, src) {
      if (!this.on || !this.kind(e)) return;
      const L = this.state(e);
      L.flinch = 1;
      if (src) L.flA = Math.atan2(e.y - src.y, e.x - src.x);
    },

    /* ------------------------------------------------------------ rendering */
    /** Screen-space pose offsets, applied at the unit's feet before its art is drawn. */
    pose(e) {
      const out = { dx: 0, dy: 0, rot: 0, sy: 1, lift: 0 };
      if (!this.on) return out;
      const k = this.kind(e), L = e.loco;
      if (!k || !L || e.air || e.burrowed) return out;
      const C = TD.Camera, ISO = C.ISO;
      const hs = C.screenAngle(L.hdg), dX = Math.cos(hs), dY = Math.sin(hs);
      // recoil: displace against the barrel / rifle direction
      if (L.kick) { out.dx -= Math.cos(L.kickA) * L.kick; out.dy -= Math.sin(L.kickA) * ISO * L.kick; }
      if (L.flinch > 0) {
        const fs = C.screenAngle(L.flA);
        out.rot += Math.cos(fs) * L.flinch * 7 * DEG;
        out.dx += Math.cos(L.flA) * L.flinch * 1.2;
      }
      if (k === 'inf') {
        const sw = Math.sin(L.phase);
        out.lift = Math.abs(sw) * BOB * L.amp;
        out.rot += L.lean * dX + sw * 3 * DEG * L.amp;
        out.sy = 1 - L.lean * 0.35 * Math.abs(dY);       // lean toward/away from camera → foreshortened
        return out;
      }
      const V = VEHICLE[e.type], t = e.game.time;
      const idle = L.spd < 6;
      const a = (idle ? 0.75 : 0.4) * (V.bike ? 0.6 : 1) / Math.sqrt(V.k);
      out.dy += Math.sin(t * 81.7 + L.seed) * a + Math.sin(t * 131.9 + L.seed * 2) * a * 0.45;
      out.dx += Math.sin(t * 57.3 + L.seed * 3) * a * 0.35;
      out.rot += -L.pitch * dX + L.roll * dY * 0.8 + (V.bike ? L.roll * Math.abs(dX) * 0.5 : 0);
      if (L.kick) out.rot += -Math.cos(C.screenAngle(L.kickA)) * L.kick * 0.006;
      return out;
    },

    /** 1-frame infantry sprite with a procedural leg "scissor" (upper body rigid, legs swing in counter-phase). */
    drawGait(ctx, id, a, e) {
      const S3 = TD.S3, m = S3.M[id], L = e.loco;
      if (!m || !this.on || !L || L.amp < 0.06 || e.air) return S3.draw(ctx, id, 0, 0, a, 0);
      const idx = S3.angleIndex(id, a), c = m.cells[idx] || m.cells[0], img = S3.pages[c[0]];
      const s = 1 / m.res, x0 = -m.ax * s, y0 = -m.ay * s, w = m.cw * s, h = m.ch * s;
      const hip = -m.size[1] * 0.46;                 // hip line, screen px above the feet
      const bot = y0 + h;
      const ch = S3.cellHeading(id, a), side = Math.abs(Math.cos(ch)) > 0.45;
      const sw = Math.sin(L.phase) * L.amp;
      const blit = () => ctx.drawImage(img, c[1], c[2], m.cw, m.ch, x0, y0, w, h);
      for (const sg of [-1, 1]) {
        ctx.save();
        ctx.beginPath();
        if (side) ctx.rect(x0, hip, w, bot - hip);
        else if (sg < 0) ctx.rect(x0, hip, -x0, bot - hip);
        else ctx.rect(0, hip, w + x0, bot - hip);
        ctx.clip();
        if (side) {
          const k = sg * sw * 0.42;                       // shear about the hip: x' = x + k·(y − hip)
          ctx.transform(1, 0, k, 1, -k * hip, 0);
          if (sg < 0) ctx.globalAlpha = 0.92;              // far leg a touch dimmer
        } else {
          const lift = Math.max(0, sg * sw) * 3.2;         // camera-facing: alternate knees rise
          ctx.translate(sg * sw * 0.8, -lift);
        }
        blit();
        ctx.restore();
      }
      ctx.save();
      ctx.beginPath(); ctx.rect(x0, y0, w, hip - y0 + 0.6); ctx.clip();
      blit();
      ctx.restore();
      return true;
    },

    /* ------------------------------------------------------------ death debris */
    death(e) {
      if (!this.on || e.air) return;
      const k = this.kind(e), P = e.game.particles;
      if (!k || P.list.length > 1900) return;
      const L = e.loco || this.state(e);
      const fa = L.flinch > 0 || L.flA ? L.flA : Math.atan2(e.y, e.x);   // fly away from the last hit
      const fx = Math.cos(fa), fy = Math.sin(fa);
      if (k === 'inf') {
        const helm = { knife: '#7a1c1c', ak: '#4a5232', sniper: '#5d7a3a', para: '#3e4a28', stealth: '#1c1f24', sapper: '#5a4a28' }[e.type] || '#4a5232';
        P.spawn({ type: 'gear', kind: 'helmet', x: e.x, y: e.y, z: e.height * 0.9, vx: fx * rand(50, 110) + rand(-30, 30), vy: fy * rand(50, 110) + rand(-30, 30), vz: rand(190, 280), g: -900, drag: 0.4, rot: rand(0, 6), vr: rand(-14, 14), vt: 0, size: 4.6, color: helm, life: rand(6, 8), bounces: 0 });
        const gun = { ak: 16, sniper: 24, para: 15, knife: 7, sapper: 7, stealth: 9 }[e.type];
        if (gun) P.spawn({ type: 'gear', kind: e.type === 'knife' || e.type === 'sapper' ? 'blade' : 'rifle', mag: e.type === 'ak' || e.type === 'para', x: e.x, y: e.y, z: e.height * 0.55, vx: fx * rand(30, 80) + rand(-40, 40), vy: fy * rand(30, 80) + rand(-40, 40), vz: rand(120, 200), g: -900, drag: 0.5, rot: rand(0, 6), vr: rand(-10, 10), vt: 0, size: gun, life: rand(6, 8), bounces: 0 });
        for (let i = 0; i < 6; i++) P.spawn({ type: 'drop', x: e.x, y: e.y, z: e.height * rand(0.4, 0.8), vx: fx * rand(40, 140) + rand(-30, 30), vy: fy * rand(40, 140) + rand(-30, 30), vz: rand(40, 140), g: -700, size: rand(1.2, 2), color: '#8a1410', splatColor: '#5a0b09', life: rand(0.8, 1.2) });
        this.stain(P, e.x + fx * 6, e.y + fy * 4, rand(7, 10), '#3a0806', 0.5);
      } else {
        const V = VEHICLE[e.type];
        const n = V.bike ? 5 : Math.round(6 * V.k);
        for (let i = 0; i < n; i++) {
          const a = rand(0, TAU), sp = rand(80, 220) * (V.bike ? 0.8 : 1);
          P.spawn({ type: 'gear', kind: 'scrap', x: e.x, y: e.y, z: rand(10, 30) * V.k, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, vz: rand(200, 380), g: -980, drag: 0.5, rot: rand(0, 6), vr: rand(-18, 18), vt: 0, size: rand(3, 6) * Math.sqrt(V.k), color: pick(['#4a4d46', '#3b3d38', '#6a6a62', '#5d5240']), life: rand(5, 7), bounces: 0, hot: Math.random() < 0.5 });
        }
        if (V.bike) P.spawn({ type: 'gear', kind: 'wheel', x: e.x, y: e.y, z: 12, vx: fx * 120, vy: fy * 120, vz: 220, g: -900, drag: 0.4, rot: 0, vr: rand(-16, 16), vt: 0, size: 7, color: '#151515', life: 7, bounces: 0 });
        this.stain(P, e.x, e.y, (V.bike ? 12 : 20) * V.k, '#100d0a', 0.6);
      }
    },
    stain(P, x, y, r, color, alpha) {
      let n = 0;
      for (let i = P.list.length - 1; i >= 0; i--) if (P.list[i].type === 'stain' && ++n > 40) { P.list.splice(i, 1); break; }
      const lobes = [];
      for (let i = 0; i < 4; i++) lobes.push([rand(-0.6, 0.6), rand(-0.5, 0.5), rand(0.45, 0.8)]);
      P.spawn({ type: 'stain', layer: 'ground', x, y, z: 0, size: r, color, alpha, lobes, life: rand(9, 12) });
    },
  };

  TD.Loco = Loco;
})(window.TD);
