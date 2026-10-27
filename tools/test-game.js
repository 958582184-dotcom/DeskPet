'use strict';

/** 纯逻辑单测：node tools/test-game.js */

const assert = require('node:assert');
const { Game, levelInfo, STAGES, JOBS } = require('../src/game');
const Physics = require('../src/physics');

let passed = 0;
function ok(name, fn) {
  try {
    fn();
    passed += 1;
    console.log('PASS ' + name);
  } catch (e) {
    console.log('FAIL ' + name + ' -> ' + e.message);
    process.exitCode = 1;
  }
}

function newGame() {
  const g = new Game(Game.fresh('小蓝'));
  g.s.hunger = 80;
  g.s.clean = 80;
  g.s.courses['kid:zhi:0'] = 5;
  g.s.courses['kid:mei:0'] = 5;
  g.s.courses['kid:wu:0'] = 5;
  return g;
}

/** 把这门课直接推到最后一节，再正常上完（避免循环 8/20/40 次） */
function finishCourse(g, stage, cat, idx) {
  const lessons = g.lessonsOf(stage);
  g.s.courses[stage + ':' + cat + ':' + idx] = lessons - 1;
  g.enroll(stage, cat, idx);
  g.s.busyUntil = Date.now() - 1;
  g.tick(0);
}

function finishDiploma(g, stage, cat) {
  for (let i = 0; i < 3; i++) finishCourse(g, stage, cat, i);
}

ok('level thresholds', function () {
  assert.strictEqual(levelInfo(0).lv, 1);
  assert.strictEqual(levelInfo(60).lv, 2);
  assert.strictEqual(levelInfo(172).lv, 2);
  assert.strictEqual(levelInfo(173).lv, 3);
  assert.strictEqual(levelInfo(173).need, 182);
});

ok('feed', function () {
  const g = newGame();
  g.s.hunger = 50;
  const money = g.s.money;
  const res = g.feed('cookie');
  assert.strictEqual(res.ok, true);
  assert.strictEqual(res.anim, '大口吃零食');
  assert.strictEqual(g.s.hunger, 68);
  assert.strictEqual(g.s.money, money - 5);
});

ok('bath', function () {
  const g = newGame();
  g.s.clean = 10;
  assert.strictEqual(g.bath().ok, true);
  assert.strictEqual(g.s.clean, 42);
});

ok('one lesson: cost, 30min busy, progress +1', function () {
  const g = newGame();
  const money = g.s.money;
  const res = g.enroll('primary', 'zhi', 0);
  assert.strictEqual(res.ok, true);
  assert.strictEqual(g.s.money, money - 2);
  assert.strictEqual(g.s.activity, 'study');
  const mins = (g.s.busyUntil - Date.now()) / 60000;
  assert.ok(mins > 29 && mins <= 30, 'busy minutes=' + mins);

  g.s.busyUntil = Date.now() - 1;
  g.tick(0);
  assert.strictEqual(g.progress('primary', 'zhi', 0), 1);
  assert.strictEqual(g.hasCourse('primary', 'zhi', 0), false);
  assert.strictEqual(g.s.attrs.zhi, 0);
});

ok('course needs all 8 lessons', function () {
  const g = newGame();
  finishCourse(g, 'primary', 'zhi', 0);
  assert.strictEqual(g.hasCourse('primary', 'zhi', 0), true);
  assert.strictEqual(g.s.attrs.zhi, 5);
});

ok('diploma needs all three courses and pays scholarship', function () {
  const g = newGame();
  g.s.money = 100;
  finishCourse(g, 'primary', 'zhi', 0);
  finishCourse(g, 'primary', 'zhi', 1);
  assert.strictEqual(g.hasDiploma('primary', 'zhi'), false);

  const money = g.s.money;
  g.s.courses['primary:zhi:2'] = 7;
  g.enroll('primary', 'zhi', 2);
  g.s.busyUntil = Date.now() - 1;
  const events = g.tick(1);
  assert.strictEqual(g.hasDiploma('primary', 'zhi'), true);
  assert.strictEqual(g.eduLabel(), '小学');
  assert.ok(g.s.money >= money - 2 + 100, 'money=' + g.s.money);
  assert.ok(events.some(function (e) { return e.type === 'graduate'; }));
});

ok('middle locked until primary diploma', function () {
  const g = newGame();
  const res = g.enroll('middle', 'zhi', 0);
  assert.strictEqual(res.ok, false);
  assert.ok(/小学/.test(res.msg));

  finishDiploma(g, 'primary', 'zhi');
  assert.strictEqual(g.enroll('middle', 'zhi', 0).ok, true);
});

ok('job gating by diploma', function () {
  const g = newGame();
  const editor = JOBS.filter(function (j) { return j.id === 'editor'; })[0];
  const dish = JOBS.filter(function (j) { return j.id === 'dish'; })[0];

  assert.strictEqual(g.jobAvailable(dish), true);
  assert.strictEqual(g.jobAvailable(editor), false);

  g.s.courses['college:zhi:0'] = 40;
  assert.strictEqual(g.jobAvailable(editor), true);
  assert.ok(/大学语文/.test(g.reqText(editor)));
});

ok('work pays the job wage (45 min shift)', function () {
  const g = newGame();
  g.s.level = 3;
  const money = g.s.money;
  assert.strictEqual(g.workAt('brick').ok, true);
  const mins = (g.s.busyUntil - Date.now()) / 60000;
  assert.ok(mins > 19 && mins <= 20, 'shift minutes=' + mins);

  g.s.busyUntil = Date.now() - 1;
  g.tick(0);
  assert.strictEqual(g.s.activity, 'idle');
  assert.ok(g.s.money >= money + 11 && g.s.money <= money + 20, 'money=' + g.s.money);
});

