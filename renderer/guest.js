'use strict';

/** 客人宠物窗口：只负责把 A 的宠物画出来，位置/走动由主进程控制 */
(function () {
  const api = window.qqpetGuest;
  const zoom = document.getElementById('zoom');
  const stage = document.getElementById('stage');
  const bubble = document.getElementById('bubble');
  const vids = [document.getElementById('vA'), document.getElementById('vB')];

  let front = 0;
  let current = '';
  let currentLoop = null;
  let oneShot = false;
  let swapSeq = 0;
  let bubbleTimer = null;
  let pet = null;
  let motion = { walking: false, facing: 1 };

  function url(name) {
    return encodeURI('../assets/anim/' + name + '.webm');
  }

  function play(name, loop, onEnd) {
    if (!name) return;
    const next = vids[1 - front];
    const old = vids[front];
    if (name === current && loop === currentLoop) return;

    const seq = ++swapSeq;
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
      if (seq !== swapSeq) return;
      next.classList.add('front');
      old.classList.remove('front');
      try { old.pause(); } catch (e) { /* ignore */ }
      const p = next.play();
      if (p && p.catch) p.catch(function () { /* ignore */ });
      front = 1 - front;
    };

    next._swap = swap;
    next.addEventListener('loadeddata', swap);
    next.src = url(name);
    next.load();
    if (next.readyState >= 2) swap();
    setTimeout(function () {
      if (seq === swapSeq && next._swap) swap();
    }, 1500);
  }

  function playOnce(name) {
    if (!name) return;
    oneShot = true;
    play(name, false, function () {
      oneShot = false;
      if (pet && pet.anim && !oneShot) play(pet.anim, pet.loop !== false);
    });
  }

  function showBubble(text) {
    if (!text) return;
    bubble.textContent = text;
    bubble.classList.add('show');
    clearTimeout(bubbleTimer);
    bubbleTimer = setTimeout(function () { bubble.classList.remove('show'); }, 2800);
  }

  function applyMotion() {
    stage.style.transform = motion.facing >= 0 ? 'scaleX(-1)' : '';
    if (motion.walking) play('螃蟹走路', true);
    else if (pet) play(pet.anim || '待机呼吸休闲', true);
  }

  function applyState(s) {
    if (!s) return;
    pet = s.pet || {};
    const lv = Number(s.level) || 1;
    const t = Math.max(0, Math.min(1, (lv - 1) / 29));
    const k = (100 + 150 * t) / 211;
    zoom.style.transform = 'scale(' + k + ')';
    bubble.style.bottom = Math.round(362 - (357 - 211 * k) + 33) + 'px';
    document.getElementById('gname').textContent = s.name || '客人';
    document.getElementById('glv').textContent = 'Lv.' + (s.level || 1);
    if (pet.bubble) showBubble(pet.bubble);
    if (!oneShot && !motion.walking) play(pet.anim || '待机呼吸休闲', true);
  }

  api.onState(applyState);
  api.onMotion(function (m) { motion = m; applyMotion(); });
  api.onPlay(function (name) { playOnce(name); });
  api.onBubble(showBubble);

  document.addEventListener('contextmenu', function (e) {
    e.preventDefault();
    api.menu();
  });

  document.addEventListener('pointerup', function (e) {
    if (e.button !== 0) return;
    api.pat();
  });

  if (api.ready) api.ready();

  // 预热一个待机片段，避免第一次出现时黑一下
  play('待机呼吸休闲', true);
})();
