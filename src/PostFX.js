/* =========================================================
   PostFX.js — TD.PostFX: real-time lighting & post-processing
   • Dynamic point lights  (muzzle, tracer heads, blasts, EMP…)
     → coloured light pooled on the ground (ISO-squashed) and on
       the tower / units standing in it.
   • Emissive bloom: effects submit glow primitives (dots and
     capsules); the GPU rasterises them, blurs them in two
     gaussian octaves and the result is screen-blended over the
     frame → neon halos without muddying the background.
   • Shockwave refraction: explosion / EMP rings lens the
     already-rendered battlefield (Canvas2D self-sample — works
     from file:// because nothing is ever read back to the CPU).
   • Chromatic flash for the nuke.
   GPU path: a WebGL1 canvas layered between the game canvas and
   the HUD, blended by the browser compositor (CSS mix-blend-mode:
   screen). It never samples any image → never tainted, no
   GPU↔CPU copies, file:// safe. No WebGL → same API on a 2D
   overlay fallback.
   Adaptive governor: if the real frame time stays high it sheds
   refraction → bloom → lights (and restores them when it can).
   Toggles (F12):  TD.PostFX.on / lights / bloom / distortion / chromatic / auto
   ========================================================= */
(function (TD) {
  'use strict';
  let W = 1600, H = 900;            // logical view (v11: portrait changes it via PostFX.setView)
  const BW = 400, BH = 225;          // light + bloom buffer (¼ res — lights/halos are soft)
  const MAXL = 40;                   // GPU light budget per frame
  const MAXP = 1400;                 // emissive primitives per frame
  const FPV = 11;                    // floats / vertex: pos2 seg4 rad2 col3

  /* ---------- colour helper: '#rrggbb' / 'rgb(r,g,b)' / 'r,g,b' / [r,g,b] → [0..1]³ ---------- */
  const _cc = {};
  function rgb(c) {
    if (Array.isArray(c)) return c;
    if (_cc[c]) return _cc[c];
    let r = 1, g = 1, b = 1;
    if (c[0] === '#') { const n = parseInt(c.length === 4 ? c.slice(1).split('').map((h) => h + h).join('') : c.slice(1, 7), 16); r = (n >> 16 & 255) / 255; g = (n >> 8 & 255) / 255; b = (n & 255) / 255; }
    else { const p = c.replace(/[^\d,.]/g, '').split(',').map(Number); r = p[0] / 255; g = p[1] / 255; b = p[2] / 255; }
    return (_cc[c] = [r, g, b]);
  }
  const hex2 = (v) => ('0' + Math.round(Math.min(1, v) * 255).toString(16)).slice(-2);
  const hexOf = (c) => '#' + hex2(c[0]) + hex2(c[1]) + hex2(c[2]);

  /* ---------- shaders ---------- */
  const VS_Q = 'attribute vec2 p; varying vec2 uv; void main(){ uv = p * 0.5 + 0.5; gl_Position = vec4(p, 0.0, 1.0); }';
  const VS_E = [
    'attribute vec2 aP; attribute vec4 aS; attribute vec2 aR; attribute vec3 aC;',
    'varying vec2 vP; varying vec4 vS; varying vec2 vR; varying vec3 vC;',
    'uniform vec2 uWH;',
    'void main(){ vP = aP; vS = aS; vR = aR; vC = aC;',
    '  gl_Position = vec4(aP.x / uWH.x * 2.0 - 1.0, 1.0 - aP.y / uWH.y * 2.0, 0.0, 1.0); }'].join('\n');
  // capsule / squashed-disc soft glow: distance to the segment, falloff like TD.Draw.blob
  const FS_E = [
    'precision mediump float; varying vec2 vP; varying vec4 vS; varying vec2 vR; varying vec3 vC;',
    'void main(){',
    '  vec2 a = vS.xy, b = vS.zw, p = vP; vec2 ab = b - a; float L2 = dot(ab, ab);',
    '  float h = L2 > 0.0001 ? clamp(dot(p - a, ab) / L2, 0.0, 1.0) : 0.0;',
    '  vec2 d = p - (a + ab * h); d.y /= vR.y;',
    '  float q = 1.0 - length(d) / vR.x; if (q <= 0.0) discard;',
    '  gl_FragColor = vec4(vC * (q * (0.55 + 0.45 * q)), 1.0);',
    '}'].join('\n');
  const FS_BLUR = [
    'precision mediump float; varying vec2 uv; uniform sampler2D t; uniform vec2 d;',
    'void main(){',
    '  vec3 c = texture2D(t, uv).rgb * 0.2270270;',
    '  c += (texture2D(t, uv + d * 1.3846153).rgb + texture2D(t, uv - d * 1.3846153).rgb) * 0.3162162;',
    '  c += (texture2D(t, uv + d * 3.2307692).rgb + texture2D(t, uv - d * 3.2307692).rgb) * 0.0702702;',
    '  gl_FragColor = vec4(c, 1.0);',
    '}'].join('\n');
  const FS_FINAL = [
    'precision mediump float; varying vec2 uv;',
    'uniform sampler2D tE; uniform sampler2D tB1; uniform sampler2D tB2;',
    'uniform vec4 uL[' + MAXL + ']; uniform vec3 uC[' + MAXL + ']; uniform int uN; uniform vec3 uK; uniform vec2 uWH;',
    'void main(){',
    '  vec2 f = vec2(uv.x * uWH.x, (1.0 - uv.y) * uWH.y);',
    '  vec3 col = texture2D(tE, uv).rgb * uK.x + texture2D(tB1, uv).rgb * uK.y + texture2D(tB2, uv).rgb * uK.z;',
    '  for (int i = 0; i < ' + MAXL + '; i++) {',
    '    if (i >= uN) break;',
    '    vec4 L = uL[i];',
    '    vec2 d = f - L.xy; d.y /= L.w;',
    '    float q = max(0.0, 1.0 - dot(d, d) / (L.z * L.z));',
    '    col += uC[i] * (q * q * (0.65 + 0.35 * q));',
    '  }',
    '  gl_FragColor = vec4(col, 1.0);',
    '}'].join('\n');

  const PostFX = {
    on: true, lights: true, bloom: true, distortion: true, chromatic: true, auto: true,
    ambient: 0.1,                 // gentle cool night-grade so lights read (0 = off)
    gpu: false, ready: false, level: 0,
    _frame: [], _timed: [], shocks: [], chroma: 0, stats: { lights: 0, shocks: 0, prims: 0, level: 0 },

    init() {
      if (this.ready) return;
      this.ready = true;
      this.P = new Float32Array(MAXP * 6 * FPV); this.np = 0;
      this.M = new DOMMatrix();
      try { this.gpu = this.initGL(); } catch (e) { this.gpu = false; }
      if (!this.gpu) {
        this.out = document.createElement('canvas'); this.out.width = BW; this.out.height = BH;
        this.octx = this.out.getContext('2d');
        this.emit = document.createElement('canvas'); this.emit.width = BW; this.emit.height = BH;
        this.ectx = this.emit.getContext('2d');
        this.small = document.createElement('canvas'); this.small.width = BW / 4; this.small.height = BH / 4;
        this.sctx = this.small.getContext('2d');
      }
      this.tmp = document.createElement('canvas');
      this.tctx = this.tmp.getContext('2d');
      // overlay layer: between the game canvas and the HUD, screen-blended by the compositor
      const o = this.out;
      o.id = 'fxLayer';
      Object.assign(o.style, { position: 'absolute', left: '0', top: '0', width: W + 'px', height: H + 'px', pointerEvents: 'none', mixBlendMode: 'screen' });
      const base = document.getElementById('canvas');
      if (base && base.parentNode) base.parentNode.insertBefore(o, base.nextSibling);
    },

    initGL() {
      const c = document.createElement('canvas'); c.width = BW; c.height = BH;
      const gl = c.getContext('webgl', { alpha: false, antialias: false, depth: false, stencil: false, premultipliedAlpha: false, preserveDrawingBuffer: false, powerPreference: 'high-performance' });
      if (!gl) return false;
      const sh = (type, src) => { const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s); if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s)); return s; };
      const prog = (vs, fs, attrs) => { const p = gl.createProgram(); gl.attachShader(p, sh(gl.VERTEX_SHADER, vs)); gl.attachShader(p, sh(gl.FRAGMENT_SHADER, fs)); attrs.forEach((a, i) => gl.bindAttribLocation(p, i, a)); gl.linkProgram(p); if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p)); return p; };
      const emit = prog(VS_E, FS_E, ['aP', 'aS', 'aR', 'aC']), blur = prog(VS_Q, FS_BLUR, ['p']), fin = prog(VS_Q, FS_FINAL, ['p']);
      const quad = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, quad);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
      const vbo = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
      gl.bufferData(gl.ARRAY_BUFFER, this.P.byteLength, gl.DYNAMIC_DRAW);
      const tex = (w, h) => {
        const t = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, t);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
        return t;
      };
      const target = (w, h) => { const t = tex(w, h); const f = gl.createFramebuffer(); gl.bindFramebuffer(gl.FRAMEBUFFER, f); gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, t, 0); return { t, f, w, h }; };
      const E = target(BW, BH);
      if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) return false;
      const A = target(BW / 2, BH / 2), B = target(BW / 2, BH / 2), C = target(BW / 8, BH / 8), Dd = target(BW / 8, BH / 8);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      this.gl = gl; this.glc = c; this.out = c;
      this.G = {
        emit, blur, fin, quad, vbo, E, A, B, C, D: Dd,
        uBt: gl.getUniformLocation(blur, 't'), uBd: gl.getUniformLocation(blur, 'd'),
        uE: gl.getUniformLocation(fin, 'tE'), uB1: gl.getUniformLocation(fin, 'tB1'), uB2: gl.getUniformLocation(fin, 'tB2'),
        uL: gl.getUniformLocation(fin, 'uL'), uC: gl.getUniformLocation(fin, 'uC'), uN: gl.getUniformLocation(fin, 'uN'), uK: gl.getUniformLocation(fin, 'uK'),
        uWHe: gl.getUniformLocation(emit, 'uWH'), uWHf: gl.getUniformLocation(fin, 'uWH'),
        L: new Float32Array(MAXL * 4), Cc: new Float32Array(MAXL * 3),
      };
      c.addEventListener('webglcontextlost', (e) => { e.preventDefault(); if (c.parentNode) c.parentNode.removeChild(c); this.gpu = false; this.ready = false; this.init(); }, false);
      return true;
    },

    /** v11: logical view size (1600×900 landscape, taller in portrait). Overlay CSS follows. */
    setView(w, h) {
      W = w; H = h;
      if (this.out && this.out.style) { this.out.style.width = W + 'px'; this.out.style.height = H + 'px'; }
    },
    get W() { return W; }, get H() { return H; },

    reset() { this._frame.length = 0; this._timed.length = 0; this.shocks.length = 0; this.chroma = 0; },

    /* ================= API used by effects ================= */
    /** One-frame point light at WORLD (x,y,z). r = ground radius px, col colour, k intensity (~0.2–2). */
    light(x, y, z, r, col, k = 1) { if (this.on && this.lights) this._frame.push(x, y, z, r, rgb(col), k); },
    /** Timed light that decays (quadratic) over dur seconds. */
    flash(x, y, z, r, col, k = 1, dur = 0.25, delay = 0) { if (this.on && this.lights) this._timed.push({ x, y, z, r, c: rgb(col), k, t: -delay, dur }); },

    /** Raw emissive primitive: capsule (x1,y1)→(x2,y2) in LOGICAL screen px, radius r, vertical squash sq. */
    prim(x1, y1, x2, y2, r, sq, col, a) {
      if (!this.on || !this.bloom || !this.ready || this.np >= MAXP || r < 0.5 || a <= 0.004) return;
      const M = this.M, c = rgb(col), k = Math.min(1, a);
      const X1 = M.a * x1 + M.c * y1 + M.e, Y1 = M.b * x1 + M.d * y1 + M.f;
      const X2 = M.a * x2 + M.c * y2 + M.e, Y2 = M.b * x2 + M.d * y2 + M.f;
      const ry = r * sq;
      const x0 = Math.min(X1, X2) - r, x3 = Math.max(X1, X2) + r, y0 = Math.min(Y1, Y2) - ry, y3 = Math.max(Y1, Y2) + ry;
      if (x3 < 0 || x0 > W || y3 < 0 || y0 > H) return;
      const P = this.P; let o = this.np * 6 * FPV;
      const v = (px, py) => { P[o++] = px; P[o++] = py; P[o++] = X1; P[o++] = Y1; P[o++] = X2; P[o++] = Y2; P[o++] = r; P[o++] = sq; P[o++] = c[0] * k; P[o++] = c[1] * k; P[o++] = c[2] * k; };
      v(x0, y0); v(x3, y0); v(x0, y3); v(x3, y0); v(x3, y3); v(x0, y3);
      this.np++;
    },
    /** Emissive glow stroke between WORLD points a,b (bloom source). */
    glowLine(a, b, w, col, alpha = 1) {
      const C = TD.Camera, p = C.project(a.x, a.y, a.z || 0), q = C.project(b.x, b.y, b.z || 0);
      this.glowLineS(p.sx, p.sy, q.sx, q.sy, w, col, alpha);
    },
    glowLineS(x1, y1, x2, y2, w, col, alpha = 1) { this.prim(x1, y1, x2, y2, w * 0.9, 1, col, alpha); },
    /** Emissive glow blob at WORLD point (bloom source). */
    glowDot(x, y, z, r, col, alpha = 1) { const s = TD.Camera.project(x, y, z); this.glowDotS(s.sx, s.sy, r, col, alpha); },
    glowDotS(x, y, r, col, alpha = 1, squash = 1) { this.prim(x, y, x, y, r, squash, col, alpha); },
    /** Glow along a screen-space polyline (Tesla bolts, EMP front…). pts = [{x,y}] in screen px. */
    glowPath(pts, w, col, alpha = 1) { for (let i = 1; i < pts.length; i++) this.prim(pts[i - 1].x, pts[i - 1].y, pts[i].x, pts[i].y, w * 0.9, 1, col, alpha); },
    /** Refractive ground shockwave (radius R world px) — lenses the frame underneath. */
    shock(x, y, R, dur = 0.45, strength = 0.07, delay = 0, z = 0) { if (this.on && this.distortion) this.shocks.push({ x, y, z, R, dur, s: strength, t: -delay }); },
    /** Full-screen chromatic aberration pulse (nuke). */
    chromaPulse(k = 1) { this.chroma = Math.max(this.chroma, k); },

    update(dt) {
      for (const l of this._timed) l.t += dt;
      this._timed = this._timed.filter((l) => l.t < l.dur);
      for (const s of this.shocks) s.t += dt;
      this.shocks = this.shocks.filter((s) => s.t < s.dur);
      this.chroma = Math.max(0, this.chroma - dt * 1.6);
    },

    /**
     * Adaptive quality governor, fed with the REAL frame interval (ms) by the game loop.
     * Level 0 = everything • 1 = no refraction/chromatic • 2 = + no bloom • 3 = + no lights.
     */
    governor(ms) {
      if (!this.auto || !this.on || !(ms > 0) || ms > 250) return;
      this._ema = this._ema == null ? ms : this._ema * 0.95 + ms * 0.05;
      this._slow = this._ema > 24 ? (this._slow || 0) + ms : 0;     // < ~41 FPS sustained
      this._fast = this._ema < 15 ? (this._fast || 0) + ms : 0;     // ≥ ~66 FPS headroom
      if (this._slow > 1500 && this.level < 3) { this.setLevel(this.level + 1); this._slow = 0; this._ema = 17; }
      else if (this._fast > 6000 && this.level > 0) { this.setLevel(this.level - 1); this._fast = 0; }
    },
    setLevel(n) {
      this.level = n; this.stats.level = n;
      this.distortion = n < 1; this.chromatic = n < 1; this.bloom = n < 2; this.lights = n < 3;
    },

    /* ================= frame hooks (called by Game.render) ================= */
    /** ctx = game canvas with the current (shaken) world transform → glow follows the camera shake. */
    beginFrame(ctx) {
      if (!this.ready) this.init();
      const m = ctx ? ctx.getTransform() : new DOMMatrix();
      const k = ctx ? ctx.canvas.width / W : 1;
      this.M = new DOMMatrix([m.a / k, m.b / k, m.c / k, m.d / k, m.e / k, m.f / k]);   // logical-space world matrix
      this.np = 0;
    },
    /** Night grade over the terrain (before units are drawn). */
    grade(ctx) {
      if (!this.on || !this.lights || this.ambient <= 0) return;
      ctx.fillStyle = `rgba(8,12,24,${this.ambient})`;
      ctx.fillRect(-80, -80, W + 160, H + 160);
    },

    /** Gather lights (frame + timed), project, budget the brightest MAXL. */
    collect() {
      const C = TD.Camera, L = [], F = this._frame;
      for (let i = 0; i < F.length; i += 6) L.push({ x: F[i], y: F[i + 1], z: F[i + 2], r: F[i + 3], c: F[i + 4], k: F[i + 5] });
      for (const l of this._timed) {
        if (l.t < 0) continue;
        const u = 1 - l.t / l.dur;
        L.push({ x: l.x, y: l.y, z: l.z, r: l.r * (0.8 + 0.2 * u), c: l.c, k: l.k * u * u });
      }
      F.length = 0;
      if (L.length > MAXL) { L.sort((a, b) => b.k * b.r - a.k * a.r); L.length = MAXL; }
      const out = [], M = this.M;
      for (const l of L) {
        if (l.k <= 0.01) continue;
        const g = C.project(l.x, l.y, 0);
        // an elevated source pools its light a little higher (reaches walls, the tower face & bodies)
        const cy = g.sy - Math.min(l.z, 200) * 0.45;
        const px = M.a * g.sx + M.c * cy + M.e, py = M.b * g.sx + M.d * cy + M.f;
        if (px + l.r < -60 || px - l.r > W + 60 || py + l.r < -60 || py - l.r > H + 60) continue;
        out.push({ sx: px, sy: py, r: l.r, sq: C.ISO + Math.min(0.35, l.z / 400), c: l.c, k: l.k });
      }
      this.stats.lights = out.length;
      return out;
    },

    /** Render lights + bloom into the overlay layer (the compositor screens it over the game canvas). */
    composite() {
      const o = this.out;
      const show = this.on && (this.lights || this.bloom);
      const vis = show ? '' : 'none';
      if (o && o.style.display !== vis) o.style.display = vis;
      this.stats.prims = this.np;
      if (!show) { this._frame.length = 0; return; }
      const lights = this.lights ? this.collect() : (this._frame.length = 0, []);
      if (this.gpu) this.renderGL(lights); else this.render2D(lights);
    },

    renderGL(lights) {
      const gl = this.gl, G = this.G;
      if (!gl || gl.isContextLost()) return;
      const bloom = this.bloom && this.np > 0;
      // ① emissive primitives → E (additive)
      gl.bindFramebuffer(gl.FRAMEBUFFER, G.E.f); gl.viewport(0, 0, BW, BH);
      gl.clearColor(0, 0, 0, 1); gl.clear(gl.COLOR_BUFFER_BIT);
      if (bloom) {
        gl.useProgram(G.emit); gl.uniform2f(G.uWHe, W, H);
        gl.bindBuffer(gl.ARRAY_BUFFER, G.vbo);
        gl.bufferSubData(gl.ARRAY_BUFFER, 0, this.P.subarray(0, this.np * 6 * FPV));
        const S = FPV * 4;
        for (let i = 0; i < 4; i++) gl.enableVertexAttribArray(i);
        gl.vertexAttribPointer(0, 2, gl.FLOAT, false, S, 0);
        gl.vertexAttribPointer(1, 4, gl.FLOAT, false, S, 8);
        gl.vertexAttribPointer(2, 2, gl.FLOAT, false, S, 24);
        gl.vertexAttribPointer(3, 3, gl.FLOAT, false, S, 32);
        gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE);
        gl.drawArrays(gl.TRIANGLES, 0, this.np * 6);
        gl.disable(gl.BLEND);
        for (let i = 1; i < 4; i++) gl.disableVertexAttribArray(i);
      }
      // quad geometry for the full-screen passes
      gl.bindBuffer(gl.ARRAY_BUFFER, G.quad);
      gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
      gl.activeTexture(gl.TEXTURE0);
      const pass = (srcT, dst, dx, dy) => {
        gl.bindFramebuffer(gl.FRAMEBUFFER, dst.f); gl.viewport(0, 0, dst.w, dst.h);
        gl.bindTexture(gl.TEXTURE_2D, srcT);
        gl.uniform2f(G.uBd, dx, dy);
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      };
      if (bloom) {
        gl.useProgram(G.blur); gl.uniform1i(G.uBt, 0);
        pass(G.E.t, G.A, 1 / (BW / 2), 0);            // octave 1 (½)
        pass(G.A.t, G.B, 0, 1 / (BH / 2));
        pass(G.B.t, G.C, 1 / (BW / 8), 0);            // octave 2 (⅛) — wide soft halo
        pass(G.C.t, G.D, 0, 1 / (BH / 8));
      }
      // ② final: bloom octaves + analytic point lights → overlay canvas
      gl.bindFramebuffer(gl.FRAMEBUFFER, null); gl.viewport(0, 0, BW, BH);
      gl.useProgram(G.fin); gl.uniform2f(G.uWHf, W, H);
      gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, G.E.t); gl.uniform1i(G.uE, 0);
      gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, G.B.t); gl.uniform1i(G.uB1, 1);
      gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_2D, G.D.t); gl.uniform1i(G.uB2, 2);
      gl.activeTexture(gl.TEXTURE0);
      const n = Math.min(MAXL, lights.length);
      for (let i = 0; i < n; i++) {
        const l = lights[i];
        G.L[i * 4] = l.sx; G.L[i * 4 + 1] = l.sy; G.L[i * 4 + 2] = l.r; G.L[i * 4 + 3] = l.sq;
        G.Cc[i * 3] = l.c[0] * l.k; G.Cc[i * 3 + 1] = l.c[1] * l.k; G.Cc[i * 3 + 2] = l.c[2] * l.k;
      }
      gl.uniform4fv(G.uL, G.L); gl.uniform3fv(G.uC, G.Cc); gl.uniform1i(G.uN, n);
      gl.uniform3f(G.uK, bloom ? 0.3 : 0, bloom ? 1.25 : 0, bloom ? 1.6 : 0);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    },

    render2D(lights) {
      const o = this.octx, q = BW / W, qy = BH / H;
      o.setTransform(1, 0, 0, 1, 0, 0);
      o.globalCompositeOperation = 'source-over'; o.globalAlpha = 1;
      o.fillStyle = '#000'; o.fillRect(0, 0, BW, BH);
      o.globalCompositeOperation = 'lighter';
      if (this.bloom && this.np) {
        const e = this.ectx, P = this.P;
        e.setTransform(1, 0, 0, 1, 0, 0); e.globalCompositeOperation = 'source-over'; e.globalAlpha = 1;
        e.fillStyle = '#000'; e.fillRect(0, 0, BW, BH);
        e.setTransform(q, 0, 0, qy, 0, 0); e.globalCompositeOperation = 'lighter'; e.lineCap = 'round';
        for (let i = 0; i < this.np; i++) {
          const b = i * 6 * FPV, x1 = P[b + 2], y1 = P[b + 3], x2 = P[b + 4], y2 = P[b + 5], r = P[b + 6], sq = P[b + 7];
          const c = [P[b + 8], P[b + 9], P[b + 10]], k = Math.max(c[0], c[1], c[2]) || 1;
          e.globalAlpha = Math.min(1, k);
          const col = hexOf([c[0] / k, c[1] / k, c[2] / k]);
          if (x1 === x2 && y1 === y2) e.drawImage(TD.Draw.blob(col), x1 - r, y1 - r * sq, r * 2, r * 2 * sq);
          else { e.strokeStyle = col; e.lineWidth = r * 1.1; e.beginPath(); e.moveTo(x1, y1); e.lineTo(x2, y2); e.stroke(); }
        }
        const s = this.sctx;
        s.globalCompositeOperation = 'copy'; s.drawImage(this.emit, 0, 0, BW / 4, BH / 4);
        o.globalAlpha = 1; o.drawImage(this.small, 0, 0, BW, BH); o.drawImage(this.small, -2, -2, BW + 4, BH + 4);
        o.globalAlpha = 0.35; o.drawImage(this.emit, 0, 0);
      }
      o.globalAlpha = 1;
      for (const l of lights) {
        const x = l.sx * q, y = l.sy * qy, r = l.r * q;
        const c = l.c, k = Math.min(1, l.k);
        const g = o.createRadialGradient(0, 0, 0, 0, 0, r);
        const col = (a) => `rgba(${(c[0] * 255) | 0},${(c[1] * 255) | 0},${(c[2] * 255) | 0},${a})`;
        g.addColorStop(0, col(k)); g.addColorStop(0.45, col(k * 0.42)); g.addColorStop(1, col(0));
        o.save(); o.translate(x, y); o.scale(1, l.sq * qy / q); o.fillStyle = g;
        o.beginPath(); o.arc(0, 0, r, 0, Math.PI * 2); o.fill(); o.restore();
      }
    },

    /** Lens the frame under every live shockwave ring (call after units, before top FX). */
    distort(ctx) {
      this.stats.shocks = 0;
      if (!this.on || !this.distortion || !this.shocks.length) return;
      const C = TD.Camera, cv = ctx.canvas, m = ctx.getTransform();
      const ks = Math.hypot(m.a, m.b);
      let n = 0;
      for (let i = this.shocks.length - 1; i >= 0 && n < 5; i--) {
        const s = this.shocks[i];
        if (s.t < 0) continue;
        const k = s.t / s.dur, u = 1 - k;
        const r = s.R * (1 - Math.pow(1 - k, 2.4));
        if (r < 8) continue;
        const band = Math.max(7, s.R * 0.11) * (0.55 + 0.45 * u);
        const c = C.project(s.x, s.y, s.z);
        const dc = m.transformPoint(new DOMPoint(c.sx, c.sy));
        n++;
        const zoomOut = 1 + s.s * u, zoomIn = 1 / (1 + s.s * 0.6 * u);
        ctx.save();
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        const ring = (r0, r1, zoom) => {
          if (r1 <= 1) return;
          ctx.save();
          ctx.beginPath();
          ctx.ellipse(dc.x, dc.y, r1 * ks, r1 * C.ISO * ks, 0, 0, Math.PI * 2);
          ctx.ellipse(dc.x, dc.y, Math.max(0.5, r0 * ks), Math.max(0.5, r0 * C.ISO * ks), 0, 0, Math.PI * 2);
          ctx.clip('evenodd');
          const dw = r1 * 2 * ks, dh = r1 * 2 * C.ISO * ks;
          const sw = dw / zoom, sh = dh / zoom;
          const sx0 = dc.x - sw / 2, sy0 = dc.y - sh / 2, dx0 = dc.x - dw / 2, dy0 = dc.y - dh / 2;
          // clamp the source rect into the canvas (keeps Safari happy) while preserving the lens mapping
          const cx0 = Math.max(0, sx0), cy0 = Math.max(0, sy0), cx1 = Math.min(cv.width, sx0 + sw), cy1 = Math.min(cv.height, sy0 + sh);
          if (cx1 - cx0 > 2 && cy1 - cy0 > 2) {
            const zx = dw / sw, zy = dh / sh;
            try { ctx.drawImage(cv, cx0, cy0, cx1 - cx0, cy1 - cy0, dx0 + (cx0 - sx0) * zx, dy0 + (cy0 - sy0) * zy, (cx1 - cx0) * zx, (cy1 - cy0) * zy); } catch (e) { /* ignore */ }
          }
          ctx.restore();
        };
        ring(r, r + band, zoomOut);                  // compression front pushes pixels outward
        ring(Math.max(1, r - band * 0.9), r, zoomIn); // rarefaction behind pulls them back
        // thin hot rim of the pressure front
        ctx.globalCompositeOperation = 'lighter';
        ctx.globalAlpha = 0.22 * u;
        ctx.strokeStyle = '#fff4dc'; ctx.lineWidth = 1.5 * ks;
        ctx.beginPath(); ctx.ellipse(dc.x, dc.y, (r + band * 0.5) * ks, (r + band * 0.5) * C.ISO * ks, 0, 0, Math.PI * 2); ctx.stroke();
        ctx.restore();
      }
      this.stats.shocks = n;
    },

    /** Nuke chromatic aberration: red/cyan split copies of the frame (screen space, after world). */
    chromaticPass(ctx) {
      if (!this.on || !this.chromatic || this.chroma <= 0.02) return;
      const cv = ctx.canvas, t = this.tmp, x = this.tctx;
      if (t.width !== cv.width || t.height !== cv.height) { t.width = cv.width; t.height = cv.height; }
      const off = Math.round(10 * this.chroma * (cv.width / W));
      const split = (col, dx) => {
        x.globalCompositeOperation = 'copy'; x.globalAlpha = 1; x.drawImage(cv, 0, 0);
        x.globalCompositeOperation = 'multiply'; x.fillStyle = col; x.fillRect(0, 0, t.width, t.height);
        ctx.drawImage(t, dx, 0);
      };
      ctx.save();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = 0.45 * this.chroma;
      split('#ff2a1a', off);
      split('#1ad8ff', -off);
      ctx.restore();
    },
  };

  TD.PostFX = PostFX;
})(window.TD);
