/* =========================================================
   UI.js — HUD (pills, HP + red/green energy bars, boss bar),
   skill hotbar, NÂNG CẤP drawer, card / branch choice modal,
   "⚙️ SKILL GAME" balance center, banners, floating numbers.
   ========================================================= */
(function (TD) {
  'use strict';
  const INK = '#0b0f10';

  /* ---------------- Green-line auxiliary cards (Lv1..3) ---------------- */
  const CARDS = [
    { id: 'rocket', icon: '🚀', name: 'Pháo Kích', rarity: 'rare', tag: 'TRANG BỊ',
      desc: ['Gắn bệ tên lửa lên tháp: 1 quả / loạt, khói kéo vệt, bám mục tiêu gần nhất', 'Loạt bắn 3 quả tên lửa', 'Loạt bắn 5 quả tên lửa'] },
    { id: 'tesla', icon: '⚡', name: 'Trạm Điện', rarity: 'rare', tag: 'TRANG BỊ',
      desc: ['Cuộn Tesla phóng sét lan 3 mục tiêu, ưu tiên địch gần', 'Sét lan 5 mục tiêu', 'Sét lan 7 mục tiêu'] },
    { id: 'sam', icon: '🛰️', name: 'Tên Lửa SAM', rarity: 'epic', tag: 'TRANG BỊ',
      desc: ['Phóng tên lửa SAM bổ nhào xuống địch, sát thương cực lớn (6s/lần). Ưu tiên bắn hạ tên lửa & drone', 'Hồi phóng 4.5s', 'Hồi phóng 3.2s'] },
    { id: 'laser', icon: '🔆', name: 'Laser Quét', rarity: 'epic', tag: 'TRANG BỊ',
      desc: ['Tia laser quét hình nón 45° qua chiến trường (hồi 5s)', 'Nón 70°, hồi 4s', 'Nón 100°, hồi 3.2s'] },
    { id: 'wall', icon: '🧱', name: 'Tường Rào & Công Binh', rarity: 'rare', tag: 'CÔNG SỰ',
      desc: ['Tường bao cát quanh tháp + 1 công binh sửa tường. Địch bộ phải phá tường mới vào được', 'Tường bê tông + 2 công binh', 'Tường thép titan + 3 công binh'] },
    { id: 'rate', icon: '⏩', name: 'Tốc Độ Bắn', rarity: 'common', tag: 'NỘI TẠI',
      desc: ['+20% tốc độ bắn súng chính', 'Tổng +40% tốc độ bắn', 'Tổng +60% tốc độ bắn'] },
    { id: 'multi', icon: '🎯', name: 'Bắn Nhiều Đối Tượng', rarity: 'common', tag: 'NỘI TẠI',
      desc: ['Lắp +1 tháp súng phụ trên nóc pháo đài: tự ngắm & bắn mục tiêu riêng (70% sát thương súng chính)', '+2 tháp súng phụ', '+3 tháp súng phụ'] },
    { id: 'explosive', icon: '💥', name: 'Đạn Nổ', rarity: 'rare', tag: 'NỘI TẠI',
      desc: ['25% viên đạn phát nổ: +50% sát thương, nổ lan 50% xung quanh', 'Nổ +75% sát thương', 'Nổ +100% sát thương'] },
    // ---------- Part I: 7 new ammo / protocol cards ----------
    { id: 'cryo', icon: '❄️', name: 'Đạn Băng Cryo', rarity: 'rare', tag: 'ĐẠN',
      desc: ['Đạn Minigun gây Lạnh Cóng: -30% tốc chạy & tốc đánh trong 3s', 'Lạnh Cóng -40%', 'Lạnh Cóng -50%'] },
    { id: 'incend', icon: '🔥', name: 'Đạn Cháy', rarity: 'rare', tag: 'ĐẠN',
      desc: ['Đốt cháy địch: 1.5% máu tối đa / giây trong 4s', 'Đốt 2.5% máu tối đa / giây', 'Đốt 3.5% máu tối đa / giây'] },
    { id: 'acid', icon: '🧪', name: 'Axit Ăn Mòn', rarity: 'rare', tag: 'ĐẠN',
      desc: ['Mỗi phát trúng lột vĩnh viễn 3 điểm giáp — đạn thường xuyên giáp xe tăng', 'Lột giáp + địch đã mòn nhận thêm 15% sát thương', 'Lột giáp + thêm 30% sát thương'] },
    { id: 'ricochet', icon: '⚡', name: 'Đạn Xuyên / Nảy', rarity: 'rare', tag: 'ĐẠN',
      desc: ['Đạn xuyên qua 1 mục tiêu', 'Đạn xuyên qua 2 mục tiêu', 'Xuyên 2 mục tiêu + nảy sang địch kế bên'] },
    { id: 'vortex', icon: '🧲', name: 'Bẫy Hố Đen', rarity: 'epic', tag: 'BẪY',
      desc: ['Đặt 2 mìn đặc biệt: kích nổ tạo xoáy chân không hút địch trong bán kính 150px rồi nổ sập. (Có Bãi Mìn: cứ 3 quả nổ → 1 xoáy)', '3 mìn xoáy, nạp nhanh hơn, xoáy lâu hơn', '4 mìn xoáy, nổ sập mạnh hơn'] },
    { id: 'overclock', icon: '☠️', name: 'Giao Thức Quá Tải', rarity: 'epic', tag: 'LỜI NGUYỀN', max: 1,
      desc: ['+100% tốc độ bắn Minigun — NHƯNG pháo đài mất 1% máu mỗi giây khi đang xả đạn (không tự giết tháp)'] },
    { id: 'bounty', icon: '💰', name: 'Thợ Săn Tiền Thưởng', rarity: 'epic', tag: 'LỜI NGUYỀN', max: 1,
      desc: ['Địch +20% máu & tốc độ, nhưng rơi ×2 vàng 🪙 khi chết'] },
    // ---------- Part II: 6 new equipment sub-skills ----------
    { id: 'uav', icon: '🚁', name: 'Bầy Drone Tấn Công', rarity: 'epic', tag: 'TRANG BỊ',
      desc: ['1 drone tuần tra trên không, bắn tỉa địch máu thấp nhất; hết giờ về sạc', '2 drone, bay lâu hơn, sạc nhanh hơn', '3 drone, bay tối đa & xuất kích liên tục'] },
    { id: 'railgun', icon: '🎯', name: 'Pháo Điện Từ Railgun', rarity: 'epic', tag: 'TRANG BỊ',
      desc: ['Tia siêu thanh 300 sát thương mỗi 5s, nhắm địch máu cao nhất', '550 sát thương / 4s, xuyên thủng mọi địch trên đường thẳng', '900 sát thương / 3s, 30% chí mạng ×2 (1800) + choáng 2s'] },
    { id: 'aegis', icon: '🛡️', name: 'Khiên Aegis', rarity: 'epic', tag: 'TRANG BỊ',
      desc: ['Bong bóng năng lượng hấp thụ 100% đạn tầm xa (AK, bắn tỉa, Katyusha, bom). 500 HP / 8s, hết giờ tự sập', '1000 HP / 12s', '1800 HP / 16s, phản 35% đạn ngược về kẻ bắn'] },
    { id: 'flamer', icon: '🔥', name: 'Súng Phun Lửa Napalm', rarity: 'rare', tag: 'TRANG BỊ',
      desc: ['4 vòi góc phun lửa hình nón 130px vào lính cận chiến, đốt 3s', 'Tầm 180px, quét 360° quanh căn cứ', 'Lửa Plasma xanh: làm tan 50% giáp xe tăng trong vùng phun'] },
    { id: 'gas', icon: '🧪', name: 'Cối Khí Độc', rarity: 'rare', tag: 'TRANG BỊ',
      desc: ['Bắn bình hoá chất vào cụm địch, mây độc 45 DPS / 5s (chu kỳ bắn cố định)', '85 DPS / 7.5s, làm chậm 40%', '130 DPS / 10s, địch chết trong khói phát nổ độc lan'] },
    { id: 'barbed', icon: '🪓', name: 'Hàng Rào Thép Gai Điện', rarity: 'rare', tag: 'CÔNG SỰ',
      desc: ['Dây thép gai điện quanh tháp: giật 40 DPS, -35% tốc đánh địch cận chiến. ⚠️ Loại trừ Tường Rào', 'Giật 90 DPS, phóng hồ quang sang địch phía sau', 'Cứ 5 đòn cận chiến → Xung Sốc 360° đẩy lùi 80px'] },
  ];
  /** Mutually exclusive defensive layers — picking one purges the other from the pool. */
  const EXCLUSIVE = { wall: 'barbed', barbed: 'wall' };
  const FALLBACK_CARDS = [
    { id: 'cash', icon: '💵', name: 'Tiếp Tế Quân Nhu', rarity: 'common', tag: 'TIẾP TẾ', desc: ['+250 🪙 ngay lập tức'], repeat: true },
    { id: 'medkit', icon: '🩹', name: 'Sửa Chữa Toàn Diện', rarity: 'common', tag: 'TIẾP TẾ', desc: ['Hồi 40% HP tháp & sửa toàn bộ tường'], repeat: true },
  ];

  /* ---------------- Red-line special defense branches ---------------- */
  const BRANCHES = [
    { id: 'mine', icon: '💣', name: 'Vành Đai Bãi Mìn', rarity: 'epic', tag: 'NHÁNH PHÒNG THỦ',
      desc: 'Rải mìn ngẫu nhiên khắp chiến trường (8 quả); nổ xong sẽ cài lại ở chỗ mới. Lv2–3: 14 / 20 quả, nạp nhanh hơn, nổ mạnh & hất văng xa hơn.' },
    { id: 'bomber', icon: '✈️', name: 'Không Kích Rải Bom', rarity: 'epic', tag: 'NHÁNH PHÒNG THỦ',
      desc: 'Oanh tạc cơ định kỳ bay ngang chiến trường rải một hàng bom chùm. Lv2–3: thêm máy bay, xuất kích dày hơn, bom mạnh hơn.' },
    { id: 'nuke', icon: '☢️', name: 'Tên Lửa Hạt Nhân', rarity: 'epic', tag: 'NHÁNH PHÒNG THỦ',
      desc: 'Tự khoá mục tiêu có máu cao nhất (xe tăng / boss) và thả đầu đạn hạt nhân chiến thuật. Lv2–3: hồi phóng nhanh hơn nhiều, nổ & phóng xạ mạnh hơn.' },
  ];

  /* ---------------- Active skills [1]..[4] ---------------- */
  const SKILLS = [
    { id: 'artillery', key: '1', icon: '🎯', name: 'Pháo Binh', cd: 22 },
    { id: 'emp', key: '2', icon: '📡', name: 'EMP', cd: 30 },
    { id: 'repair', key: '3', icon: '🔧', name: 'Sửa Chữa', cd: 35 },
    { id: 'decoy', key: '4', icon: '🛰️', name: 'Mồi Nhử', cd: 20 },
  ];

  const STAT_ROWS = [
    { id: 'dmg', label: '💥 Sát thương' },
    { id: 'rate', label: '⚡ Tốc độ bắn' },
    { id: 'armor', label: '🛡️ Giáp' },
    { id: 'regen', label: '❤️ Hồi máu' },
    { id: 'range', label: '📡 Tầm bắn' },
    { id: 'crit', label: '🎯 Chí mạng' },
  ];
  const AUX_ROWS = [
    { id: 'rocket', label: '🚀 Pháo kích', card: 'Pháo Kích' },
    { id: 'tesla', label: '⚡ Trạm điện', card: 'Trạm Điện' },
    { id: 'sam', label: '🛰️ SAM', card: 'Tên Lửa SAM' },
    { id: 'laser', label: '🔆 Laser', card: 'Laser Quét' },
    { id: 'wall', label: '🧱 Độ bền tường', card: 'Tường Rào' },
    { id: 'uav', label: '🚁 Drone', card: 'Bầy Drone' },
    { id: 'railgun', label: '🎯 Railgun', card: 'Railgun' },
    { id: 'aegis', label: '🛡️ Khiên Aegis', card: 'Khiên Aegis' },
    { id: 'flamer', label: '🔥 Phun lửa', card: 'Phun Lửa' },
    { id: 'gas', label: '🧪 Khí độc', card: 'Cối Khí Độc' },
    { id: 'barbed', label: '🪓 Thép gai', card: 'Thép Gai Điện' },
  ];

  const FLOAT_STYLES = {
    normal: { color: '#ffe9b8', size: 20 },
    crit:   { color: '#ffe14d', size: 34, suffix: '!' },
    shock:  { color: '#8af4ff', size: 20 },
    laser:  { color: '#ff7af2', size: 22 },
    gold:   { color: '#ffcc33', size: 22 },
    hurt:   { color: '#ff6a5a', size: 24 },
    heal:   { color: '#7dff6a', size: 28 },
    info:   { color: '#ffffff', size: 28 },
    big:    { color: '#ffe14d', size: 44 },
    slow:   { color: '#8af4ff', size: 20 },
    burn:   { color: '#ff9a3c', size: 18 },
    acid:   { color: '#b6ff3a', size: 20 },
  };

  class UI {
    constructor(game) {
      this.game = game;
      this.floaters = [];
      this.shopOpen = false;
      this.$ = {};
      [
        'waveNum', 'goldNum', 'scoreNum', 'killNum', 'goldPill', 'hpBar', 'hpFill', 'hpLag', 'hpText', 'hpArmor',
        'redFill', 'redText', 'greenFill', 'greenText', 'redBar', 'greenBar',
        'bossBar', 'bossFill', 'bossName', 'combo', 'comboNum', 'comboMult', 'comboTimer',
        'btnSpeed', 'btnMute', 'btnPause', 'intermission', 'nextWaveNum', 'nextWaveTime', 'btnNextWave',
        'skills', 'shop', 'shopToggle', 'shopContent', 'shopGold', 'banner', 'bossWarning',
        'perkModal', 'perkCards', 'perkTitle', 'perkSub', 'startScreen', 'btnStart', 'btnCfg', 'bestLine', 'assetStatus',
        'pauseScreen', 'btnResume', 'btnQuit', 'gameOver', 'goWave', 'goKills', 'goGold', 'goCombo', 'goScore', 'goBest', 'btnRetry',
        'cfgModal', 'cfgTabs', 'cfgBody', 'cfgSave', 'cfgReset', 'cfgClose', 'cfgToast',
        'labModal', 'labBody', 'labPoints', 'labClose', 'labRefund', 'btnLab', 'btnLabGo', 'goTech', 'jamWarn',
      ].forEach((id) => { this.$[id] = document.getElementById(id); });
      this.cache = {};
      this.shopTick = 0;
      this.cfgTab = 'energy';
      this.buildSkills();
      this.bind();
    }

    icon(key, emoji) {
      const img = TD.Assets.get('icon_' + key);
      return img ? `<img src="${img.src}" alt="">` : emoji;
    }
    applyIconAssets() {
      document.querySelectorAll('[data-icon]').forEach((el) => {
        const img = TD.Assets.get('icon_' + el.dataset.icon);
        if (img) el.innerHTML = `<img src="${img.src}" alt="">`;
      });
      const hb = TD.Assets.get('health_bar');
      if (hb) { this.$.hpBar.classList.add('skin'); this.$.hpBar.style.backgroundImage = `url(${hb.src})`; }
      this.buildSkills();
    }

    /* ---------------- events ---------------- */
    bind() {
      const g = this.game;
      const $ = this.$;
      $.btnStart.onclick = () => g.startGame();
      $.btnRetry.onclick = () => g.startGame();
      $.btnResume.onclick = () => g.togglePause(false);
      $.btnQuit.onclick = () => g.startGame();
      $.btnPause.onclick = () => g.togglePause();
      $.btnMute.onclick = () => this.setMuted(g.audio.toggleMute());
      $.btnSpeed.onclick = () => { g.speed = g.speed === 1 ? 2 : 1; $.btnSpeed.textContent = g.speed === 1 ? '⏩ x1' : '⏩ x2'; g.audio.play('click'); };
      $.btnNextWave.onclick = () => g.skipIntermission();
      $.shopToggle.onclick = () => this.toggleShop();
      $.btnCfg.onclick = () => this.openCfg();
      $.cfgClose.onclick = () => this.closeCfg();
      $.cfgSave.onclick = () => this.saveCfg();
      $.cfgReset.onclick = () => this.resetCfg();
      $.btnLab.onclick = () => this.openLab();
      $.btnLabGo.onclick = () => this.openLab();
      $.labClose.onclick = () => this.closeLab();
      $.labRefund.onclick = () => { TD.TechLab.refund(); this.renderLab(); g.audio.play('click'); };
      $.labBody.addEventListener('click', (e) => {
        const b = e.target.closest('button[data-lab]');
        if (!b || b.disabled) return;
        if (TD.TechLab.buy(b.dataset.lab)) { g.audio.init(); g.audio.play('upgrade'); } else g.audio.play('deny');
        this.renderLab();
      });
      $.skills.addEventListener('click', (e) => {
        const b = e.target.closest('.skill');
        if (b) g.pressSkill(+b.dataset.i);
      });
      $.shopContent.addEventListener('click', (e) => {
        const b = e.target.closest('button[data-action]');
        if (!b || b.disabled) return;
        if (b.dataset.action === 'stat') g.buyStat(b.dataset.stat);
        else if (b.dataset.action === 'aux') g.buyAux(b.dataset.stat);
      });
      $.shop.addEventListener('mousedown', (e) => e.stopPropagation());
      $.cfgTabs.addEventListener('click', (e) => {
        const b = e.target.closest('button[data-tab]');
        if (!b) return;
        this.cfgTab = b.dataset.tab;
        this.renderCfg();
        g.audio.play('click');
      });
      $.cfgBody.addEventListener('input', (e) => {
        const el = e.target;
        if (!el.dataset.path) return;
        let v = parseFloat(el.value);
        if (!isFinite(v)) return;
        TD.Config.setPath(this.cfgDraft, el.dataset.path, v);
        this.$.cfgBody.querySelectorAll(`[data-path="${el.dataset.path}"]`).forEach((o) => { if (o !== el) o.value = v; });
      });
      $.cfgBody.addEventListener('click', (e) => {
        const b = e.target.closest('button[data-preset]');
        if (!b) return;
        const v = +b.dataset.preset;
        TD.Config.setPath(this.cfgDraft, b.dataset.for, v);
        this.$.cfgBody.querySelectorAll(`[data-path="${b.dataset.for}"]`).forEach((o) => { o.value = v; });
        g.audio.play('click');
      });
    }

    setMuted(m) { this.$.btnMute.textContent = m ? '🔇' : '🔊'; }

    /** 📱 v11: portrait = shop permanently docked in the bottom panel (no [B] drawer). */
    setPortrait(p) {
      this.portrait = p;
      this.shopOpen = p;
      this.$.shop.classList.toggle('closed', !p);
      this.$.shop.classList.toggle('docked', p);
      this.cache = {};
      this.renderShop();
    }

    toggleShop(force) {
      if (this.portrait) return;                     // docked in portrait — nothing to toggle
      this.shopOpen = force != null ? force : !this.shopOpen;
      this.$.shop.classList.toggle('closed', !this.shopOpen);
      if (this.shopOpen) this.renderShop();
      this.game.audio.play('click');
    }

    /* ---------------- skills bar ---------------- */
    buildSkills() {
      this.$.skills.innerHTML = SKILLS.map((s, i) => `
        <button class="skill" data-i="${i}" title="${s.name} [${s.key}]">
          <kbd>${s.key}</kbd>
          <span class="s-icon">${this.icon(s.id, s.icon)}</span>
          <span class="s-name">${s.name}</span>
          <div class="cd"></div>
          <div class="cd-text"></div>
        </button>`).join('');
      this.skillEls = [...this.$.skills.querySelectorAll('.skill')].map((el) => ({
        el, cd: el.querySelector('.cd'), txt: el.querySelector('.cd-text'), ready: null,
      }));
    }
    /** 📱 Aim mode feedback: highlight the button + hint banner. i = -1 → off. */
    setAiming(i, s) {
      this.skillEls.forEach((e, k) => e.el.classList.toggle('aiming', k === i));
      const h = document.getElementById('aimHint');
      if (!h) return;
      if (i < 0) { h.classList.add('hidden'); return; }
      h.innerHTML = `${s.icon} <b>${s.name}</b> — chạm vào bản đồ để chọn mục tiêu<br><small>Chạm lại nút = tự nhắm cụm địch đông nhất</small>`;
      h.classList.remove('hidden');
    }
    flashSkill(i) {
      const s = this.skillEls[i];
      if (!s) return;
      s.el.classList.remove('flash'); void s.el.offsetWidth; s.el.classList.add('flash');
    }

    /* ---------------- shop ---------------- */
    pips(lv, max) {
      let h = '';
      for (let i = 1; i <= max; i++) h += `<i class="${i <= lv ? 'on' : ''}"></i>`;
      return `<span class="pips">${h}</span>`;
    }
    costBtn(attrs, cost) {
      if (!isFinite(cost)) return `<button class="buy max" disabled>MAX</button>`;
      return `<button class="buy" ${attrs} data-cost="${cost}">🪙${cost}</button>`;
    }

    renderShop() {
      if (this.portrait) { this.renderShopPortrait(); return; }
      const g = this.game;
      const t = g.tower;
      const tierNames = ['Boong-ke', 'Tháp 2 tầng', 'Tháp radar 3 tầng', 'Siêu Pháo Đài'];
      const br = t.branchId ? BRANCHES.find((b) => b.id === t.branchId) : null;
      let html = `<div class="w-card">
        <div class="w-head"><div class="w-icon tier">T${t.tier}</div>
        <div><div class="w-name">${tierNames[t.tier]}</div>
        <div class="w-desc">${br ? `${br.icon} ${br.name} — Lv${t.branch.lv}` : 'Đầy thanh 🔴 để lên tầng & chọn nhánh phòng thủ'}</div></div></div></div>`;
      html += `<div class="w-card">
        <div class="w-head"><div class="w-icon" style="background:#59633e">🔫</div>
        <div><div class="w-name">Súng Máy Chính</div><div class="w-desc">Minigun nòng xoay — ưu tiên bắn hạ tên lửa địch đang bay.</div></div></div>`;
      for (const r of STAT_ROWS) {
        html += `<div class="stat-row"><span>${r.label}</span>${this.pips(t.lv[r.id], TD.STAT_MAX)}<span class="val">${t.statValue(r.id)}</span>
          ${this.costBtn(`data-action="stat" data-stat="${r.id}"`, t.upgradeCost(r.id))}</div>`;
      }
      html += `</div><div class="w-card">
        <div class="w-head"><div class="w-icon" style="background:#3e5162">🧰</div>
        <div><div class="w-name">Trang Bị Phụ Trợ</div><div class="w-desc">Nhận trang bị từ thẻ 🟢, nâng sát thương bằng vàng (+20%/cấp).</div></div></div>`;
      for (const r of AUX_ROWS) {
        const has = (t.cards[r.id] || 0) > 0;
        if (!has) {
          const ex = EXCLUSIVE[r.id] && (t.cards[EXCLUSIVE[r.id]] || 0) > 0;
          html += `<div class="stat-row locked"><span>${r.label}</span><span class="lock">${ex ? '⛔ Bị loại trừ (đã chọn lớp phòng thủ kia)' : `🔒 Cần thẻ “${r.card}”`}</span></div>`;
          continue;
        }
        const val = r.id === 'wall' ? t.wall.segMax : '+' + (t.aux[r.id] * 20) + '%';
        html += `<div class="stat-row"><span>${r.label}</span>${this.pips(t.aux[r.id], TD.AUX_MAX)}<span class="val">${val}</span>
          ${this.costBtn(`data-action="aux" data-stat="${r.id}"`, t.auxCost(r.id))}</div>`;
      }
      html += '</div>';
      this.$.shopContent.innerHTML = html;
      this.refreshShopButtons();
    }

    /** 📱 Portrait console: 2 columns of big stat tiles (≥48 px buttons) + owned equipment below. */
    renderShopPortrait() {
      const g = this.game, t = g.tower;
      const tierNames = ['Boong-ke', 'Tháp 2 tầng', 'Tháp radar 3 tầng', 'Siêu Pháo Đài'];
      const br = t.branchId ? BRANCHES.find((b) => b.id === t.branchId) : null;
      const tile = (label, lv, max, val, btn) => `<div class="p-stat">
          <div class="p-top"><span class="p-lbl">${label}</span></div>
          <div class="p-mid"><div class="p-row"><b class="p-val">${val}</b><span class="p-lvl">Lv ${lv}/${max}</span></div>${this.pips(lv, max)}</div>${btn}</div>`;
      let html = '<div class="p-grid">';
      for (const r of STAT_ROWS) {
        html += tile(r.label, t.lv[r.id], TD.STAT_MAX, t.statValue(r.id), this.costBtn(`data-action="stat" data-stat="${r.id}"`, t.upgradeCost(r.id)));
      }
      html += '</div>';
      const owned = AUX_ROWS.filter((r) => (t.cards[r.id] || 0) > 0);
      html += `<div class="p-sec">🧰 Trang bị phụ trợ ${owned.length ? '' : '<small>— rút thẻ 🟢 để mở khoá</small>'}</div>`;
      if (owned.length) {
        html += '<div class="p-grid">';
        for (const r of owned) {
          const val = r.id === 'wall' ? t.wall.segMax : '+' + (t.aux[r.id] * 20) + '%';
          html += tile(r.label, t.aux[r.id], TD.AUX_MAX, val, this.costBtn(`data-action="aux" data-stat="${r.id}"`, t.auxCost(r.id)));
        }
        html += '</div>';
      }
      html += `<div class="p-sec p-tier"><span class="w-icon tier">T${t.tier}</span> ${tierNames[t.tier]} · ${br ? `${br.icon} ${br.name} Lv${t.branch.lv}` : 'đầy 🔴 để lên tầng'}</div>`;
      this.$.shopContent.innerHTML = html;
      this.refreshShopButtons();
    }

    refreshShopButtons() {
      const gold = this.game.gold;
      this.$.shopContent.querySelectorAll('button[data-cost]').forEach((b) => {
        const ok = gold >= +b.dataset.cost;
        b.disabled = !ok;
        b.classList.toggle('afford', ok);
      });
    }

    canAffordAnything() {
      const g = this.game, t = g.tower;
      for (const r of STAT_ROWS) if (g.gold >= t.upgradeCost(r.id)) return true;
      for (const r of AUX_ROWS) if (g.gold >= t.auxCost(r.id)) return true;
      return false;
    }

    /* ---------------- HUD update ---------------- */
    set(key, val) {
      if (this.cache[key] === val) return;
      this.cache[key] = val;
      this.$[key].textContent = val;
    }

    update(dt) {
      const g = this.game;
      const t = g.tower;
      for (let i = this.floaters.length - 1; i >= 0; i--) {
        const f = this.floaters[i];
        f.age += dt;
        f.z += f.vz * dt;
        f.vz *= Math.max(0, 1 - dt * 3);
        f.x += f.vx * dt;
        if (f.age >= f.life) this.floaters.splice(i, 1);
      }

      this.set('waveNum', String(g.wave));
      this.set('goldNum', String(Math.floor(g.gold)));
      this.set('shopGold', String(Math.floor(g.gold)));
      this.set('scoreNum', g.score.toLocaleString('vi-VN'));
      this.set('killNum', String(g.kills));

      const pct = Math.max(0, t.hp / t.maxHp);
      this.$.hpFill.style.width = (pct * 100).toFixed(1) + '%';
      this.$.hpLag.style.width = (pct * 100).toFixed(1) + '%';
      this.set('hpText', `${Math.ceil(t.hp)} / ${t.maxHp}`);
      if (this.$.hpArmor) this.set('hpArmor', `🛡️${Math.round(t.armorPct)}%`);
      this.$.hpBar.classList.toggle('low', pct < 0.3);

      // energy bars
      const redMax = Math.max(1, TD.CFG.energy.redKills);
      const greenMax = g.greenNeed;
      const rp = Math.min(1, g.redEnergy / redMax), gp = Math.min(1, g.greenEnergy / greenMax);
      this.$.redFill.style.width = (rp * 100).toFixed(1) + '%';
      this.$.greenFill.style.width = (gp * 100).toFixed(1) + '%';
      const redLbl = t.tier >= 3 ? 'TỐI THƯỢNG' : `TIER ${t.tier} → ${t.tier + 1}`;
      this.set('redText', `🔴 ${redLbl} · ${Math.floor(Math.min(g.redEnergy, redMax))}/${redMax}`);
      this.set('greenText', `🟢 THẺ PHỤ TRỢ · ${Math.floor(Math.min(g.greenEnergy, greenMax))}/${greenMax}`);
      this.$.redBar.classList.toggle('full', rp >= 0.999);
      this.$.greenBar.classList.toggle('full', gp >= 0.999);

      const show = g.combo >= 3;
      this.$.combo.classList.toggle('hidden', !show);
      const jam = g.jamFactor > 0 && g.state === 'playing';
      this.$.jamWarn.classList.toggle('hidden', !jam);
      if (jam) this.set('jamWarn', `📡 BỊ GÂY NHIỄU — TẦM BẮN -${Math.round(g.jamFactor * 100)}%`);
      if (show) {
        this.set('comboNum', String(g.combo));
        this.set('comboMult', g.comboMult.toFixed(2).replace(/\.?0+$/, '') || '1');
        this.$.comboTimer.style.width = Math.max(0, (g.comboTimer / g.comboWindow) * 100) + '%';
      }

      const boss = g.enemies.find((e) => e.type === 'boss' && !e.dead);
      this.$.bossBar.classList.toggle('hidden', !boss);
      if (boss) {
        this.$.bossFill.style.width = (boss.hp / boss.maxHp) * 100 + '%';
        this.set('bossName', `${boss.cfg.name} — ${Math.ceil(boss.hp)}`);
      }

      g.skills.forEach((s, i) => {
        const el = this.skillEls[i];
        if (!el) return;
        const ready = s.t <= 0;
        el.cd.style.height = (ready ? 0 : (s.t / s.maxT) * 100) + '%';
        const txt = ready ? '' : Math.ceil(s.t);
        if (el.lastTxt !== txt) { el.txt.textContent = txt; el.lastTxt = txt; }
        if (el.ready !== ready) { el.el.classList.toggle('ready', ready); el.ready = ready; }
      });

      const inter = g.intermission > 0 && g.state === 'playing';
      this.$.intermission.classList.toggle('hidden', !inter);
      if (inter) {
        this.set('nextWaveNum', String(g.wave + 1));
        this.set('nextWaveTime', String(Math.ceil(g.intermission)));
      }

      this.shopTick -= dt;
      if (this.shopTick <= 0) {
        this.shopTick = 0.2;
        if (this.shopOpen) this.refreshShopButtons();
        this.$.shopToggle.classList.toggle('can-buy', !this.shopOpen && this.canAffordAnything());
      }
    }

    bumpGold() { const p = this.$.goldPill; p.classList.remove('bump'); void p.offsetWidth; p.classList.add('bump'); }
    towerHurt() { const b = this.$.hpBar; b.classList.remove('hurt'); void b.offsetWidth; b.classList.add('hurt'); }
    pulseBar(which) { const b = this.$[which]; b.classList.remove('pulse'); void b.offsetWidth; b.classList.add('pulse'); }

    /* ---------------- floating numbers ---------------- */
    float(x, y, z, text, style = 'normal') {
      if (this.floaters.length > 140) this.floaters.shift();
      const st = FLOAT_STYLES[style] || FLOAT_STYLES.normal;
      this.floaters.push({
        x: x + (Math.random() - 0.5) * 16, y, z,
        vx: (Math.random() - 0.5) * 30, vz: style === 'big' ? 60 : 110 + Math.random() * 40,
        text: (st.prefix || '') + text + (st.suffix || ''),
        color: st.color, size: st.size, age: 0,
        life: style === 'big' ? 1.3 : style === 'crit' ? 0.95 : 0.8, style,
      });
    }

    drawFloaters(ctx) {
      const g = this.game;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.lineJoin = 'round';
      for (const f of this.floaters) {
        const s = g.project(f.x, f.y, f.z);
        let sc;
        if (f.age < 0.08) sc = 0.4 + (f.age / 0.08) * 1.0;
        else if (f.age < 0.2) sc = 1.4 - ((f.age - 0.08) / 0.12) * 0.4;
        else sc = 1;
        ctx.globalAlpha = Math.max(0, Math.min(1, (f.life - f.age) / (f.life * 0.35)));
        ctx.save();
        ctx.translate(s.x, s.y);
        const ts = g.textScale || 1;
        ctx.scale(sc * ts, sc * ts);
        if (f.style === 'crit') ctx.rotate(-0.06);
        const font = f.style === 'crit' || f.style === 'big' || f.style === 'info' ? "'Black Ops One', 'Impact', sans-serif" : "'Rajdhani', 'Arial Narrow', sans-serif";
        ctx.font = `700 ${f.size}px ${font}`;
        ctx.lineWidth = f.size > 30 ? 7 : 5;
        ctx.strokeStyle = INK;
        ctx.strokeText(f.text, 0, 0);
        ctx.fillStyle = f.color;
        ctx.fillText(f.text, 0, 0);
        ctx.restore();
      }
      ctx.globalAlpha = 1;
    }

    /* ---------------- banners & screens ---------------- */
    banner(title, sub = '', kind = '') {
      const b = this.$.banner;
      b.className = kind ? 'k-' + kind : '';
      b.querySelector('.b-title').textContent = title;
      b.querySelector('.b-sub').textContent = sub;
      void b.offsetWidth;
      b.classList.remove('hidden');
      clearTimeout(this._bannerT);
      this._bannerT = setTimeout(() => b.classList.add('hidden'), 2200);
    }
    bossWarning(text) {
      const w = this.$.bossWarning;
      w.querySelector('.bw-text').textContent = text || '⚠️ SIÊU TĂNG ĐANG ĐẾN! ⚠️';
      w.classList.add('hidden'); void w.offsetWidth; w.classList.remove('hidden');
      clearTimeout(this._bossT);
      this._bossT = setTimeout(() => w.classList.add('hidden'), 3000);
    }

    /** Roll 3 auxiliary cards (owned cards come back as upgrades). */
    rollCards() {
      const t = this.game.tower;
      const pool = CARDS.filter((c) => (t.cards[c.id] || 0) < (c.max || 3) && !(EXCLUSIVE[c.id] && (t.cards[EXCLUSIVE[c.id]] || 0) > 0));
      const out = [];
      while (out.length < 3 && pool.length) {
        const w = pool.map((c) => (c.rarity === 'epic' ? 0.6 : c.rarity === 'rare' ? 0.85 : 1) * ((t.cards[c.id] || 0) > 0 ? 1.25 : 1));
        let r = Math.random() * w.reduce((a, b) => a + b, 0);
        let i = 0;
        while (r > w[i]) { r -= w[i]; i++; }
        out.push(pool.splice(Math.min(i, pool.length - 1), 1)[0]);
      }
      for (const f of FALLBACK_CARDS) if (out.length < 3) out.push(f);
      return out;
    }

    /** Generic 3-card choice modal (cards & branches). */
    showChoice(title, sub, items, onPick) {
      const labels = { common: 'THƯỜNG', rare: 'HIẾM', epic: 'SỬ THI' };
      this.$.perkTitle.textContent = title;
      this.$.perkSub.textContent = sub;
      this.$.perkCards.innerHTML = items.map((p, i) => `
        <button class="perk ${p.rarity}" data-i="${i}">
          <div class="p-tag">${p.tag || ''}</div>
          <div class="p-icon">${p.icon}</div>
          <div class="p-name">${p.name}</div>
          ${p.lvText ? `<div class="p-lv">${p.lvText}</div>` : ''}
          <div class="p-desc">${p.descText}</div>
          <div class="p-rarity">${labels[p.rarity]}</div>
        </button>`).join('');
      this.$.perkModal.classList.remove('hidden');
      this.$.perkCards.querySelectorAll('.perk').forEach((el) => {
        el.onclick = () => {
          this.$.perkModal.classList.add('hidden');
          onPick(items[+el.dataset.i]);
        };
      });
    }

    showCards(onPick) {
      const t = this.game.tower;
      const items = this.rollCards().map((c) => {
        const cur = t.cards[c.id] || 0;
        return Object.assign({}, c, {
          lvText: c.repeat ? '' : cur ? `Lv${cur} ➔ Lv${cur + 1}` : 'MỚI',
          descText: c.desc[Math.min(cur, c.desc.length - 1)],
        });
      });
      this.showChoice('🟢 Chọn 1 Thẻ Phụ Trợ', 'Thẻ đã có sẽ xuất hiện lại dưới dạng nâng cấp (tối đa Lv3)', items, onPick);
    }
    showBranches(onPick) {
      const items = BRANCHES.map((b) => Object.assign({}, b, { lvText: 'Lv1 ➔ tự lên Lv2 / Lv3 ở Tier 2 / 3', descText: b.desc }));
      this.showChoice('🔴 TIER 1 — Chọn Nhánh Phòng Thủ Đặc Biệt', 'Chỉ được chọn 1 lần — nhánh tự nâng cấp khi tháp tiến hoá', items, onPick);
    }

    showStart(bestWave) {
      this.$.startScreen.classList.remove('hidden');
      this.$.bestLine.textContent = bestWave ? `🏆 Kỷ lục: Wave ${bestWave}` : '';
    }

    setAssetStatus(loaded, total) {
      this.$.assetStatus.textContent = loaded === 0
        ? `Đồ hoạ vector vẽ bằng code (${total} ảnh có thể thay). Thả PNG vào assets/images/ để thay thế.`
        : `Đã tải ${loaded}/${total} ảnh từ assets/ — phần còn lại dùng đồ hoạ vector.`;
    }

    showPause(on) { this.$.pauseScreen.classList.toggle('hidden', !on); }

    showGameOver(stats, best, isRecord) {
      const $ = this.$;
      $.goWave.textContent = stats.wave;
      $.goKills.textContent = stats.kills;
      $.goGold.textContent = stats.goldEarned;
      $.goCombo.textContent = stats.maxCombo;
      $.goScore.textContent = stats.score.toLocaleString('vi-VN');
      $.goBest.textContent = isRecord ? '🏆 KỶ LỤC MỚI!' : best ? `🏆 Kỷ lục: Wave ${best}` : '';
      $.goTech.textContent = `+${stats.tech || 0} 🧬 Điểm Công Nghệ (tổng ${TD.TechLab.points})`;
      $.gameOver.classList.remove('hidden');
    }

    hideAllOverlays() {
      ['gameOver', 'pauseScreen', 'perkModal', 'startScreen', 'banner', 'bossWarning', 'cfgModal', 'labModal'].forEach((k) => this.$[k].classList.add('hidden'));
    }

    /* =========================================================
       🧬 MILITARY TECH LAB — permanent progression
       ========================================================= */
    openLab() {
      this.$.labModal.classList.remove('hidden');
      this.renderLab();
      this.game.audio.play('click');
    }
    closeLab() {
      this.$.labModal.classList.add('hidden');
      this.game.audio.play('click');
    }
    renderLab() {
      const L = TD.TechLab;
      this.$.labPoints.textContent = L.points;
      this.$.btnLab.textContent = `🧬 TECH LAB (${L.points})`;
      this.$.labBody.innerHTML = L.DEFS.map((d) => {
        const lv = L.lv[d.id] || 0, cost = L.cost(d.id);
        const maxed = lv >= L.MAX;
        return `<div class="lab-row">
          <div class="lab-ico">${d.icon}</div>
          <div class="lab-txt"><div class="lab-name">${d.name} <span>Lv${lv}/${L.MAX}</span></div>
            <div class="lab-desc">${d.desc}</div>
            <div class="lab-now">Hiện tại: <b>${d.fmt(lv)}</b>${maxed ? '' : ` → <b>${d.fmt(lv + 1)}</b>`}</div>
            ${this.pips(lv, L.MAX)}</div>
          ${maxed ? '<button class="buy max" disabled>MAX</button>' : `<button class="buy" data-lab="${d.id}" ${L.points < cost ? 'disabled' : ''}>🧬${cost}</button>`}
        </div>`;
      }).join('');
    }

    reset() {
      this.floaters.length = 0;
      this.cache = {};
      this.shopOpen = !!this.portrait;
      this.$.shop.classList.toggle('closed', !this.portrait);
      if (this.portrait) this.renderShop();
    }

    /* =========================================================
       ⚙️ SKILL GAME — balance & tuning center
       ========================================================= */
    openCfg() {
      this.cfgDraft = TD.Config.clone(TD.CFG);
      this.$.cfgModal.classList.remove('hidden');
      this.renderCfg();
      this.game.audio.init();
      this.game.audio.play('click');
    }
    closeCfg() { this.$.cfgModal.classList.add('hidden'); this.game.audio.play('click'); }
    saveCfg() {
      TD.Config.apply(this.cfgDraft);
      this.cfgDraft = TD.Config.clone(TD.CFG);
      this.toast('✅ Đã lưu & áp dụng — có hiệu lực từ trận tiếp theo');
      this.game.audio.play('upgrade');
    }
    resetCfg() {
      TD.Config.reset();
      this.cfgDraft = TD.Config.clone(TD.CFG);
      this.renderCfg();
      this.toast('↺ Đã khôi phục giá trị mặc định');
      this.game.audio.play('click');
    }
    toast(msg) {
      const t = this.$.cfgToast;
      t.textContent = msg;
      t.classList.remove('show'); void t.offsetWidth; t.classList.add('show');
    }
    renderCfg() {
      const S = TD.Config.SCHEMA;
      this.$.cfgTabs.innerHTML = S.map((s) => `<button data-tab="${s.id}" class="${s.id === this.cfgTab ? 'on' : ''}">${s.tab}</button>`).join('');
      const tab = S.find((s) => s.id === this.cfgTab) || S[0];
      const dft = TD.Config.DEFAULTS;
      let h = '';
      for (const grp of tab.groups) {
        h += `<div class="cfg-group"><div class="cfg-gtitle">${grp.title}</div>`;
        for (const f of grp.fields) {
          const v = TD.Config.getPath(this.cfgDraft, f.path);
          const dv = TD.Config.getPath(dft, f.path);
          h += `<div class="cfg-row"><label>${f.label}<small>mặc định ${dv}</small></label>
            <input type="range" min="${f.min}" max="${f.max}" step="${f.step}" value="${v}" data-path="${f.path}">
            <input type="number" min="${f.min}" max="${f.max}" step="${f.step}" value="${v}" data-path="${f.path}">`;
          if (f.presets) h += `<span class="presets">${f.presets.map((p) => `<button data-preset="${p}" data-for="${f.path}">${p}</button>`).join('')}</span>`;
          h += `</div>`;
        }
        h += `</div>`;
      }
      if (tab.id === 'branch') h += `<div class="cfg-note">Giá trị là cấp Lv1. Lv2 / Lv3 tự nhân: Mìn ×1.45/×2.0 sát thương, hồi ×0.7/×0.45, số mìn ×1.75/×2.5 (mặc định 8 → 14 → 20), rải ngẫu nhiên khắp bản đồ · Bom ×1.35/×1.8, chu kỳ ×0.75/×0.55 · Hạt nhân ×1.6/×2.4, hồi ×0.62/×0.4.</div>`;
      if (tab.id === 'sub') h += `<div class="cfg-note">Giá trị Lv1. Lv2/Lv3 tự nhân — Drone: số lượng 1/2/3, bay ×1.35/×1.7, sạc ×0.8/×0.55 · Railgun: 300→550→900, chu kỳ ×0.8/×0.6 · Aegis: HP ×2/×3.6, thời gian ×1.5/×2 · Phun lửa ×1.35/×1.8 · Khí độc 45→85→130 DPS, thời gian ×1.5/×2 (chu kỳ phóng KHÔNG đổi) · Thép gai ×2.25/×3.</div>`;
      if (tab.id === 'foes') h += `<div class="cfg-note">Máu & sát thương còn được nhân theo hệ số wave. Lính dù từ wave 6, Xe cứu thương 7, Xe ủi 8, Công binh đào hầm 9, Đặc công 10, Xe gây nhiễu 11, Pháo đài bay 12.</div>`;
      if (tab.id === 'stats') h += `<div class="cfg-note">Mỗi chỉ số có 15 cấp trong Xưởng Nâng Cấp. Ví dụ Sát thương cấp n = Gốc × (1 + %tăng × n).</div>`;
      this.$.cfgBody.innerHTML = h;
    }
  }

  TD.CARDS = CARDS;
  TD.BRANCHES = BRANCHES;
  TD.SKILLS = SKILLS;
  TD.UI = UI;
})(window.TD);
