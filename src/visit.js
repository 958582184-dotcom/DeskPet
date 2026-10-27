'use strict';

const http = require('node:http');

const STALE_MS = 10000;
const TIMEOUT_MS = 3000;
const BODY_LIMIT = 4096;

function readBody(req, cb) {
  let size = 0;
  const chunks = [];
  req.on('data', function (c) {
    size += c.length;
    if (size > BODY_LIMIT) {
      req.destroy();
      return;
    }
    chunks.push(c);
  });
  req.on('end', function () {
    let obj = {};
    try {
      obj = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
    } catch (e) {
      obj = null;
    }
    cb(obj);
  });
}

function send(res, code, obj) {
  const data = JSON.stringify(obj || {});
  res.writeHead(code, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(data),
    'Cache-Control': 'no-store',
  });
  res.end(data);
}

function normalizeAddress(input) {
  let s = String(input || '').trim().replace(/^https?:\/\//i, '').replace(/\/+$/, '');
  if (!s) return '';
  if (!/:\d+$/.test(s)) s += ':8737';
  return s;
}

function postJson(address, path, body) {
  return new Promise(function (resolve) {
    const addr = normalizeAddress(address);
    if (!addr) return resolve({ ok: false, status: 0, json: {} });
    const [host, port] = addr.split(':');
    const data = JSON.stringify(body || {});
    let done = false;
    const finish = function (r) {
      if (done) return;
      done = true;
      resolve(r);
    };
    const req = http.request(
      {
        hostname: host,
        port: Number(port),
        path: path,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json; charset=utf-8',
          'Content-Length': Buffer.byteLength(data),
        },
        timeout: TIMEOUT_MS,
      },
      function (res) {
        let buf = '';
        res.on('data', function (c) { buf += c; });
        res.on('end', function () {
          let json = {};
          try { json = JSON.parse(buf || '{}'); } catch (e) { json = {}; }
          finish({ ok: res.statusCode < 400, status: res.statusCode, json: json });
        });
      }
    );
    req.on('error', function () { finish({ ok: false, status: 0, json: {} }); });
    req.on('timeout', function () { req.destroy(); finish({ ok: false, status: 0, json: {} }); });
    req.write(data);
    req.end();
  });
}

/** 接待端：B 家的小服务，A 的宠物来这里串门 */
class VisitServer {
  constructor(handlers) {
    this.h = handlers || {};
    this.server = null;
    this.port = 0;
    this.code = '';
    this.guest = null;
    this.picker = null;
    this.timer = null;
  }

  start(port, code) {
    const self = this;
    if (this.server) this.stop();
    this.code = String(code || '');
    return new Promise(function (resolve, reject) {
      const server = http.createServer(function (req, res) { self.handle(req, res); });
      server.once('error', function (err) {
        self.server = null;
        reject(err);
      });
      const p = Number(port);
      server.listen(Number.isFinite(p) ? p : 8737, '0.0.0.0', function () {
        self.server = server;
        self.port = server.address().port;
        self.timer = setInterval(function () { self.checkStale(); }, 2000);
        resolve(self.port);
      });
    });
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    if (this.server) {
      try { this.server.close(); } catch (e) { /* ignore */ }
    }
    this.server = null;
    this.guest = null;
  }

  checkStale() {
    if (this.picker && Date.now() - this.picker.lastSeen > STALE_MS) {
      this.picker = null;
      if (this.h.onPickupLeave) this.h.onPickupLeave('timeout');
    }
    if (this.guest && Date.now() - this.guest.lastSeen > STALE_MS) {
      const name = this.guest.name;
      this.guest = null;
      if (this.h.onGone) this.h.onGone(name);
    }
  }

  push(event) {
    if (!this.guest) return false;
    this.guest.events.push(event);
    return true;
  }