ok('workBest picks highest available', function () {
  const g = newGame();
  g.s.level = 3;
  finishDiploma(g, 'primary', 'wu');
  g.workBest();
  assert.strictEqual(g.s.jobName, '快递员');
  assert.strictEqual(g.s.jobPay, 31);
});

ok('slow decay: an hour costs little', function () {
  const g = newGame();
  g.tick(3600);
  // 60 分钟应该只掉 10 点左右，而不是掉光
  assert.ok(g.s.hunger > 65 && g.s.hunger < 75, 'hunger=' + g.s.hunger);
  assert.ok(g.s.clean > 70 && g.s.clean < 80, 'clean=' + g.s.clean);
});

ok('play raises mood', function () {
  const g = newGame();
  g.s.mood = 50;
  g.play();
  assert.strictEqual(g.s.mood, 72);
});

ok('cure costs scale with health', function () {
  const g = newGame();
  g.s.sick = true;
  g.s.illness = 'gastro';
  g.s.health = 60;
  g.s.money = 100;
  const cost = g.cureCost({ base: 30 });
  assert.strictEqual(cost, 54);
  const r = g.cure('gastro');
  assert.strictEqual(r.ok, true);
  assert.strictEqual(g.s.money, 46);
  assert.strictEqual(g.s.health, 80);
});

ok('revive costs 500', function () {
  const g = newGame();
  g.s.alive = false;
  g.s.activity = 'dead';
  g.s.money = 600;
  assert.strictEqual(g.revive().ok, true);
  assert.strictEqual(g.s.alive, true);
  assert.strictEqual(g.s.money, 100);
});

ok('revive blocked when broke', function () {
  const g = newGame();
  g.s.alive = false;
  g.s.activity = 'dead';
  g.s.money = 40;
  const res = g.revive();
  assert.strictEqual(res.ok, false);
  assert.ok(/500/.test(res.msg));
});

ok('busy blocks toys but allows feeding, bath and throw', function () {
  const g = newGame();
  g.enroll('primary', 'zhi', 0);
  assert.strictEqual(g.s.activity, 'study');

  assert.strictEqual(g.playToy('toss').ok, false);
  assert.strictEqual(g.canThrow(800).ok, true);

  const money = g.s.money;
  assert.strictEqual(g.feed('cookie').ok, true);
  assert.strictEqual(g.bath().ok, true);
  assert.strictEqual(g.s.activity, 'study');
  assert.ok(g.s.money < money, 'money=' + g.s.money);
});

ok('snapshot exposes lessons and progress', function () {
  const g = newGame();
  const s = g.snapshot();
  const st = s.edu.stages.filter(function (x) { return x.id === 'primary'; })[0];
  assert.strictEqual(st.lessons, 8);
  assert.strictEqual(st.lessonMin, 30);
  const course = st.cats[0].courses[0];
  assert.strictEqual(course.lessons, 8);
  assert.strictEqual(course.progress, 0);
  assert.ok(s.jobs.length >= 15);
});

ok('snapshot can flags', function () {
  const g = newGame();
  let s = g.snapshot();
  assert.strictEqual(s.can.cure, false);
  assert.strictEqual(s.can.revive, false);
  g.s.sick = true;
  s = g.snapshot();
  assert.strictEqual(s.can.cure, true);
  g.s.alive = false;
  s = g.snapshot();
  assert.strictEqual(s.can.revive, true);
  assert.strictEqual(s.can.feed, false);
});

ok('death only after 1 hour at zero health while sick', function () {
  const g = newGame();
  g.s.sick = true;
  g.s.illness = 'gastro';
  g.s.hunger = 80;
  g.s.clean = 80;
  g.s.mood = 80;
  g.s.health = 0;
  g.tick(59 * 60);
  assert.strictEqual(g.s.alive, true);
  g.tick(60);
  assert.strictEqual(g.s.alive, false);
});

ok('starving while sick no longer kills directly', function () {
  const g = newGame();
  g.s.sick = true;
  g.s.illness = 'gastro';
  g.s.hunger = 0;
  g.s.clean = 0;
  g.s.health = 50;
  g.tick(60 * 60);
  assert.strictEqual(g.s.alive, true);
});

ok('stage table matches original pacing', function () {
  const expect = { kid: [5, 20], primary: [8, 30], middle: [20, 40], high: [24, 50], college: [40, 60] };
  STAGES.forEach(function (st) {
    assert.strictEqual(st.lessons, expect[st.id][0]);
    assert.strictEqual(st.lessonMin, expect[st.id][1]);
  });
});


ok('throw velocity from pointer trail', function () {
  const fast = Physics.velocityFromTrail([
    { t: 0, x: 100, y: 100 },
    { t: 50, x: 150, y: 120 },
    { t: 100, x: 200, y: 140 },
  ], 100);
  assert.ok(fast && fast.vx > 500 && fast.vy > 0, 'fast=' + JSON.stringify(fast));

  const slow = Physics.velocityFromTrail([
    { t: 0, x: 0, y: 0 },
    { t: 100, x: 10, y: 0 },
  ], 100);
  assert.strictEqual(slow, null);

  const stale = Physics.velocityFromTrail([
    { t: 0, x: 0, y: 0 },
    { t: 100, x: 100, y: 0 },
  ], 400);
  assert.strictEqual(stale, null);
});

