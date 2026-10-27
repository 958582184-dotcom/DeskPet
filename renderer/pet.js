'use strict';

(function () {
  const api = window.qqpet;

  const ANIM = {
    idle: '待机呼吸休闲',
    idleAlt: '东张西望',
    walk: '螃蟹走路',
    walkAlt: '原地漂浮踏步',
    drag: '被鼠标拖拽悬空反馈',
    eat: '吃白饭',
    eatAlt: '大口吃零食',
    bath: '玩水枪',
    sleep: '原地小憩沉眠',
    study: '写代码',
    work: '工作状态-忙碌点按',
    sick: '工作状态-垂头叹气冒汗',
    cheer: '工作状态-雀跃庆祝',
    revive: '凭空生花',
    toyMirror: '照镜子',
    toyCat: '撸猫',
    clicks: ['点击回应-开心跃动', '点击回应-害羞惊讶', '点击回应-元气挥手', '点击回应-挠痒咯咯笑'],
    idles: ['悠闲哼歌', '超大伸懒腰', '哈欠连天', '照镜子', '撸猫', '偷吃零食被抓住', '原地敲击桌面互动', '深度思考碎碎念'],
  };

  const zoom = document.getElementById('zoom');
  const stage = document.getElementById('stage');
  const bubble = document.getElementById('bubble');
  const vids = [document.getElementById('vA'), document.getElementById('vB')];
  const hit = document.getElementById('hit');

  let front = 0;
  let current = '';
  let currentLoop = false;
  let oneShot = false;
  let state = null;
  let walking = false;
  let flying = false;
  let facing = -1; // -1 = 朝左（素材原始朝向）
  let bubbleTimer = null;
  let idleTimer = null;
  let dragging = false;
  let down = null;
  let moved = false;

  function facingTransform(dir) {
    // 素材本身朝左，朝右要镜像（dsh-pet 的约定：facing==='right' 时 scaleX(-1)）
    return 'scaleX(' + (dir >= 0 ? -1 : 1) + ')';
  }

  function url(name) {
    return '../assets/anim/' + encodeURIComponent(name) + '.webm';
  }

  let swapSeq = 0;

  function animLog(msg) {
    try { if (api.animLog) api.animLog(msg); } catch (err) { /* ignore */ }
  }

  function play(name, loop, onEnd) {
    if (!name) return;
    const visible = document.querySelector('#stage video.front');
    if (name === current && loop === currentLoop) {
      if (visible && (visible.paused || visible.ended)) {
        try { visible.currentTime = 0; visible.play(); } catch (err) { /* ignore */ }
      }
      return;
    }

    const seq = ++swapSeq;
    const next = vids[1 - front];
    const old = vids[front];
    animLog('play ' + name + ' loop=' + loop + ' seq=' + seq + ' cur=' + current + ' oneShot=' + oneShot + ' hid=' + document.hidden);

    // 上一次切换还没 loadeddata 就被新动画取代：先拆掉旧监听，避免一个事件触发两次 swap 把 front 翻乱
    if (next._swap) {
      next.removeEventListener('loadeddata', next._swap);
      next._swap = null;
    }

    current = name;
    currentLoop = loop;
    next.loop = !!loop;
    next.onended = function () {
      if (seq === swapSeq && onEnd) onEnd();
    };

    const swap = function () {
      next.removeEventListener('loadeddata', swap);
      next._swap = null;
      if (seq !== swapSeq) {
        animLog('swap-stale ' + name + ' seq=' + seq);
        return;
      }
      next.classList.add('front');
      old.classList.remove('front');
      try { old.pause(); } catch (e) { /* ignore */ }
      const p = next.play();
      animLog('swap-ok ' + name + ' rs=' + next.readyState + ' paused=' + next.paused);
      if (p && p.catch) p.catch(function () { /* 自动播放被拒时保持上一帧 */ });
      front = 1 - front;
    };

    setTimeout(function () {
      if (seq === swapSeq && next._swap) {
        animLog('swap-timeout ' + name + ' rs=' + next.readyState + ' ns=' + next.networkState +
          ' err=' + (next.error ? next.error.code : 0));
        swap();
      }
    }, 1300);

    next.onerror = function () {
      console.warn('[pet] 动画加载失败: ' + name + ' -> ' + url(name));
    };

    next._swap = swap;
    next.addEventListener('loadeddata', swap);
    next.src = url(name);
    next.load();
    if (next.readyState >= 2) swap();
  }

 /* ---------------- 状态 → 动画 ---------------- */

  function baseAnim() {
    if (!state) return ANIM.idle;
    if (!state.alive) return ANIM.sick;
    if (state.absent) return ANIM.sleep;
    if (state.sick) return ANIM.sick;
    if (state.activity === 'sleep') return ANIM.sleep;
    if (state.activity === 'work') return ANIM.work;
    if (state.activity === 'study') return ANIM.study;
    if (state.activity === 'play') return ANIM.clicks[0];
    if (dragging) return ANIM.drag;
    if (walking) return ANIM.walk;
    return ANIM.idle;
  }

  function applyBase(force) {
    const name = baseAnim();
    // 基础动画必须循环；之前的 play 状态只播一次，播完会定格
    if (force || !oneShot) play(name, true);
  }

  function applyState(s) {
    state = s;
    if (!s) return;
    stage.classList.toggle('dead', !s.alive);
    if (s.walking !== undefined) walking = !!s.walking;
    if (s.facing !== undefined) facing = s.facing >= 0 ? 1 : -1;
    stage.style.transform = facingTransform(facing);
    if (!oneShot) applyBase();
  }

  function setWalking(on) {
    walking = !!on;
    if (!oneShot) applyBase();
  }

  function setFacing(dir) {
    facing = dir >= 0 ? 1 : -1;
    stage.style.transform = facingTransform(facing);
  }

  /* ---------------- 一次性动画 ---------------- */

  function playOnce(name) {
    if (!name) return;
    oneShot = true;
    play(name, false, function () {
      oneShot = false;
      applyBase(true);
    });
  }

  function randomOf(list) {
    return list[Math.floor(Math.random() * list.length)];
  }

  function scheduleIdle() {
    clearTimeout(idleTimer);
    idleTimer = setTimeout(function () {
      if (!oneShot && state && !state.muted && state.alive && !state.sick && state.activity === 'idle' && !dragging && !walking) {
        playOnce(randomOf(ANIM.idles));
      }
      scheduleIdle();
    }, 15000 + Math.random() * 15000);
  }

  /* ---------------- 气泡 / 特效 ---------------- */

  function say(text, ms) {
    bubble.textContent = text;
    bubble.classList.add('show');
    clearTimeout(bubbleTimer);
    bubbleTimer = setTimeout(function () { bubble.classList.remove('show'); }, ms || 2800);
  }

  function heart() {
    const el = document.createElement('div');
    el.className = 'heart';
    el.textContent = randomOf(['❤', '💙', '✨', '💫']);
    el.style.left = 180 + Math.random() * 100 + 'px';
    el.style.top = Math.round(357 - 211 * zoomScale - 30 + Math.random() * 60) + 'px';
    document.body.appendChild(el);
    setTimeout(function () { el.remove(); }, 1250);
  }

  /* ---------------- 主进程事件 ---------------- */

  api.onState(function (s) {
    if (s) applyState(s);
  });

  api.onMotion(function (m) {
    flying = !!m.flying;
    setFacing(m.facing);
    if (flying) {
      oneShot = false;
      play(ANIM.drag, true);
    } else {
      setWalking(!!m.walking);
      applyBase(true);
    }
  });

  api.onSay(function (p) { say(p.text, p.ms); });
  api.onEffect(function (type) {
    if (typeof type === 'string' && type.indexOf('anim:') === 0) {
      playOnce(type.slice(5));
      return;
    }
    if (type === 'eat') playOnce(Math.random() < 0.5 ? ANIM.eat : ANIM.eatAlt);
    else if (type.indexOf('toy:') === 0) {
      const map = {
        toss: ANIM.clicks[0],
        tickle: ANIM.clicks[3],
        mirror: ANIM.toyMirror,
        cat: ANIM.toyCat,
      };
      playOnce(map[type.slice(4)] || ANIM.clicks[0]);
    }
    else if (type === 'bath') playOnce(ANIM.bath);
    else if (type === 'cheer') playOnce(ANIM.cheer);
    else if (type === 'revive') playOnce(ANIM.revive);
    else if (type === 'pat') heart();
    else if (type === 'land') {
      stage.classList.add('land');
      setTimeout(function () { stage.classList.remove('land'); }, 300);
    }
  });

  api.onBubbleClear(function () { bubble.classList.remove('show'); });

  // 从串门回来：重置动画状态，防止停在最后一帧
  api.onResume(function () {
    current = '';
    currentLoop = null;
    oneShot = false;
    applyBase(true);
    const v = document.querySelector('#stage video.front');
    if (v && v.paused) {
      try { v.play(); } catch (err) { /* ignore */ }
    }
  });

  // 等级缩放：只缩放宠物，气泡字号保持可读
  let zoomScale = 1;

  api.onScale(function (payload) {
    const k = Number(payload && payload.scale ? payload.scale : payload) || 1;
    zoomScale = k;
    zoom.style.transform = 'scale(' + k + ')';
    const hitTop = 357 - 211 * k;
    bubble.style.bottom = Math.round(362 - hitTop + 33) + 'px';
    const h = payload && payload.hit;
    if (h) {
      hit.style.left = h.x + 'px';
      hit.style.top = h.y + 'px';
      hit.style.width = h.w + 'px';
      hit.style.height = h.h + 'px';
    }
  });

  /* ---------------- 鼠标 ---------------- */

  hit.addEventListener('pointerdown', function (e) {
    if (e.button !== 0) return;
    e.preventDefault();
    down = { x: e.screenX, y: e.screenY };
    moved = false;
    dragging = true;
    oneShot = false;
    stage.classList.add('dragging');
    play(ANIM.drag, true);
    api.dragStart(e.screenX, e.screenY);
    try { hit.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
  });

  hit.addEventListener('pointermove', function (e) {
    if (!down) return;
    if (Math.hypot(e.screenX - down.x, e.screenY - down.y) >= 5) moved = true;
    if (moved) api.dragMove(e.screenX, e.screenY);
  });

  hit.addEventListener('pointerup', function (e) {
    if (!down) return;
    const wasMoved = moved;
    down = null;
    dragging = false;
    stage.classList.remove('dragging');
    try { hit.releasePointerCapture(e.pointerId); } catch (err) { /* ignore */ }
    api.dragEnd(true);
    if (!wasMoved) {
      const rect = hit.getBoundingClientRect();
      const rel = (e.clientY - rect.top) / rect.height;
      const zone = rel < 0.45 ? 'head' : 'body';
      api.pat(zone);
      playOnce(zone === 'head' ? ANIM.clicks[1] : ANIM.clicks[3]);
    } else {
      applyBase(true);
    }
  });

  hit.addEventListener('pointercancel', function () {
    if (!down) return;
    down = null;
    dragging = false;
    stage.classList.remove('dragging');
    api.dragEnd(false);
    applyBase(true);
  });

  hit.addEventListener('dblclick', function () { api.openPanel(); });

  hit.addEventListener('contextmenu', function (e) {
    e.preventDefault();
    api.menu(e.screenX, e.screenY);
  });

  window.addEventListener('mouseleave', function () {
    // 光标离开窗口时，如果没在拖拽就回到正常动画
    if (!dragging && !down) applyBase();
  });

  // 看门狗：以「真实可见的 video」为准，卡住就强制重建动画
  let lastFrameTime = -1;
  let lastFrameAt = Date.now();
  let stallFixes = 0;
  setInterval(function () {
    const v = document.querySelector('#stage video.front');
    if (!v) {
      animLog('no-front');
      return;
    }
    const now = Date.now();
    if (v.ended) {
      animLog('ended ' + (v.currentSrc || '').split('/').pop() + ' cur=' + current);
      current = '';
      currentLoop = null;
      oneShot = false;
      applyBase(true);
      lastFrameAt = now;
      return;
    }
    if (v.currentTime !== lastFrameTime) {
      lastFrameTime = v.currentTime;
      lastFrameAt = now;
      stallFixes = 0;
      return;
    }
    if (now - lastFrameAt <= 1500) return;

    stallFixes += 1;
    animLog('stall#' + stallFixes + ' ' + JSON.stringify({
      src: (v.currentSrc || '').split('/').pop(),
      paused: v.paused,
      ended: v.ended,
      rs: v.readyState,
      ns: v.networkState,
      t: v.currentTime,
      cur: current,
      loop: currentLoop,
      oneShot: oneShot,
      hid: document.hidden,
    }));

    if (stallFixes >= 3) {
      animLog('hard-restart');
      try {
        v.loop = true;
        v.src = v.src;
        v.load();
        v.play();
      } catch (err) {
        animLog('hard-fail ' + (err && err.name));
      }
      stallFixes = 0;
    } else {
      current = '';
      currentLoop = null;
      oneShot = false;
      applyBase(true);
    }
    lastFrameAt = now;
  }, 600);

  scheduleIdle();
  play(ANIM.idle, true);
  api.ready();
})();