  handle(req, res) {
    const url = new URL(req.url, 'http://local');
    const path = url.pathname;
    if (req.method !== 'POST') return send(res, 405, { error: 'method' });

    const self = this;
    readBody(req, function (body) {
      if (!body) return send(res, 400, { error: 'json' });

      if (path === '/visit/arrive') {
        if (String(body.code || '') !== self.code) return send(res, 401, { error: 'code' });
        if (self.guest) return send(res, 409, { error: 'busy' });
        self.guest = {
          id: Math.random().toString(36).slice(2, 10),
          name: String(body.name || '小宠物').slice(0, 20),
          level: Number(body.level) || 1,
          pet: body.pet || null,
          lastSeen: Date.now(),
          events: [],
        };
        if (self.h.onArrive) self.h.onArrive(self.guest);
        return send(res, 200, { session: self.guest.id, host: self.h.hostName ? self.h.hostName() : '' });
      }

      if (path === '/visit/state') {
        if (!self.guest || body.session !== self.guest.id) return send(res, 404, { error: 'session' });
        self.guest.lastSeen = Date.now();
        self.guest.pet = body.pet || self.guest.pet;
        if (self.h.onState) self.h.onState(self.guest);
        const events = self.guest.events.splice(0);
        return send(res, 200, { events: events });
      }

      if (path === '/visit/leave') {
        if (self.guest && body.session === self.guest.id) {
          const name = self.guest.name;
          self.guest = null;
          if (self.h.onLeave) self.h.onLeave(name);
        }
        return send(res, 200, { ok: true });
      }

      if (path === '/visit/pickup/join') {
        if (String(body.code || '') !== self.code) return send(res, 401, { error: 'code' });
        if (!self.h.offerActive || !self.h.offerActive()) return send(res, 409, { error: 'no-offer' });
        if (self.picker) return send(res, 409, { error: 'busy' });
        self.picker = {
          id: Math.random().toString(36).slice(2, 10),
          name: String(body.name || '朋友').slice(0, 20),
          lastSeen: Date.now(),
          approved: false,
        };
        if (self.h.onPickupJoin) self.h.onPickupJoin(self.picker);
        return send(res, 200, { session: self.picker.id, pending: true, host: self.h.hostName ? self.h.hostName() : '' });
      }

      if (path === '/visit/pickup/poll') {
        if (!self.picker || body.session !== self.picker.id) return send(res, 404, { error: 'session' });
        self.picker.lastSeen = Date.now();
        if (!self.picker.approved) return send(res, 200, { pending: true, pet: null });
        const actions = Array.isArray(body.actions) ? body.actions : [];
        for (let i = 0; i < actions.length; i++) {
          if (self.h.onPickupAction) self.h.onPickupAction(actions[i]);
        }
        return send(res, 200, { pet: self.h.getPet ? self.h.getPet() : null });
      }

      if (path === '/visit/pickup/leave') {
        if (self.picker && body.session === self.picker.id) {
          self.picker = null;
          if (self.h.onPickupLeave) self.h.onPickupLeave('leave');
        }
        return send(res, 200, { ok: true });
      }

      if (path === '/visit/ping') {
        return send(res, 200, { ok: true, guest: self.guest ? self.guest.name : '' });
      }

      return send(res, 404, { error: 'path' });
    });
  }
}

/** 宠物端：A 把宠物送到 B 家，定时汇报状态、取回事件 */
class VisitClient {
  constructor(getPet, handlers) {
    this.pollMs = 2000;
    this.getPet = getPet;
    this.h = handlers || {};
    this.address = '';
    this.session = '';
    this.timer = null;
    this.fails = 0;
    this.busy = false;
  }

  arrive(address, code) {
    const self = this;
    const pet = this.getPet();
    return postJson(address, '/visit/arrive', {
      code: code,
      name: pet.name,
      level: pet.level,
      pet: pet,
    }).then(function (r) {
      if (!r.ok) {
        const msg = r.json && r.json.error === 'code' ? '门牌码不对' :
          r.json && r.json.error === 'busy' ? '对方家已经有一只客宠了' :
            r.status === 0 ? '连不上 ' + normalizeAddress(address) + '：检查对方是否开着接待、防火墙是否放行' : '对方拒绝了连接';
        return { ok: false, msg: msg };
      }
      self.address = normalizeAddress(address);
      self.session = r.json.session;
      self.fails = 0;
      self.start();
      return { ok: true, host: r.json.host || '' };
    });
  }