ok('flight falls, bounces and settles on ground', function () {
  const bounds = { left: 0, top: 0, right: 1000, bottom: 600, w: 100, h: 100 };
  let pos = { x: 300, y: 100 };
  let vel = { vx: 600, vy: -200 };
  let steps = 0;
  while (steps < 1400) {
    const r = Physics.stepFlight(pos, vel, 1 / 60, bounds);
    pos = { x: r.x, y: r.y };
    vel = { vx: r.vx, vy: r.vy };
    steps += 1;
    if (r.stopped) break;
    assert.ok(pos.y <= bounds.bottom - bounds.h + 0.001, 'escaped ground at step ' + steps);
    assert.ok(pos.x >= bounds.left - 0.001 && pos.x <= bounds.right - bounds.w + 0.001, 'escaped walls');
  }
  assert.ok(steps < 1400, 'never stopped');
  assert.ok(Math.abs(pos.y - (bounds.bottom - bounds.h)) < 0.001, 'y=' + pos.y);
});

ok('flight bounces off right wall', function () {
  const bounds = { left: 0, top: 0, right: 1000, bottom: 600, w: 100, h: 100 };
  const r = Physics.stepFlight({ x: 890, y: 100 }, { vx: 2000, vy: 0 }, 0.1, bounds);
  assert.ok(r.vx < 0, 'vx=' + r.vx);
  assert.ok(r.x <= bounds.right - bounds.w + 0.001);
});

ok('throw costs stamina and gives mood', function () {
  const g = newGame();
  g.s.mood = 50;
  const res = g.canThrow(900);
  assert.strictEqual(res.ok, true);
  assert.strictEqual(res.cost, 10, 'cost=' + res.cost);
  assert.ok(res.mood >= 3 && res.mood <= 16, 'mood=' + res.mood);

  g.applyThrow(res.cost, res.mood);
  assert.strictEqual(g.s.stamina, 100 - res.cost);
  assert.strictEqual(g.s.mood, 50 + res.mood);
});

ok('tired pet can still throw, stamina clamps at 0', function () {
  const g = newGame();
  g.s.stamina = 2;
  const res = g.canThrow(1200);
  assert.strictEqual(res.ok, true);
  g.applyThrow(res.cost, res.mood);
  assert.strictEqual(g.s.stamina, 0);
});

ok('pat gives +1 mood', function () {
  const g = newGame();
  g.s.mood = 50;
  g.pat('head');
  assert.strictEqual(g.s.mood, 51);
  g.pat('body');
  assert.strictEqual(g.s.mood, 52);
});


ok('toy play costs and rewards', function () {
  const g = newGame();
  g.s.mood = 40;
  const money = g.s.money;
  const res = g.playToy('cat');
  assert.strictEqual(res.ok, true);
  assert.strictEqual(g.s.money, money - 10);
  assert.strictEqual(g.s.mood, 85);
  assert.strictEqual(g.s.activity, 'play');
  const secs = (g.s.busyUntil - Date.now()) / 1000;
  assert.ok(secs > 9 && secs <= 10, 'secs=' + secs);
});

ok('toy blocked when poor', function () {
  const g = newGame();
  g.s.money = 1;
  assert.strictEqual(g.playToy('cat').ok, false);
});



ok('bounce settles with 60ms frames + 1/120 substeps', function () {
  const area = { left: 0, top: 0, right: 1920, bottom: 1040, w: 520, h: 362 };
  let pos = { x: 1000, y: 678 };
  let vel = { vx: 600, vy: -1500 };
  let settled = false;
  let frames = 0;
  for (let f = 0; f < 900 && !settled; f++) {
    frames += 1;
    let remain = 0.06;
    while (remain > 0.0005) {
      const h = Math.min(remain, 1 / 120);
      const r = Physics.stepFlight(pos, vel, h, area);
      pos = { x: r.x, y: r.y };
      vel = { vx: r.vx, vy: r.vy };
      remain -= h;
      if (r.stopped) {
        settled = true;
        break;
      }
    }
  }
  assert.ok(settled, 'still bouncing after ' + frames + ' frames');
  assert.ok(frames < 200, 'took ' + frames + ' frames');
  assert.ok(Math.abs(pos.y - 678) < 0.01, 'y=' + pos.y);
});


ok('food, bath and sleep restore stamina', function () {
  const g = newGame();
  g.s.stamina = 10;
  g.feed('hotpot');
  assert.strictEqual(g.s.stamina, 32);

  g.s.stamina = 10;
  g.s.money = 100;
  g.bathAt('bubble');
  assert.strictEqual(g.s.stamina, 25);

  g.s.stamina = 0;
  g.s.hunger = 80;
  g.s.clean = 80;
  g.s.activity = 'sleep';
  g.tick(60);
  assert.ok(Math.abs(g.s.stamina - 6) < 0.01, 'stamina=' + g.s.stamina);
});


ok('every food and toy has its own animation', function () {
  const { FOODS, TOYS } = require('../src/game');
  assert.ok(FOODS.length >= 8, 'foods=' + FOODS.length);
  assert.ok(TOYS.length >= 10, 'toys=' + TOYS.length);
  FOODS.forEach(function (f) { assert.ok(f.anim, f.name + ' 缺动画'); });
  TOYS.forEach(function (t) { assert.ok(t.anim, t.name + ' 缺动画'); });

  const g = newGame();
  g.s.money = 200;
  const res = g.feed('watermelon');
  assert.strictEqual(res.food, 'watermelon');
  assert.strictEqual(res.anim, '吃西瓜');

  const toy = g.playToy('swing');
  assert.strictEqual(toy.anim, '荡秋千');
});


