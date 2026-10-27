'use strict';

(function () {
  window.addEventListener('error', function (e) {
    console.error('PANEL_ERR ' + e.message + ' @ ' + e.filename + ':' + e.lineno);
  });
  const api = window.qqpetPanel;

  const $ = function (id) { return document.getElementById(id); };
  const toastEl = $('toast');
  const sheet = $('sheet');
  const sheetBody = $('sheetBody');

  let state = null;
  let lastLevel = null;
  let specClosedFor = -1;
  let dailyNotifiedDay = '';
  const repValues = {};
  let sheetKind = null;
  let schoolStage = 'primary';
  let sheetStatic = false;
  let sheetStack = [];
  let visit = null;
  let editingChatter = -1;
  let toastTimer = null;

  function toast(text) {
    if (!text) return;
    toastEl.textContent = text;
    toastEl.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { toastEl.classList.remove('show'); }, 2400);
  }

  function setBar(id, value) {
    const bar = $('bar' + id);
    if (bar) bar.style.width = Math.max(0, Math.min(100, value)) + '%';
  }

  function render(s) {
    try {
      renderBody(s);
    } catch (err) {
      console.error('RENDER_ERR ' + (err && err.stack ? err.stack : err));
    }
  }

  function renderBody(s) {
    if (!s) return;
    state = s;

    $('pName').textContent = s.name;
    $('pLevel').textContent = 'Lv.' + s.level;
    $('pState').textContent = s.label + (s.detail ? '，' + s.detail : '');
    $('pGrowth').textContent = s.cur + ' / ' + s.need;
    $('barGrowth').style.width = Math.max(0, Math.min(100, s.cur / s.need * 100)) + '%';
    $('pMoney').textContent = Math.floor(s.money);

    setBar('Hunger', s.hunger);
    setBar('Clean', s.clean);
    setBar('Mood', s.mood);
    setBar('Stamina', s.stamina);
    setBar('Health', s.health);
    $('valHunger').textContent = Math.round(s.hunger);
    $('valClean').textContent = Math.round(s.clean);
    $('valMood').textContent = Math.round(s.mood);
    $('valStamina').textContent = Math.round(s.stamina);
    $('valHealth').textContent = Math.round(s.health);

    const awayTag = $('awayTag');
    if (awayTag) {
      if (s.away && s.away.active) awayTag.hidden = false;
      else awayTag.hidden = true;
    }

    const sickTag = $('sickTag');
    if (s.sick && s.illness) {
      sickTag.hidden = false;
      sickTag.textContent = s.illness.name;
    } else {
      sickTag.hidden = true;
    }

    const perkBar = $('perkBar');
    if (perkBar) {
      const counts = {};
      (s.specs || []).forEach(function (x) { counts[x] = (counts[x] || 0) + 1; });
      const badges = (s.specsList || []).filter(function (sp) { return counts[sp.id]; }).map(function (sp) {
        const tip = esc(specTip(sp.id, counts[sp.id]));
        const dup = counts[sp.id] > 1 ? ' <b>脳' + counts[sp.id] + '</b>' : '';
        const img = SPEC_IMG[sp.id];
        if (img) {
          return '<span class="badge badge-icon" data-spec-tip="' + tip + '"><img class="badge-img" src="' + img +
            '" alt="' + sp.name + '">' + dup + '</span>';
        }
        return '<span class="badge" data-spec-tip="' + tip + '">' + sp.name + dup + '</span>';
      }).join('');
      const freeEl = $('freeStatus');
      const hasFree = s.freeQuota > 0;
      if (freeEl) {
        freeEl.hidden = !hasFree;
        freeEl.className = 'freeStatus' + (s.freeLeft > 0 ? '' : ' used');
        freeEl.textContent = s.freeLeft > 0 ? '每日免单 可用' : '每日免单 已用';
      }
      $('specBadges').innerHTML = badges;
      perkBar.hidden = !badges && !hasFree;
    }

    // 看病 / 还钱 / 复活共用一个格子
    const debt = s.debt || 0;
    if (!s.alive) {
      $('cureIco').textContent = '💫';
      $('cureTxt').textContent = '复活';
    } else if (debt > 0) {
      $('cureIco').textContent = '💰';
      $('cureTxt').textContent = '还钱';
    } else {
      $('cureIco').textContent = '🩺';
      $('cureTxt').textContent = '看病';
    }

    $('eduLabel').textContent = s.edu.label;
    $('attrZhi').textContent = s.edu.attrs.zhi;
    $('attrMei').textContent = s.edu.attrs.mei;
    $('attrWu').textContent = s.edu.attrs.wu;

    document.querySelectorAll('.act').forEach(function (b) {
      if (b.dataset.act) b.disabled = !s.can[b.dataset.act];
    });
    const cureTile = $('cureTile');
    if (cureTile) cureTile.disabled = !!(s.away && s.away.active);
    if (!s.alive) {
      document.querySelectorAll('.act').forEach(function (b) {
        if (b.id !== 'cureTile') b.disabled = true;
      });
      if (cureTile) cureTile.disabled = false;
      if (!window.__deadShown) {
        window.__deadShown = true;
        openDeadModal();
      }
    } else {
      window.__deadShown = false;
    }
    // 打工/学习互斥：忙碌时两个都不可点
    const away = !!(s.away && s.away.active);
    const workTile = document.querySelector('[data-open="jobs"]');
    if (workTile) workTile.disabled = !s.can.work;
    const studyTile = document.querySelector('[data-open="school"]');
    if (studyTile) studyTile.disabled = !s.can.study;
    const playTile = document.querySelector('[data-open="toys"]');
    if (playTile) playTile.disabled = !s.can.play;

    const rates = s.rates || {};
    const statEls = document.querySelectorAll('.stat');
    ['hunger', 'clean', 'mood', 'stamina', 'health'].forEach(function (k, i) {
      const r = rates[k];
      if (!r || !statEls[i]) return;
      const sign = r.rate > 0 ? '+' : '';
      statEls[i].setAttribute('data-tip', r.label + ' ' + sign + r.rate.toFixed(1) + '/小时');
    });

    renderActivity(s.busy);
    if (lastLevel !== null && s.level > lastLevel) {
      toast('升级！Lv.' + s.level + (s.specLeft > 0 ? '，可以选专精了' : ''));
    }
    lastLevel = s.level;
    maybeSpecModal(s);
    if (s.daily && s.daily.claimed && dailyNotifiedDay !== s.daily.day) {
      dailyNotifiedDay = s.daily.day;
      toast('每日任务完成，奖励已自动发放');
    }
    const ae = document.activeElement;
    const editing = !!(ae && ae.closest && ae.closest('#sheetBody') && (ae.tagName === 'INPUT' || ae.tagName === 'TEXTAREA'));
    if (sheetKind && !sheetStatic && !editing) renderSheet();
  }

  function specTip(id, n) {
    const c = Math.max(1, n || 1);
    if (id === 'diligent') {
      return '勤劳 Lv.' + c + '：打工时长 -' + Math.min(18, c * 3) + '%，打工体力消耗 -' + Math.min(30, c * 5) + '%';
    }
    if (id === 'scholar') {
      return '学霸 Lv.' + c + '：上课经验 +' + Math.min(18, c * 3) + '%，上课时长 -' + Math.min(18, c * 3) + '%';
    }
    if (id === 'health') {
      return '养生 Lv.' + c + '：状态消耗 -' + Math.min(9, c * 1.5) + '%，睡觉回体力 +' + Math.min(18, c * 3) + '%，生病概率 -' + Math.min(18, c * 3) + '%';
    }
    if (id === 'social') {
      return '社交 Lv.' + c + '：串门轮询 +' + Math.min(30, c * 5) + '%，好友位 +' + c;
    }
    if (id === 'lucky') {
      return '幸运 Lv.' + c + '：奖金概率 +' + Math.min(12, c * 2) + ' 个百分点，看病/复活费用 -' + Math.min(30, c * 5) + '%';
    }
    return '';
  }

  const SPEC_IMG = {
    scholar: '../src/xb_badge.png',
    diligent: '../src/badge_diligent.png',
    health: '../src/badge_health.png',
    social: '../src/badge_social.png',
    lucky: '../src/badge_lucky.png',
  };

  const tipEl = document.getElementById('specTip');
  function showSpecTip(el) {
    if (!tipEl) return;
    const txt = el.getAttribute('data-tip') || el.getAttribute('data-spec-tip');
    if (!txt) return;
    tipEl.textContent = txt;
    tipEl.hidden = false;
    const r = el.getBoundingClientRect();
    const tw = tipEl.offsetWidth;
    const th = tipEl.offsetHeight;
    let x = r.left + r.width / 2 - tw / 2 + 22;
    let y = r.top - th - 8;
    if (y < 4) y = r.bottom + 8;
    x = Math.max(6, Math.min(x, window.innerWidth - tw - 6));
    y = Math.max(4, Math.min(y, window.innerHeight - th - 4));
    tipEl.style.left = Math.round(x) + 'px';
    tipEl.style.top = Math.round(y) + 'px';
  }

  function hideSpecTip() {
    if (tipEl) tipEl.hidden = true;
  }

  document.addEventListener('mouseover', function (e) {
    const t = e.target.closest('[data-tip],[data-spec-tip]');
    if (t) showSpecTip(t);
  });
  document.addEventListener('mouseout', function (e) {
    if (e.target.closest('[data-tip],[data-spec-tip]')) hideSpecTip();
  });
  document.addEventListener('mousedown', hideSpecTip);

  function repVal(key) {
    const v = Number(repValues[key]);
    return Math.max(1, Math.min(5, Math.round(v || 1)));
  }

  function pct(x) {
    return Math.round((x || 0) * 100) + '%';
  }

  function maybeSpecModal(s) {
    const modal = $('specModal');
    if (!modal || !s.specsList) return;
    if (s.specLeft > 0 && specClosedFor !== s.specLeft) {
      buildSpecModal(s);
      modal.classList.add('show');
    } else {
      modal.classList.remove('show');
    }
  }

  function buildSpecModal(s) {
    const counts = {};
    (s.specs || []).forEach(function (x) { counts[x] = (counts[x] || 0) + 1; });
    $('specHint').textContent = '还可以选 ' + s.specLeft + ' 次，选择后永久生效。';
    $('specList').innerHTML = s.specsList.map(function (sp) {
      return '<div class="job"><div class="jmain"><div class="jname">' + sp.name + ' × ' + (counts[sp.id] || 0) + '</div>' +
        '<div class="jreq">' + sp.desc + '</div></div>' +
        '<button class="jbtn" data-spec="' + sp.id + '" data-name="' + sp.name + '">选择</button></div>';
    }).join('');
  }

  function renderDaily() {
    const d = state.daily || { tasks: [], claimed: true, total: 0, doneCount: 0 };
    $('sheetTitle').textContent = '每日任务';
    $('sheetHint').textContent = d.claimed ? '已完成' : (d.doneCount + '/' + d.total);
    const rows = (d.tasks || []).map(function (t) {
      const done = t.done >= t.target;
      return '<div class="job' + (done ? '' : ' locked') + '"><div class="jmain">' +
        '<div class="jname">' + (done ? '✓ ' : '○ ') + t.label + '</div>' +
        '<div class="jreq">' + Math.min(t.done, t.target) + ' / ' + t.target + '</div></div></div>';
    }).join('');
    const foot = d.claimed
      ? '<div class="empty">奖励已自动发放：30 金币 · 心情 +10 · 成长 +10。</div>'
      : '<div class="empty">全部完成后自动发放奖励（30 金币 · 心情 +10 · 成长 +10）。</div>';
    sheetBody.innerHTML = rows + foot;
  }

  function renderPerks() {
    const s = state;
    const p = s.perks || {};
    $('sheetTitle').textContent = '成长';
    $('sheetHint').textContent = 'Lv.' + s.level + ' · 专精 ' + (s.specs || []).length + '/' + s.specSlots;
    const rows = [
      ['打工时长', '-' + pct(p.workTime)],
      ['打工体力消耗', '-' + pct(p.workStamina)],
      ['状态消耗速度', '-' + pct(p.decay)],
      ['吃饭/洗澡/玩具效果', '+' + pct(p.effect)],
      ['睡觉回体力', '+' + pct(p.sleepStamina)],
      ['生病概率', '-' + pct(p.illness)],
      ['上课经验', '+' + pct(p.studyExp)],
      ['学费', '-' + pct(p.tuition)],
      ['串门轮询', '+' + pct(p.visitPoll)],
      ['好友位', '+' + (p.friends || 0)],
      ['打工奖金概率', '+' + pct(p.bonusChance)],
      ['看病/复活费用', '-' + pct(Math.max(p.cureCost || 0, p.reviveCost || 0))],
    ].map(function (r) {
      return '<div class="job"><div class="jmain"><div class="jname">' + r[0] + '</div></div>' +
        '<div class="jpay">' + r[1] + '</div></div>';
    }).join('');
    const counts = {};
    (s.specs || []).forEach(function (x) { counts[x] = (counts[x] || 0) + 1; });
    const owned = (s.specsList || []).filter(function (sp) { return counts[sp.id]; });
    const specRows = owned.length ? owned.map(function (sp) {
      return '<div class="job"><div class="jmain"><div class="jname">' + sp.name + ' × ' + counts[sp.id] + '</div>' +
        '<div class="jreq">' + sp.desc + '</div></div></div>';
    }).join('') : '<div class="empty">还没有专精，每 5 级可以选一次。</div>';
    sheetBody.innerHTML =
      '<div style="font-size:11px;color:#9aa3b6;margin-bottom:10px;line-height:1.6;">' +
      '每日免单 ' + s.freeLeft + '/' + s.freeQuota + ' 次（Lv10/20/30 各 +1，不限金额，复活除外）。</div>' +
      rows + '<div style="height:8px;"></div>' + specRows;
  }

  function renderActivity(busy) {
    const row = $('activityRow');
    if (!row) return;
    const growth = $('growthRow');
    if (!busy) {
      row.classList.remove('on');
      if (growth) growth.style.display = '';
      if ($('activityStop')) $('activityStop').hidden = true;
      return;
    }
    row.classList.add('on');
    // 忙碌时用进度条顶替成长条，避免面板超高
    if (growth) growth.style.display = 'none';
    const label = busy.kind === 'work' ? '打工中' : (busy.kind === 'study' ? '上课中' : '玩耍中');
    $('activityLabel').textContent = label;
    const left = Math.max(0, Math.round(busy.left / 1000));
    const mm = String(Math.floor(left / 60)).padStart(2, '0');
    const ss = String(left % 60).padStart(2, '0');
    $('activityLeft').textContent = mm + ':' + ss;
    $('barActivity').style.width = Math.round(busy.progress * 100) + '%';
    if ($('activityStop')) $('activityStop').hidden = false;
    const meta = $('activityMeta');
    if (meta && state) {
      meta.textContent = '成长 ' + state.cur + ' / ' + state.need;
    }
  }

  function setCost(id, n) {
    const el = $(id);
    if (!el) return;
    if (!n) {
      el.classList.add('hide');
      return;
    }
    el.classList.remove('hide');
    const b = el.querySelector('b');
    if (b) b.textContent = n;
  }

  function run(name) {
    return api.act(name).then(function (res) {
      if (res && !res.ok && res.msg) toast(res.msg);
      else if (res && res.free) toast('今日免单！');
      return res;
    });
  }

  /* ---------------- 弹层 ---------------- */

  function staticSheet(kind) {
    return kind === 'chatter' || kind === 'offwork' || kind === 'visit';
  }

  function openSheet(kind) {
    if (sheetKind) sheetStack.push(sheetKind);
    sheetKind = kind;
    sheetStatic = staticSheet(kind);
    editingChatter = -1;
    sheet.classList.add('show');
    renderSheet();
  }

  function closeSheet() {
    editingChatter = -1;
    // 多级菜单：先回上一层（3 级 → 2 级 → 1 级）
    if (sheetStack.length) {
      sheetKind = sheetStack.pop();
      sheetStatic = staticSheet(sheetKind);
      renderSheet();
      return;
    }
    sheetKind = null;
    sheetStatic = false;
    sheet.classList.remove('show');
  }

  function closeSheetAll() {
    sheetStack = [];
    sheetKind = null;
    sheetStatic = false;
    editingChatter = -1;
    sheet.classList.remove('show');
  }

  function renderSheet() {
    if (!state) return;
    if (sheetKind === 'school') return renderSchool();
    if (sheetKind === 'jobs') return renderJobs();
    if (sheetKind === 'food') return renderShop(state.actions.foods, 'food');
    if (sheetKind === 'toys') return renderShop(state.actions.toys, 'toys');
    if (sheetKind === 'more') return renderMore();
    if (sheetKind === 'baths') return renderBaths();
    if (sheetKind === 'visit') return renderVisit();
    if (sheetKind === 'cures') return renderCures();
    if (sheetKind === 'perks') return renderPerks();
    if (sheetKind === 'daily') return renderDaily();
    if (sheetKind === 'chatter') return renderChatter();
    if (sheetKind === 'offwork') return renderOffWork();
  }

  function renderSchool() {
    $('sheetTitle').textContent = '学校';

    const stages = state.edu.stages;
    const st = stages.filter(function (x) { return x.id === schoolStage; })[0] || stages[0];
    $('sheetHint').textContent = st.name + '：' + (st.realLessonMin || st.lessonMin) + ' 分钟/节 · ' + (st.price || st.cost) + ' 金币/节';

    const tabs = stages.map(function (x) {
      return '<button class="tab' + (x.id === st.id ? ' active' : '') +
        '" data-stage="' + x.id + '">' + x.name + '</button>';
    }).join('');

    const blocks = st.cats.map(function (cat) {
      const rows = cat.courses.map(function (c) {
        let right;
        if (c.done) {
          right = '<span class="cstate done">✓ 已修完</span>';
        } else if (c.reason) {
          right = '<span class="cstate">' + c.reason + '</span>' +
            '<button class="cbtn" disabled>上课</button>';
        } else {
          right = '<span class="cstate">' + c.progress + '/' + c.lessons + ' 节</span>' +
            '<input class="rep" type="number" min="1" max="5" value="' + repVal('course:' + st.id + ':' + cat.id + ':' + c.idx) + '" data-rep-key="course:' + st.id + ':' + cat.id + ':' + c.idx + '">' +
            '<button class="cbtn" data-enroll="' + st.id + ':' + cat.id + ':' + c.idx + '">上课</button>';
        }
        return '<div class="course"><span class="cname">' + c.name + '</span>' + right + '</div>';
      }).join('');

      return '<div class="catblock">' +
        '<div class="cathead"><span class="dot ' + cat.id + '"></span>' + cat.name +
        '<span class="prog">' + cat.done + '/' + (cat.courses ? cat.courses.length : 3) + '</span>' +
        (cat.graduated ? '<span class="grad">已毕业</span>' : '') +
        '</div>' + rows + '</div>';
    }).join('');

    sheetBody.innerHTML = '<div class="tabs">' + tabs + '</div>' + blocks;
  }

  function renderJobs() {
    $('sheetTitle').textContent = '找工作';
    $('sheetHint').textContent = '按班次';

    const rows = state.jobs.map(function (j) {
      const cost = '饱食-' + (j.hunger || 0) + ' · 体力-' + (j.stamina || 0) + ' · 清洁-' + (j.clean || 0);
      const m = j.mastery || { prof: 0, need: 5, mastered: false };
      return '<div class="job' + (j.available ? '' : ' locked') + '">' +
        '<div class="jmain"><div class="jname">' + j.name + ' · 熟练度 ' + m.prof + '/' + m.need + '</div>' +
        '<div class="jreq">时长 ' + (j.realMin || j.min) + ' 分钟 · 基础 ' + j.base + ' · ' + j.attrName + ' ' + j.attrValue + (m.mastered ? ' · 熟练 -10%' : '') + '</div>' +
        '<div class="jreq">' + j.req + '</div>' +
        '<div class="jreq">' + cost + '</div></div>' +
        '<div class="jpay"><i class="coin"></i>' + j.pay + '</div>' +
        '<input class="rep" type="number" min="1" max="5" value="' + repVal('job:' + j.id) + '" data-rep-key="job:' + j.id + '"' + (j.available ? '' : ' disabled') + '>' +
        '<button class="jbtn" data-job="' + j.id + '"' + (j.available ? '' : ' disabled') + '>' +
        (j.available ? '去工作' : '未解锁') + '</button>' +
        '</div>';
    }).join('');

    sheetBody.innerHTML =
      '<div style="font-size:11px;color:#9aa3b6;margin-bottom:10px;line-height:1.6;">' +
      '班次越长工资越高（单位时间工资同一档位一致）；消耗越多，越需要吃饭洗澡。</div>' + rows;
  }

  function renderBaths() {
    const list = state.actions.baths || [];
    $('sheetTitle').textContent = '洗澡';
    $('sheetHint').textContent = '';
    const rows = list.map(function (it) {
      const parts = [];
      if (it.clean) parts.push('+' + it.clean + ' 清洁');
      if (it.mood) parts.push((it.mood > 0 ? '+' : '') + it.mood + ' 心情');
      if (it.stamina) parts.push((it.stamina > 0 ? '+' : '') + it.stamina + ' 体力');
      if (it.health) parts.push((it.health > 0 ? '+' : '') + it.health + ' 健康');
      return '<div class="job"><div class="jmain"><div class="jname">' + it.name + '</div>' +
        '<div class="jreq">' + parts.join(' · ') + '</div></div>' +
        '<div class="jpay"><i class="coin"></i>' + it.price + '</div>' +
        '<button class="jbtn" data-shop="bath:' + it.id + '">洗一下</button></div>';
    }).join('');
    sheetBody.innerHTML = rows;
  }

  function refreshVisit() {
    api.visitStatus().then(function (v) {
      visit = v;
      if (sheetKind === 'visit') renderVisit();
    });
  }

  function renderCures() {
    const list = (state.actions && state.actions.illnesses) || [];
    const debt = state.debt || 0;
    const sickId = state.sick && state.illness ? state.illness.id : '';
    $('sheetTitle').textContent = '看病';
    $('sheetHint').textContent = debt > 0 ? '先还欠款' : '';
    const rows = list.map(function (it) {
      const can = !debt && sickId === it.id;
      let reason = '';
      if (debt) reason = '先还清欠款';
      else if (!sickId) reason = '没生病';
      else if (sickId !== it.id) reason = '得的不是这个病';
      else if (state.money < it.cost) reason = '可欠一次诊费';
      return '<div class="job' + (can ? '' : ' locked') + '">' +
        '<div class="jmain"><div class="jname">' + it.name + '</div>' +
        '<div class="jreq">' + it.hint + (reason ? ' · ' + reason : '') + '</div></div>' +
        '<div class="jpay"><i class="coin"></i>' + it.cost + '</div>' +
        '<button class="jbtn" data-shop="cure:' + it.id + '"' + (can ? '' : ' disabled') + '>' +
        (!can ? '治疗' : (state.money >= it.cost ? '治疗' : '欠费治疗')) + '</button></div>';
    }).join('');
    sheetBody.innerHTML = '<div style="font-size:11px;color:#9aa3b6;margin-bottom:10px;line-height:1.6;">' +
      (debt ? '欠款 ' + debt + ' 金币，还清后才能再看病。' : '基础价 + 健康缺失，越拖越贵；没生病或病种不对不能治疗。') +
      '</div>' + rows;
  }

  function renderVisit() {
    const h = visit ? visit.host : { enabled: false, running: false, address: '', code: '', guest: null };
    const away = visit ? visit.away : (state.away || { active: false });
    const offerOn = !!(visit && visit.offer && visit.offer.enabled);
    $('sheetTitle').textContent = '串门';
    $('sheetHint').textContent = h.running ? '接待中' : '';

    let html = '';

    if (visit && visit.request) {
      html += '<div class="job"><div class="jmain"><div class="jname">' + esc(visit.request.name) + ' 想接走宠物</div>' +
        '<div class="jreq">同意后宠物会去对方家</div></div>' +
        '<button class="jbtn small" id="visitAnswerOk">同意</button>' +
        '<button class="jbtn small" id="visitAnswerNo">拒绝</button></div>';
    }

    if (visit && visit.pulling && visit.pulling.active) {
      html += '<div class="job"><div class="jmain"><div class="jname">正在招待 ' + esc(visit.pulling.name || '朋友的宠物') + '</div>' +
        '<div class="jreq">它会在桌面上自己走动</div></div>' +
        '<button class="jbtn small" id="visitStopPull">停止</button></div>';
    } else if (away && away.active) {
      const mins = Math.max(1, Math.round((Date.now() - away.since) / 60000));
      html += '<div class="job"><div class="jmain"><div class="jname">在 ' + esc(away.host || '朋友家') + ' 串门</div>' +
        '<div class="jreq">已经 ' + mins + ' 分钟了</div></div>' +
        '<button class="jbtn small" id="visitCall">叫回家</button></div>';
    }

    html += '<div class="job" style="margin-top:12px"><div class="jmain"><div class="jname">我的门牌</div>' +
      '<div class="jreq">' + (h.enabled ? (h.running ? '把地址和门牌码发给朋友' : '启动中…') : '打开后朋友才能把宠物送过来') + '</div></div>' +
      '<button class="switch' + (h.enabled ? ' on' : '') + '" id="visitToggle"></button></div>';

    if (h.enabled) {
      html += '<div class="job"><div class="jmain"><div class="jname mono">' + esc(h.address) + ' · 码 ' + esc(h.code || '----') + '</div></div>' +
        '<button class="jbtn small" id="visitCopy">复制</button>' +
        '<button class="jbtn small" id="visitNewCode">换码</button></div>';
      if (h.guest) {
        html += '<div class="job"><div class="jmain"><div class="jname">' + esc(h.guest.name) + ' 在家</div>' +
          '<div class="jreq">Lv.' + h.guest.level + '</div></div>' +
          '<button class="jbtn small" id="visitGuestHome">送客</button></div>';
      }
      html += '<div class="job"><div class="jmain"><div class="jname">让对方来取</div>' +
        '<div class="jreq">' + (offerOn ? (h.picker ? '对方正在接…' : '已开启，把上面地址发给对方') : '对方连不上你时用') + '</div></div>' +
        '<button class="switch' + (offerOn ? ' on' : '') + '" id="visitOffer"></button></div>';
    }

    if (!(away && away.active) && !(visit && visit.pulling && visit.pulling.active)) {
      html += '<div class="job" style="margin-top:12px"><div class="jmain"><div class="jname">去串门</div>' +
        '<div class="jreq">送宠物过去，或去对方家取</div></div></div>' +
        '<div class="chatform"><input id="visitAddr" placeholder="IP:端口" value="' + esc((visit && visit.last && visit.last.address) || '') + '">' +
        '<input id="visitCode" class="code" placeholder="门牌码" maxlength="4" value="' + esc((visit && visit.last && visit.last.code) || '') + '"></div>' +
        '<div class="chatform" style="margin-top:6px">' +
        '<button class="jbtn small" id="visitSend">送过去</button>' +
        '<button class="jbtn small" id="visitPull">去取</button>' +
        '<button class="jbtn small" id="visitProbe">测试连接</button></div>';
    }

    if (visit && visit.friends && visit.friends.length) {
      html += '<div class="job" style="margin-top:12px"><div class="jmain"><div class="jname">好友</div>' +
        '<div class="jreq">点「使用」回填地址和门牌码</div></div></div>';
      visit.friends.forEach(function (f) {
        html += '<div class="job"><div class="jmain"><div class="jname">' + esc(f.name || f.address) + '</div>' +
          '<div class="jreq mono">' + esc(f.address) + '</div></div>' +
          '<button class="jbtn small" data-friend="' + esc(f.address) + '">使用</button>' +
          '<button class="jbtn small" data-friend-del="' + esc(f.address) + '">删除</button></div>';
      });
    }

    sheetBody.innerHTML = html;
  }

  function renderMore() {
    $('sheetTitle').textContent = '更多';
    $('sheetHint').textContent = '管理';
    const n = (state.chatter || []).length;
    const off = state.offWorkAt ? '每天 ' + state.offWorkAt : '未设置';
    sheetBody.innerHTML =
      '<div class="job"><div class="jmain"><div class="jname">碎碎念管理</div>' +
      '<div class="jreq">' + (n ? n + ' 条自定义' : '使用默认台词') + '</div></div>' +
      '<button class="jbtn" data-sheet="chatter">管理</button></div>' +
      '<div class="job"><div class="jmain"><div class="jname">下班倒计时</div>' +
      '<div class="jreq">' + off + '</div></div>' +
      '<button class="jbtn" data-sheet="offwork">设置</button></div>' +
      '<div class="job"><div class="jmain"><div class="jname">串门</div>' +
      '<div class="jreq">' + (state.away && state.away.active ? '宠物在 ' + esc(state.away.host || '朋友家') + ' 串门' : '送宠物去朋友家 / 接待客宠') + '</div></div>' +
      '<button class="jbtn" data-sheet="visit">打开</button></div>' +
      '<div class="job"><div class="jmain"><div class="jname">成长</div>' +
      '<div class="jreq">Lv.' + state.level + ' · 专精 ' + (state.specs || []).length + '/' + state.specSlots + '</div></div>' +
      '<button class="jbtn" data-sheet="perks">查看</button></div>' +
      '<div class="job"><div class="jmain"><div class="jname">每日任务</div>' +
      '<div class="jreq">' + (state.daily ? state.daily.doneCount + '/' + state.daily.total + (state.daily.claimed ? ' · 已完成' : '') : '0/3') + '</div></div>' +
      '<button class="jbtn" data-sheet="daily">查看</button></div>' +
      '<div class="job"><div class="jmain"><div class="jname">低状态提醒</div>' +
      '<div class="jreq">饱食/清洁/心情低于 20 时发系统通知</div></div>' +
      '<button class="jbtn" data-act-sheet="notifylow">' + (state.notifyLow ? '已开' : '已关') + '</button></div>' +
      '<div class="job"><div class="jmain"><div class="jname">存档</div>' +
      '<div class="jreq" style="word-break:break-all;">v' + (state.appVersion || '') + ' · ' + (state.savePath || '') + '</div></div>' +
      '<button class="jbtn" id="saveExport">导出</button>' +
      '<button class="jbtn" id="saveImport">导入</button></div>';
  }

  function esc(t) {
    return String(t).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }

  function renderChatter() {
    const list = state.chatter || [];
    $('sheetTitle').textContent = '碎碎念管理';
    $('sheetHint').textContent = list.length + '/30';
    const rows = list.map(function (t, i) {
      return '<div class="job"><div class="jmain"><div class="jname">' + esc(t) + '</div></div>' +
        '<button class="jbtn" data-edit="' + i + '">编辑</button>' +
        '<button class="jbtn" data-del="' + i + '">删除</button></div>';
    }).join('') || '<div class="empty">还没有自定义碎碎念，下面加一条吧。</div>';
    const editing = editingChatter >= 0 && list[editingChatter] !== undefined;
    sheetBody.innerHTML = rows +
      '<div class="chatform"><input id="chatterInput" maxlength="60" placeholder="写一句它要说的话"' +
      ' value="' + (editing ? esc(list[editingChatter]) : '') + '">' +
      '<button class="jbtn" id="chatterAdd">' + (editing ? '保存' : '添加') + '</button>' +
      (editing ? '<button class="jbtn" id="chatterCancel">取消</button>' : '') +
      '</div>';
  }

  function leftUntil(hhmm) {
    const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm || '');
    if (!m) return null;
    const now = new Date();
    const t = new Date(now.getFullYear(), now.getMonth(), now.getDate(), Number(m[1]), Number(m[2]), 0, 0);
    return (t.getTime() - now.getTime()) / 60000;
  }

  function renderOffWork() {
    $('sheetTitle').textContent = '下班倒计时';
    $('sheetHint').textContent = state.offWorkAt ? '每天 ' + state.offWorkAt : '未设置';
    let status;
    const left = state.offWorkLeft;
    if (!state.offWorkAt) status = '超过 1 小时每半小时提醒一次；最后 1 小时按 60 / 30 / 10 / 5 / 1 分钟提醒。';
    else if (left === null) status = '今天的时间已经过了，明天继续。';
    else if (left > 0) status = '还有 ' + Math.ceil(left) + ' 分钟下班。';
    else status = '到点啦，收工！';
    sheetBody.innerHTML =
      '<div class="offwork"><input type="time" id="offworkInput" value="' + (state.offWorkAt || '18:00') + '">' +
      '<button class="jbtn" id="offworkSave">保存</button>' +
      (state.offWorkAt ? '<button class="jbtn" id="offworkClear">清除</button>' : '') +
      '</div><div class="empty">' + status + '</div>';
  }

  function renderShop(items, kind) {
    const food = kind === 'food';
    $('sheetTitle').textContent = food ? '餐厅' : '玩具箱';
    $('sheetHint').textContent = '';

    const rows = items.map(function (it) {
      const eff = food
        ? '+' + it.hunger + ' 饱食 · +' + it.mood + ' 心情 · +' + it.stamina + ' 体力'
        : '+' + it.mood + ' 心情 · ' + it.seconds + ' 秒';
      const act = (food ? 'feed:' : 'toy:') + it.id;
      return '<div class="job">' +
        '<div class="jmain"><div class="jname">' + it.name + '</div>' +
        '<div class="jreq">' + eff + '</div></div>' +
        '<div class="jpay"><i class="coin"></i>' + it.price + '</div>' +
        '<button class="jbtn" data-shop="' + act + '">' + (food ? '吃掉！' : '玩去！') + '</button>' +
        '</div>';
    }).join('');

    sheetBody.innerHTML = rows;
  }

  sheetBody.addEventListener('input', function (e) {
    const r = e.target.closest('.rep');
    if (r && r.dataset.repKey) {
      const v = Math.max(1, Math.min(5, Math.round(Number(r.value) || 1)));
      repValues[r.dataset.repKey] = v;
    }
  });

  sheetBody.addEventListener('click', function (e) {
    const acts = e.target.closest('[data-act-sheet]');
    if (acts) {
      run(acts.dataset.actSheet).then(function () { renderMore(); });
      return;
    }
    if (e.target.id === 'saveExport') {
      api.exportSave().then(function (r) {
        if (r && r.ok) toast('已导出到 ' + r.path);
        else if (r && r.msg) toast(r.msg);
      });
      return;
    }
    if (e.target.id === 'saveImport') {
      api.importSave().then(function (r) {
        if (r && r.ok) toast('导入成功，正在重启…');
        else if (r && r.msg) toast(r.msg);
      });
      return;
    }
    const tab = e.target.closest('[data-stage]');
    if (tab) {
      schoolStage = tab.dataset.stage;
      renderSchool();
      return;
    }
    const en = e.target.closest('[data-enroll]');
    if (en) {
      const inp = en.parentNode.querySelector('.rep');
      const n = inp ? Math.max(1, Math.min(5, Math.round(Number(inp.value) || 1))) : 1;
      run('enroll:' + en.dataset.enroll + ':' + n);
      return;
    }
    const job = e.target.closest('[data-job]');
    if (job) {
      const inp = job.parentNode.querySelector('.rep');
      const n = inp ? Math.max(1, Math.min(5, Math.round(Number(inp.value) || 1))) : 1;
      run('job:' + job.dataset.job + ':' + n);
      return;
    }
    if (e.target.id === 'visitToggle') {
      api.visitHost({ enabled: !(visit && visit.host.enabled) }).then(function (r) {
        if (r && r.status) visit = r.status;
        renderVisit();
      });
      return;
    }
    if (e.target.id === 'visitNewCode') {
      api.visitCode().then(function (r) {
        if (r && r.status) visit = r.status;
        renderVisit();
      });
      return;
    }
    if (e.target.id === 'visitCopy') {
      if (visit) api.visitCopy(visit.host.address + '  门牌码 ' + visit.host.code);
      toast('已复制地址和门牌码');
      return;
    }
    if (e.target.id === 'visitSend') {
      const addr = $('visitAddr') ? $('visitAddr').value : '';
      const code = $('visitCode') ? $('visitCode').value : '';
      api.visitSend({ address: addr.trim(), code: code.trim() }).then(function (r) {
        if (r && !r.ok) toast(r.msg || '送不过去');
        else {
          toast('送过去啦');
          closeSheetAll();
        }
        refreshVisit();
      });
      return;
    }
    const friendUse = e.target.closest('[data-friend]');
    if (friendUse) {
      const f = (visit && visit.friends || []).find(function (x) { return x.address === friendUse.dataset.friend; });
      if (f) {
        if ($('visitAddr')) $('visitAddr').value = f.address;
        if ($('visitCode')) $('visitCode').value = f.code || '';
      }
      return;
    }
    const friendDel = e.target.closest('[data-friend-del]');
    if (friendDel) {
      api.visitFriendRemove(friendDel.dataset.friendDel).then(function () { refreshVisit(); });
      return;
    }
    if (e.target.id === 'visitAnswerOk' || e.target.id === 'visitAnswerNo') {
      api.visitAnswer({ ok: e.target.id === 'visitAnswerOk' }).then(function () { refreshVisit(); });
      return;
    }
    if (e.target.id === 'visitOffer') {
      api.visitOffer({ enabled: !(visit && visit.offer && visit.offer.enabled) }).then(function (r) {
        if (r && r.status) visit = r.status;
        if (r && !r.ok) toast(r.msg || '现在不能开启');
        renderVisit();
      });
      return;
    }
    if (e.target.id === 'visitPull') {
      const addr = $('visitAddr') ? $('visitAddr').value : '';
      const code = $('visitCode') ? $('visitCode').value : '';
      api.visitPull({ address: addr.trim(), code: code.trim() }).then(function (r) {
        if (r && !r.ok) toast(r.msg || '取不到');
        else toast('接到啦');
        refreshVisit();
      });
      return;
    }
    if (e.target.id === 'visitStopPull') {
      api.visitStopPull();
      toast('已停止');
      refreshVisit();
      return;
    }
    if (e.target.id === 'visitProbe') {
      const addr = $('visitAddr') ? $('visitAddr').value : '';
      if (!addr.trim()) {
        toast('先填对方地址');
        return;
      }
      toast('正在测试…');
      api.visitProbe(addr.trim()).then(function (r) {
        toast(r && r.msg ? r.msg : '测试失败');
      });
      return;
    }
    if (e.target.id === 'visitCall') {
      api.visitCall();
      toast('叫回家啦');
      refreshVisit();
      return;
    }
    if (e.target.id === 'visitGuestHome') {
      api.visitGuestHome();
      toast('已送客');
      refreshVisit();
      return;
    }
    const sheetBtn = e.target.closest('[data-sheet]');
    if (sheetBtn) {
      openSheet(sheetBtn.dataset.sheet);
      return;
    }
    const editBtn = e.target.closest('[data-edit]');
    if (editBtn) {
      editingChatter = Number(editBtn.dataset.edit);
      renderChatter();
      return;
    }
    const delBtn = e.target.closest('[data-del]');
    if (delBtn) {
      const idx = Number(delBtn.dataset.del);
      api.chatter({ op: 'remove', index: idx });
      if (state.chatter) state.chatter.splice(idx, 1);
      editingChatter = -1;
      renderChatter();
      return;
    }
    if (e.target.id === 'chatterAdd') {
      const input = $('chatterInput');
      const text = input ? input.value : '';
      if (!text.trim()) return;
      if (editingChatter >= 0) {
        api.chatter({ op: 'update', index: editingChatter, text: text });
        if (state.chatter) state.chatter[editingChatter] = text.trim();
      } else {
        api.chatter({ op: 'add', text: text });
        if (!state.chatter) state.chatter = [];
        state.chatter.push(text.trim());
      }
      editingChatter = -1;
      renderChatter();
      return;
    }
    if (e.target.id === 'chatterCancel') {
      editingChatter = -1;
      renderChatter();
      return;
    }
    if (e.target.id === 'offworkSave') {
      const v = $('offworkInput').value;
      api.offWork(v);
      state.offWorkAt = v;
      state.offWorkLeft = leftUntil(v);
      renderOffWork();
      return;
    }
    if (e.target.id === 'offworkClear') {
      api.offWork('');
      state.offWorkAt = '';
      state.offWorkLeft = null;
      renderOffWork();
      return;
    }
    const shop = e.target.closest('[data-shop]');
    if (shop) {
      run(shop.dataset.shop);
      return;
    }
    const cmd = e.target.closest('[data-cmd]');
    if (cmd) {
      api.cmd(cmd.dataset.cmd);
      closeSheet();
    }
  });

  sheetBody.addEventListener('keydown', function (e) {
    if (e.key === 'Enter' && e.target.id === 'chatterInput') {
      const add = $('chatterAdd');
      if (add) add.click();
    }
  });

  document.addEventListener('click', function (e) {
    const b = e.target.closest('[data-spec]');
    if (!b) return;
    const left = state ? state.specLeft : 0;
    api.act('spec:' + b.dataset.spec).then(function (res) {
      if (res && res.ok) {
        specClosedFor = Math.max(0, left - 1);
        $('specModal').classList.remove('show');
        toast('已选择「' + b.dataset.name + '」，永久生效');
      } else if (res && res.msg) {
        toast(res.msg);
      }
    });
  });

  $('activityStop').addEventListener('click', function () {
    if (!state) return;
    const kind = state.activity === 'work' ? '打工' : state.activity === 'study' ? '上课' : '玩耍';
    $('stopTitle').textContent = '停止' + kind + '？';
    $('stopHint').textContent = state.activity === 'work' ? '会按已经工作的时间结算工资。'
      : state.activity === 'study' ? '这一节课不会计入进度，学费不退。' : '当前玩耍会中断。';
    $('stopModal').classList.add('show');
  });
  $('stopCancel').addEventListener('click', function () {
    $('stopModal').classList.remove('show');
  });
  $('stopConfirm').addEventListener('click', function () {
    $('stopModal').classList.remove('show');
    run('stop').then(function (res) {
      if (res && res.ok) toast('已停止');
    });
  });
  $('stopModal').addEventListener('mousedown', function (e) {
    if (e.target === $('stopModal')) $('stopModal').classList.remove('show');
  });

  $('specLater').addEventListener('click', function () {
    specClosedFor = state ? state.specLeft : 0;
    $('specModal').classList.remove('show');
  });

  $('sheetClose').addEventListener('click', closeSheet);

  document.querySelectorAll('[data-open]').forEach(function (b) {
    b.addEventListener('click', function (e) {
      e.stopPropagation();
      if (b.dataset.open === 'jobs' && state && state.level < 3) {
        toast('我还太小了，不能打工…');
        return;
      }
      openSheet(b.dataset.open);
    });
  });

  $('eduBtn').addEventListener('click', function (e) {
    e.stopPropagation();
    openSheet('school');
  });

  /* ---------------- 直接动作 ---------------- */

  document.querySelectorAll('.act').forEach(function (b) {
    b.addEventListener('click', function (e) {
      e.stopPropagation();
      if (!b.dataset.act) return;
      if (b.dataset.act === 'cure' && state) {
        if (!state.alive) { openDeadModal(); return; }
        if ((state.debt || 0) > 0) { run('repay'); return; }
        openSheet('cures');
        return;
      }
      run(b.dataset.act);
    });
  });

  function openDeadModal() {
    if (!state) return;
    $('deadHint').textContent = '复活需要 ' + state.actions.revive.cost + ' 金币（你有 ' + Math.floor(state.money) + '）';
    $('reviveBtn').disabled = state.money < state.actions.revive.cost;
    $('deadModal').classList.add('show');
  }

  function closeDeadModal() {
    $('deadModal').classList.remove('show');
  }

  $('reviveBtn').addEventListener('click', function () {
    run('revive').then(function (res) {
      if (res && res.ok) closeDeadModal();
    });
  });
  $('restartBtn').addEventListener('click', function () {
    closeDeadModal();
    api.restart();
  });
  $('deadModal').addEventListener('mousedown', function (e) {
    if (e.target === $('deadModal')) closeDeadModal();
  });

  $('closeBtn').addEventListener('click', function () { api.hide(); });
  $('quitBtn').addEventListener('click', function () { api.quit(); });

  if (api.onOpenSheet) {
    api.onOpenSheet(function (kind) { openSheet(kind); });
  }

  if (api.onVisitToast) api.onVisitToast(toast);
  if (api.onVisitRefresh) api.onVisitRefresh(function () { if (sheetKind === 'visit') refreshVisit(); });
  refreshVisit();
  api.onState(render);
  api.get().then(render);
})();
