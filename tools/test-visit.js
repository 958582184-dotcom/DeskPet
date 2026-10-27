'use strict';

const assert = require('node:assert');
const { VisitServer, VisitClient, VisitPullClient } = require('../src/visit');

function wait(ms) {
  return new Promise(function (r) { setTimeout(r, ms); });
}

(async function () {
  let guest = null;
  const events = [];
  const srv = new VisitServer({
    hostName: function () { return 'B 的小宠'; },
    onArrive: function (g) { guest = g; },
    onState: function (g) { guest = g; },
    onLeave: function () { guest = null; },
    onGone: function () { guest = null; },
  });
  const port = await srv.start(0, '1234');
  assert.ok(port > 0);

  const bad = await new VisitClient(function () { return {}; }, {}).arrive('127.0.0.1:' + port, '9999');
  assert.strictEqual(bad.ok, false, '错误门牌码应该被拒绝');

  const pet = { name: '小白', level: 5, anim: '待机呼吸休闲', walking: false, facing: 1 };
  const cli = new VisitClient(function () { return pet; }, {
    onPat: function () { events.push('pat'); },
    onFeed: function (id) { events.push('feed:' + id); },
    onSendHome: function () { events.push('sendhome'); },
    onClosed: function (m) { events.push('closed:' + m); },
  });
  const r = await cli.arrive('127.0.0.1:' + port, '1234');
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.host, 'B 的小宠');
  assert.ok(guest && guest.name === '小白');

  await wait(300);
  assert.strictEqual(guest.pet.anim, '待机呼吸休闲');

  srv.push({ type: 'pat' });
  srv.push({ type: 'feed', foodId: 'cookie' });
  cli.poll();
  await wait(500);
  assert.deepStrictEqual(events, ['pat', 'feed:cookie']);

  await cli.leave();
  await wait(300);
  assert.strictEqual(guest, null);

  srv.stop();

  // 取宠模式：对方连不上时，接收端主动来拉
  let picker = null;
  const acts = [];
  const srv2 = new VisitServer({
    hostName: function () { return 'A 的小宠'; },
    offerActive: function () { return true; },
    getPet: function () { return { name: '小蓝', level: 9, anim: '待机呼吸休闲', bubble: '' }; },
    onPickupJoin: function (p) { picker = p; },
    onPickupAction: function (ev) { acts.push(ev.type); },
    onPickupLeave: function () { picker = null; },
  });
  const port2 = await srv2.start(0, '5678');
  let got = null;
  const pull = new VisitPullClient({ onPet: function (p) { got = p; } });
  const j = await pull.join('127.0.0.1:' + port2, '5678');
  assert.strictEqual(j.ok, true);
  assert.ok(picker, '等待主人同意');
  assert.strictEqual(got, null, '同意前不给宠物');
  srv2.picker.approved = true;
  await wait(2400);
  assert.ok(got && got.name === '小蓝', '同意后拿到宠物');
  pull.send({ type: 'pat' });
  pull.send({ type: 'feed', foodId: 'cookie' });
  await wait(300);
  pull.poll();
  await wait(500);
  assert.deepStrictEqual(acts, ['pat', 'feed']);
  await pull.leave();
  await wait(300);
  assert.strictEqual(picker, null);
  srv2.stop();

  console.log('visit tests passed');
  process.exit(0);
})().catch(function (err) {
  console.error('visit tests failed:', err && err.message);
  process.exit(1);
});