ok('legacy busy save still shows progress', function () {
  const st = Game.fresh('x');
  st.activity = 'work';
  st.busyUntil = Date.now() + 8 * 60 * 1000;
  delete st.busyTotal;
  const g = new Game(st);
  const b = g.snapshot().busy;
  assert.ok(b, 'busy 快照缺失');
  assert.ok(b.total > 0, 'total=' + b.total);
  assert.ok(b.progress >= 0 && b.progress < 0.2, 'progress=' + b.progress);
});


ok('low stats damage health and pick illness', function () {
  const g = newGame();
  g.s.hunger = 80;
  g.s.clean = 5;
  g.s.mood = 80;
  g.s.health = 30;
  const rnd = Math.random;
  Math.random = function () { return 0; };
  g.tick(60);
  Math.random = rnd;
  assert.ok(g.s.health < 30, 'health=' + g.s.health);
  assert.strictEqual(g.s.sick, true);
  assert.strictEqual(g.s.illness, 'skin');
});

ok('very low health causes fever', function () {
  const g = newGame();
  g.s.hunger = 5;
  g.s.clean = 5;
  g.s.mood = 5;
  g.s.health = 20;
  const rnd = Math.random;
  Math.random = function () { return 0; };
  g.tick(60);
  Math.random = rnd;
  assert.strictEqual(g.s.illness, 'fever');
});

ok('quitting pauses timers instead of settling offline', function () {
  const g = newGame();
  g.s.hunger = 80;
  g.s.clean = 80;
  g.s.busyUntil = Date.now() + 5 * 60000;
  g.s.busyTotal = 10 * 60000;
  g.freezeTimers(3600 * 1000);
  const left = g.s.busyUntil - Date.now();
  assert.ok(left > 5 * 60000, 'left=' + left);
  assert.strictEqual(g.s.hunger, 80);
  assert.strictEqual(g.s.clean, 80);
});

ok('study gives more exp than work', function () {
  const g = newGame();
  finishCourse(g, 'primary', 'zhi', 0);
  const studyExp = g.s.growth;

  const w = newGame();
  w.s.growth = 0;
  w.s.activity = 'work';
  w.s.jobPay = 20;
  w.finishBusy();
  assert.ok(studyExp > w.s.growth, 'study=' + studyExp + ' work=' + w.s.growth);
});


ok('chatter lines CRUD', function () {
  const g = newGame();
  assert.ok(g.chatterLine().length > 0);
  assert.strictEqual(g.addChatter('测试台词').ok, true);
  assert.strictEqual(g.chatterLine(), '测试台词');
  g.updateChatter(0, '改过的台词');
  assert.strictEqual(g.chatterLine(), '改过的台词');
  g.removeChatter(0);
  assert.strictEqual(g.s.chatter.length, 0);
});

ok('off work countdown reminds', function () {
  const g = newGame();
  const t = new Date(Date.now() + 59 * 60000);
  const hhmm = String(t.getHours()).padStart(2, '0') + ':' + String(t.getMinutes()).padStart(2, '0');
  assert.strictEqual(g.setOffWork(hhmm).ok, true);
  const left = g.offWorkLeft();
  assert.ok(left > 57 && left <= 60, 'left=' + left);
  const events = g.tick(1);
  const says = events.filter(function (e) { return e.type === 'say'; });
  assert.ok(says.length >= 1, '没有倒计时提醒');
});


ok('off work half-hour reminders repeat without spam', function () {
  const g = newGame();
  const t = new Date(Date.now() + 215 * 60000);
  const hhmm = String(t.getHours()).padStart(2, '0') + ':' + String(t.getMinutes()).padStart(2, '0');
  g.setOffWork(hhmm);
  const first = g.tick(1).filter(function (e) { return e.type === 'say'; }).map(function (e) { return e.text; });
  assert.ok(first.some(function (t2) { return /3 个半小时/.test(t2); }), first.join('|'));
  const second = g.tick(1).filter(function (e) { return e.type === 'say'; });
  assert.strictEqual(second.length, 0, '同一档不该重复');
});


ok('bath plans', function () {
  const g = newGame();
  g.s.money = 100;
  g.s.clean = 10;
  g.s.stamina = 50;
  g.s.health = 50;
  const res = g.bathAt('sauna');
  assert.strictEqual(res.ok, true);
  assert.strictEqual(g.s.clean, 40);
  assert.strictEqual(g.s.stamina, 40);
  assert.strictEqual(g.s.health, 62);
  assert.strictEqual(g.s.money, 82);
});

ok('work needs level 3', function () {
  const g = newGame();
  assert.strictEqual(g.s.level, 1);
  const res = g.workAt('dish');
  assert.strictEqual(res.ok, false);
  assert.ok(/太小/.test(res.msg));
  g.s.level = 3;
  assert.strictEqual(g.workAt('dish').ok, true);
});


ok('off work rounds to nearest half hour', function () {
  const g = newGame();
  const t = new Date(Date.now() + 240 * 60000);
  const hhmm = String(t.getHours()).padStart(2, '0') + ':' + String(t.getMinutes()).padStart(2, '0');
  g.setOffWork(hhmm);
  const says = g.tick(1).filter(function (e) { return e.type === 'say'; }).map(function (e) { return e.text; });
  assert.ok(says.some(function (x) { return /4 小时/.test(x); }), says.join('|'));
});


