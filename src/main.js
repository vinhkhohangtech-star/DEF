/* =========================================================
   main.js — game loop, state manager, battlefield environment,
   input, skills, economy/combo, red/green energy progression,
   combat helpers and the procedural Web-Audio sound engine.
   ========================================================= */
(function (TD) {
  'use strict';
  const IS_TOUCH = ('ontouchstart' in window) || navigator.maxTouchPoints > 0;
  const { rand, randInt, pick, clamp, dist } = TD.util;
  const D = TD.Draw;
  const PR = TD.Projectiles;

  /* =========================================================
     🧬 MILITARY TECH LAB — permanent progression (localStorage)
     ========================================================= */
  const LAB_KEY = 'def_techlab_v1';
  const LAB_DEFS = [
    { id: 'dmg', icon: '💥', name: 'Sát Thương Gốc', desc: 'Tăng sát thương khởi điểm của Minigun.', fmt: (lv) => `+${lv * 6}% sát thương` },
    { id: 'rate', icon: '⚡', name: 'Tốc Bắn Gốc', desc: 'Tăng tốc độ bắn ban đầu.', fmt: (lv) => `+${lv * 5}% tốc bắn` },
    { id: 'hp', icon: '🛡️', name: 'Máu & Giáp Gốc', desc: 'Tăng độ bền khởi điểm của pháo đài.', fmt: (lv) => `+${lv * 80} HP · +${(lv * 1.5).toFixed(1)}% giáp` },
    { id: 'gold', icon: '🪙', name: 'Quỹ Chiến Tranh', desc: 'Vàng thưởng thêm khi bắt đầu Wave 1.', fmt: (lv) => `+${lv * 50} 🪙` },
    { id: 'cdr', icon: '⏱️', name: 'Giảm Hồi Chiêu', desc: 'Giảm hồi chiêu các kỹ năng [1]–[4].', fmt: (lv) => `-${lv * 4}% hồi chiêu` },
    { id: 'potency', icon: '✨', name: 'Hiệu Lực Kỹ Năng', desc: 'Pháo binh rộng hơn · EMP choáng lâu hơn · Sửa chữa hồi nhiều hơn · Mồi nhử bền hơn.', fmt: (lv) => `+${lv * 8}% vùng nổ · +${(lv * 0.25).toFixed(2)}s EMP · +${lv * 3}% sửa · +${lv * 15}% HP mồi` },
  ];
  const TechLab = {
    MAX: 10, DEFS: LAB_DEFS, points: 0, lv: {}, lastAward: 0,
    load() {
      try { const d = JSON.parse(localStorage.getItem(LAB_KEY) || '{}'); this.points = Math.max(0, +d.points || 0); this.lv = d.lv || {}; } catch (e) { this.points = 0; this.lv = {}; }
      for (const d of LAB_DEFS) this.lv[d.id] = clamp(Math.floor(+this.lv[d.id] || 0), 0, this.MAX);
    },
    save() { try { localStorage.setItem(LAB_KEY, JSON.stringify({ points: this.points, lv: this.lv })); } catch (e) { /* storage blocked */ } },
    cost(id) { return 3 + (this.lv[id] || 0) * 2; },
    spent() { let s = 0; for (const d of LAB_DEFS) for (let i = 0; i < (this.lv[d.id] || 0); i++) s += 3 + i * 2; return s; },
    buy(id) {
      if ((this.lv[id] || 0) >= this.MAX) return false;
      const c = this.cost(id);
      if (this.points < c) return false;
      this.points -= c; this.lv[id] = (this.lv[id] || 0) + 1; this.save(); return true;
    },
    refund() { this.points += this.spent(); for (const d of LAB_DEFS) this.lv[d.id] = 0; this.save(); },
    /** Tech Points from a finished run. */
    award(wave, kills, bosses) {
      const n = Math.max(0, Math.floor(wave * 2 + kills / 20 + bosses * 3));
      this.points += n; this.lastAward = n; this.save(); return n;
    },
    bonus(k) {
      const L = this.lv;
      switch (k) {
        case 'dmg': return (L.dmg || 0) * 0.06;
        case 'rate': return (L.rate || 0) * 0.05;
        case 'hp': return (L.hp || 0) * 80;
        case 'armor': return (L.hp || 0) * 1.5;
        case 'gold': return (L.gold || 0) * 50;
        case 'cdr': return (L.cdr || 0) * 0.04;
        case 'potency': return L.potency || 0;
      }
      return 0;
    },
  };
  TechLab.load();
  TD.TechLab = TechLab;

  /** Damage sources that bypass armor / reveal cloaked units. */
  const PIERCE = new Set(['nuke', 'arty', 'sam', 'fallout', 'rail', 'flame', 'burn', 'gas', 'barbed', 'vortex', 'reflect', 'impact']);
  const AOE = new Set(['mine', 'arty', 'bomb', 'nuke', 'fallout', 'he', 'rocket', 'sam', 'mortar', 'gas', 'vortex', 'flame', 'barbed', 'emp', 'tesla']);

  /* =========================================================
     AudioManager — synthesized modern military SFX.
     Optional overrides: drop shoot.wav / hit.wav / upgrade.wav /
     boss.mp3 / explosion.wav into assets/audio/.
     ========================================================= */
  const AUDIO_FILES = {
    shoot: 'assets/audio/shoot.wav',
    hit: 'assets/audio/hit.wav',
    upgrade: 'assets/audio/upgrade.wav',
    boss: 'assets/audio/boss.mp3',
    explosion: 'assets/audio/explosion.wav',
  };
  const FILE_ALIAS = { mg: 'shoot', hit: 'hit', upgrade: 'upgrade', boss: 'boss', boom_m: 'explosion', boom_l: 'explosion' };
  const THROTTLE = {
    mg: 45, hit: 40, he: 60, boom_s: 60, boom_m: 70, ak: 40, sniper: 80, tank: 90, rocket: 50, zap: 70,
    slash: 70, coin: 45, kill: 40, crit: 70, stomp: 100, intercept: 60, wallbreak: 120, drone: 400, laser: 200, hurt: 90,
    clang: 70, ricochet: 60, flame: 140, uavshot: 60, shield_hit: 60, jam: 500, dig: 300, chute: 150, glitch: 200, c4: 300,
    railgun: 200, railcharge: 300, mortar: 120, gas: 150, gaspop: 120, plane: 1500, bombdrop: 120, erupt: 150, pulse: 200, vortex: 300,
  };

  class AudioManager {
    constructor() { this.ctx = null; this.muted = false; this.volume = 0.5; this.files = {}; this.last = {}; }
    init() {
      if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      this.ctx = new AC();
      this.master = this.ctx.createGain();
      this.master.gain.value = this.muted ? 0 : this.volume;
      const comp = this.ctx.createDynamicsCompressor();
      comp.threshold.value = -16; comp.ratio.value = 6;
      this.master.connect(comp);
      comp.connect(this.ctx.destination);
      const len = this.ctx.sampleRate * 2;
      this.noiseBuf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
      const data = this.noiseBuf.getChannelData(0);
      for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    }
    loadFiles() {
      for (const [key, src] of Object.entries(AUDIO_FILES)) {
        try {
          const a = new Audio();
          a.preload = 'auto';
          a.addEventListener('canplaythrough', () => { this.files[key] = a; }, { once: true });
          a.addEventListener('error', () => { delete this.files[key]; }, { once: true });
          a.src = src;
        } catch (e) { /* no audio element */ }
      }
    }
    toggleMute() {
      this.muted = !this.muted;
      if (this.master) this.master.gain.value = this.muted ? 0 : this.volume;
      return this.muted;
    }
    play(name) {
      if (this.muted) return;
      const now = performance.now();
      const gap = THROTTLE[name] || 25;
      if (this.last[name] && now - this.last[name] < gap) return;
      this.last[name] = now;
      const fk = FILE_ALIAS[name];
      if (fk && this.files[fk]) {
        try { const a = this.files[fk].cloneNode(); a.volume = 0.6; a.play().catch(() => {}); } catch (e) { /* ignore */ }
        return;
      }
      if (!this.ctx) return;
      const fn = SFX[name];
      if (fn) { try { fn(this); } catch (e) { /* ignore audio errors */ } }
    }
    tone({ freq = 440, to = null, dur = 0.15, type = 'sine', vol = 0.3, delay = 0, attack = 0.005 }) {
      const c = this.ctx, t = c.currentTime + delay;
      const o = c.createOscillator(), g = c.createGain();
      o.type = type;
      o.frequency.setValueAtTime(freq, t);
      if (to) o.frequency.exponentialRampToValueAtTime(Math.max(1, to), t + dur);
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(vol, t + attack);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      o.connect(g); g.connect(this.master);
      o.start(t); o.stop(t + dur + 0.03);
    }
    noise({ dur = 0.2, vol = 0.3, filter = 'lowpass', freq = 1200, to = null, delay = 0, q = 1, attack = 0.004 }) {
      const c = this.ctx, t = c.currentTime + delay;
      const src = c.createBufferSource();
      src.buffer = this.noiseBuf;
      const f = c.createBiquadFilter();
      f.type = filter; f.Q.value = q;
      f.frequency.setValueAtTime(freq, t);
      if (to) f.frequency.exponentialRampToValueAtTime(Math.max(10, to), t + dur);
      const g = c.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(vol, t + attack);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      src.connect(f); f.connect(g); g.connect(this.master);
      src.start(t, Math.random() * 1.0);
      src.stop(t + dur + 0.03);
    }
    arp(notes, { type = 'triangle', step = 0.07, dur = 0.16, vol = 0.14, delay = 0 } = {}) {
      notes.forEach((n, i) => this.tone({ freq: n, dur, type, vol, delay: delay + i * step }));
    }
  }

  const SFX = {
    mg: (a) => { a.noise({ dur: 0.07, vol: 0.32, freq: 2600, to: 400 }); a.tone({ freq: 120, to: 50, dur: 0.07, type: 'square', vol: 0.12 }); },
    ak: (a) => { a.noise({ dur: 0.09, vol: 0.18, filter: 'bandpass', freq: 1800, to: 600, q: 0.8 }); a.tone({ freq: 180, to: 70, dur: 0.06, type: 'square', vol: 0.05 }); },
    sniper: (a) => { a.noise({ dur: 0.05, vol: 0.5, filter: 'highpass', freq: 3000 }); a.noise({ dur: 0.5, vol: 0.25, freq: 1400, to: 120, delay: 0.02 }); a.tone({ freq: 900, to: 140, dur: 0.12, type: 'sawtooth', vol: 0.08 }); },
    tank: (a) => { a.noise({ dur: 0.45, vol: 0.55, freq: 900, to: 60 }); a.tone({ freq: 70, to: 30, dur: 0.4, vol: 0.45 }); },
    hit: (a) => a.noise({ dur: 0.04, vol: 0.08, filter: 'bandpass', freq: 2400, q: 2 }),
    he: (a) => { a.noise({ dur: 0.18, vol: 0.25, freq: 1500, to: 150 }); a.tone({ freq: 110, to: 45, dur: 0.15, vol: 0.18 }); },
    crit: (a) => { a.tone({ freq: 1400, to: 600, dur: 0.08, type: 'square', vol: 0.08 }); a.noise({ dur: 0.12, vol: 0.2, freq: 600, to: 80 }); a.tone({ freq: 90, to: 40, dur: 0.14, vol: 0.25 }); },
    boom_s: (a) => { a.noise({ dur: 0.35, vol: 0.4, freq: 1800, to: 90 }); a.tone({ freq: 95, to: 35, dur: 0.3, vol: 0.3 }); },
    boom_m: (a) => { a.noise({ dur: 0.7, vol: 0.65, freq: 2000, to: 60 }); a.tone({ freq: 80, to: 28, dur: 0.6, vol: 0.5 }); },
    boom_l: (a) => {
      a.noise({ dur: 2.6, vol: 0.95, freq: 3000, to: 40, attack: 0.01 });
      a.tone({ freq: 60, to: 18, dur: 2.4, vol: 0.8 });
      a.tone({ freq: 40, to: 15, dur: 3.0, type: 'triangle', vol: 0.5 });
      a.noise({ dur: 2.0, vol: 0.4, freq: 400, to: 60, delay: 0.4 });
    },
    explosion: (a) => SFX.boom_m(a),
    rocket: (a) => { a.noise({ dur: 0.45, vol: 0.22, filter: 'bandpass', freq: 600, to: 2600, q: 1.2 }); a.noise({ dur: 0.1, vol: 0.2, freq: 900 }); },
    sam: (a) => { a.noise({ dur: 1.1, vol: 0.35, filter: 'bandpass', freq: 400, to: 3200, q: 1 }); a.tone({ freq: 120, to: 60, dur: 0.3, vol: 0.2 }); },
    zap: (a) => { a.tone({ freq: 160, to: 1200, dur: 0.12, type: 'sawtooth', vol: 0.1 }); a.noise({ dur: 0.18, vol: 0.2, filter: 'bandpass', freq: 3500, q: 3 }); a.tone({ freq: 60, dur: 0.15, type: 'square', vol: 0.06 }); },
    laser: (a) => { a.tone({ freq: 220, to: 880, dur: 0.9, type: 'sawtooth', vol: 0.07, attack: 0.05 }); a.tone({ freq: 440, to: 1760, dur: 0.9, type: 'sine', vol: 0.06, attack: 0.05 }); },
    jet: (a) => { a.noise({ dur: 2.4, vol: 0.4, filter: 'bandpass', freq: 300, to: 2200, q: 0.7, attack: 0.6 }); a.noise({ dur: 2.0, vol: 0.18, filter: 'highpass', freq: 5000, delay: 0.3, attack: 0.5 }); },
    siren: (a) => { for (let i = 0; i < 3; i++) { a.tone({ freq: 520, to: 980, dur: 0.45, type: 'sawtooth', vol: 0.1, delay: i * 0.5, attack: 0.05 }); } },
    siren_s: (a) => { a.tone({ freq: 700, to: 1100, dur: 0.25, type: 'square', vol: 0.05 }); a.tone({ freq: 1100, to: 700, dur: 0.25, type: 'square', vol: 0.05, delay: 0.25 }); },
    intercept: (a) => { a.tone({ freq: 1800, to: 2600, dur: 0.07, type: 'square', vol: 0.06 }); a.noise({ dur: 0.25, vol: 0.3, freq: 1600, to: 200, delay: 0.02 }); },
    slash: (a) => a.noise({ dur: 0.08, vol: 0.12, filter: 'highpass', freq: 3500 }),
    wallbreak: (a) => { a.noise({ dur: 0.5, vol: 0.4, freq: 700, to: 80 }); a.tone({ freq: 90, to: 40, dur: 0.3, vol: 0.3 }); },
    stomp: (a) => a.tone({ freq: 60, to: 30, dur: 0.2, vol: 0.3 }),
    drone: (a) => { a.tone({ freq: 140, to: 160, dur: 1.2, type: 'sawtooth', vol: 0.04, attack: 0.3 }); },
    emp: (a) => { a.tone({ freq: 2400, to: 60, dur: 0.9, type: 'sawtooth', vol: 0.14 }); a.noise({ dur: 0.9, vol: 0.3, filter: 'bandpass', freq: 3000, to: 200, q: 2 }); },
    kill: (a) => a.tone({ freq: 620, to: 900, dur: 0.05, type: 'triangle', vol: 0.05 }),
    coin: (a) => { a.tone({ freq: 1320, dur: 0.06, type: 'square', vol: 0.04 }); a.tone({ freq: 1760, dur: 0.1, type: 'square', vol: 0.04, delay: 0.05 }); },
    upgrade: (a) => a.arp([392, 523, 659, 784], { type: 'square', step: 0.05, vol: 0.06, dur: 0.1 }),
    deny: (a) => { a.tone({ freq: 180, dur: 0.1, type: 'square', vol: 0.09 }); a.tone({ freq: 140, dur: 0.14, type: 'square', vol: 0.09, delay: 0.11 }); },
    boss: (a) => { SFX.siren(a); a.tone({ freq: 55, dur: 1.4, type: 'sawtooth', vol: 0.16 }); },
    repair: (a) => a.arp([330, 440, 554, 660, 880], { type: 'triangle', step: 0.06, vol: 0.12, dur: 0.18 }),
    decoy: (a) => { a.tone({ freq: 300, to: 1200, dur: 0.3, type: 'sine', vol: 0.12 }); a.tone({ freq: 1200, to: 600, dur: 0.25, type: 'triangle', vol: 0.06, delay: 0.25 }); },
    wave: (a) => { a.tone({ freq: 440, dur: 0.15, type: 'square', vol: 0.06 }); a.tone({ freq: 440, dur: 0.15, type: 'square', vol: 0.06, delay: 0.2 }); a.tone({ freq: 660, dur: 0.35, type: 'square', vol: 0.07, delay: 0.4 }); },
    clear: (a) => a.arp([523, 659, 784, 1047], { type: 'square', step: 0.09, vol: 0.06, dur: 0.2 }),
    card: (a) => a.arp([784, 988, 1175, 1568], { type: 'sine', step: 0.05, vol: 0.12 }),
    tierup: (a) => { a.arp([262, 330, 392, 523, 659, 784], { type: 'sawtooth', step: 0.08, vol: 0.07, dur: 0.25 }); a.tone({ freq: 65, to: 40, dur: 1.0, vol: 0.3 }); },
    combo: (a) => a.tone({ freq: 880, to: 1760, dur: 0.15, type: 'square', vol: 0.06 }),
    click: (a) => a.tone({ freq: 900, dur: 0.03, type: 'square', vol: 0.05 }),
    gameover: (a) => a.arp([392, 330, 262, 196], { type: 'sawtooth', step: 0.28, dur: 0.35, vol: 0.1 }),
    clang: (a) => { a.tone({ freq: 1900, to: 1500, dur: 0.12, type: 'square', vol: 0.05 }); a.tone({ freq: 2650, dur: 0.18, type: 'sine', vol: 0.05 }); a.noise({ dur: 0.05, vol: 0.12, filter: 'highpass', freq: 4000 }); },
    ricochet: (a) => { a.tone({ freq: 3200, to: 900, dur: 0.16, type: 'sine', vol: 0.06 }); },
    flame: (a) => { a.noise({ dur: 0.22, vol: 0.18, filter: 'bandpass', freq: 700, q: 0.6 }); a.noise({ dur: 0.18, vol: 0.06, filter: 'highpass', freq: 3000 }); },
    uav: (a) => { a.tone({ freq: 210, to: 240, dur: 1.0, type: 'sawtooth', vol: 0.04, attack: 0.2 }); a.tone({ freq: 420, to: 470, dur: 1.0, type: 'square', vol: 0.015, attack: 0.2 }); },
    uavshot: (a) => { a.tone({ freq: 1600, to: 500, dur: 0.06, type: 'square', vol: 0.035 }); a.noise({ dur: 0.04, vol: 0.06, filter: 'highpass', freq: 3000 }); },
    railcharge: (a) => { a.tone({ freq: 300, to: 2400, dur: 0.65, type: 'sawtooth', vol: 0.05, attack: 0.1 }); },
    railgun: (a) => { a.noise({ dur: 0.06, vol: 0.6, filter: 'highpass', freq: 2500 }); a.tone({ freq: 3000, to: 120, dur: 0.35, type: 'sawtooth', vol: 0.14 }); a.noise({ dur: 0.9, vol: 0.35, freq: 1200, to: 60, delay: 0.03 }); a.tone({ freq: 55, to: 30, dur: 0.6, vol: 0.4 }); },
    shield_up: (a) => { a.tone({ freq: 180, to: 720, dur: 0.5, type: 'sine', vol: 0.12 }); a.tone({ freq: 360, to: 1440, dur: 0.5, type: 'triangle', vol: 0.05 }); },
    shield_hit: (a) => { a.tone({ freq: 900, to: 400, dur: 0.12, type: 'sine', vol: 0.08 }); a.noise({ dur: 0.08, vol: 0.08, filter: 'bandpass', freq: 2500, q: 4 }); },
    shield_down: (a) => { a.tone({ freq: 800, to: 90, dur: 0.6, type: 'sawtooth', vol: 0.08 }); a.noise({ dur: 0.5, vol: 0.2, filter: 'highpass', freq: 2000 }); },
    jam: (a) => { a.noise({ dur: 0.35, vol: 0.05, filter: 'bandpass', freq: 1800, q: 6 }); a.tone({ freq: 60, dur: 0.3, type: 'square', vol: 0.02 }); },
    plane: (a) => { a.tone({ freq: 70, to: 85, dur: 3.5, type: 'sawtooth', vol: 0.07, attack: 1.0 }); a.noise({ dur: 3.5, vol: 0.12, filter: 'lowpass', freq: 400, attack: 1.0 }); },
    bombdrop: (a) => { a.tone({ freq: 1400, to: 300, dur: 0.9, type: 'sine', vol: 0.05 }); },
    dig: (a) => { a.noise({ dur: 0.4, vol: 0.12, filter: 'lowpass', freq: 220 }); },
    erupt: (a) => { a.noise({ dur: 0.6, vol: 0.45, freq: 600, to: 60 }); a.tone({ freq: 70, to: 30, dur: 0.4, vol: 0.35 }); },
    chute: (a) => { a.noise({ dur: 0.3, vol: 0.12, filter: 'bandpass', freq: 500, to: 1400, q: 1 }); },
    glitch: (a) => { for (let i = 0; i < 4; i++) a.tone({ freq: 200 + Math.random() * 2400, dur: 0.04, type: 'square', vol: 0.05, delay: i * 0.05 }); },
    c4: (a) => { a.tone({ freq: 2200, dur: 0.06, type: 'square', vol: 0.06 }); a.tone({ freq: 2200, dur: 0.06, type: 'square', vol: 0.06, delay: 0.12 }); },
    mortar: (a) => { a.tone({ freq: 140, to: 50, dur: 0.18, vol: 0.3 }); a.noise({ dur: 0.15, vol: 0.2, freq: 900, to: 200 }); },
    gas: (a) => { a.noise({ dur: 0.9, vol: 0.16, filter: 'highpass', freq: 2200, attack: 0.05 }); a.tone({ freq: 90, to: 40, dur: 0.2, vol: 0.2 }); },
    gaspop: (a) => { a.noise({ dur: 0.35, vol: 0.2, filter: 'bandpass', freq: 900, q: 1.5 }); },
    pulse: (a) => { a.tone({ freq: 120, to: 1800, dur: 0.25, type: 'sawtooth', vol: 0.1 }); a.noise({ dur: 0.4, vol: 0.3, filter: 'bandpass', freq: 3000, to: 400, q: 2 }); },
    vortex: (a) => { a.tone({ freq: 900, to: 60, dur: 1.2, type: 'sine', vol: 0.12 }); a.noise({ dur: 1.2, vol: 0.12, filter: 'bandpass', freq: 2000, to: 200, q: 2 }); },
  };

  /* =========================================================
     Game
     ========================================================= */
  /* Logical view. Landscape = 1600×900 (unchanged). 📱 v11 portrait: the battlefield is the top ~55 %
     of a tall screen → the logical view becomes PORT_W wide and as tall as that area's aspect needs. */
  const LAND_W = 1600, LAND_H = 900, LAND_CY = 470;
  const PORT_W = 1300;            // ±650 world units visible across → Katyusha (range 610) stays on screen
  const PORT_BF = 0.55;           // share of the screen height given to the battlefield
  const PORTRAIT_MQ = window.matchMedia ? window.matchMedia('(orientation: portrait)') : null;
  let W = LAND_W, H = LAND_H;
  /** Centre of the landing pad in assets/images/environment/Map.webp (1024×572). */
  const MAP_PAD = { x: 512, y: 276 };

  class Game {
    constructor() {
      this.canvas = document.getElementById('canvas');
      this.ctx = this.canvas.getContext('2d');
      this.W = W; this.H = H;
      this.ISO = 0.6;
      this.CX = W / 2; this.CY = LAND_CY;
      this.portrait = false; this.textScale = 1;
      this.ARENA = { hw: 735, hh: 650 };
      TD.Camera.attach(this);          // 📐 unified 2.5D projection
      TD.PostFX.init();                // 💡 lights • bloom • refraction
      this.renderScale = 1;
      this.time = 0;
      this.speed = 1;
      this.state = 'menu';
      this.mouse = { x: W / 2, y: H / 2, inside: false };
      this.aimSkill = -1;          // 📱 skill waiting for a tap on the map
      this.touch = false;          // last input came from a finger
      this.shakeAmt = 0; this.shakeX = 0; this.shakeY = 0; this.shakeR = 0; this.trauma = 0;
      this.whiteFlash = 0; this.popFlash = 0; this.popFlashT = 0;
      this.hitStop = 0; this.hitStopCd = 0; this.blastAcc = 0;
      this.flyovers = []; this.husks = []; this.charges = [];
      this.jamFactor = 0;

      this.audio = new AudioManager();
      this.particles = new TD.ParticleSystem(this);
      this.enemies = [];
      this.projectiles = [];
      this.rockets = [];
      this.tower = new TD.Tower(this);
      this.ui = new TD.UI(this);

      this.buildGaps();
      this.bindInput();
      this.resize();
      window.addEventListener('resize', () => this.resize());

      this.reset();
      this.last = performance.now();
      requestAnimationFrame((t) => this.loop(t));
    }

    project(x, y, z = 0) { return TD.Camera.project(x, y, z); }
    unproject(sx, sy) { return TD.Camera.unproject(sx, sy); }

    resize() {
      const vw = window.innerWidth, vh = window.innerHeight;
      const portrait = PORTRAIT_MQ ? PORTRAIT_MQ.matches : vh > vw;
      const gameEl = document.getElementById('game');
      let s;
      if (portrait) {
        // 📱 split screen: battlefield on top (--bf px), HP strip + docked shop below (CSS)
        const bf = Math.round(vh * PORT_BF);
        gameEl.style.setProperty('--bf', bf + 'px');
        gameEl.style.setProperty('--s', 1);
        this.setView(PORT_W, Math.max(LAND_H, Math.round(PORT_W * bf / Math.max(1, vw))), true);
        s = vw / W;                                  // CSS px per logical unit
      } else {
        this.setView(LAND_W, LAND_H, false);
        s = Math.min(vw / W, vh / H) * (this.touch || IS_TOUCH ? 1 : 0.98);
        gameEl.style.setProperty('--s', s);
      }
      const k = clamp(s * (window.devicePixelRatio || 1), 0.75, 2.2);
      this.renderScale = k;
      this.canvas.width = Math.round(W * k);
      this.canvas.height = Math.round(H * k);
    }

    /** v11: switch the logical view (landscape 1600×900 ↔ portrait PORT_W×h). Rebuilds the camera,
        PostFX overlay and the pre-rendered background only when something actually changed. */
    setView(w, h, portrait) {
      document.body.classList.toggle('portrait', portrait);
      if (w === W && h === H && portrait === this.portrait) return;
      W = w; H = h; this.W = W; this.H = H;
      const modeChanged = portrait !== this.portrait;
      this.portrait = portrait;
      this.CX = W / 2;
      this.CY = portrait ? Math.round(H * 0.5) : LAND_CY;
      this.textScale = portrait ? 1.6 : 1;           // floating numbers stay readable on a narrow phone
      TD.Camera.attach(this);
      TD.PostFX.setView(W, H);
      if (this.bg) { this.bg = this.makeBackground(); this.bgScale = this.bg.width / W; this.vignette = this.makeVignette(); }
      if (modeChanged && this.ui && this.ui.setPortrait) this.ui.setPortrait(portrait);
    }

    /* ---------------- environment ---------------- */
    buildGaps() {
      const { hw, hh } = this.ARENA;
      const raw = [
        [-450, -hh, 0, -1], [450, -hh, 0, -1],
        [-hw, -170, -1, 0], [-hw, 280, -1, 0],
        [hw, -170, 1, 0], [hw, 280, 1, 0],
        [-430, hh, 0, 1], [430, hh, 0, 1],
      ];
      this.gaps = raw.map(([x, y, ox, oy]) => ({ x, y, ox, oy, sx: x + ox * 110, sy: y + oy * 110 }));
    }

    buildEnvironment() {
      const { hw, hh } = this.ARENA;
      this.props = [];
      const nearGap = (x, y, r) => this.gaps.some((g) => Math.hypot(g.x - x, g.y - y) < r);
      const addRow = (x0, y0, x1, y1, offset, spacing, gapR, kinds) => {
        const len = Math.hypot(x1 - x0, y1 - y0);
        const n = Math.floor(len / spacing);
        for (let i = 0; i <= n; i++) {
          const t = i / n;
          const x = x0 + (x1 - x0) * t + rand(-8, 8) + offset.x;
          const y = y0 + (y1 - y0) * t + rand(-8, 8) + offset.y;
          if (nearGap(x - offset.x, y - offset.y, gapR)) continue;
          this.props.push({ x, y, v: pick(kinds), s: rand(0.9, 1.12) });
        }
      };
      const rows = [
        { off: 22, sp: 58, gap: 100, kinds: [0, 0, 0, 2] },     // hesco line
        { off: 92, sp: 66, gap: 75, kinds: [1, 1, 3, 4] },      // pines, sandbags, drums
        { off: 165, sp: 70, gap: 45, kinds: [1, 1, 1, 0] },
      ];
      for (const r of rows) {
        addRow(-hw - 120, -hh, hw + 120, -hh, { x: 0, y: -r.off }, r.sp, r.gap, r.kinds);
        if (r.off < 150) addRow(-hw - 120, hh, hw + 120, hh, { x: 0, y: 45 + r.off * 0.8 }, r.sp, r.gap + 15, r.kinds);
        addRow(-hw, -hh, -hw, hh, { x: -r.off, y: 0 }, r.sp * 0.8, r.gap, r.kinds);
        addRow(hw, -hh, hw, hh, { x: r.off, y: 0 }, r.sp * 0.8, r.gap, r.kinds);
      }
      // scattered cover inside the arena (off the roads)
      this.cover = [];
      const segDist = (px, py, g) => {
        const ax = g.x, ay = g.y;
        const t = clamp(((px - ax) * -ax + (py - ay) * -ay) / (ax * ax + ay * ay), 0, 1);
        return Math.hypot(px - (ax - ax * t), py - (ay - ay * t));
      };
      let tries = 0;
      while (this.cover.length < 13 && tries++ < 600) {
        const x = rand(-hw + 70, hw - 70), y = rand(-hh + 70, hh - 70);
        if (Math.hypot(x, y) < 300) continue;
        if (this.gaps.some((g) => segDist(x, y, g) < 90)) continue;
        if (this.cover.some((r) => Math.hypot(r.x - x, r.y - y) < 130)) continue;
        this.cover.push({ x, y, s: rand(0.85, 1.15), v: randInt(0, 3) });
      }
      this.propSprites = [0, 1, 2, 3, 4].map((v) => this.makePropSprite(v));
      this.coverSprites = [0, 1, 2, 3].map((v) => this.makeCoverSprite(v));
      // 🧊 3D-model sprites for props / cover (several baked headings → variety)
      const S3 = TD.S3, P3 = { 0: 'hesco', 1: 'pine', 2: 'jersey_barrier', 4: 'oil_drum' }, C3 = { 0: 'ammo_crate', 1: 'car_wreck', 2: 'tire_stack' };
      this.props.forEach((p, i) => { const id = P3[p.v]; if (id && S3.has(id)) p.spr = S3.cell(id, i % S3.count(id)); });
      this.cover.forEach((c, i) => { const id = C3[c.v]; if (id && S3.has(id)) c.spr = S3.cell(id, i % S3.count(id)); });
      this.bg = this.makeBackground();
      this.bgScale = this.bg.width / W;
      this.vignette = this.makeVignette();
    }

    makeCanvas(w, h, scale = 1.5) {
      const c = document.createElement('canvas');
      c.width = Math.ceil(w * scale); c.height = Math.ceil(h * scale);
      const x = c.getContext('2d');
      x.scale(scale, scale);
      return { c, x };
    }

    /** Border props. Anchor: bottom-center at (70, 150). */
    makePropSprite(v) {
      const img = TD.Assets.get('prop_border');
      if (img && v === 0) return { img, w: 110, h: 110 * (img.naturalHeight / img.naturalWidth), ay: 1 };
      const { c, x } = this.makeCanvas(140, 170);
      const cx = 70, by = 150;
      D.shadow(x, cx + 8, by, 44, 12, 0.35);
      if (v === 0) {           // HESCO barrier block
        const w = 52, h = 46;
        x.fillStyle = '#b39b6a'; x.fillRect(cx - w / 2, by - h, w, h);
        x.fillStyle = '#9a8456'; x.fillRect(cx - w / 2, by - h, w, 6);
        x.fillStyle = '#c9b585';
        x.beginPath(); x.moveTo(cx - w / 2, by - h); x.lineTo(cx - w / 2 + 10, by - h - 10); x.lineTo(cx + w / 2 + 10, by - h - 10); x.lineTo(cx + w / 2, by - h); x.fill();
        x.fillStyle = '#8a7348'; x.beginPath(); x.moveTo(cx + w / 2, by); x.lineTo(cx + w / 2 + 10, by - 10); x.lineTo(cx + w / 2 + 10, by - h - 10); x.lineTo(cx + w / 2, by - h); x.fill();
        x.strokeStyle = 'rgba(60,55,45,0.55)'; x.lineWidth = 1;
        for (let i = 0; i <= 6; i++) { x.beginPath(); x.moveTo(cx - w / 2 + (i * w) / 6, by - h); x.lineTo(cx - w / 2 + (i * w) / 6, by); x.stroke(); }
        for (let j = 0; j <= 5; j++) { x.beginPath(); x.moveTo(cx - w / 2, by - h + (j * h) / 5); x.lineTo(cx + w / 2, by - h + (j * h) / 5); x.stroke(); }
        // barbed wire on top
        x.strokeStyle = '#5a5a58'; x.lineWidth = 1.2;
        for (let i = 0; i < 5; i++) { x.beginPath(); x.ellipse(cx - 20 + i * 11, by - h - 12, 6, 4, 0, 0, Math.PI * 2); x.stroke(); }
      } else if (v === 1) {    // dark pine
        x.fillStyle = '#4b3826'; x.fillRect(cx - 5, by - 34, 10, 34);
        for (let i = 0; i < 4; i++) {
          const yy = by - 26 - i * 26, w = 46 - i * 9;
          x.fillStyle = i % 2 ? '#2f4a2a' : '#365530';
          x.beginPath(); x.moveTo(cx - w, yy); x.lineTo(cx, yy - 52); x.lineTo(cx + w, yy); x.closePath(); x.fill();
          x.fillStyle = 'rgba(0,0,0,0.18)';
          x.beginPath(); x.moveTo(cx, yy - 52); x.lineTo(cx + w, yy); x.lineTo(cx + 4, yy); x.closePath(); x.fill();
        }
      } else if (v === 2) {    // concrete jersey barriers
        for (const dx of [-26, 18]) {
          x.fillStyle = '#a5a49e';
          x.beginPath(); x.moveTo(cx + dx - 20, by); x.lineTo(cx + dx - 14, by - 12); x.lineTo(cx + dx - 8, by - 34); x.lineTo(cx + dx + 8, by - 34); x.lineTo(cx + dx + 14, by - 12); x.lineTo(cx + dx + 20, by); x.closePath(); x.fill();
          x.fillStyle = '#8a8983'; x.fillRect(cx + dx + 2, by - 34, 6, 34);
          x.fillStyle = '#e0b31c'; x.fillRect(cx + dx - 16, by - 9, 32, 4);
        }
      } else if (v === 3) {    // sandbag wall
        for (let r = 0; r < 3; r++) for (let i = 0; i < 4 - r; i++) {
          const bx = cx - 30 + i * 20 + r * 10, byy = by - 8 - r * 11;
          D.ellipse(x, bx, byy, 12, 6.5, r % 2 ? '#b8a06c' : '#a88f5c', '#5c4b2a', 1.2);
        }
      } else {                 // oil drums
        for (const [dx, col] of [[-16, '#3f5a3a'], [6, '#7a2d1f'], [24, '#3f5a3a']]) {
          x.fillStyle = col; x.fillRect(cx + dx - 9, by - 30, 18, 30);
          D.ellipse(x, cx + dx, by - 30, 9, 4, D.shade(col, 0.15), null, 0);
          x.fillStyle = 'rgba(0,0,0,0.25)'; x.fillRect(cx + dx - 9, by - 20, 18, 2); x.fillRect(cx + dx - 9, by - 10, 18, 2);
        }
      }
      return { img: c, w: 140, h: 170, ay: 150 / 170 };
    }

    /** Arena cover: crates, wrecked car, tire stack, sandbag nest. Anchor (60, 70). */
    makeCoverSprite(v) {
      const img = TD.Assets.get('crate');
      if (img && v === 0) return { img, w: 70, h: 70 * (img.naturalHeight / img.naturalWidth), ay: 1 };
      const { c, x } = this.makeCanvas(120, 80);
      const cx = 60, by = 70;
      D.shadow(x, cx + 6, by - 2, 40, 10, 0.32);
      if (v === 0) {
        for (const [dx, dy, s] of [[-16, 0, 26], [12, 0, 24], [-2, -24, 22]]) {
          x.fillStyle = '#7d6a3e'; x.fillRect(cx + dx - s / 2, by + dy - s, s, s);
          x.strokeStyle = '#4e4124'; x.lineWidth = 2; x.strokeRect(cx + dx - s / 2 + 1, by + dy - s + 1, s - 2, s - 2);
          x.beginPath(); x.moveTo(cx + dx - s / 2, by + dy - s); x.lineTo(cx + dx + s / 2, by + dy); x.stroke();
          x.fillStyle = '#d8c070'; x.font = '700 7px sans-serif'; x.fillText('AMMO', cx + dx - 10, by + dy - s / 2);
        }
      } else if (v === 1) {    // burned car wreck
        x.fillStyle = '#2a2826';
        x.beginPath(); x.moveTo(cx - 40, by - 8); x.lineTo(cx - 36, by - 22); x.lineTo(cx - 16, by - 26); x.lineTo(cx - 6, by - 40); x.lineTo(cx + 18, by - 40); x.lineTo(cx + 28, by - 26); x.lineTo(cx + 40, by - 22); x.lineTo(cx + 40, by - 8); x.closePath(); x.fill();
        x.fillStyle = '#4a3a2a'; x.fillRect(cx - 4, by - 37, 18, 10);
        x.fillStyle = '#5a3a20'; x.fillRect(cx - 30, by - 20, 20, 4);
        for (const wx of [-24, 24]) D.circle(x, cx + wx, by - 8, 7, '#111', null, 0);
      } else if (v === 2) {    // tire stack
        for (const [dx, dy] of [[-12, 0], [12, 0], [0, -10], [-12, -8], [12, -8]]) {
          D.ellipse(x, cx + dx, by - 8 + dy, 12, 6, '#1d1d1c', null, 0);
          D.ellipse(x, cx + dx, by - 10 + dy, 6, 3, '#3a3a38', null, 0);
        }
      } else {                 // sandbag MG nest (empty)
        for (let i = 0; i < 7; i++) {
          const a = Math.PI + (i / 6) * Math.PI;
          D.ellipse(x, cx + Math.cos(a) * 30, by - 10 + Math.sin(a) * 12, 11, 6, i % 2 ? '#b8a06c' : '#a88f5c', '#5c4b2a', 1);
        }
        for (let i = 0; i < 7; i++) {
          const a = (i / 6) * Math.PI;
          D.ellipse(x, cx + Math.cos(a) * 30, by - 10 + Math.sin(a) * 12, 11, 6, i % 2 ? '#b8a06c' : '#a88f5c', '#5c4b2a', 1);
        }
      }
      return { img: c, w: 120, h: 80, ay: 70 / 80 };
    }

    /** Pre-rendered static battlefield: dirt, roads from breaches, central pad. */
    makeBackground() {
      const { c, x } = this.makeCanvas(W, H, 1.5);
      // 🗺️ Map.webp: painted battlefield. Its landing pad (MAP_PAD, image px) is placed on the
      // fortress at (CX, CY) and the image is scaled just enough to cover the whole screen.
      const map = TD.Assets.get('map');
      if (map) {
        const iw = map.naturalWidth, ih = map.naturalHeight;
        const pc = iw === 1024 && ih === 572 ? MAP_PAD : { x: iw / 2, y: ih * 0.48 };
        // scale is ALWAYS the landscape one (pad ↔ tower size stays identical in both orientations)
        const s = Math.max((LAND_W / 2) / pc.x, (LAND_W / 2) / (iw - pc.x), LAND_CY / pc.y, (LAND_H - LAND_CY) / (ih - pc.y)) * 1.03;
        x.fillStyle = '#4a4436'; x.fillRect(0, 0, W, H);
        const ox = this.CX - pc.x * s, oy = this.CY - pc.y * s, dw = iw * s, dh = ih * s;
        // 📱 a taller view than the map → continue it with mirrored copies (seamless edges)
        for (let j = -3; j <= 3; j++) for (let i = -2; i <= 2; i++) {
          const x0 = ox + i * dw, y0 = oy + j * dh;
          if (x0 > W || y0 > H || x0 + dw < 0 || y0 + dh < 0) continue;
          const fx = i & 1, fy = j & 1;
          x.save();
          x.translate(x0 + (fx ? dw : 0), y0 + (fy ? dh : 0));
          x.scale(fx ? -1 : 1, fy ? -1 : 1);
          x.drawImage(map, 0, 0, dw, dh);
          x.restore();
          if (i || j) { x.fillStyle = 'rgba(20,24,12,0.22)'; x.fillRect(x0, y0, dw, dh); }   // far field a touch darker
        }
        return c;
      }
      const grd = x.createLinearGradient(0, 0, 0, H);
      grd.addColorStop(0, '#5d6340'); grd.addColorStop(0.5, '#6d7148'); grd.addColorStop(1, '#5a5f3c');
      x.fillStyle = grd; x.fillRect(0, 0, W, H);
      const tile = TD.Assets.get('ground_tile');
      if (tile) {
        x.fillStyle = x.createPattern(tile, 'repeat');
        x.fillRect(0, 0, W, H);
      } else {
        for (let i = 0; i < 320; i++) {
          x.fillStyle = Math.random() < 0.5 ? 'rgba(160,140,90,0.08)' : 'rgba(30,40,15,0.09)';
          x.beginPath(); x.ellipse(rand(0, W), rand(0, H), rand(30, 110), rand(14, 50), rand(0, 3), 0, Math.PI * 2); x.fill();
        }
        for (let i = 0; i < 1600; i++) {
          x.fillStyle = Math.random() < 0.5 ? 'rgba(40,45,25,0.35)' : 'rgba(170,160,120,0.25)';
          x.fillRect(rand(0, W), rand(0, H), rand(1, 2.5), rand(1, 2));
        }
        x.strokeStyle = 'rgba(60,75,35,0.55)'; x.lineWidth = 1.5; x.lineCap = 'round';
        for (let i = 0; i < 380; i++) {
          const gx = rand(0, W), gy = rand(0, H);
          x.beginPath(); x.moveTo(gx - 3, gy - 5); x.lineTo(gx, gy); x.lineTo(gx + 3, gy - 6); x.stroke();
        }
        // old craters
        for (let i = 0; i < 9; i++) {
          const p = this.project(rand(-650, 650), rand(-580, 580));
          if (Math.hypot(p.x - W / 2, (p.y - this.CY) / this.ISO) < 260) continue;
          const r = rand(18, 40);
          x.fillStyle = 'rgba(30,25,15,0.4)'; x.beginPath(); x.ellipse(p.x, p.y, r, r * 0.6, 0, 0, Math.PI * 2); x.fill();
          x.strokeStyle = 'rgba(150,130,90,0.35)'; x.lineWidth = 3; x.beginPath(); x.ellipse(p.x, p.y - 2, r + 4, r * 0.6 + 2, 0, Math.PI, Math.PI * 2); x.stroke();
        }
      }
      // darker outer zone
      const { hw, hh } = this.ARENA;
      const tl = this.project(-hw, -hh), br = this.project(hw, hh);
      x.save();
      x.fillStyle = 'rgba(25,30,15,0.35)';
      x.beginPath(); x.rect(0, 0, W, H);
      D.roundRect(x, tl.x + 10, tl.y + 10, br.x - tl.x - 20, br.y - tl.y - 20, 50);
      x.fill('evenodd');
      x.restore();

      // asphalt roads from every breach to the base
      const pathPts = this.gaps.map((g) => {
        const pts = [];
        const mx = g.x * 0.5 + (g.oy !== 0 ? (g.x > 0 ? -60 : 60) : 0);
        const my = g.y * 0.5 + (g.ox !== 0 ? (g.y > 0 ? -50 : 50) : 0);
        for (let i = 0; i <= 24; i++) {
          const t = i / 24;
          const px = (1 - t) * (1 - t) * g.sx + 2 * (1 - t) * t * mx;
          const py = (1 - t) * (1 - t) * g.sy + 2 * (1 - t) * t * my;
          pts.push(this.project(px, py));
        }
        return pts;
      });
      const strokePath = (w, col, dash) => {
        x.strokeStyle = col; x.lineWidth = w; x.lineCap = 'round'; x.lineJoin = 'round';
        x.setLineDash(dash || []);
        for (const pts of pathPts) { x.beginPath(); x.moveTo(pts[0].x, pts[0].y); for (const p of pts) x.lineTo(p.x, p.y); x.stroke(); }
        x.setLineDash([]);
      };
      strokePath(70, '#8b7d5a');
      strokePath(58, '#4a4a46');
      strokePath(54, '#55554f');
      strokePath(2.5, 'rgba(230,190,60,0.7)', [18, 16]);
      // tire tracks & cracks
      x.strokeStyle = 'rgba(25,25,22,0.35)'; x.lineWidth = 2;
      for (const pts of pathPts) {
        for (const off of [-12, 12]) {
          x.beginPath();
          pts.forEach((p, i) => (i ? x.lineTo(p.x + off * 0.3, p.y + off) : x.moveTo(p.x + off * 0.3, p.y + off)));
          x.stroke();
        }
      }
      x.fillStyle = 'rgba(20,20,18,0.4)';
      for (const pts of pathPts) for (let i = 0; i < 18; i++) {
        const p = pick(pts);
        x.fillRect(p.x + rand(-20, 20), p.y + rand(-12, 12), rand(2, 7), 1.5);
      }

      // central concrete pad with hazard ring & grid
      const o = this.project(0, 0);
      D.ellipse(x, o.x, o.y + 6, 210, 210 * this.ISO, '#3f413c', null, 0);
      D.ellipse(x, o.x, o.y, 204, 204 * this.ISO, '#8d8e86', null, 0);
      x.save();
      x.beginPath(); x.ellipse(o.x, o.y, 204, 204 * this.ISO, 0, 0, Math.PI * 2); x.clip();
      x.strokeStyle = 'rgba(40,40,36,0.35)'; x.lineWidth = 1.5;
      for (let gx = -220; gx <= 220; gx += 40) { const a = this.project(gx, -220), b = this.project(gx, 220); x.beginPath(); x.moveTo(a.x, a.y); x.lineTo(b.x, b.y); x.stroke(); }
      for (let gy = -220; gy <= 220; gy += 40) { const a = this.project(-220, gy), b = this.project(220, gy); x.beginPath(); x.moveTo(a.x, a.y); x.lineTo(b.x, b.y); x.stroke(); }
      for (let i = 0; i < 40; i++) { x.fillStyle = 'rgba(30,30,28,0.18)'; x.beginPath(); x.ellipse(o.x + rand(-180, 180), o.y + rand(-100, 100), rand(4, 18), rand(2, 8), 0, 0, Math.PI * 2); x.fill(); }
      x.restore();
      x.lineWidth = 9;
      for (let i = 0; i < 36; i++) {
        x.strokeStyle = i % 2 ? '#1c1c1a' : '#e0b31c';
        const a0 = (i / 36) * Math.PI * 2, a1 = ((i + 1) / 36) * Math.PI * 2;
        x.beginPath(); x.ellipse(o.x, o.y, 196, 196 * this.ISO, 0, a0, a1); x.stroke();
      }
      return c;
    }

    makeVignette() {
      const { c, x } = this.makeCanvas(W, H, 0.5);
      const g = x.createRadialGradient(W / 2, H / 2, H * 0.42, W / 2, H / 2, H * 1.0);
      g.addColorStop(0, 'rgba(0,0,0,0)');
      g.addColorStop(1, 'rgba(5,8,4,0.55)');
      x.fillStyle = g; x.fillRect(0, 0, W, H);
      return c;
    }

    /* ---------------- state management ---------------- */
    reset() {
      this.tower = new TD.Tower(this);
      this.enemies = [];
      this.projectiles = [];
      this.rockets = [];
      this.flyovers = []; this.husks = []; this.charges = [];
      this.jamFactor = 0; this.trauma = 0; this.hitStop = 0; this.blastAcc = 0;
      this.bossKills = 0;
      this.particles.clear();
      this.spawner = new TD.WaveSpawner(this);
      this.gold = 150 + TechLab.bonus('gold');
      this.goldEarned = 0;
      this.score = 0;
      this.kills = 0;
      this.wave = 0;
      this.waveActive = false;
      this.intermission = 0;
      this.combo = 0; this.comboTimer = 0; this.maxCombo = 0;
      this.comboWindow = 2.2;
      this.redEnergy = 0; this.greenEnergy = 0; this.drafts = 0;
      this.pending = [];
      this.choiceDelay = 0;
      this.decoy = null;
      this.empFx = 0;
      this.whiteFlash = 0;
      TD.PostFX.reset();
      this.gameOverT = 0;
      this.skills = TD.SKILLS.map((s) => ({ ...s, t: 0, maxT: s.cd * this.cdrMult }));
      this.ui.reset();
    }

    get cdrMult() { return Math.max(0.5, 1 - TechLab.bonus('cdr')); }
    bestWave() { try { return +localStorage.getItem('def_best_wave') || 0; } catch (e) { return 0; } }

    startGame() {
      this.audio.init();
      this.audio.play('click');
      this.ui.hideAllOverlays();
      this.reset();
      this.state = 'playing';
      this.intermission = 3;
      this.ui.banner('SẴN SÀNG CHIẾN ĐẤU!', 'Giữ vững pháo đài tác chiến', '');
    }

    togglePause(force) {
      if (this.state !== 'playing' && this.state !== 'paused') return;
      const pause = force != null ? force : this.state === 'playing';
      this.state = pause ? 'paused' : 'playing';
      this.ui.showPause(pause);
      this.audio.play('click');
    }

    startWave(n) {
      this.wave = n;
      this.spawner.start(n);
      this.waveActive = true;
      const boss = n % 5 === 0;
      const intro = {
        2: '🔫 Lính AK xuất hiện', 3: '🏍️ Xe máy cảm tử!', 4: '🎯 Cẩn thận bắn tỉa', 5: '🛩️ Drone cảm tử trên trời',
        6: '🛡️ Xe tăng + 🪂 Lính dù đổ bộ sân trong!', 7: '🚀 Katyusha + 🚑 Xe cứu thương hồi máu', 8: '🚜 Xe ủi — mũi thép chặn 75% đạn chính diện!',
        9: '⛏️ Công binh đào hầm — chỉ chấn động mới trúng', 11: '📡 Xe gây nhiễu — tầm bắn giảm!', 12: '🛸 Pháo đài bay ném bom rải thảm',
      }[n] || (n === 10 ? '' : null);
      if (n === 10) { this.ui.banner('WAVE 10', '⚠️ Siêu Tăng + 🥷 Đặc công tàng hình mang C4!', ''); this.audio.play('wave'); return; }
      const total = this.spawner.remaining;
      this.ui.banner(`WAVE ${n}`, boss ? '⚠️ Wave Siêu Tăng!' : intro || `${total} mục tiêu địch`, '');
      this.audio.play('wave');
    }

    skipIntermission() {
      if (this.state !== 'playing' || this.intermission <= 0) return;
      const bonus = Math.ceil(this.intermission * 3);
      if (this.wave > 0 && bonus > 0) { this.addGold(bonus); this.ui.float(0, 0, 240, `+🪙${bonus} sớm!`, 'gold'); }
      this.intermission = 0;
      this.startWave(this.wave + 1);
    }

    onWaveClear() {
      this.waveActive = false;
      const bonus = 15 + this.wave * 6;
      this.addGold(bonus);
      this.ui.banner('KHU VỰC AN TOÀN', `+${bonus} 🪙 thưởng wave`, 'clear');
      this.particles.confetti(0, 0, 200, 40, 1.2);
      this.audio.play('clear');
      this.intermission = 6;
    }

    onBossSpawn() {
      this.ui.bossWarning();
      this.audio.play('boss');
      this.shake(8);
    }

    gameOver() {
      if (this.state === 'gameover') return;
      this.state = 'gameover';
      this.gameOverT = 1.6;
      const P = this.particles;
      P.explosion(0, 0, 60, 200);
      P.explosion(-40, 10, 110, 120);
      P.smoke(0, 0, 60, { count: 30, color: '#3d3a36', size: 40, speed: 260, life: 2, rise: 140 });
      P.debris(0, 0, 80, { count: 30, color: '#5a5f55', speed: 420, size: 9 });
      this.shake(26);
      this.whiteFlash = 0.6;
      this.audio.play('boom_l');
      setTimeout(() => this.audio.play('gameover'), 700);
    }

    finishGameOver() {
      let best = 0;
      try { best = +localStorage.getItem('def_best_wave') || 0; } catch (e) { /* storage blocked */ }
      const isRecord = this.wave > best;
      if (isRecord) { try { localStorage.setItem('def_best_wave', String(this.wave)); } catch (e) { /* ignore */ } }
      const tech = TechLab.award(this.wave, this.kills, this.bossKills);
      this.ui.showGameOver({ wave: this.wave, kills: this.kills, goldEarned: Math.floor(this.goldEarned), maxCombo: this.maxCombo, score: this.score, tech }, Math.max(best, this.wave), isRecord && this.wave > 0);
    }

    /* ---------------- progression (red & green energy) ---------------- */
    get greenNeed() {
      const e = TD.CFG.energy;
      return Math.max(1, Math.round(e.greenKills * (1 + ((e.greenGrow || 0) / 100) * this.drafts)));
    }
    gainEnergy() {
      const cfg = TD.CFG.energy;
      this.greenEnergy++;
      if (this.greenEnergy >= this.greenNeed) {
        this.greenEnergy = 0;
        this.drafts++;
        this.pending.push('card');
        this.ui.pulseBar('greenBar');
      }
      this.redEnergy++;
      if (this.redEnergy >= cfg.redKills) {
        this.redEnergy = 0;
        this.pending.push('red');
        this.ui.pulseBar('redBar');
      }
      if (this.pending.length && this.choiceDelay <= 0) this.choiceDelay = 0.35;
    }

    processPending() {
      const item = this.pending.shift();
      if (!item) return;
      if (item === 'card') return this.openCards();
      if (item === 'red') {
        const t = this.tower;
        if (t.tier >= 3) {
          if (t.branch) t.branch.ultimate();
          this.ui.float(0, 0, 280, '🔴 TỐI THƯỢNG!', 'big');
          this.shake(10);
          this.audio.play('tierup');
          return;
        }
        t.tierUp();
        this.audio.play('tierup');
        this.shake(10);
        this.particles.smoke(0, 0, 0, { count: 24, size: 30, speed: 260, life: 1.4, color: '#a49a88', rise: 40 });
        this.particles.sparks(0, 0, t.height, { count: 40, color: '#ffd23f', speed: 420 });
        this.particles.ring(0, 0, { radius: 260, color: '#ff5040', width: 12, life: 0.7 });
        if (t.tier === 1) {
          this.ui.banner('⬆️ TIER 1', 'Pháo đài lên tầng 2!', 'perk');
          this.openBranch();
        } else {
          const br = TD.BRANCHES.find((b) => b.id === t.branchId);
          this.ui.banner(`⬆️ TIER ${t.tier}`, t.tier === 3 ? 'SIÊU PHÁO ĐÀI — ' + (br ? `${br.name} Lv3` : 'cấp tối đa') : br ? `${br.name} → Lv${t.tier}` : 'Thêm tầng radar', 'perk');
        }
        if (this.ui.shopOpen) this.ui.renderShop();
      }
    }

    openCards() {
      this.state = 'perk';
      this.audio.play('card');
      this.ui.showCards((card) => {
        const t = this.tower;
        if (card.id === 'cash') this.addGold(250);
        else if (card.id === 'medkit') { t.heal(t.maxHp * 0.4); t.wall.repairAll(); this.particles.plus(0, 0, 60, 14); }
        else t.addCard(card.id);
        this.state = 'playing';
        const lv = t.cards[card.id];
        this.ui.banner(`${card.icon} ${card.name}${lv ? ' Lv' + lv : ''}`, '', 'perk');
        this.audio.play('upgrade');
        this.particles.sparks(0, 0, t.height, { count: 24, color: '#7dff6a', speed: 300 });
        if (this.ui.shopOpen) this.ui.renderShop();
        if (this.pending.length) this.choiceDelay = 0.5;
      });
    }

    openBranch() {
      this.state = 'perk';
      this.audio.play('card');
      this.ui.showBranches((br) => {
        this.tower.setBranch(br.id);
        this.state = 'playing';
        this.ui.banner(`${br.icon} ${br.name}`, 'Nhánh phòng thủ đã kích hoạt — Lv1', 'perk');
        this.audio.play('upgrade');
        if (this.ui.shopOpen) this.ui.renderShop();
        if (this.pending.length) this.choiceDelay = 0.5;
      });
    }

    /* ---------------- economy & combat ---------------- */
    get comboMult() { return 1 + Math.min(3, Math.floor(this.combo / 5) * 0.25); }

    addGold(n) { this.gold += n; this.goldEarned += n; this.ui.bumpGold(); }

    spend(cost) {
      if (this.gold < cost) { this.audio.play('deny'); return false; }
      this.gold -= cost;
      this.audio.play('upgrade');
      this.particles.sparks(0, 0, this.tower.height + 20, { count: 14, color: '#ffd23f', speed: 220 });
      return true;
    }
    buyStat(stat) {
      const cost = this.tower.upgradeCost(stat);
      if (!isFinite(cost) || !this.spend(cost)) return;
      this.tower.upgrade(stat);
      this.ui.renderShop();
    }
    buyAux(id) {
      const cost = this.tower.auxCost(id);
      if (!isFinite(cost) || !this.spend(cost)) return;
      this.tower.upgradeAux(id);
      this.ui.renderShop();
    }

    /** Central damage pipeline: armor, numbers, crit thud, kill. */
    damageEnemy(e, amount, opts = {}) {
      if (e.dead) return 0;
      const src = opts.source;
      let surface = false;
      if (e.burrowed) {                                   // ⛏️ only seismic shocks reach tunnelers
        if (!TD.SEISMIC.has(src)) return 0;
        surface = true;
      }
      if (e.cloaked && AOE.has(src)) e.reveal();          // 🥷 AOE exposes infiltrators
      let dmg = amount;
      if (e.damageFilter) dmg = e.damageFilter(dmg, opts);
      if (!PIERCE.has(src)) dmg = Math.max(dmg * 0.25, dmg - e.armor);
      if (e.corroded >= 2) dmg *= e.corroded >= 3 ? 1.3 : 1.15;
      e.hp -= dmg;
      const style = opts.style || (opts.crit ? 'crit' : 'normal');
      if (opts.silent) { /* no number */ } else if (opts.dot) {
        e.dotAcc = (e.dotAcc || 0) + dmg;
        if (this.time - (e.dotShown || 0) > 0.6 && e.dotAcc >= 2) {
          this.ui.float(e.x, e.y, (e.z || 0) + e.height + 10, String(Math.round(e.dotAcc)), style);
          e.dotAcc = 0; e.dotShown = this.time;
        }
      } else {
        e.hitReact(opts.knock);
        if (dmg >= 0.5) this.ui.float(e.x, e.y, (e.z || 0) + e.height + 10, String(Math.round(dmg)), style);
      }
      if (opts.crit && src === 'mg') { this.audio.play('crit'); this.shake(2.5); }
      if (e.hp <= 0) this.killEnemy(e);
      else if (surface && e.surface) e.surface(false);
      return dmg;
    }

    /* ---------------- new combat hooks ---------------- */
    /** 🛡️ Aegis: swallow a hostile projectile that entered the dome. */
    shieldCatch(p) {
      const sh = this.tower.aegis;
      if (!sh || !sh.active || p.dead) return false;
      if (p.payload && p.payload.kind === 'decoy') return false;
      const t = this.tower, R = sh.R;
      if (p._inside === undefined) p._inside = Math.hypot((p.sx != null ? p.sx : p.x) - t.x, (p.sy != null ? p.sy : p.y) - t.y) < R - 4;
      if (p._inside) return false;
      const d = Math.hypot(p.x - t.x, p.y - t.y);
      if (d > R) return false;
      if (p.z > Math.sqrt(Math.max(0, R * R - d * d)) + 8) return false;
      p.dead = true;
      const dmg = (p.payload && p.payload.dmg) || p.dmg || 10;
      sh.absorb(p.x, p.y, Math.max(4, p.z), dmg, p.payload && p.payload.attacker);
      if (p.isRocket || p instanceof PR.EnemyBomb) this.particles.explosion(p.x, p.y, Math.max(4, p.z), 42, { scorch: false, quiet: true, debris: false });
      return true;
    }
    /** 🛡️ Aegis vs hitscan (sniper). Returns the impact point on the dome or null. */
    shieldBlockLine(a, b, dmg, attacker) {
      const sh = this.tower.aegis;
      if (!sh || !sh.active) return null;
      const t = this.tower, R = sh.R;
      if (Math.hypot(a.x - t.x, a.y - t.y) <= R || Math.hypot(b.x - t.x, b.y - t.y) > R) return null;
      const dx = b.x - a.x, dy = b.y - a.y, fx = a.x - t.x, fy = a.y - t.y;
      const A = dx * dx + dy * dy, B = 2 * (fx * dx + fy * dy), C = fx * fx + fy * fy - R * R;
      const k = clamp((-B - Math.sqrt(Math.max(0, B * B - 4 * A * C))) / (2 * A), 0, 1);
      const p = { x: a.x + dx * k, y: a.y + dy * k, z: a.z + (b.z - a.z) * k + 30 };
      sh.absorb(p.x, p.y, p.z, dmg, attacker);
      return p;
    }
    /** 🛸 Carpet bomb impact. */
    enemyBombHit(x, y, dmg, r) {
      const t = this.tower;
      this.particles.explosion(x, y, 0, r);
      this.audio.play('boom_m');
      this.shake(8);
      if (this.state !== 'playing') return;
      if (Math.hypot(x - t.x, y - t.y) - t.radius <= r * 0.8) t.takeDamage(dmg, null);
      const w = t.wall;
      if (w.lv > 0) for (const s of w.segs) {
        if (s.hp <= 0) continue;
        const a = w.segMid(s);
        if (Math.hypot(x - Math.cos(a) * w.R, y - Math.sin(a) * w.R) <= r) w.damage(s, dmg);
      }
    }
    /** ⛏️ Sapper timed demolition charge. */
    placeCharge(x, y, dmg) { this.charges.push({ x, y, t: 3, max: 3, dmg, r: 100 }); this.audio.play('c4'); }
    damageDecoy(dmg, x, y) {
      const d = this.decoy;
      if (!d) return;
      d.hp -= dmg;
      this.particles.sparks(x != null ? x : d.x, y != null ? y : d.y, 30, { count: 3, color: '#7fe8ff', speed: 120 });
      if (d.hp <= 0) {
        this.particles.sparks(d.x, d.y, 40, { count: 30, color: '#8af4ff', speed: 260 });
        this.particles.ring(d.x, d.y, { radius: 90, color: '#5ae0ff', width: 6, life: 0.4 });
        this.ui.float(d.x, d.y, 90, 'MỒI NHỬ BỊ PHÁ', 'shock');
        this.decoy = null;
      }
    }
    onMeleeStrike(e) { const b = this.tower.barbed; if (b) b.onStrike(e); }
    /** 📡 is (x, y) inside an active jamming field? */
    jamAt(x, y) {
      for (const e of this.enemies) if (!e.dead && e.jamming && Math.hypot(e.x - x, e.y - y) <= e.jamRadius) return true;
      return false;
    }
    /** Juice: screen pop-flash + hit-stop on catastrophic chain explosions. */
    blast(radius) {
      this.blastAcc += radius;
      const a = clamp((radius - 50) / 550, 0, 0.42);
      if (a > 0) { this.popFlash = Math.max(this.popFlash, a); this.popFlashT = 0.05; }
      if ((radius >= 200 || this.blastAcc > 420) && this.hitStopCd <= 0) { this.hitStop = radius >= 200 ? 0.05 : 0.034; this.hitStopCd = 0.7; }
    }
    /** Burning husk sprite of a destroyed vehicle (lingers 10–15 s). */
    makeHusk(e) {
      if (this.husks.length > 16) this.husks.shift();
      const k = e.type === 'boss' ? 1.75 : 1;
      const w = Math.ceil(e.radius * 3.4 + 60 * k), h = Math.ceil(e.height * 1.5 + 50 * k);
      const c = document.createElement('canvas'); c.width = w; c.height = h;
      const x = c.getContext('2d');
      x.translate(w / 2, h - 10);
      x.scale(e.facing, 1);
      try { e.recoil = 0; e.attackAnim = 0; e.volley = 0; if (e.s3) e.drawS3(x); else e.drawBody(x); } catch (err) { /* ignore */ }
      x.setTransform(1, 0, 0, 1, 0, 0);
      x.globalCompositeOperation = 'source-atop';
      x.fillStyle = 'rgba(16,12,9,0.84)'; x.fillRect(0, 0, w, h);
      for (let i = 0; i < 9; i++) { x.fillStyle = `rgba(255,${80 + rand(0, 80)},20,${rand(0.25, 0.6)})`; x.fillRect(rand(w * 0.25, w * 0.75), rand(h * 0.4, h - 14), rand(2, 6), rand(1.5, 3)); }
      const life = rand(10, 15);
      this.husks.push({ x: e.x, y: e.y, img: c, w, h, t: life, max: life, k, smokeT: 0 });
    }

    /** Area damage. opts: exclude, ground (skip air), knock force, crit, source. */
    splashDamage(x, y, r, dmg, opts = {}) {
      let hits = 0;
      for (const e of this.enemies) {
        if (e.dead || e === opts.exclude) continue;
        if (opts.ground && e.air) continue;
        const d = dist(x, y, e.x, e.y);
        if (d < r + e.radius * 0.6) {
          const fall = 1 - 0.45 * clamp(d / r, 0, 1);
          this.damageEnemy(e, dmg * fall, { source: opts.source, crit: opts.crit, knock: opts.knock ? { x, y, f: opts.knock } : null });
          hits++;
        }
      }
      if (!opts.ground) {
        for (const rk of this.rockets) if (!rk.dead && dist(x, y, rk.x, rk.y) < r) this.damageRocket(rk, dmg, false);
      }
      return hits;
    }

    damageRocket(r, dmg, crit) {
      if (r.dead) return;
      r.hp -= dmg;
      if (r.hp <= 0) {
        r.intercept();
        this.addGold(2);
        this.score += 5;
        this.ui.float(r.x, r.y, r.z + 20, 'CHẶN!', crit ? 'crit' : 'info');
      }
    }

    /** What a hostile shot does when it lands. */
    applyEnemyHit(p, x, y) {
      if (!p || this.state !== 'playing') return;
      if (p.kind === 'wall') {
        if (p.seg && p.seg.hp > 0) return this.tower.wall.damage(p.seg, p.dmg);
        return this.tower.takeDamage(p.dmg * 0.6, p.attacker);
      }
      if (p.kind === 'tower') { this.tower.takeDamage(p.dmg, p.attacker); this.audio.play('hit'); return; }
      if (p.kind === 'decoy') this.damageDecoy(p.dmg || (p.attacker ? p.attacker.dmg : 5), x, y);
    }

    nukeDetonate(x, y, dmg, radius) {
      this.blast(260);
      const P = this.particles;
      for (const e of this.enemies) {
        if (e.dead) continue;
        const d = dist(x, y, e.x, e.y);
        if (d < radius + e.radius) {
          const fall = 1 - 0.65 * clamp(d / radius, 0, 1);
          this.damageEnemy(e, dmg * fall, { source: 'nuke', crit: true, knock: { x, y, f: 420 } });
        }
      }
      for (const rk of this.rockets) if (!rk.dead && dist(x, y, rk.x, rk.y) < radius * 1.3) rk.intercept();
      P.nuke(x, y, radius);
      this.fallout = { x, y, r: radius * 0.8, t: 5.5, dps: dmg * 0.04 };
      this.whiteFlash = 1;
      TD.PostFX.chromaPulse(1);
      this.shake(26);
      this.audio.play('boom_l');
      this.ui.float(x, y, 220, '☢ NUKE!', 'big');
    }

    killEnemy(e) {
      if (e.dead) return;
      e.dead = true;
      this.kills++;
      if (e.type === 'boss') this.bossKills++;
      e.onDeath();
      if (e.cfg.husk) this.makeHusk(e);
      if (e.gasT > 0) { const gw = this.tower.aux$('gas'); if (gw) gw.burst(e.x, e.y); }
      this.combo++;
      this.comboTimer = this.comboWindow;
      this.maxCombo = Math.max(this.maxCombo, this.combo);
      const mult = this.comboMult;
      const gold = Math.max(1, Math.round(e.gold * mult));
      this.addGold(gold);
      this.score += Math.round(e.score * mult * (1 + this.wave * 0.1));
      this.ui.float(e.x, e.y, (e.z || 0) + e.height + 34, `+🪙${gold}`, 'gold');
      const P = this.particles;
      if (e.heavy) {
        P.explosion(e.x, e.y, 10, e.type === 'boss' ? 180 : 90);
        P.fire(e.x, e.y, 20, { count: 10, size: 24, life: 0.8 });
        P.smoke(e.x, e.y, 30, { count: 10, size: 26, color: '#2e2c29', life: 2.2, rise: 70 });
        this.audio.play('boom_m');
        this.shake(e.type === 'boss' ? 18 : 6);
      } else if (e.air) {
        P.explosion(e.x, e.y, e.z, 45, { scorch: false });
        P.debris(e.x, e.y, e.z, { count: 6, speed: 160, size: 4, color: '#8a9090' });
        this.audio.play('boom_s');
      } else if (e.type === 'biker') {
        P.explosion(e.x, e.y, 10, 70);
        this.audio.play('boom_m');
        this.shake(4);
      } else {
        P.smoke(e.x, e.y, e.height * 0.4, { count: 5, color: '#b8ae98', size: e.radius * 0.9, speed: 80, life: 0.7 });
        P.sparks(e.x, e.y, e.height * 0.5, { count: 4, color: '#ffd890', speed: 160 });
        P.debris(e.x, e.y, 20, { count: 3, color: '#3e4230', speed: 120, size: 4 });
      }
      this.audio.play('kill');
      this.audio.play('coin');
      if (e.type === 'boss') {
        P.ring(e.x, e.y, { radius: 260, color: '#ffe14d', width: 16, life: 0.7 });
        this.whiteFlash = 0.4;
        this.ui.banner('SIÊU TĂNG BỊ HẠ!', `+${gold} 🪙`, 'clear');
      }
      if (this.combo > 0 && this.combo % 10 === 0) {
        const bonus = this.combo * 2;
        this.addGold(bonus);
        this.ui.float(0, 0, 270, `🔥 CHUỖI ${this.combo}! +🪙${bonus}`, 'big');
        this.audio.play('combo');
      }
      const ce = this.ui.$.combo;
      ce.classList.remove('pop'); void ce.offsetWidth; ce.classList.add('pop');
      this.gainEnergy();
    }

    shake(n) { this.trauma = Math.min(1, this.trauma + n / 30); }

    /* ---------------- targeting helpers ---------------- */
    nearestEnemy(x, y, range, withRockets = true) {
      let best = null, bd = range;
      if (withRockets) for (const r of this.rockets) { if (r.dead) continue; const d = dist(x, y, r.x, r.y); if (d < bd) { bd = d; best = r; } }
      if (best) return best;
      bd = range;
      for (const e of this.enemies) { if (!e.targetable) continue; const d = dist(x, y, e.x, e.y); if (d < bd) { bd = d; best = e; } }
      return best;
    }
    targetsByDistance(x, y, range, withRockets) {
      const out = [];
      if (withRockets) for (const r of this.rockets) if (!r.dead && dist(x, y, r.x, r.y) < range) out.push(r);
      out.sort((a, b) => dist(x, y, a.x, a.y) - dist(x, y, b.x, b.y));
      const es = this.enemies.filter((e) => e.targetable && dist(x, y, e.x, e.y) < range).sort((a, b) => dist(x, y, a.x, a.y) - dist(x, y, b.x, b.y));
      return out.concat(es);
    }
    pickSamTarget() {
      const bombers = this.enemies.filter((e) => e.targetable && e.type === 'hbomber');   // 🛸 top SAM priority
      if (bombers.length) return pick(bombers);
      const air = this.rockets.filter((r) => !r.dead && r.t / r.T < 0.8);
      if (air.length) return pick(air);
      const drones = this.enemies.filter((e) => e.targetable && e.air);
      if (drones.length) return pick(drones);
      const list = this.enemies.filter((e) => e.targetable);
      if (!list.length) return null;
      return Math.random() < 0.5 ? this.highestHpEnemy() : pick(list);
    }
    highestHpEnemy() {
      let best = null;
      for (const e of this.enemies) if (e.targetable && (!best || e.hp > best.hp)) best = e;
      return best;
    }
    densestPoint(list) {
      let best = null, bs = -1;
      for (const e of list) {
        let s = 0;
        for (const o of list) if (dist(e.x, e.y, o.x, o.y) < 170) s += o.heavy ? 3 : 1;
        if (s > bs) { bs = s; best = e; }
      }
      return best;
    }

    /* ---------------- active skills ---------------- */
    skillTarget() {
      const { hw, hh } = this.ARENA;
      if (this.mouse.inside) {
        const p = this.unproject(this.mouse.x, this.mouse.y);
        if (Math.abs(p.x) < hw && Math.abs(p.y) < hh && Math.hypot(p.x, p.y) > 60) return p;
      }
      const best = this.densestPoint(this.enemies.filter((e) => !e.dead && e.active));
      return best ? { x: best.x, y: best.y } : null;
    }

    /** HUD button press. Targeted skills (Pháo binh, Mồi nhử) enter AIM mode: tap the map to fire,
        tap the same button again to auto-target the densest enemy cluster. */
    pressSkill(i) {
      if (this.state !== 'playing') return;
      const s = this.skills[i];
      if (!s) return;
      const targeted = s.id === 'artillery' || s.id === 'decoy';
      if (!targeted || s.t > 0) { this.cancelAim(); this.useSkill(i); return; }
      if (this.aimSkill === i) {               // second tap → auto-aim
        this.cancelAim();
        this.mouse.inside = false;
        this.useSkill(i);
        return;
      }
      this.aimSkill = i;
      this.mouse.inside = false;
      this.ui.setAiming(i, s);
      this.audio.play('click');
    }
    cancelAim() { if (this.aimSkill >= 0) { this.aimSkill = -1; this.ui.setAiming(-1); } }

    useSkill(i) {
      if (this.state !== 'playing') return;
      if (this.aimSkill >= 0 && this.aimSkill !== i) this.cancelAim();
      const s = this.skills[i];
      if (!s) return;
      if (s.t > 0) { this.audio.play('deny'); return; }
      let ok = false;
      switch (s.id) {
        case 'artillery': {
          const p = this.skillTarget();
          if (!p) break;
          const dmg = 120 + this.wave * 18;
          const pk = 1 + 0.08 * TechLab.bonus('potency');
          for (let k = 0; k < 7; k++) {
            const a = rand(0, Math.PI * 2), r = k === 0 ? 0 : rand(30, 150) * pk;
            this.projectiles.push(new PR.ArtyShell(this, { x: p.x + Math.cos(a) * r, y: p.y + Math.sin(a) * r, dmg, radius: 75 * pk, delay: k * 0.14 }));
          }
          this.audio.play('siren_s');
          this.ui.float(p.x, p.y, 80, 'PHÁO BINH!', 'info');
          ok = true; break;
        }
        case 'emp': {
          const list = this.enemies.filter((e) => !e.dead);
          if (!list.length && !this.rockets.length) break;
          for (const e of list) { e.stun(3.2 + 0.25 * TechLab.bonus('potency')); this.damageEnemy(e, 15 + this.wave * 2, { source: 'emp', style: 'shock' }); }
          for (const r of this.rockets) if (!r.dead) r.intercept();
          this.empFx = 1;
          this.particles.emp(this.tower.x, this.tower.y, 1000);
          this.ui.banner('📡 XUNG EMP!', 'Địch tê liệt • tên lửa bị vô hiệu', '');
          this.audio.play('emp');
          ok = true; break;
        }
        case 'repair': {
          const t = this.tower;
          const wallHurt = t.wall.lv > 0 && t.wall.pct < 0.999;
          if (t.hp >= t.maxHp && !wallHurt) { this.ui.float(0, 0, 220, 'Máu đã đầy!', 'info'); break; }
          const healed = t.heal(t.maxHp * (0.35 + 0.03 * TechLab.bonus('potency')));
          t.wall.repairAll();
          this.ui.float(0, 0, t.height + 40, `+${Math.round(healed)} HP`, 'heal');
          this.particles.plus(0, 0, 60, 16);
          this.particles.ring(0, 0, { radius: 180, color: '#7dff6a', width: 10, life: 0.5 });
          this.audio.play('repair');
          ok = true; break;
        }
        case 'decoy': {
          let p = this.skillTarget();
          if (!p) break;
          const d = Math.hypot(p.x, p.y);
          if (d < 230) p = { x: (p.x / (d || 1)) * 250, y: (p.y / (d || 1)) * 250 };
          const dhp = Math.round((260 + this.wave * 25) * (1 + 0.15 * TechLab.bonus('potency')));
          this.decoy = { x: p.x, y: p.y, t: 7, max: 7, hp: dhp, maxHp: dhp };
          this.particles.ring(p.x, p.y, { radius: 120, color: '#5ae0ff', width: 6, life: 0.5 });
          this.particles.sparks(p.x, p.y, 30, { count: 20, color: '#8af4ff', speed: 200 });
          this.audio.play('decoy');
          ok = true; break;
        }
      }
      if (ok) { s.maxT = s.cd * this.cdrMult; s.t = s.maxT; this.ui.flashSkill(i); }
      else this.audio.play('deny');
    }

    /* ---------------- input ---------------- */
    bindInput() {
      window.addEventListener('keydown', (e) => {
        if (e.repeat) return;
        if (e.target && (e.target.tagName === 'INPUT')) return;
        const k = e.key.toLowerCase();
        if (['1', '2', '3', '4'].includes(k)) { this.cancelAim(); this.useSkill(+k - 1); e.preventDefault(); }
        else if (k === 'b') { if (this.state === 'playing') this.ui.toggleShop(); }
        else if (k === 'escape' && this.aimSkill >= 0) this.cancelAim();
        else if (k === 'p' || k === 'escape') this.togglePause();
        else if (k === 'm') this.ui.setMuted(this.audio.toggleMute());
        else if (k === ' ') {
          e.preventDefault();
          if (this.state === 'menu' || this.state === 'gameover') { if (this.state === 'menu' ? this.ui.$.cfgModal.classList.contains('hidden') : this.gameOverT <= 0) this.startGame(); }
          else this.skipIntermission();
        }
      });
      const toLogical = (ev) => {
        const r = this.canvas.getBoundingClientRect();
        const clientX = ev.clientX !== undefined ? ev.clientX : (ev.touches && ev.touches[0] ? ev.touches[0].clientX : 0);
        const clientY = ev.clientY !== undefined ? ev.clientY : (ev.touches && ev.touches[0] ? ev.touches[0].clientY : 0);
        return { x: ((clientX - r.left) / r.width) * W, y: ((clientY - r.top) / r.height) * H };
      };
      const updatePointer = (ev) => {
        const p = toLogical(ev);
        this.mouse.x = p.x; this.mouse.y = p.y;
        this.mouse.inside = p.x >= 0 && p.y >= 0 && p.x <= W && p.y <= H;
      };
      window.addEventListener('mousemove', updatePointer);
      window.addEventListener('pointermove', updatePointer);
      window.addEventListener('pointerdown', (ev) => {
        const t = ev.pointerType === 'touch' || ev.pointerType === 'pen';
        if (t !== this.touch) { this.touch = t; document.body.classList.toggle('touch', t); this.resize(); }
        updatePointer(ev);
        if (t && ev.target !== this.canvas) this.mouse.inside = false;   // a finger on a button is not an aim point
      });
      // 📱 tap on the battlefield fires the skill that is waiting for a target
      this.canvas.addEventListener('pointerdown', (ev) => {
        if (this.aimSkill < 0 || this.state !== 'playing') return;
        updatePointer(ev);
        const i = this.aimSkill;
        this.cancelAim();
        this.useSkill(i);
        if (this.touch) this.mouse.inside = false;
        ev.preventDefault();
      });
      this.canvas.addEventListener('mouseleave', () => { this.mouse.inside = false; });
      window.addEventListener('orientationchange', () => setTimeout(() => this.resize(), 250));
      if (PORTRAIT_MQ && PORTRAIT_MQ.addEventListener) PORTRAIT_MQ.addEventListener('change', () => this.resize());
      document.addEventListener('visibilitychange', () => { if (document.hidden && this.state === 'playing') this.togglePause(true); });
    }

    /* ---------------- main loop ---------------- */
    loop(now) {
      const dt = Math.min(0.05, (now - this.last) / 1000);
      TD.PostFX.governor(now - this.last);   // 🎛️ adaptive FX quality (keeps weak devices smooth)
      this.last = now;
      try {
        this.popFlashT = Math.max(0, this.popFlashT - dt);
        this.hitStopCd = Math.max(0, this.hitStopCd - dt);
        if (this.state === 'playing' && this.hitStop > 0) {
          this.hitStop -= dt;                     // 1–2 frame micro-freeze on catastrophic chains
          this.updateShake(dt * 0.5);
        } else if (this.state === 'playing') {
          for (let i = 0; i < this.speed; i++) if (this.state === 'playing' && this.hitStop <= 0) this.update(dt);
        } else if (this.state === 'gameover' || this.state === 'menu') {
          this.time += dt;
          this.particles.update(dt);
          TD.PostFX.update(dt);
          this.updateShake(dt);
          this.whiteFlash = Math.max(0, this.whiteFlash - dt * 1.2);
          if (this.state === 'gameover' && this.gameOverT > 0) {
            this.gameOverT -= dt;
            if (this.gameOverT <= 0) this.finishGameOver();
          }
        }
        this.ui.update(dt);
        this.render();
      } catch (err) {
        console.error(err);
      }
      requestAnimationFrame((t) => this.loop(t));
    }

    /** Trauma-based screen shake: offset ∝ trauma², smooth noise + slight roll. */
    updateShake(dt) {
      this.trauma = Math.max(0, this.trauma - dt * 1.15);
      const t = this.time, k = this.trauma * this.trauma;
      const n = (a, b, c) => Math.sin(t * a) * 0.5 + Math.sin(t * b + 1.7) * 0.3 + Math.sin(t * c + 4.1) * 0.2;
      this.shakeX = 34 * k * n(47, 83, 131);
      this.shakeY = 26 * k * n(53, 97, 149);
      this.shakeR = 0.035 * k * n(29, 61, 107);
      this.shakeAmt = 34 * k;
    }

    update(dt) {
      this.time += dt;

      if (this.choiceDelay > 0) {
        this.choiceDelay -= dt;
        if (this.choiceDelay <= 0) { this.processPending(); if (this.state !== 'playing') return; }
      }
      if (this.intermission > 0) {
        this.intermission -= dt;
        if (this.intermission <= 0) { this.intermission = 0; this.startWave(this.wave + 1); }
      }

      this.spawner.update(dt);
      this.rockets = this.projectiles.filter((p) => p.isRocket && !p.dead);
      this.tower.update(dt);
      if (this.state !== 'playing') return;

      // 📡 EW jamming field on the fortress
      let jf = 0;
      for (const e of this.enemies) if (!e.dead && e.jamming && Math.hypot(e.x - this.tower.x, e.y - this.tower.y) <= e.jamRadius) jf = Math.max(jf, clamp(TD.CFG.foes.jammer.rangeDebuffPercent, 0, 95) / 100);
      this.jamFactor = jf;
      for (const f of this.flyovers) f.update(dt);
      this.flyovers = this.flyovers.filter((f) => !f.done);
      for (const e of this.enemies) if (!e.dead) e.update(dt);
      const alive = this.enemies.filter((e) => !e.dead);
      for (const e of alive) e.separate(alive, dt);

      for (const p of this.projectiles) if (!p.dead) p.update(dt);
      this.projectiles = this.projectiles.filter((p) => !p.dead);
      this.enemies = this.enemies.filter((e) => !e.dead);

      // radioactive fallout zone
      if (this.fallout) {
        const f = this.fallout;
        f.t -= dt;
        for (const e of this.enemies) if (!e.dead && !e.air && dist(e.x, e.y, f.x, f.y) < f.r) this.damageEnemy(e, f.dps * dt, { source: 'fallout', style: 'shock', dot: true });
        if (f.t <= 0) this.fallout = null;
      }

      // ⛏️ timed demolition charges
      for (const c of this.charges) {
        c.t -= dt;
        if (Math.floor(c.t * 4) !== Math.floor((c.t + dt) * 4)) this.audio.play('c4');
        if (c.t <= 0) {
          const t = this.tower;
          this.particles.explosion(c.x, c.y, 0, 80);
          this.audio.play('boom_m'); this.shake(7);
          if (Math.hypot(c.x - t.x, c.y - t.y) - t.radius <= c.r) t.takeDamage(c.dmg, null);
          const w = t.wall;
          if (w.lv > 0) for (const sg of w.segs) { if (sg.hp <= 0) continue; const a = w.segMid(sg); if (Math.hypot(c.x - Math.cos(a) * w.R, c.y - Math.sin(a) * w.R) <= c.r) w.damage(sg, c.dmg); }
        }
      }
      this.charges = this.charges.filter((c) => c.t > 0);
      // 🔥 burning husks of destroyed vehicles
      for (const h of this.husks) {
        h.t -= dt; h.smokeT -= dt;
        if (h.smokeT <= 0) {
          h.smokeT = 0.12 + (1 - h.t / h.max) * 0.25;
          const P = this.particles;
          P.spawn({ type: 'smoke', x: h.x + rand(-14, 14) * h.k, y: h.y + rand(-5, 5), z: 30 * h.k, vz: rand(40, 70), vx: rand(-10, 10), size: rand(8, 13) * h.k, grow: 2.4, color: pick(['#151311', '#24211d', '#2e2a25']), alpha: 0.55 * Math.min(1, h.t / 3), life: rand(1.6, 2.4), drag: 0.6 });
          if (h.t > h.max - 7 && Math.random() < 0.7) P.spawn({ type: 'fire', x: h.x + rand(-16, 16) * h.k, y: h.y, z: rand(10, 30) * h.k, vz: rand(30, 70), size: rand(6, 11) * h.k, grow: 0.5, color: pick(['#ffb347', '#ff6a1a', '#ff3a10']), life: rand(0.3, 0.55), drag: 1 });
        }
      }
      this.husks = this.husks.filter((h) => h.t > 0);
      this.blastAcc *= Math.max(0, 1 - dt * 7);
      if (this.combo > 0) { this.comboTimer -= dt; if (this.comboTimer <= 0) this.combo = 0; }
      for (const s of this.skills) if (s.t > 0) s.t = Math.max(0, s.t - dt);
      if (this.decoy) {
        this.decoy.t -= dt;
        if (this.decoy.t <= 0) {
          this.particles.sparks(this.decoy.x, this.decoy.y, 30, { count: 16, color: '#8af4ff', speed: 160 });
          this.decoy = null;
        }
      }
      this.empFx = Math.max(0, this.empFx - dt * 0.8);
      this.whiteFlash = Math.max(0, this.whiteFlash - dt * 1.2);

      this.particles.update(dt);
      TD.PostFX.update(dt);
      this.updateShake(dt);

      if (this.pending.length && this.choiceDelay <= 0) this.choiceDelay = 0.35;
      if (this.waveActive && this.spawner.waveDone) this.onWaveClear();
    }

    /* ---------------- rendering ---------------- */
    render() {
      const ctx = this.ctx;
      const k = this.renderScale;
      ctx.setTransform(k, 0, 0, k, 0, 0);
      ctx.clearRect(0, 0, W, H);
      if (!this.bg) return;

      ctx.save();
      ctx.translate(W / 2 + this.shakeX, H / 2 + this.shakeY);
      ctx.rotate(this.shakeR);
      ctx.translate(-W / 2, -H / 2);
      ctx.fillStyle = '#2c3020';
      ctx.fillRect(-80, -80, W + 160, H + 160);
      ctx.drawImage(this.bg, 0, 0, W, H);
      const FX = TD.PostFX;
      FX.beginFrame(ctx);
      FX.grade(ctx);

      const t = this.tower;
      this.particles.draw(ctx, 'ground');
      if (t.branch) t.branch.drawGround(ctx);
      t.drawGroundExtras(ctx);
      if (this.decoy) this.drawDecoyGround(ctx);
      for (const c of this.charges) this.drawCharge(ctx, c);
      if (this.ui.shopOpen && !this.portrait && this.state === 'playing') this.drawRanges(ctx);
      if (this.state === 'playing') this.drawReticle(ctx);

      const list = [];
      for (const p of this.props) list.push({ y: p.y, d: () => this.drawSprite(ctx, p.spr || this.propSprites[p.v], p) });
      for (const c of this.cover) list.push({ y: c.y, d: () => this.drawSprite(ctx, c.spr || this.coverSprites[c.v], c) });
      const air = [];
      for (const e of this.enemies) (e.air ? air : list).push({ y: e.y, d: () => e.draw(ctx) });
      t.wall.renderItems(ctx, list);
      for (const w of t.auxWeapons) if (w.renderItems) w.renderItems(ctx, list);
      for (const h of this.husks) list.push({ y: h.y - 1, d: () => this.drawHusk(ctx, h) });
      if (this.state !== 'gameover' || this.gameOverT > 1.4) list.push({ y: t.y + 8, d: () => t.draw(ctx) });
      else list.push({ y: 8, d: () => this.drawRuins(ctx) });
      if (this.decoy) list.push({ y: this.decoy.y, d: () => this.drawDecoy(ctx) });
      list.sort((a, b) => a.y - b.y);
      for (const o of list) o.d();
      air.sort((a, b) => a.y - b.y);
      FX.distort(ctx);                       // 🌊 shockwave refraction of the rendered battlefield
      for (const o of air) o.d();

      for (const p of this.projectiles) p.draw(ctx);
      for (const w of t.auxWeapons) w.drawTop(ctx);
      if (t.branch) t.branch.drawTop(ctx);
      for (const f of this.flyovers) f.draw(ctx);
      this.particles.draw(ctx, 'top');
      FX.composite();                        // 💡 dynamic lights + emissive bloom (overlay layer)
      this.ui.drawFloaters(ctx);
      ctx.restore();
      FX.chromaticPass(ctx);

      if (this.empFx > 0) { ctx.fillStyle = `rgba(120,230,255,${this.empFx * 0.22})`; ctx.fillRect(0, 0, W, H); }
      ctx.drawImage(this.vignette, 0, 0, W, H);
      const hpPct = t.hp / t.maxHp;
      if (this.state === 'playing' && hpPct < 0.3) {
        const pulse = 0.5 + 0.5 * Math.sin(this.time * 6);
        const g = ctx.createRadialGradient(W / 2, H / 2, H * 0.35, W / 2, H / 2, H * 0.85);
        g.addColorStop(0, 'rgba(255,0,0,0)');
        g.addColorStop(1, `rgba(255,30,30,${0.18 + pulse * 0.17})`);
        ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
      }
      if (this.whiteFlash > 0) {
        ctx.fillStyle = `rgba(255,252,235,${Math.min(1, this.whiteFlash) * 0.85})`;
        ctx.fillRect(0, 0, W, H);
      }
      if (this.popFlashT > 0 && this.popFlash > 0) {           // 0.05 s whiteout pop
        ctx.fillStyle = `rgba(255,255,250,${this.popFlash})`;
        ctx.fillRect(0, 0, W, H);
        if (this.popFlashT <= 0.017) this.popFlash = 0;
      }
    }

    drawHusk(ctx, h) {
      const s = this.project(h.x, h.y);
      ctx.save();
      ctx.globalAlpha = Math.min(1, h.t / 2.5);
      ctx.drawImage(h.img, s.x - h.w / 2, s.y - h.h + 10 + (1 - h.t / h.max) * 3, h.w, h.h * 0.94);
      if (h.t > h.max - 7) {
        ctx.globalCompositeOperation = 'lighter';
        ctx.globalAlpha = 0.25 + 0.2 * Math.random();
        ctx.drawImage(D.blob('#ff5a1a'), s.x - 30 * h.k, s.y - 36 * h.k, 60 * h.k, 34 * h.k);
      }
      ctx.restore();
    }

    drawCharge(ctx, c) {
      const s = this.project(c.x, c.y);
      const k = 1 - c.t / c.max;
      ctx.strokeStyle = `rgba(255,60,40,${0.25 + 0.5 * k})`; ctx.lineWidth = 2;
      ctx.setLineDash([6, 6]);
      ctx.beginPath(); ctx.ellipse(s.x, s.y, c.r, c.r * this.ISO, 0, 0, Math.PI * 2); ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = '#8a2a1c'; ctx.fillRect(s.x - 8, s.y - 7, 16, 9);
      ctx.fillStyle = '#d8cfa0'; ctx.fillRect(s.x - 8, s.y - 5, 16, 2);
      const on = Math.sin(this.time * (8 + k * 30)) > 0;
      ctx.fillStyle = on ? '#ff2020' : '#400808'; ctx.fillRect(s.x - 1.5, s.y - 10, 3, 3);
      if (on) { ctx.globalCompositeOperation = 'lighter'; ctx.drawImage(D.blob('#ff2020'), s.x - 10, s.y - 18, 20, 18); ctx.globalCompositeOperation = 'source-over'; }
      ctx.font = "700 14px 'Rajdhani', sans-serif"; ctx.textAlign = 'center';
      ctx.lineWidth = 3; ctx.strokeStyle = '#000'; ctx.strokeText(c.t.toFixed(1), s.x, s.y - 18);
      ctx.fillStyle = '#ffd0c0'; ctx.fillText(c.t.toFixed(1), s.x, s.y - 18);
    }

    drawSprite(ctx, spr, o) {
      const s = this.project(o.x, o.y);
      const w = spr.w * o.s, h = spr.h * o.s;
      ctx.drawImage(spr.img, s.x - w * (spr.ax != null ? spr.ax : 0.5), s.y - h * spr.ay, w, h);
    }

    drawRanges(ctx) {
      const o = this.project(0, 0);
      const r = this.tower.range;
      ctx.save();
      ctx.setLineDash([10, 8]);
      ctx.lineDashOffset = -this.time * 30;
      ctx.strokeStyle = '#7dff6a'; ctx.lineWidth = 2.5; ctx.globalAlpha = 0.85;
      ctx.beginPath(); ctx.ellipse(o.x, o.y, r, r * this.ISO, 0, 0, Math.PI * 2); ctx.stroke();
      ctx.globalAlpha = 0.05; ctx.fillStyle = '#7dff6a'; ctx.fill();
      ctx.restore();
    }

    drawReticle(ctx) {
      if (this.aimSkill >= 0 && !this.mouse.inside) {
        // aim mode on touch: pulse the whole arena edge so the player knows to tap the map
        const a = 0.25 + 0.2 * Math.sin(this.time * 6);
        ctx.save(); ctx.strokeStyle = `rgba(255,80,64,${a})`; ctx.lineWidth = 10; ctx.strokeRect(5, 5, W - 10, H - 10); ctx.restore();
        return;
      }
      if (!this.mouse.inside) return;
      const p = this.unproject(this.mouse.x, this.mouse.y);
      const { hw, hh } = this.ARENA;
      if (Math.abs(p.x) > hw || Math.abs(p.y) > hh) return;
      const ready = this.skills[0].t <= 0;
      const r = ready ? 160 : 26;
      ctx.save();
      ctx.globalAlpha = ready ? 0.55 : 0.3;
      ctx.strokeStyle = ready ? '#ff5040' : '#ffffff'; ctx.lineWidth = 2;
      ctx.setLineDash([6, 8]); ctx.lineDashOffset = -this.time * 20;
      ctx.beginPath(); ctx.ellipse(this.mouse.x, this.mouse.y, r, r * this.ISO, 0, 0, Math.PI * 2); ctx.stroke();
      ctx.setLineDash([]);
      ctx.beginPath();
      ctx.moveTo(this.mouse.x - 14, this.mouse.y); ctx.lineTo(this.mouse.x + 14, this.mouse.y);
      ctx.moveTo(this.mouse.x, this.mouse.y - 9); ctx.lineTo(this.mouse.x, this.mouse.y + 9);
      ctx.stroke();
      ctx.restore();
    }

    drawDecoyGround(ctx) {
      const d = this.decoy;
      const s = this.project(d.x, d.y);
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = 0.35 + 0.15 * Math.sin(this.time * 8);
      ctx.drawImage(D.blob('#40d0ff'), s.x - 70, s.y - 42, 140, 84);
      ctx.restore();
      ctx.strokeStyle = '#5ae0ff'; ctx.lineWidth = 4;
      ctx.beginPath(); ctx.ellipse(s.x, s.y, 60, 60 * this.ISO, 0, -Math.PI / 2, -Math.PI / 2 + (d.t / d.max) * Math.PI * 2); ctx.stroke();
      if (d.maxHp) D.hpBar(ctx, s.x, s.y + 26, 50, d.hp / d.maxHp, '#5ae0ff');
    }

    /** Holographic soldier decoy. */
    drawDecoy(ctx) {
      const d = this.decoy;
      const s = this.project(d.x, d.y);
      D.ellipse(ctx, s.x, s.y, 16, 7, '#2d343a', '#111', 1.5);
      D.ellipse(ctx, s.x, s.y - 2, 10, 4, '#5ae0ff', null, 0);
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      const flick = 0.55 + 0.25 * Math.sin(this.time * 30) * Math.sin(this.time * 7);
      ctx.globalAlpha = flick;
      const g = ctx.createLinearGradient(0, s.y - 70, 0, s.y);
      g.addColorStop(0, 'rgba(90,224,255,0)'); g.addColorStop(1, 'rgba(90,224,255,0.35)');
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.moveTo(s.x - 10, s.y - 2); ctx.lineTo(s.x - 22, s.y - 70); ctx.lineTo(s.x + 22, s.y - 70); ctx.lineTo(s.x + 10, s.y - 2); ctx.fill();
      ctx.fillStyle = 'rgba(140,240,255,0.8)';
      ctx.fillRect(s.x - 6, s.y - 48, 12, 18);
      ctx.beginPath(); ctx.arc(s.x, s.y - 54, 6, 0, Math.PI * 2); ctx.fill();
      ctx.fillRect(s.x - 5, s.y - 30, 4, 18); ctx.fillRect(s.x + 1, s.y - 30, 4, 18);
      ctx.fillRect(s.x + 4, s.y - 44, 16, 3);
      ctx.strokeStyle = 'rgba(255,255,255,0.4)'; ctx.lineWidth = 1;
      for (let yy = s.y - 66; yy < s.y; yy += 4) { ctx.beginPath(); ctx.moveTo(s.x - 20, yy); ctx.lineTo(s.x + 20, yy); ctx.stroke(); }
      ctx.restore();
      const b = Math.abs(Math.sin(this.time * 5)) * 8;
      ctx.font = "26px 'Black Ops One', Impact, sans-serif";
      ctx.textAlign = 'center';
      ctx.lineWidth = 5; ctx.strokeStyle = '#0b0f10'; ctx.strokeText('◎', s.x, s.y - 86 - b);
      ctx.fillStyle = '#5ae0ff'; ctx.fillText('◎', s.x, s.y - 86 - b);
    }

    drawRuins(ctx) {
      const s = this.project(0, 0);
      D.shadow(ctx, s.x, s.y + 6, 110, 52);
      for (const [dx, dy, r, c] of [[-44, -8, 32, '#4a4f46'], [32, -14, 36, '#5a6056'], [0, -30, 28, '#3d413a'], [-12, 6, 26, '#62675d']]) {
        D.ellipse(ctx, s.x + dx, s.y + dy, r, r * 0.6, c, '#151715', 2);
      }
      ctx.strokeStyle = '#2a2f33'; ctx.lineWidth = 4;
      ctx.beginPath(); ctx.moveTo(s.x + 10, s.y - 30); ctx.lineTo(s.x + 40, s.y - 80); ctx.moveTo(s.x - 20, s.y - 20); ctx.lineTo(s.x - 50, s.y - 60); ctx.stroke();
    }
  }

  /* =========================================================
     Boot
     ========================================================= */
  async function boot() {
    const game = new Game();
    TD.game = game;
    const { loaded, total } = await TD.Assets.loadAll();
    const n3d = await TD.S3.load();
    game.buildEnvironment();
    game.ui.applyIconAssets();
    game.ui.setAssetStatus(loaded, total);
    if (n3d) game.ui.$.assetStatus.textContent = `🧊 Đã nạp ${n3d} model 3D (ảnh dựng sẵn) — phần còn thiếu dùng đồ hoạ vector.`;
    game.audio.loadFiles();
    let best = 0;
    try { best = +localStorage.getItem('def_best_wave') || 0; } catch (e) { /* ignore */ }
    game.ui.showStart(best);
    game.ui.$.btnLab.textContent = `🧬 TECH LAB (${TechLab.points})`;
    const unlock = () => { game.audio.init(); window.removeEventListener('pointerdown', unlock); };
    window.addEventListener('pointerdown', unlock);
    // 📲 installable app (PWA): offline cache — only works when served over https / localhost
    if ('serviceWorker' in navigator && /^https?:$/.test(location.protocol)) {
      navigator.serviceWorker.register('sw.js').catch(() => { /* plain http on LAN → no offline cache, still playable */ });
    }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})(window.TD);
