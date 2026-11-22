/* =========================================================
   Camera.js — TD.Camera: ONE source of truth for the 2.5D view.
   World: X/Y on the ground plane, Z = altitude (up).
   Screen (logical 1600×900 px, before renderScale / shake):
       sx = CX + x
       sy = CY + y·ISO − z
   i.e. the 3×2 projection matrix
       | 1   0    0 |   |x|   |CX|
       | 0  ISO  −1 | · |y| + |CY|
                        |z|
   Every directional visual (tracers, ricochets, lasers, rails,
   missiles, EMP rings, dome ripples) asks the Camera for its
   screen angle — no ad-hoc Math.atan2 on mixed coordinates.
   ========================================================= */
(function (TD) {
  'use strict';

  const Camera = {
    CX: 800, CY: 470, ISO: 0.6,
    /** View direction toward the viewer in WORLD space (rays of constant screen position). */
    VIEW: (function () { const l = Math.hypot(0, 1, 0.6); return { x: 0, y: 1 / l, z: 0.6 / l }; })(),

    attach(game) {
      this.CX = game.CX; this.CY = game.CY; this.ISO = game.ISO;
      const l = Math.hypot(1, this.ISO); this.VIEW = { x: 0, y: 1 / l, z: this.ISO / l };
      this.game = game;
    },

    /** World → screen. Returns {sx, sy} plus {x, y} aliases for legacy call sites. */
    project(x, y, z = 0) {
      const sx = this.CX + x, sy = this.CY + y * this.ISO - z;
      return { sx, sy, x: sx, y: sy };
    },
    /** Screen → ground plane (z = 0). */
    unproject(sx, sy) { return { x: sx - this.CX, y: (sy - this.CY) / this.ISO }; },

    /** Exact screen-space vector between two WORLD points ({x,y,z}). */
    screenVector(p1, p2) {
      const dx = (p2.x - p1.x);
      const dy = (p2.y - p1.y) * this.ISO - ((p2.z || 0) - (p1.z || 0));
      const length = Math.hypot(dx, dy);
      return { dx, dy, angle: Math.atan2(dy, dx), length, ux: length ? dx / length : 1, uy: length ? dy / length : 0 };
    },
    /** Screen angle of a WORLD velocity / direction vector (vx, vy, vz). */
    screenAngleOfVelocity(vx, vy, vz = 0) { return Math.atan2(vy * this.ISO - vz, vx); },
    /** Screen angle of a ground heading (radians in the X/Y plane). */
    screenAngle(heading) { return Math.atan2(Math.sin(heading) * this.ISO, Math.cos(heading)); },

    /** Ground circle of world radius r → screen ellipse path (never rotated, always ISO-squashed). */
    groundEllipse(ctx, x, y, r, z = 0) {
      const s = this.project(x, y, z);
      ctx.ellipse(s.sx, s.sy, Math.max(0.1, r), Math.max(0.1, r * this.ISO), 0, 0, Math.PI * 2);
      return s;
    },

    /** Orthonormal basis around a unit vector n (for drawing circles on spheres / cones). */
    basis(n) {
      const a = Math.abs(n.z) < 0.9 ? { x: 0, y: 0, z: 1 } : { x: 1, y: 0, z: 0 };
      let e1 = { x: a.y * n.z - a.z * n.y, y: a.z * n.x - a.x * n.z, z: a.x * n.y - a.y * n.x };
      const l = Math.hypot(e1.x, e1.y, e1.z) || 1; e1 = { x: e1.x / l, y: e1.y / l, z: e1.z / l };
      const e2 = { x: n.y * e1.z - n.z * e1.y, y: n.z * e1.x - n.x * e1.z, z: n.x * e1.y - n.y * e1.x };
      return { e1, e2 };
    },
    /** Reflect direction d about unit normal n (3D). */
    reflect(d, n) { const k = 2 * (d.x * n.x + d.y * n.y + d.z * n.z); return { x: d.x - k * n.x, y: d.y - k * n.y, z: d.z - k * n.z }; },
    norm(v) { const l = Math.hypot(v.x, v.y, v.z) || 1; return { x: v.x / l, y: v.y / l, z: v.z / l }; },
  };

  TD.Camera = Camera;
})(window.TD);