ok('can owe one cure fee and must repay first', function () {
  const g = newGame();
  g.s.sick = true;
  g.s.illness = 'gastro';
  g.s.health = 40;
  g.s.money = 10;
  const cost = g.cureCost({ base: 30 });
  const r = g.cure('gastro');
  assert.strictEqual(r.ok, true);
  assert.strictEqual(g.s.debt, cost);
  assert.strictEqual(g.s.money, 10);

  g.s.sick = true;
  g.s.illness = 'skin';
  assert.strictEqual(g.cure('skin').ok, false, '欠款期间不能再治');

  g.s.money = cost + 5;
  const p = g.repayDebt();
  assert.strictEqual(p.ok, true);
  assert.strictEqual(g.s.debt, 0);
  assert.strictEqual(g.s.money, 5);
});

ok('sleeping while sick slowly recovers health', function () {
  const g = newGame();
  g.s.sick = true;
  g.s.illness = 'gastro';
  g.s.health = 50;
  g.s.activity = 'sleep';
  g.tick(60);
  assert.ok(g.s.health > 50, 'health=' + g.s.health);
});





ok('sick pet can sleep', function () {
  const g = newGame();
  g.s.sick = true;
  g.s.illness = 'gastro';
  assert.strictEqual(g.toggleSleep().ok, true);
  assert.strictEqual(g.s.activity, 'sleep');
});


ok('sick work only above 50 health', function () {
  const g = newGame();
  g.s.level = 3;
  g.s.sick = true;
  g.s.illness = 'gastro';
  g.s.health = 60;
  assert.strictEqual(g.workAt('dish').ok, true);
  g.s.activity = 'idle';
  g.s.health = 40;
  assert.strictEqual(g.workAt('dish').ok, false);
});

ok('sick study/play only above 30 health', function () {
  const g = newGame();
  g.s.sick = true;
  g.s.illness = 'gastro';
  g.s.health = 40;
  assert.strictEqual(g.enroll('primary', 'zhi', 0).ok, true);
  g.s.activity = 'idle';
  assert.strictEqual(g.playToy('tickle').ok, true);
  g.s.activity = 'idle';
  g.s.busyUntil = 0;
  g.s.health = 20;
  assert.strictEqual(g.enroll('primary', 'zhi', 1).ok, false);
  assert.strictEqual(g.playToy('tickle').ok, false);
});

ok('sick sleep caps health at 80', function () {
  const g = newGame();
  g.s.sick = true;
  g.s.illness = 'gastro';
  g.s.health = 79;
  g.s.activity = 'sleep';
  g.tick(300);
  assert.ok(g.s.health <= 80, 'health=' + g.s.health);
  assert.strictEqual(g.s.sick, true);
});


ok('sick work drains more health than idle', function () {
  const a = newGame();
  a.s.sick = true;
  a.s.illness = 'gastro';
  a.s.health = 70;
  a.tick(300);
  const idle = a.s.health;
  const b = newGame();
  b.s.level = 3;
  b.s.sick = true;
  b.s.illness = 'gastro';
  b.s.health = 70;
  b.s.hunger = 80;
  b.s.clean = 80;
  b.workAt('brick');
  b.tick(300);
  assert.ok(b.s.health < idle, 'working=' + b.s.health + ' idle=' + idle);
});

ok('work interrupts when health drops below 50, pays by time', function () {
  const g = newGame();
  g.s.level = 3;
  g.s.sick = true;
  g.s.illness = 'gastro';
  g.s.health = 50.5;
  g.s.money = 0;
  g.workAt('brick');
  g.s.busyTotal = 10 * 60000;
  g.s.busyUntil = Date.now() + 5 * 60000;
  g.tick(300);
  assert.strictEqual(g.s.activity, 'idle');
  assert.strictEqual(g.s.money, 8, 'pay=' + g.s.money);
});

ok('study interrupts below 30 without progress', function () {
  const g = newGame();
  g.s.sick = true;
  g.s.illness = 'gastro';
  g.s.health = 30.5;
  g.s.money = 50;
  g.tick(0);
  assert.strictEqual(g.enroll('primary', 'zhi', 0).ok, true);
  g.tick(300);
  assert.strictEqual(g.s.activity, 'idle');
  assert.strictEqual(g.progress('primary', 'zhi', 0), 0);
});

ok('primary needs kindergarten', function () {
  const g = new Game(Game.fresh('x'));
  assert.strictEqual(g.enroll('primary', 'zhi', 0).ok, false);
  g.s.courses['kid:zhi:0'] = 5;
  g.s.courses['kid:mei:0'] = 5;
  g.s.courses['kid:wu:0'] = 5;
  assert.strictEqual(g.enroll('primary', 'zhi', 0).ok, true);
});

ok('health regen when stats high and not working', function () {
  const a = newGame();
  a.s.health = 50;
  a.s.hunger = 60;
  a.s.clean = 60;
  a.s.mood = 60;
  a.tick(600);
  assert.ok(a.s.health > 50, 'idle health=' + a.s.health);

  const b = newGame();
  b.s.level = 3;
  b.s.health = 50;
  b.s.hunger = 60;
  b.s.clean = 60;
  b.s.mood = 60;
  b.workAt('brick');
  b.tick(600);
  assert.strictEqual(b.s.health, 50, 'working health=' + b.s.health);
});

ok('work split costs at start and end', function () {
  const g = newGame();
  g.s.level = 3;
  g.s.hunger = 80;
  g.s.stamina = 80;
  g.s.clean = 80;
  g.workAt('brick');
  assert.strictEqual(g.s.hunger, 77.5);
  assert.strictEqual(g.s.stamina, 75);
  assert.strictEqual(g.s.clean, 80);
  g.s.busyUntil = Date.now() - 1;
  g.tick(0);
  assert.strictEqual(g.s.hunger, 75);
  assert.strictEqual(g.s.stamina, 70);
  assert.strictEqual(g.s.clean, 73);
});