  start() {
    const self = this;
    if (this.timer) clearInterval(this.timer);
    this.timer = setInterval(function () { self.poll(); }, self.pollMs || 2000);
    this.poll();
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  poll() {
    const self = this;
    if (!this.session || this.busy) return;
    this.busy = true;
    postJson(this.address, '/visit/state', {
      session: this.session,
      pet: this.getPet(),
    }).then(function (r) {
      self.busy = false;
      if (!r.ok) {
        self.fails += 1;
        if (r.status === 404 || self.fails >= 3) {
          self.stop();
          self.session = '';
          if (self.h.onClosed) self.h.onClosed(r.status === 404 ? '对方关掉了串门' : '和对方断开了');
        }
        return;
      }
      self.fails = 0;
      const events = r.json.events || [];
      for (let i = 0; i < events.length; i++) {
        const ev = events[i];
        if (ev.type === 'pat' && self.h.onPat) self.h.onPat();
        else if (ev.type === 'feed' && self.h.onFeed) self.h.onFeed(ev.foodId);
        else if (ev.type === 'sendhome' && self.h.onSendHome) self.h.onSendHome();
      }
    });
  }

  leave() {
    const self = this;
    const session = this.session;
    const address = this.address;
    this.stop();
    this.session = '';
    if (!session) return Promise.resolve();
    return postJson(address, '/visit/leave', { session: session }).then(function () { /* ignore */ });
  }
}

/** 接收端：去朋友家把宠物「取」过来（朋友在 NAT 后面、连不上时用） */
class VisitPullClient {
  constructor(handlers) {
    this.pollMs = 2000;
    this.h = handlers || {};
    this.address = '';
    this.session = '';
    this.timer = null;
    this.fails = 0;
    this.actions = [];
    this.busy = false;
    this.pet = null;
  }

  send(action) {
    this.actions.push(action);
  }

  join(address, code, myName) {
    const self = this;
    return postJson(address, '/visit/pickup/join', { code: code, name: myName || '朋友' }).then(function (r) {
      if (!r.ok) {
        const msg = r.json && r.json.error === 'code' ? '门牌码不对' :
          r.json && r.json.error === 'no-offer' ? '对方还没开启「让对方来取」' :
            r.json && r.json.error === 'busy' ? '已经有人在取了' :
              r.status === 0 ? '连不上 ' + normalizeAddress(address) + '：检查网段和防火墙' : '对方拒绝了';
        return { ok: false, msg: msg };
      }
      self.address = normalizeAddress(address);
      self.session = r.json.session;
      self.fails = 0;
      self.start();
      return { ok: true, host: r.json.host || '' };
    });
  }

  start() {
    const self = this;
    if (this.timer) clearInterval(this.timer);
    this.timer = setInterval(function () { self.poll(); }, self.pollMs || 2000);
    this.poll();
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  poll() {
    const self = this;
    if (!this.session || this.busy) return;
    this.busy = true;
    const actions = this.actions.splice(0);
    postJson(this.address, '/visit/pickup/poll', { session: this.session, actions: actions }).then(function (r) {
      self.busy = false;
      if (!r.ok) {
        self.fails += 1;
        if (r.status === 404 || self.fails >= 3) {
          self.stop();
          self.session = '';
          if (self.h.onClosed) self.h.onClosed(r.status === 404 ? '对方收回了宠物' : '和对方断开了');
        }
        return;
      }
      self.fails = 0;
      self.pet = r.json.pet || self.pet;
      if (self.pet && self.h.onPet) self.h.onPet(self.pet);
    });
  }

  leave() {
    const session = this.session;
    const address = this.address;
    this.stop();
    this.session = '';
    if (!session) return Promise.resolve();
    return postJson(address, '/visit/pickup/leave', { session: session }).then(function () { /* ignore */ });
  }
}

module.exports = { VisitServer, VisitClient, VisitPullClient, normalizeAddress, postJson };
