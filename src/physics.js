'use strict';

/**
 * 抛掷物理（纯函数，方便单测）。
 * 参考 dsh-pet 的手感：拖动时按指针轨迹估速，松手后重力 + 碰壁反弹 + 地面摩擦。
 */

const DEFAULTS = {
  gravity: 1400,      // px/s²（对齐参考项目）
  restitution: 0.78,  // 碰壁/落地反弹系数
  groundFriction: 2.5, // 落地后水平速度衰减 /s
  maxSpeed: 3600,     // 初速上限（softClamp）
};

const RELEASE_WINDOW_MS = 150;
const RELEASE_STALE_MS = 150;
const MIN_SPAN_MS = 20;
const SEG_MIN_DT_MS = 8;
const DEAD_ZONE_SPEED = 500;
const PEAK_WEIGHT = 0.5;
const ACCEL_REF = 8000;
const ACCEL_GAIN_MAX = 0.6;

function softClampSpeed(speed, max) {
  if (speed <= 0) return 0;
  const cap = max || DEFAULTS.maxSpeed;
  return cap * (1 - Math.exp(-speed / cap));
}

/** 从最近的指针轨迹估初速（只用最后 ~140ms 的采样） */
function velocityFromTrail(trail, now) {
  if (!Array.isArray(trail) || !trail.length) return null;
  const t = typeof now === 'number' ? now : (trail[trail.length - 1] || {}).t;
  const last = trail[trail.length - 1];
  if (!last || t - last.t > RELEASE_STALE_MS) return null;

  const win = trail.filter(function (s) { return t - s.t <= RELEASE_WINDOW_MS; });
  if (win.length < 2) return null;

  const first = win[0];
  const span = last.t - first.t;
  if (span < MIN_SPAN_MS) return null;

  const baseVx = (last.x - first.x) / span * 1000;
  const baseVy = (last.y - first.y) / span * 1000;
  const baseSpeed = Math.sqrt(baseVx * baseVx + baseVy * baseVy);
  if (baseSpeed < 1e-6) return null;

  // 分段速度取峰值，再按 50/50 与基础速度加权（参考 dsh-pet 的 PEAK_WEIGHT）
  const segs = [];
  let px = first.x;
  let py = first.y;
  let pt = first.t;
  for (let i = 1; i < win.length; i++) {
    const dt = win[i].t - pt;
    if (dt >= SEG_MIN_DT_MS) {
      segs.push({ speed: Math.hypot(win[i].x - px, win[i].y - py) / dt * 1000, tEnd: win[i].t });
      px = win[i].x;
      py = win[i].y;
      pt = win[i].t;
    }
  }
  const peakSpeed = segs.length ? Math.max.apply(null, segs.map(function (v) { return v.speed; })) : baseSpeed;

  let accel = 0;
  if (segs.length >= 2) {
    accel = (segs[segs.length - 1].speed - segs[0].speed) / Math.max((segs[segs.length - 1].tEnd - segs[0].tEnd) / 1000, MIN_SPAN_MS / 1000);
  }
  const gain = 1 + Math.min(Math.max(accel, 0) / ACCEL_REF, 1) * ACCEL_GAIN_MAX;
  const raw = ((1 - PEAK_WEIGHT) * baseSpeed + PEAK_WEIGHT * peakSpeed) * gain;
  const speed = softClampSpeed(raw);
  if (speed < DEAD_ZONE_SPEED) return null;

  return { vx: baseVx / baseSpeed * speed, vy: baseVy / baseSpeed * speed };
}

/**
 * 走一帧飞行。
 * pos/vel: {x,y} / {vx,vy}（窗口左上角 + 像素/秒）
 * bounds: {left, top, right, bottom} 工作区；w/h 窗口尺寸
 * 返回 {x,y,vx,vy,landed,stopped}
 */
function stepFlight(pos, vel, dt, bounds, opts) {
  const o = Object.assign({}, DEFAULTS, opts || {});
  let vx = vel.vx;
  let vy = vel.vy + o.gravity * dt;
  let x = pos.x + vx * dt;
  let y = pos.y + vy * dt;

  // 左右墙
  if (x < bounds.left) {
    x = bounds.left;
    vx = Math.abs(vx) * o.restitution;
  } else if (x + bounds.w > bounds.right) {
    x = bounds.right - bounds.w;
    vx = -Math.abs(vx) * o.restitution;
  }

  // 天花板
  if (y < bounds.top) {
    y = bounds.top;
    vy = Math.abs(vy) * o.restitution;
  }

  // 地面
  const ground = bounds.bottom - bounds.h;
  let landed = false;
  if (y >= ground) {
    y = ground;
    if (Math.abs(vy) > 40) {
      vy = -Math.abs(vy) * o.restitution;
    } else {
      vy = 0;
      landed = true;
    }
    vx *= Math.max(0, 1 - o.groundFriction * dt);
  }

  if (landed && Math.abs(vx) < 15) vx = 0;

  return {
    x: x,
    y: y,
    vx: vx,
    vy: vy,
    landed: landed,
    stopped: landed && vx === 0 && vy === 0,
  };
}

module.exports = { DEFAULTS, velocityFromTrail, stepFlight, softClampSpeed, DEAD_ZONE_SPEED };