ok('mood grows above 60 stats and drops per low stat', function () {
  const a = newGame();
  a.s.hunger = 70;
  a.s.clean = 70;
  a.s.mood = 50;
  a.tick(600);
  assert.ok(a.s.mood > 50, 'mood=' + a.s.mood);

  const b = newGame();
  b.s.hunger = 40;
  b.s.clean = 70;
  b.s.mood = 50;
  b.tick(600);
  assert.ok(Math.abs(b.s.mood - 48.8) < 0.01, 'mood=' + b.s.mood);

  const c = newGame();
  c.s.hunger = 40;
  c.s.clean = 40;
  c.s.mood = 50;
  c.tick(600);
  assert.ok(Math.abs(c.s.mood - 47.6) < 0.01, 'mood=' + c.s.mood);
});

ok('cure health rules', function () {
  const g = newGame();
  g.s.sick = true;
  g.s.illness = 'gastro';
  g.s.money = 100;
  g.s.health = 10;
  g.cure();
  assert.strictEqual(g.s.health, 40);

  const h = newGame();
  h.s.sick = true;
  h.s.illness = 'gastro';
  h.s.money = 100;
  h.s.health = 70;
  h.cure();
  assert.strictEqual(h.s.health, 80);

  const k = newGame();
  k.s.sick = true;
  k.s.illness = 'gastro';
  k.s.money = 100;
  k.s.health = 85;
  k.cure();
  assert.strictEqual(k.s.health, 85);
});

ok('play costs a little clean', function () {
  const g = newGame();
  g.s.clean = 60;
  g.s.money = 100;
  g.playToy('tickle');
  assert.strictEqual(g.s.clean, 58);
});

ok('revive restores healthy stats', function () {
  const g = newGame();
  g.s.alive = false;
  g.s.money = 1000;
  g.s.health = 0;
  g.revive();
  assert.strictEqual(g.s.health, 80);
  assert.strictEqual(g.s.hunger, 80);
  assert.strictEqual(g.s.clean, 80);
  assert.strictEqual(g.s.mood, 80);
  assert.strictEqual(g.s.stamina, 100);
});

ok('freezeTimers keeps offWorkAt string intact', function () {
  const g = newGame();
  g.setOffWork('17:00');
  g.freezeTimers(3600 * 1000);
  assert.strictEqual(g.s.offWorkAt, '17:00');
});

ok('corrupted offWorkAt is repaired on load', function () {
  const raw = Game.fresh('x');
  raw.offWorkAt = '17:00918964818891548116681194626848514491';
  const g = new Game(raw);
  assert.strictEqual(g.s.offWorkAt, '17:00');
});

ok('perk sources cap independently', function () {
  const g = newGame();
  g.s.level = 30;
  g.s.specs = ['diligent', 'diligent', 'diligent', 'diligent', 'diligent', 'diligent'];
  const p = g.perks();
  assert.ok(Math.abs(p.workTime - 0.2235) < 1e-9, 'workTime=' + p.workTime);
  assert.ok(Math.abs(p.workStamina - 0.30) < 1e-9, 'workStamina=' + p.workStamina);
});

ok('work duration shrinks with perks', function () {
  const g = newGame();
  g.s.level = 30;
  g.s.specs = ['diligent', 'diligent', 'diligent', 'diligent', 'diligent', 'diligent'];
  g.workAt('brick');
  assert.strictEqual(g.s.busyTotal, 16 * 60000);
});

ok('job pay uses attribute only', function () {
  const g = newGame();
  g.s.attrs.wu = 105;
  g.s.prof.brick = 10;
  const job = JOBS.find(function (j) { return j.id === 'brick'; });
  assert.strictEqual(g.jobPay(job), 16);
});

ok('proficiency is one level and cuts 10% at its threshold', function () {
  const g = newGame();
  const brick = JOBS.find(function (j) { return j.id === 'brick'; });
  assert.strictEqual(g.jobMinutes(brick), 20);
  g.s.prof.brick = 4;
  assert.strictEqual(g.jobMinutes(brick), 20);
  g.s.prof.brick = 5;
  assert.strictEqual(g.jobMinutes(brick), 18);
  g.s.prof.brick = 99;
  assert.strictEqual(g.jobMinutes(brick), 18);
  assert.strictEqual(g.jobMastery(brick).need, 5);
  assert.strictEqual(g.jobMastery(brick).mastered, true);

  const waiter = JOBS.find(function (j) { return j.id === 'waiter'; });
  assert.strictEqual(g.jobMastery(waiter).need, 8);
  assert.strictEqual(g.jobMastery(JOBS.find(function (j) { return j.id === 'typist'; })).need, 12);
  assert.strictEqual(g.jobMastery(JOBS.find(function (j) { return j.id === 'editor'; })).need, 16);
  assert.strictEqual(g.jobMastery(JOBS.find(function (j) { return j.id === 'king'; })).need, 20);
  g.s.prof.waiter = 7;
  assert.strictEqual(g.jobMinutes(waiter), 10);
  g.s.prof.waiter = 8;
  assert.strictEqual(g.jobMinutes(waiter), 9);

  g.s.prof.brick = 5;
  g.s.level = 3;
  g.workAt('brick');
  assert.strictEqual(g.s.busyTotal, 18 * 60000);
});

ok('daily free purchase applies once and excludes revive', function () {
  const g = newGame();
  g.s.level = 10;
  g.s.money = 0;
  const r = g.feed('cookie');
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.free, true);
  assert.strictEqual(g.s.money, 0);
  assert.strictEqual(g.freeLeft(), 0);
  assert.strictEqual(g.feed('cookie').ok, false);

  const d = newGame();
  d.s.level = 30;
  d.s.money = 0;
  d.s.alive = false;
  const rv = d.revive();
  assert.strictEqual(rv.ok, false);
});

