/* =========================================================
   Config.js — balance values for the whole game.
   "⚙️ SKILL GAME" on the start screen edits these values;
   they are saved to localStorage and read live by the engine.
   ========================================================= */
window.TD = window.TD || {};

(function (TD) {
  'use strict';
  const STORE_KEY = 'def_mil_cfg_v1';

  const DEFAULTS = {
    energy: {
      redKills: 100,     // kills to fill the RED bar (tower tier / ultimate)
      greenKills: 20,    // kills to fill the GREEN bar (auxiliary card draft)
      greenGrow: 12,     // +% kills needed after every card draft (0 = always the same)
    },
    branch: {            // Lv1 values — Lv2 / Lv3 are scaled by BRANCH_LV below
      mine:   { dmg: 110,  cd: 9,  radius: 230, count: 8 },  // cd = respawn time per mine, radius = min. distance from the tower, count = mines at Lv1
      bomber: { dmg: 75,   cd: 16, radius: 80 },   // cd = sortie interval, radius = bomb blast radius
      nuke:   { dmg: 1400, cd: 45, radius: 260 },  // cd = launch interval, radius = blast radius
    },
    stats: {             // 6 gold-shop stats: base value + gain per level
      dmg:   { base: 12,  gain: 12 },   // dmg per bullet, +% of base per level
      rate:  { base: 6,   gain: 8 },    // bullets / s, +% of base per level
      armor: { base: 0,   gain: 4 },    // % damage reduction, + points per level
      regen: { base: 0,   gain: 1.0 },  // HP / s, + HP/s per level
      range: { base: 420, gain: 6 },    // world units, +% of base per level
      crit:  { base: 5,   gain: 2.5 },  // % chance, + points per level
    },
    enemies: {           // hp, dmg (per hit / per shot / per rocket), range (0 = melee), speed, atk (seconds between attacks)
      knife:    { hp: 40,  dmg: 8,  range: 0,   speed: 74,  atk: 0.9 },
      ak:       { hp: 60,  dmg: 5,  range: 250, speed: 56,  atk: 1.8 },
      sniper:   { hp: 55,  dmg: 30, range: 560, speed: 46,  atk: 4.0 },
      biker:    { hp: 70,  dmg: 55, range: 0,   speed: 175, atk: 0.5 },
      tank:     { hp: 520, dmg: 34, range: 320, speed: 26,  atk: 3.4 },
      drone:    { hp: 34,  dmg: 42, range: 0,   speed: 150, atk: 0.5 },
      katyusha: { hp: 280, dmg: 18, range: 610, speed: 38,  atk: 8.0 },
    },
    /** 6 equipment sub-skills (green cards) — Lv1 values, Lv2/Lv3 scaled by SUB_LV. */
    sub: {
      uav:     { dmg: 16,  duration: 10, cd: 14 },   // dmg per drone shot, flight time (s), dock recharge (s)
      railgun: { dmg: 300, fireInterval: 5 },        // dmg per beam, seconds between shots
      aegis:   { hp: 500,  duration: 8, cd: 24 },    // shield HP, uptime (s), cooldown (s)
      flamer:  { dmg: 55 },                          // DPS inside the cone
      gas:     { dmg: 45,  duration: 5, fireInterval: 6 }, // cloud DPS, cloud lifetime (s), CONSTANT launch interval
      barbed:  { dmg: 40 },                          // DPS zap on melee attackers
    },
    /** 7 new enemies — unique parameters (Skill Game → tab "Địch Mới"). */
    foes: {
      dozer:   { hp: 900, speed: 30, damageToWall: 90 },
      jammer:  { hp: 420, jamRadius: 560, rangeDebuffPercent: 40 },
      medic:   { hp: 480, healPerSec: 22, healRadius: 170, adrenalineDuration: 4 },
      para:    { squadSize: 5, hp: 55, fallDuration: 3, damage: 9 },
      stealth: { hp: 70, speed: 80, c4Damage: 120, explosionRadius: 110 },
      hbomber: { hp: 1100, speed: 115, bombCount: 4, bombDamage: 60 },
      sapper:  { tunnelSpeed: 55, hp: 120, popDamage: 45 },
    },
  };

  /** Lv1 / Lv2 / Lv3 multipliers of the equipment sub-skills (keys not in CFG are raw values). */
  const SUB_LV = {
    uav:     { dmg: [1, 1.2, 1.45], duration: [1, 1.35, 1.7], cd: [1, 0.8, 0.55], count: [1, 2, 3] },
    railgun: { dmg: [1, 550 / 300, 3], fireInterval: [1, 0.8, 0.6], pierce: [0, 1, 1], crit: [0, 0, 0.3] },
    aegis:   { hp: [1, 2, 3.6], duration: [1, 1.5, 2], cd: [1, 0.92, 0.85], reflect: [0, 0, 0.35] },
    flamer:  { dmg: [1, 1.35, 1.8], range: [130, 180, 180], sweep: [0, 1, 1], plasma: [0, 0, 1] },
    gas:     { dmg: [1, 85 / 45, 130 / 45], duration: [1, 1.5, 2], fireInterval: [1, 1, 1], slow: [0, 0.4, 0.4], burst: [0, 0, 1] },
    barbed:  { dmg: [1, 2.25, 3], arc: [0, 2, 3], pulse: [0, 0, 1] },
  };

  /** Lv1 / Lv2 / Lv3 multipliers of the three red-line branches. */
  const BRANCH_LV = {
    mine:   { dmg: [1, 1.45, 2.0], cd: [1, 0.7, 0.45], radius: [1, 1, 1], count: [1, 1.75, 2.5], blast: [80, 95, 115], knock: [180, 260, 360] },   // count 8 → 8 / 14 / 20
    bomber: { dmg: [1, 1.35, 1.8], cd: [1, 0.75, 0.55], radius: [1, 1.1, 1.22], planes: [1, 2, 3] },
    nuke:   { dmg: [1, 1.6, 2.4],  cd: [1, 0.62, 0.4],  radius: [1, 1.08, 1.16] },
  };

  /** Skill Game UI schema. */
  const E = (id, name) => ({
    title: name, fields: [
      { path: `enemies.${id}.hp`, label: 'Máu (HP)', min: 5, max: 5000, step: 5 },
      { path: `enemies.${id}.dmg`, label: 'Sát thương', min: 1, max: 400, step: 1 },
      { path: `enemies.${id}.range`, label: 'Tầm đánh (0 = cận chiến)', min: 0, max: 800, step: 10 },
      { path: `enemies.${id}.speed`, label: 'Tốc độ chạy', min: 5, max: 400, step: 1 },
      { path: `enemies.${id}.atk`, label: 'Hồi đòn (giây)', min: 0.2, max: 20, step: 0.1 },
    ],
  });
  const B = (id, name, cdLabel, rLabel, dmgMax) => ({
    title: name, fields: [
      { path: `branch.${id}.dmg`, label: 'Sát thương (Lv1)', min: 5, max: dmgMax, step: 5 },
      { path: `branch.${id}.cd`, label: cdLabel, min: 1, max: 120, step: 0.5 },
      { path: `branch.${id}.radius`, label: rLabel, min: 30, max: 600, step: 5 },
    ],
  });
  const S = (id, name, baseLabel, gainLabel, bmax, gmax, step = 0.5) => ({
    title: name, fields: [
      { path: `stats.${id}.base`, label: baseLabel, min: 0, max: bmax, step: id === 'range' ? 10 : step },
      { path: `stats.${id}.gain`, label: gainLabel, min: 0, max: gmax, step },
    ],
  });

  const F = (path, label, min, max, step) => ({ path, label, min, max, step });
  const G = (title, fields) => ({ title, fields });

  const SCHEMA = [
    {
      id: 'energy', tab: '⚡ Năng Lượng', groups: [
        { title: '🔴 Thanh Đỏ — Tiến hoá tháp & Tối thượng', fields: [{ path: 'energy.redKills', label: 'Số kill để đầy thanh đỏ', min: 10, max: 400, step: 5, presets: [50, 100, 150] }] },
        { title: '🟢 Thanh Xanh — Rút thẻ phụ trợ', fields: [
          { path: 'energy.greenKills', label: 'Số kill để đầy thanh xanh', min: 3, max: 120, step: 1, presets: [15, 20, 25] },
          { path: 'energy.greenGrow', label: '% kill tăng thêm sau mỗi lần rút', min: 0, max: 50, step: 1, presets: [0, 12, 25] },
        ] },
      ],
    },
    {
      id: 'branch', tab: '💣 Phòng Thủ P1', groups: [
        (() => { const g = B('mine', '💥 Bãi Mìn (rải ngẫu nhiên khắp bản đồ)', 'Hồi mìn (giây / quả, cài lại ở chỗ mới)', 'Khoảng cách tối thiểu từ tháp', 2000);
          g.fields.push({ path: 'branch.mine.count', label: 'Số mìn Lv1 (Lv2 ×1.75, Lv3 ×2.5)', min: 1, max: 40, step: 1, presets: [6, 8, 12] });
          return g; })(),
        B('bomber', '✈️ Không Kích Rải Bom', 'Chu kỳ xuất kích (giây)', 'Bán kính nổ mỗi quả bom', 2000),
        B('nuke', '☢️ Tên Lửa Hạt Nhân', 'Hồi phóng (giây)', 'Bán kính vụ nổ', 20000),
      ],
    },
    {
      id: 'stats', tab: '📈 Chỉ Số %', groups: [
        S('dmg', '💥 Sát thương', 'Gốc (mỗi viên)', '% tăng / cấp', 300, 100),
        S('rate', '⚡ Tốc độ bắn', 'Gốc (viên / giây)', '% tăng / cấp', 30, 100),
        S('armor', '🛡️ Giáp', 'Gốc (% giảm sát thương)', '+ điểm % / cấp', 60, 20),
        S('regen', '❤️ Hồi máu', 'Gốc (HP / giây)', '+ HP/s mỗi cấp', 50, 20),
        S('range', '📡 Tầm bắn', 'Gốc (đơn vị)', '% tăng / cấp', 900, 40),
        S('crit', '🎯 Chí mạng', 'Gốc (% tỉ lệ)', '+ điểm % / cấp', 50, 20),
      ],
    },
    {
      id: 'enemies', tab: '🪖 Địch', groups: [
        E('knife', '🔪 Lính Dao'), E('ak', '🔫 Lính AK'), E('sniper', '🎯 Lính Bắn Tỉa'),
        E('biker', '🏍️ Xe Máy Cảm Tử'), E('tank', '🛡️ Xe Tăng Thiết Giáp'),
        E('drone', '🛩️ Máy Bay Cảm Tử'), E('katyusha', '🚀 Xe Tên Lửa Katyusha'),
      ],
    },
    {
      id: 'sub', tab: '🚁 Trang Bị P2', groups: [
        G('🚁 Bầy Drone Tấn Công', [
          F('sub.uav.dmg', 'Sát thương mỗi phát (Lv1)', 1, 300, 1),
          F('sub.uav.duration', 'Thời gian bay (giây)', 2, 60, 0.5),
          F('sub.uav.cd', 'Hồi về sạc (giây)', 1, 90, 0.5),
        ]),
        G('🎯 Pháo Điện Từ Railgun', [
          F('sub.railgun.dmg', 'Sát thương mỗi tia (Lv1)', 10, 5000, 10),
          F('sub.railgun.fireInterval', 'Chu kỳ bắn (giây)', 0.5, 20, 0.1),
        ]),
        G('🛡️ Khiên Năng Lượng Aegis', [
          F('sub.aegis.hp', 'Máu khiên (Lv1)', 50, 10000, 10),
          F('sub.aegis.duration', 'Thời gian tồn tại (giây)', 1, 60, 0.5),
          F('sub.aegis.cd', 'Hồi chiêu (giây)', 1, 120, 0.5),
        ]),
        G('🔥 Súng Phun Lửa Napalm', [F('sub.flamer.dmg', 'Sát thương / giây (Lv1)', 5, 1000, 5)]),
        G('🧪 Cối Khí Độc', [
          F('sub.gas.dmg', 'Sát thương / giây (Lv1)', 5, 1000, 5),
          F('sub.gas.duration', 'Thời gian đám mây (giây)', 1, 30, 0.5),
          F('sub.gas.fireInterval', 'Chu kỳ phóng (CỐ ĐỊNH mọi cấp)', 1, 30, 0.5),
        ]),
        G('🪓 Hàng Rào Thép Gai Điện', [F('sub.barbed.dmg', 'Sát thương giật / giây (Lv1)', 5, 1000, 5)]),
      ],
    },
    {
      id: 'foes', tab: '☠️ Địch Mới', groups: [
        G('🚜 Xe Ủi Phá Tường', [
          F('foes.dozer.hp', 'Máu (HP)', 50, 20000, 10), F('foes.dozer.speed', 'Tốc độ', 5, 200, 1),
          F('foes.dozer.damageToWall', 'Sát thương vào tường / cú húc', 1, 1000, 1),
        ]),
        G('📡 Xe Gây Nhiễu EW', [
          F('foes.jammer.hp', 'Máu (HP)', 50, 20000, 10), F('foes.jammer.jamRadius', 'Bán kính nhiễu', 100, 1200, 10),
          F('foes.jammer.rangeDebuffPercent', '% giảm tầm bắn Minigun', 0, 90, 1),
        ]),
        G('🚑 Xe Cứu Thương APC', [
          F('foes.medic.hp', 'Máu (HP)', 50, 20000, 10), F('foes.medic.healPerSec', 'Hồi máu / giây', 0, 500, 1),
          F('foes.medic.healRadius', 'Bán kính hồi máu', 40, 600, 5), F('foes.medic.adrenalineDuration', 'Adrenaline khi chết (giây)', 0, 20, 0.5),
        ]),
        G('🪂 Lính Dù', [
          F('foes.para.squadSize', 'Số lính mỗi đợt thả', 1, 20, 1), F('foes.para.hp', 'Máu (HP)', 5, 2000, 5),
          F('foes.para.fallDuration', 'Thời gian rơi (giây)', 0.5, 10, 0.1), F('foes.para.damage', 'Sát thương cận chiến', 1, 300, 1),
        ]),
        G('🥷 Đặc Công Tàng Hình', [
          F('foes.stealth.hp', 'Máu (HP)', 5, 2000, 5), F('foes.stealth.speed', 'Tốc độ', 10, 300, 1),
          F('foes.stealth.c4Damage', 'Sát thương C4', 1, 2000, 5), F('foes.stealth.explosionRadius', 'Bán kính nổ C4', 20, 400, 5),
        ]),
        G('🛸 Pháo Đài Bay Ném Bom', [
          F('foes.hbomber.hp', 'Máu (HP)', 50, 30000, 10), F('foes.hbomber.speed', 'Tốc độ bay', 20, 500, 5),
          F('foes.hbomber.bombCount', 'Số bom rải thảm', 1, 12, 1), F('foes.hbomber.bombDamage', 'Sát thương mỗi quả bom', 1, 1000, 1),
        ]),
        G('⛏️ Công Binh Đào Hầm', [
          F('foes.sapper.tunnelSpeed', 'Tốc độ đào', 5, 300, 1), F('foes.sapper.hp', 'Máu (HP)', 5, 3000, 5),
          F('foes.sapper.popDamage', 'Sát thương khi trồi lên / thuốc nổ', 1, 1000, 1),
        ]),
      ],
    },
  ];

  const clone = (o) => JSON.parse(JSON.stringify(o));

  function mergeInto(dst, src) {
    if (!src || typeof src !== 'object') return dst;
    for (const k of Object.keys(dst)) {
      if (!(k in src)) continue;
      if (typeof dst[k] === 'object' && dst[k] !== null) mergeInto(dst[k], src[k]);
      else if (typeof src[k] === 'number' && isFinite(src[k])) dst[k] = src[k];
    }
    return dst;
  }

  function getPath(obj, path) { return path.split('.').reduce((o, k) => (o ? o[k] : undefined), obj); }
  function setPath(obj, path, v) {
    const ks = path.split('.');
    const last = ks.pop();
    const o = ks.reduce((a, k) => a[k], obj);
    o[last] = v;
  }

  function load() {
    const cfg = clone(DEFAULTS);
    try {
      const raw = localStorage.getItem(STORE_KEY);
      if (raw) mergeInto(cfg, JSON.parse(raw));
    } catch (e) { /* storage blocked or bad JSON → defaults */ }
    return cfg;
  }

  TD.CFG = load();
  TD.Config = {
    DEFAULTS, SCHEMA, BRANCH_LV, SUB_LV, getPath, setPath, clone,
    /** Equipment sub-skill value at level lv (1..3). */
    sub(id, key, lv) {
      const L = Math.max(1, Math.min(3, lv || 1)) - 1;
      const m = SUB_LV[id];
      const c = TD.CFG.sub[id];
      if (c && key in c) return c[key] * (m[key] ? m[key][L] : 1);
      return m[key][L];
    },
    /** Replace the live config (engine reads TD.CFG every time). */
    apply(cfg) {
      const fresh = mergeInto(clone(DEFAULTS), cfg);
      TD.CFG = fresh;
      try { localStorage.setItem(STORE_KEY, JSON.stringify(fresh)); } catch (e) { /* ignore */ }
      return fresh;
    },
    reset() {
      try { localStorage.removeItem(STORE_KEY); } catch (e) { /* ignore */ }
      TD.CFG = clone(DEFAULTS);
      return TD.CFG;
    },
    /** Branch value at level lv (1..3). */
    branch(id, key, lv) {
      const L = Math.max(1, Math.min(3, lv)) - 1;
      const m = BRANCH_LV[id];
      if (key in TD.CFG.branch[id]) return TD.CFG.branch[id][key] * m[key][L];
      return m[key][L];
    },
  };
})(window.TD);