ok('pick a specialization and lock slots', function () {
  const g = newGame();
  g.s.level = 5;
  assert.strictEqual(g.specLeft(), 1);
  assert.strictEqual(g.pickSpec('diligent').ok, true);
  assert.strictEqual(g.specLeft(), 0);
  assert.strictEqual(g.pickSpec('lucky').ok, false);
});

ok('free purchase covers cure before debt', function () {
  const g = newGame();
  g.s.level = 10;
  g.s.money = 0;
  g.s.sick = true;
  g.s.illness = 'gastro';
  g.s.health = 40;
  const r = g.cure();
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.free, true);
  assert.strictEqual(g.s.debt, 0);
  assert.strictEqual(g.s.sick, false);
});

ok('kindergarten has three direction courses', function () {
  const g = newGame();
  const kid = g.snapshot().edu.stages[0];
  assert.strictEqual(kid.cats.length, 3);
  assert.deepStrictEqual(kid.cats.map(function (c) { return c.courses[0].name; }), ['学数数', '学儿歌', '做手工']);
});

ok('old kindergarten progress migrates to 学数数', function () {
  const raw = Game.fresh('x');
  raw.courses = { 'kid:kid:0': 3, 'kid:kid:1': 1, 'kid:kid:2': 2 };
  const g = new Game(raw);
  assert.strictEqual(g.s.courses['kid:zhi:0'], 3);
  assert.strictEqual(g.s.courses['kid:mei:0'], 2);
  assert.strictEqual(g.s.courses['kid:kid:0'], undefined);
});

ok('kindergarten course trains its attribute', function () {
  const g = new Game(Game.fresh('x'));
  g.s.money = 50;
  g.s.courses['kid:zhi:0'] = 4;
  g.enroll('kid', 'zhi', 0);
  g.s.busyUntil = Date.now() - 1;
  g.tick(0);
  assert.strictEqual(g.s.attrs.zhi, 3);
});

ok('legacy kid pending course migrates and finishes', function () {
  const raw = Game.fresh('x');
  raw.activity = 'study';
  raw.busyTotal = 20 * 60000;
  raw.busyUntil = Date.now() - 1;
  raw.pendingCourse = { stage: 'kid', cat: 'kid', idx: 0 };
  raw.courses = { 'kid:kid:0': 2 };
  const g = new Game(raw);
  assert.strictEqual(g.s.pendingCourse.cat, 'zhi');
  g.tick(0);
  assert.strictEqual(g.s.courses['kid:zhi:0'], 3);
  assert.strictEqual(g.s.activity, 'idle');
});

ok('daily tasks count and claim', function () {
  const g = newGame();
  const d = g.dailySummary();
  assert.strictEqual(d.tasks.length, 3);
  assert.strictEqual(new Set(d.tasks.map(function (t) { return t.id; })).size, 3);
  g.s.daily.tasks.forEach(function (t) { t.done = t.target; });
  assert.strictEqual(g.dailySummary().canClaim, true);
  const before = g.s.money;
  assert.strictEqual(g.claimDaily().ok, true);
  assert.strictEqual(g.s.money, before + 30);
  assert.strictEqual(g.claimDaily().ok, false);
});

ok('daily tasks reset next day', function () {
  const g = newGame();
  g.s.daily = { day: '2000-1-1', tasks: [{ id: 'feed', label: '喂食', target: 3, done: 3 }], claimed: true };
  const d = g.ensureDaily();
  assert.notStrictEqual(d.day, '2000-1-1');
  assert.strictEqual(d.claimed, false);
});

ok('class distraction rewards clicking in time', function () {
  const g = new Game(Game.fresh('x'));
  g.s.money = 100;
  g.s.hunger = 80;
  g.s.clean = 80;
  g.enroll('kid', 'zhi', 0);
  g.s.distractAt = Date.now() - 1;
  g.s.distractUntil = 0;
  g.tick(1);
  assert.ok(g.s.distractUntil > Date.now(), 'window=' + g.s.distractUntil);
  const before = g.s.growth;
  const r = g.pat('head');
  assert.strictEqual(r.distract, true);
  assert.strictEqual(g.s.growth, before + 5);
  assert.strictEqual(g.s.distractUntil, 0);
});

ok('random event fires and schedules next', function () {
  const g = newGame();
  g.s.nextEventAt = Date.now() - 1;
  g.tick(1);
  assert.ok(g.s.nextEventAt > Date.now());
});

ok('daily tasks auto claim on completion', function () {
  const g = newGame();
  const d = g.ensureDaily();
  d.tasks.slice(0, 2).forEach(function (t) { t.done = t.target; });
  const last = d.tasks[2];
  last.done = last.target - 1;
  const before = g.s.money;
  g.countTask(last.id);
  assert.strictEqual(d.claimed, true);
  assert.strictEqual(g.s.money, before + 30);
});

ok('long absence marks pet away and pauses', function () {
  const g = newGame();
  assert.strictEqual(g.maybeAbsent(3 * 3600 * 1000), true);
  assert.strictEqual(g.s.absent, true);
  assert.strictEqual(g.snapshot().label, '离开');
  const h = g.s.hunger;
  g.tick(600);
  assert.strictEqual(g.s.hunger, h);
  assert.strictEqual(g.activate(), true);
  assert.strictEqual(g.s.absent, false);
  g.tick(600);
  assert.ok(g.s.hunger < h);
});

ok('short absence is ignored', function () {
  const g = newGame();
  assert.strictEqual(g.maybeAbsent(1 * 3600 * 1000), false);
  assert.strictEqual(g.s.absent, false);
});

ok('death zeroes all stats and disables actions', function () {
  const g = newGame();
  g.s.hunger = 11;
  g.s.clean = 12;
  g.s.mood = 13;
  g.s.stamina = 14;
  g.s.health = 15;
  g.die();
  assert.strictEqual(g.s.alive, false);
  assert.strictEqual(g.s.hunger, 0);
  assert.strictEqual(g.s.clean, 0);
  assert.strictEqual(g.s.mood, 0);
  assert.strictEqual(g.s.stamina, 0);
  assert.strictEqual(g.s.health, 0);
  assert.strictEqual(g.snapshot().can.feed, false);
  assert.strictEqual(g.snapshot().can.revive, true);
});

ok('scholar shortens study time', function () {
  const g = newGame();
  g.s.level = 30;
  g.s.specs = ['scholar', 'scholar', 'scholar', 'scholar', 'scholar', 'scholar'];
  assert.ok(Math.abs(g.perks().studyTime - 0.18) < 1e-9, 'studyTime=' + g.perks().studyTime);
  const fresh = new Game(Game.fresh('x'));
  fresh.s.level = 30;
  fresh.s.specs = ['scholar', 'scholar', 'scholar', 'scholar', 'scholar', 'scholar'];
  fresh.s.money = 100;
  fresh.s.hunger = 80;
  fresh.s.clean = 80;
  fresh.enroll('kid', 'zhi', 0);
  assert.strictEqual(fresh.s.busyTotal, 16 * 60000);
});

ok('study detail shows stage course and lesson index', function () {
  const g = newGame();
  g.enroll('primary', 'zhi', 0);
  const snap = g.snapshot();
  assert.strictEqual(snap.label, '上课中');
  assert.strictEqual(snap.detail, '小学语文1/8');
});

ok('job stamina is 1.5x rounded to 0/2/5', function () {
  const g = newGame();
  const expect = { dish: 5, brick: 10, flyer: 12, waiter: 2, kitchen: 10, courier: 10, typist: 2, seller: 5, guard: 10, editor: 2, model: 5, architect: 10, judge: 5, chief: 5, king: 10 };
  Object.keys(expect).forEach(function (id) {
    const job = JOBS.find(function (j) { return j.id === id; });
    assert.strictEqual(g.jobStamina(job), expect[id], id);
  });
});

ok('work and study drain mood continuously', function () {
  const g = newGame();
  g.s.level = 3;
  g.s.hunger = 80;
  g.s.clean = 80;
  g.s.mood = 50;
  g.workAt('brick');
  g.tick(600);
  assert.ok(g.s.mood < 50, 'mood=' + g.s.mood);
  assert.ok(Math.abs(g.s.mood - 49.7) < 0.05, 'mood=' + g.s.mood);
});

ok('repeat work queues up to 5 shifts', function () {
  const g = newGame();
  g.s.level = 3;
  g.s.money = 100;
  g.s.hunger = 80;
  g.s.clean = 80;
  g.s.stamina = 100;
  assert.strictEqual(g.startWorkRepeat('brick', 3).ok, true);
  assert.strictEqual(g.s.repeat.left, 2);
  g.s.busyUntil = Date.now() - 1;
  g.tick(0);
  assert.strictEqual(g.s.activity, 'work');
  assert.strictEqual(g.s.repeat.left, 1);
  g.s.busyUntil = Date.now() - 1;
  g.tick(0);
  assert.strictEqual(g.s.activity, 'work');
  assert.strictEqual(g.s.repeat, null);
  g.s.busyUntil = Date.now() - 1;
  g.tick(0);
  assert.strictEqual(g.s.activity, 'idle');
});

ok('repeat study queues lessons', function () {
  const g = new Game(Game.fresh('x'));
  g.s.money = 100;
  g.s.hunger = 80;
  g.s.clean = 80;
  assert.strictEqual(g.startStudyRepeat('kid', 'zhi', 0, 2).ok, true);
  g.s.busyUntil = Date.now() - 1;
  g.tick(0);
  assert.strictEqual(g.s.activity, 'study');
  assert.strictEqual(g.s.courses['kid:zhi:0'], 1);
  g.s.busyUntil = Date.now() - 1;
  g.tick(0);
  assert.strictEqual(g.s.activity, 'idle');
  assert.strictEqual(g.s.courses['kid:zhi:0'], 2);
});

ok('notify low toggle', function () {
  const g = newGame();
  assert.strictEqual(g.s.notifyLow, true);
  assert.strictEqual(g.setNotifyLow(false).ok, true);
  assert.strictEqual(g.s.notifyLow, false);
});

ok('stop activity interrupts work and study', function () {
  const w = newGame();
  w.s.level = 3;
  w.s.money = 100;
  w.s.hunger = 80;
  w.s.clean = 80;
  w.startWorkRepeat('brick', 3);
  assert.strictEqual(w.stopActivity().ok, true);
  assert.strictEqual(w.s.activity, 'idle');
  assert.strictEqual(w.s.repeat, null);

  const st = new Game(Game.fresh('x'));
  st.s.money = 100;
  st.s.hunger = 80;
  st.s.clean = 80;
  st.startStudyRepeat('kid', 'zhi', 0, 2);
  assert.strictEqual(st.stopActivity().ok, true);
  assert.strictEqual(st.s.activity, 'idle');
  assert.strictEqual(st.s.courses['kid:zhi:0'], undefined);
  assert.strictEqual(st.s.repeat, null);
});

console.log('---');
console.log('passed ' + passed);
