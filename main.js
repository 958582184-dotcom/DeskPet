'use strict';

/**
 * 桌面宠物 · 桌面端
 *
 * 形态参考 dsh-pet 的 Electron helper：
 *   - 宠物窗是「透明 + 无边框 + 置顶 + 不占任务栏」的局部小窗口，尺寸只比宠物大一圈，
 *     跟着宠物在桌面上移动（主进程 setBounds），不做全屏透明画布。
 *   - 窗口默认整窗点击穿透，主进程按真实光标位置判定是否落在宠物身上，
 *     落在身上才 setIgnoreMouseEvents(false)，透明区域不挡下层程序。
 *   - 托盘常驻：关掉面板、隐藏宠物都不退出进程。
 */

const { app, BrowserWindow, Menu, Tray, ipcMain, screen, nativeImage, dialog, clipboard, powerMonitor, Notification } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const crypto = require('node:crypto');
const os = require('node:os');
const net = require('node:net');

const { Game, FOODS, ACTIONS, stateLabel } = require('./src/game');
const { VisitServer, VisitClient, VisitPullClient, normalizeAddress } = require('./src/visit');
const store = require('./src/store');
const Physics = require('./src/physics');

const BOOT_LOG = path.join(os.tmpdir(), 'qqpet-boot.log');
const ANIM_LOG = path.join(os.tmpdir(), 'qqpet-anim.log');

function blog(msg) {
  if (!TEST) return;
  try { fs.appendFileSync(BOOT_LOG, new Date().toISOString() + ' ' + msg + '\n'); } catch (e) { /* ignore */ }
}

const SMOKE = process.argv.includes('--smoke');
const UI_TEST = process.argv.includes('--ui-test');
const DRAG_TEST = process.argv.includes('--drag-test');
const VISIT_TEST = process.argv.includes('--visit-test');
const CURE_TEST = process.argv.includes('--cure-test');
const PANEL_POS_TEST = process.argv.includes('--panel-pos-test');
const PERKS_TEST = process.argv.includes('--perks-test');
const SCHOOL_TEST = process.argv.includes('--school-test');
const BUSY_TEST = process.argv.includes('--busy-test');
const DAILY_TEST = process.argv.includes('--daily-test');
const HOVER_TEST = process.argv.includes('--hover-test');
const HOST_VISIT = process.argv.includes('--host-visit');
const OFFER_VISIT = process.argv.includes('--offer-visit');
const PULL_VISIT = (function () {
  const i = process.argv.indexOf('--pull-visit');
  return i >= 0 ? String(process.argv[i + 1] || '') : '';
})();
const SEND_VISIT = (function () {
  const i = process.argv.indexOf('--send-visit');
  return i >= 0 ? String(process.argv[i + 1] || '') : '';
})();
const TEST = SMOKE || UI_TEST || DRAG_TEST || VISIT_TEST || CURE_TEST || PANEL_POS_TEST || PERKS_TEST || SCHOOL_TEST || BUSY_TEST || DAILY_TEST || HOVER_TEST;
blog('boot argv=' + JSON.stringify(process.argv));

const WIN_W = 520; // 宠物窗宽度（640×360 舞台按 16:9 缩放）
const WIN_H = 362; // 宠物窗高度（292 视频 + 头顶气泡空间）
const BASE_HIT = { x: 163, y: 127, w: 194, h: 230 }; // 1 倍时的角色身体命中区
let HIT = { x: 163, y: 127, w: 194, h: 230 };
const GHIT = { x: 163, y: 127, w: 194, h: 230 }; // 客宠窗口固定 1 倍
let petScale = 1;
const SPEED = 60; // 散步速度 px/s
const TICK_MS = 1000;
const MOVE_MS = 60;

const TRAY_ICON = path.join(__dirname, 'assets', 'tray.png');

app.setName('DeskPet');

// 多开测试/多宠物：--profile <名字> 用独立的 userData（存档分开）
const PROFILE = (function () {
  const i = process.argv.indexOf('--profile');
  return i >= 0 ? String(process.argv[i + 1] || '').replace(/[^a-zA-Z0-9_-]/g, '') : '';
})();
if (PROFILE) app.setPath('userData', path.join(app.getPath('appData'), 'DeskPet-' + PROFILE));

if (TEST) app.setPath('userData', path.join(os.tmpdir(), 'deskpet-test-' + process.pid));

// 视频素材要能自动播放（透明 WebM），不需要用户手势
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');
// 关键：关掉 Windows 的窗口遮挡判定，否则面板/菜单盖住宠物窗时 Chromium 会停止出帧，视频卡死
app.commandLine.appendSwitch('disable-features', 'CalculateNativeWinOcclusion');
app.commandLine.appendSwitch('disable-backgrounding-occluded-windows');
app.commandLine.appendSwitch('disable-renderer-backgrounding');

// Windows 上透明分层窗口 + 硬件合成容易出黑边/残影；宠物窗很小，软件合成足够
if (process.platform === 'win32') app.disableHardwareAcceleration();

let game = null;
let petWin = null;
let panelWin = null;
let adoptWin = null;
let tray = null;

let petVisible = false;
let petPos = { x: 0, y: 0 };
let vy = 0;
let vel = { vx: 0, vy: 0 };
let flying = false;
let flightArea = null; // 抛掷时冻结的屏幕工作区，整段飞行都用它，绝不跨屏
let floating = false; // 拎到半空松手后悬停，不再往下掉
let trail = [];
let dragTarget = null;
let dragVX = 0;
let dragVY = 0;
let targetX = null;
let nextWanderAt = 0;
let facing = -1; // -1 = 朝左（素材原始朝向）
let walking = false;
let dragging = false;
let dragOffset = { x: 0, y: 0 };
let ignoreMouse = true;
let menuOpen = false;
let menuWin = null;
let lastMoveAt = 0;
let lastSaveAt = 0;
let quitting = false;
let tickTimer = null;
let moveTimer = null;
let ignoreTimer = null;
let lowTimer = null;
// 画面级看门狗：视频时钟可能在走但合成器不再出新帧，只能靠像素判断
let paintTimer = null;
let paintHash = '';
let paintStill = 0;
let paintRecoverAt = 0;
let paintRecoverCount = 0;
let paintLastStallAt = 0;

// 串门
let visitServer = null;
let visitClient = null;
let pullClient = null;
let guestWin = null;
let guestPet = null;
let guestName = '';
let guestLevel = 1;
let guestPos = { x: 0, y: 0 };
let guestMoveTimer = null;
let guestIgnore = true;
let guestFeedAt = 0;
let guestLocal = { walking: false, facing: 1, target: 0, nextAt: 0 };
let guestScale = 1;
let guestHit = { x: 163, y: 127, w: 194, h: 230 };
let guestPatAt = 0;
let visitHomeTimer = null;
let lastSay = { text: '', until: 0 };

/* ---------------- 工具 ---------------- */

function clamp(v, a, b) {
  return v < a ? a : v > b ? b : v;
}

function sleep(ms) {
  return new Promise(function (r) { setTimeout(r, ms); });
}

function displayFor(x, y) {
  return screen.getDisplayNearestPoint({ x: Math.round(x), y: Math.round(y) });
}

function scaleForLevel(level) {
  const t = clamp((Number(level) - 1) / 29, 0, 1);
  return (100 + 150 * t) / 211; // 211 = 1 倍时角色的可见高度
}

/** 只缩放宠物，窗口和脚底位置不动 */
function applyPetScale(level, force) {
  const next = scaleForLevel(level);
  if (!force && Math.abs(next - petScale) < 0.002) return;
  petScale = next;
  HIT = {
    x: Math.round(260 - (BASE_HIT.w / 2) * next),
    y: Math.round(357 - BASE_HIT.h * next),
    w: Math.round(BASE_HIT.w * next),
    h: Math.round(BASE_HIT.h * next),
  };
  if (petWin && !petWin.isDestroyed()) {
    try { petWin.webContents.send('pet:scale', { scale: petScale, hit: HIT }); } catch (e) { /* ignore */ }
  }
}

function groundY() {
  const wa = displayFor(petPos.x + WIN_W / 2, petPos.y + WIN_H / 2).workArea;
  return wa.y + wa.height - WIN_H;
}

function sendToWindows(channel, payload) {
  [petWin, panelWin].forEach(function (w) {
    if (!w || w.isDestroyed() || !w.webContents || w.webContents.isDestroyed()) return;
    try { w.webContents.send(channel, payload); } catch (e) { /* 窗口正在销毁 */ }
  });
}

function say(text, ms) {
  // 免打扰：不再弹气泡（状态和数值照常更新）
  if (game && game.s.muted) return;
  lastSay = { text: text, until: Date.now() + (ms || 2600) };
  sendToWindows('say', { text: text, ms: ms || 2600 });
}

/* ---------------- 窗口 ---------------- */

function createPetWindow() {
  const wa = screen.getPrimaryDisplay().workArea;
  petPos.x = wa.x + wa.width - (HIT.x + HIT.w) - 80;
  petPos.y = wa.y + wa.height - WIN_H;

  petWin = new BrowserWindow({
    width: WIN_W,
    height: WIN_H,
    x: Math.round(petPos.x),
    y: Math.round(petPos.y),
    show: false,
    useContentSize: true,
    transparent: true,
    frame: false,
    resizable: false,
    movable: true,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    hasShadow: false,
    focusable: false,
    title: '桌面宠物',
    webPreferences: {
      preload: path.join(__dirname, 'preload', 'pet.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      backgroundThrottling: false,
      spellcheck: false,
    },
  });

  petWin.setAlwaysOnTop(true, 'screen-saver');
  if (process.platform === 'darwin') {
    petWin.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  }
  petWin.setIgnoreMouseEvents(true, { forward: false });
  petWin.webContents.on('context-menu', function (e) { e.preventDefault(); });

  petWin.once('ready-to-show', function () {
    if (petVisible) petWin.showInactive();
  });
  petWin.on('closed', function () { petWin = null; });

  petWin.webContents.on('did-finish-load', function () {
    try { petWin.webContents.send('pet:scale', { scale: petScale, hit: HIT }); } catch (e) { /* ignore */ }
  });
  petWin.loadFile(path.join(__dirname, 'renderer', 'pet.html'));
}

function createPanelWindow() {
  panelWin = new BrowserWindow({
    width: 380,
    height: 560,
    show: false,
    frame: false,
    resizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    transparent: true,
    hasShadow: false,
    backgroundColor: '#00000000',
    title: '桌面宠物',
    webPreferences: {
      preload: path.join(__dirname, 'preload', 'panel.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      spellcheck: false,
    },
  });

  panelWin.on('close', function (e) {
    if (quitting) return;
    e.preventDefault();
    panelWin.hide();
  });
  if (TEST) {
    panelWin.webContents.on('console-message', function (event, level, message) {
      var msg = (event && event.message) || message || (typeof level === 'string' ? level : '');
      console.log('PANEL ' + msg);
    });
  }
  panelWin.on('blur', function () { if (!quitting) hidePanel(); });
  panelWin.on('closed', function () { panelWin = null; });
  panelWin.loadFile(path.join(__dirname, 'renderer', 'panel.html'));
}

function createAdoptWindow() {
  adoptWin = new BrowserWindow({
    width: 420,
    height: 400,
    show: false,
    frame: false,
    resizable: false,
    maximizable: false,
    fullscreenable: false,
    transparent: true,
    hasShadow: false,
    backgroundColor: '#00000000',
    title: '领养',
    webPreferences: {
      preload: path.join(__dirname, 'preload', 'adopt.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      spellcheck: false,
    },
  });

  adoptWin.on('close', function (e) {
    if (quitting || game) return;
    e.preventDefault();
    quitApp();
  });
  adoptWin.on('closed', function () { adoptWin = null; });
  adoptWin.loadFile(path.join(__dirname, 'renderer', 'adopt.html'));
}

/* ---------------- 位置 / 跟随 ---------------- */


function petPaintLog(msg) {
  try {
    fs.appendFileSync(ANIM_LOG, new Date().toISOString() + ' ' + msg + '\n');
  } catch (e) { /* ignore */ }
}

function checkPetPaint() {
  if (!petWin || petWin.isDestroyed() || !petVisible || dragging || flying) {
    paintStill = 0;
    return;
  }
  if (Date.now() < paintRecoverAt) return;
  if (petWin.webContents.isLoading()) return;
  petWin.webContents.executeJavaScript('document.visibilityState').then(function (vis) {
    // 被完全遮挡时 Chromium 会停止出帧，这不是卡死，跳过
    if (vis === 'hidden') {
      paintStill = 0;
      return;
    }
    return petWin.webContents.capturePage().then(handlePetPaint);
  }).catch(function () { /* ignore */ });
}

function handlePetPaint(img) {
    if (!img || img.isEmpty()) return;
    const h = crypto.createHash('sha1').update(img.toPNG()).digest('hex');
    if (h === paintHash) {
      paintStill += 1;
    } else {
      paintHash = h;
      paintStill = 0;
    }
    if (paintStill >= 3) petPaintRecover();
}

function petPaintRecover() {
  paintStill = 0;
  paintHash = '';
  paintRecoverAt = Date.now() + 15000;
  paintRecoverCount += 1;
  paintLastStallAt = Date.now();
  petPaintLog('paint-stall #' + paintRecoverCount);
  if (petRecoverCount >= 2) {
    // 第二次还卡：整窗重建，等价于只重启宠物窗
    petRecoverCount = 0;
    petPaintLog('paint-stall rebuild-window');
    rebuildPetWindow();
    return;
  }
  try { petWin.webContents.reload(); } catch (e) { /* ignore */ }
}

function rebuildPetWindow() {
  if (!petWin || petWin.isDestroyed()) return;
  const pos = { x: petPos.x, y: petPos.y };
  const wasVisible = petVisible;
  const wasFlying = flying;
  try { petWin.removeAllListeners('closed'); } catch (e) { /* ignore */ }
  try { petWin.destroy(); } catch (e) { /* ignore */ }
  petWin = null;
  createPetWindow();
  petPos = pos;
  flying = wasFlying;
  petVisible = wasVisible;
  applyBounds();
  petWin.webContents.once('did-finish-load', function () {
    applyBounds();
    applyPetScale(game ? game.s.level : 1, true);
    if (petVisible) petWin.showInactive();
    broadcast();
  });
}

function applyBounds() {
  if (!petWin || petWin.isDestroyed()) return;
  const x = Math.round(petPos.x);
  const y = Math.round(petPos.y);
  const b = petWin.getBounds();
  if (b.x === x && b.y === y) return;
  petWin.setBounds({ x: x, y: y, width: WIN_W, height: WIN_H });
}

function pushMotion() {
  sendToWindows('motion', { walking: walking, facing: facing, flying: flying });
}

function setWalking(next) {
  if (walking === next) return;
  walking = next;
  pushMotion();
}

function setFacing(next) {
  const dir = next >= 0 ? 1 : -1;
  if (facing === dir) return;
  facing = dir;
  pushMotion();
}

function setFlying(next) {
  if (flying === next) return;
  flying = next;
  pushMotion();
}

function panelShown() {
  return !!(panelWin && !panelWin.isDestroyed() && panelWin.isVisible());
}

function canWalk() {
  // 面板打开时宠物站着别动，方便看数值
  return !!game && game.s.alive && !game.s.sick && game.s.activity === 'idle' && !floating && !panelShown();
}


function moveTick() {
  if (!petWin || petWin.isDestroyed() || !petVisible || !game) return;
  if (menuOpen) { setWalking(false); return; }

  const now = Date.now();
  const dt = Math.min((now - lastMoveAt) / 1000, 0.25);
  lastMoveAt = now;

  if (dragging) {
    if (dragTarget) {
      let remain = dt;
      while (remain > 0.0005) {
        const h = Math.min(remain, 1 / 120);
        dragVX += ((dragTarget.x - petPos.x) * 200 - dragVX * 30) * h;
        dragVY += ((dragTarget.y - petPos.y) * 200 - dragVY * 30) * h;
        petPos.x += dragVX * h;
        petPos.y += dragVY * h;
        remain -= h;
      }
      const waDrag = displayFor(petPos.x + WIN_W / 2, petPos.y + WIN_H / 2).workArea;
      petPos.x = clamp(petPos.x, waDrag.x - HIT.x, waDrag.x + waDrag.width - HIT.x - HIT.w);
      petPos.y = clamp(petPos.y, waDrag.y - 12, waDrag.y + waDrag.height - WIN_H);
      applyBounds();
    }
    return;
  }

  {
    const gy = groundY();

    if (flying) {
      const b = flightArea || displayFor(petPos.x + WIN_W / 2, petPos.y + WIN_H / 2).workArea;
      flightArea = b;

      // 固定子步长积分：moveTick 是 60ms，直接用 60ms 步进会让重力每帧灌进 132px/s 的速度，
      // 落地反弹永远压不到静止阈值（表现为一直弹）。这里拆成 ≤1/120s 的子步。
      // 边界按「身体」算：窗口左右各可以探出 HIT.x / 右侧余量，身体边缘正好贴住屏幕边
      const area = {
        left: b.x - HIT.x,
        top: b.y,
        right: b.x + b.width + (WIN_W - HIT.x - HIT.w),
        bottom: b.y + b.height,
        w: WIN_W,
        h: WIN_H,
      };
      let remain = dt;
      let stopped = false;
      while (remain > 0.0005) {
        const h = Math.min(remain, 1 / 120);
        const step = Physics.stepFlight(petPos, vel, h, area);
        petPos.x = step.x;
        petPos.y = step.y;
        vel.vx = step.vx;
        vel.vy = step.vy;
        stopped = step.stopped;
        remain -= h;
        if (stopped) break;
      }

      if (Math.abs(vel.vx) > 40) setFacing(vel.vx);
      setWalking(false);
      if (stopped) {
        setFlying(false);
        flightArea = null;
        floating = false;
        sendToWindows('effect', 'land');
      }
    } else if (!floating && petPos.y < gy - 0.5) {
      // 只有抛掷落地后才会自由落体；手动拖动松手改为悬停
      vy += 2400 * dt;
      petPos.y = Math.min(gy, petPos.y + vy * dt);
      if (petPos.y >= gy) vy = 0;
      setWalking(false);
    } else if (canWalk()) {
      const wa = displayFor(petPos.x + WIN_W / 2, petPos.y + WIN_H / 2).workArea;

      if (targetX === null && now >= nextWanderAt) {
        // 允许窗口的透明边伸出屏幕，身体（HIT 区）刚好能贴到屏幕边
        const min = wa.x - HIT.x + 8;
        const max = wa.x + wa.width - HIT.x - HIT.w - 8;
        targetX = clamp(petPos.x + (Math.random() * 2 - 1) * 130, min, Math.max(min, max));
        nextWanderAt = now + 2500 + Math.random() * 5000;
      }

      if (targetX !== null) {
        const dx = targetX - petPos.x;
        if (Math.abs(dx) < 2) {
          targetX = null;
          setWalking(false);
        } else {
          const dir = dx > 0 ? 1 : -1;
          petPos.x = clamp(petPos.x + dir * SPEED * dt, wa.x - HIT.x, wa.x + wa.width - HIT.x - HIT.w);
          setFacing(dir);
          setWalking(true);
        }
      }
    } else {
      targetX = null;
      setWalking(false);
    }
  }

  applyBounds();
}

function setInteractive(next) {
  if (!petWin || petWin.isDestroyed()) return;
  if (next === !ignoreMouse) return;
  ignoreMouse = !next;
  petWin.setIgnoreMouseEvents(!next, { forward: false });
}

function watchPointer() {
  if (!petWin || petWin.isDestroyed() || !petVisible || !petWin.isVisible()) return;
  if (dragging || menuOpen) {
    setInteractive(true);
    return;
  }

  const b = petWin.getBounds();
  const p = screen.getCursorScreenPoint();
  const inside =
    p.x >= b.x + HIT.x && p.x <= b.x + HIT.x + HIT.w &&
    p.y >= b.y + HIT.y && p.y <= b.y + HIT.y + HIT.h;

  setInteractive(inside);
}

function petChatter() {
  if (!game) return;
  say(game.chatterLine(), 3200);
}

function resetPet() {
  if (!game) return;
  const choice = dialog.showMessageBoxSync({
    type: 'warning',
    buttons: ['取消', '重新领养'],
    defaultId: 0,
    cancelId: 0,
    title: '重新领养',
    message: '会清空当前宠物和存档，重新养一只，确定吗？',
  });
  if (choice !== 1) return;
  try { fs.unlinkSync(store.savePath(app.getPath('userData'))); } catch (e) { /* ignore */ }
  game = null;
  petVisible = false;
  if (petWin && !petWin.isDestroyed()) petWin.setOpacity(0);
  if (panelWin && !panelWin.isDestroyed()) panelWin.hide();
  if (adoptWin && !adoptWin.isDestroyed()) adoptWin.show();
  buildTrayMenu();
}

function recallPet() {
  const wa = displayFor(petPos.x, petPos.y).workArea;
  petPos.x = wa.x + wa.width / 2 - WIN_W / 2;
  petPos.y = wa.y + wa.height - WIN_H;
  vy = 0;
  floating = false;
  targetX = null;
  applyBounds();
  // 之前只挪了位置：宠物被「隐藏」后窗口是 hide 状态，这里得把它显示出来
  setPetVisible(true);
  say('我在这儿！', 1800);
}

/* ---------------- 面板 ---------------- */

function positionPanel() {
  if (!panelWin || !petWin) return;
  const b = petWin.getBounds();
  const wa = displayFor(b.x + b.width / 2, b.y + b.height / 2).workArea;
  const pw = panelWin.getBounds().width;
  const ph = panelWin.getBounds().height;

  // 贴着身体右侧，而不是窗口右侧（窗口左右各有 163px 透明留白）
  let x = b.x + HIT.x + HIT.w + 12;
  if (x + pw > wa.x + wa.width - 8) x = b.x + HIT.x - pw - 12;
  x = clamp(x, wa.x + 8, wa.x + wa.width - pw - 8);

  const y = clamp(b.y + HIT.y - 110, wa.y + 8, wa.y + wa.height - ph - 8);
  panelWin.setPosition(Math.round(x), Math.round(y));
}

function positionPanelAtTray() {
  if (!panelWin || !tray || tray.isDestroyed()) {
    positionPanel();
    return;
  }
  const tb = tray.getBounds();
  const pw = panelWin.getBounds().width;
  const ph = panelWin.getBounds().height;
  if (!tb || !tb.width || !tb.height) {
    positionPanel();
    return;
  }
  const wa = displayFor(tb.x + tb.width / 2, tb.y + tb.height / 2).workArea;
  let x = Math.round(tb.x + tb.width / 2 - pw / 2);
  let y = Math.round(tb.y - ph - 8);
  if (y < wa.y + 4) y = Math.round(tb.y + tb.height + 8);
  x = clamp(x, wa.x + 4, wa.x + wa.width - pw - 4);
  y = clamp(y, wa.y + 4, wa.y + wa.height - ph - 4);
  panelWin.setPosition(x, y);
}

function openSheet(kind) {
  showPanel();
  if (panelWin && !panelWin.isDestroyed()) panelWin.webContents.send('open-sheet', kind);
}

function showPanel(anchor) {
  if (!panelWin || panelWin.isDestroyed()) return;
  if (!game) {
    if (adoptWin && !adoptWin.isDestroyed()) adoptWin.show();
    return;
  }
  if (game.activate()) {
    broadcast();
    saveNow();
  }
  targetX = null;
  setWalking(false);
  if (anchor === 'tray') positionPanelAtTray();
  else if (petWin && petVisible) positionPanel();
  panelWin.show();
  panelWin.moveTop();
  panelWin.focus();
  if (petWin && !petWin.isDestroyed() && petVisible) {
    try {
      petWin.setAlwaysOnTop(true, 'screen-saver');
      petWin.moveTop();
    } catch (e) { /* ignore */ }
  }
  panelWin.webContents.send('state', currentSnapshot());
}

function hidePanel() {
  if (panelWin && !panelWin.isDestroyed() && panelWin.isVisible()) panelWin.hide();
  if (petWin && !petWin.isDestroyed() && petVisible) {
    try {
      petWin.setAlwaysOnTop(true, 'screen-saver');
      petWin.moveTop();
    } catch (e) { /* ignore */ }
  }
  if (petWin && !petWin.isDestroyed() && petVisible) {
    try { petWin.webContents.send('pet:resume'); } catch (e) { /* ignore */ }
    paintHash = '';
    paintStill = 0;
  }
}

function togglePanel() {
  if (!panelWin) return;
  if (panelWin.isVisible()) hidePanel();
  else showPanel('tray');
}

/* ---------------- 托盘 ---------------- */

let trayTitle = '';

function buildTrayMenu() {
  if (!tray || tray.isDestroyed()) return;

  const hasPet = !!game;
  const snap = hasPet ? game.snapshot() : null;

  const dead = hasPet && !game.s.alive;
  const template = [
    {
      label: hasPet ? snap.name + ' · Lv.' + snap.level : '尚未领养',
      enabled: false,
    },
    { type: 'separator' },
    { label: '打开面板', click: function () { showPanel('tray'); } },
    {
      label: '显示宠物',
      type: 'checkbox',
      checked: petVisible,
      click: function (item) { setPetVisible(item.checked); },
    },
  ];

  if (hasPet && game.s.away && game.s.away.active) {
    template.push({ label: '叫 ' + snap.name + ' 回家（在串门）', click: function () { returnPetHome('我叫它回家了'); } });
  }
  if (visitServer && visitServer.guest) {
    template.push({ label: '送客（' + visitServer.guest.name + '）', click: function () { sendGuestHome(); } });
  }

  if (dead) {
    template.push({ type: 'separator' });
    template.push({ label: '复活（' + ACTIONS.revive.cost + ' 金币）', click: function () { act('revive'); } });
    template.push({ label: '重新领养', click: function () { resetPet(); } });
  }

  template.push({ type: 'separator' });
  template.push({
    label: '免打扰',
    type: 'checkbox',
    checked: !!(game && game.s.muted),
    enabled: hasPet,
    click: function (item) { setMuted(item.checked); },
  });
  template.push({
    label: '开机自动启动',
    type: 'checkbox',
    checked: autoStartEnabled(),
    click: function (item) { setAutoStart(item.checked); },
  });
  template.push({ type: 'separator' });
  template.push({ label: '退出', click: function () { quitApp(); } });

  trayTitle = template[0].label;
  tray.setContextMenu(Menu.buildFromTemplate(template));
}

function createTray() {
  let icon;
  try {
    icon = nativeImage.createFromPath(TRAY_ICON);
    if (icon.isEmpty()) icon = nativeImage.createEmpty();
  } catch (e) {
    icon = nativeImage.createEmpty();
  }

  tray = new Tray(icon);
  tray.setToolTip('桌面宠物');
  buildTrayMenu();
  tray.on('click', function () { togglePanel(); });
}

let lastTrayTip = '';

let lastLowNotifyAt = 0;

function checkLowStats() {
  if (!game || !game.s.alive || !game.s.notifyLow) return;
  if (!Notification.isSupported()) return;
  const s = game.s;
  const low = [];
  if (s.hunger < 20) low.push('饱食');
  if (s.clean < 20) low.push('清洁');
  if (s.mood < 20) low.push('心情');
  if (!low.length) return;
  const now = Date.now();
  if (now - lastLowNotifyAt < 30 * 60000) return;
  lastLowNotifyAt = now;
  const n = new Notification({
    title: '桌面宠物',
    body: (s.name || '宠物') + '的' + low.join('、') + '低于 20 了，去看一眼吧',
  });
  n.on('click', function () { showPanel(); });
  n.show();
}

function updateTrayTooltip() {
  if (!tray || tray.isDestroyed() || !game) return;
  const s = game.snapshot();
  const text = s.name + ' · Lv.' + s.level + ' · ' + (s.illness ? '生病了 · ' : '') + s.label;
  if (text === lastTrayTip) return;
  lastTrayTip = text;
  tray.setToolTip(text);
  // 名字/等级/状态变了，菜单里的标题和“叫回来”等可用状态也要跟着刷新
  buildTrayMenu();
}

function loginItemOptions() {
  const opts = { path: process.execPath };
  if (!app.isPackaged) opts.args = [app.getAppPath()];
  return opts;
}

function autoStartEnabled() {
  try {
    return app.getLoginItemSettings(loginItemOptions()).openAtLogin;
  } catch (e) {
    return false;
  }
}

function setAutoStart(on) {
  try {
    const opts = loginItemOptions();
    opts.openAtLogin = !!on;
    app.setLoginItemSettings(opts);
  } catch (e) {
    console.error('[qqpet] 设置开机启动失败：', e && e.message ? e.message : e);
  }
}

/* ---------------- 状态广播 / 存档 ---------------- */

function currentSnapshot() {
  if (!game) return null;
  const snap = game.snapshot();
  snap.walking = walking;
  snap.facing = facing;
  snap.appVersion = app.getVersion();
  snap.savePath = path.join(app.getPath('userData'), 'save.json');
  return snap;
}

function broadcast() {
  if (!game) return;
  const snap = currentSnapshot();
  sendToWindows('state', snap);
  updateTrayTooltip();
}

function markAbsent(reason) {
  if (!game || !game.s.alive || game.s.absent) return false;
  if (game.s.away && game.s.away.active) return false;
  game.s.absent = true;
  saveNow();
  broadcast();
  buildTrayMenu();
  updateTrayTooltip();
  petPaintLog('absent ' + reason);
  return true;
}

function setupPresenceWatch() {
  let suspendAt = 0;
  let lockAt = 0;
  try {
    powerMonitor.on('suspend', function () { suspendAt = Date.now(); });
    powerMonitor.on('resume', function () {
      const gap = suspendAt ? Date.now() - suspendAt : 0;
      suspendAt = 0;
      if (gap > 2 * 3600 * 1000 && game && game.maybeAbsent(gap)) {
        saveNow();
        broadcast();
        buildTrayMenu();
        updateTrayTooltip();
        petPaintLog('absent resume ' + Math.round(gap / 60000) + 'min');
      }
    });
    powerMonitor.on('lock-screen', function () { lockAt = Date.now(); });
    powerMonitor.on('unlock-screen', function () {
      const gap = lockAt ? Date.now() - lockAt : 0;
      lockAt = 0;
      if (gap > 2 * 3600 * 1000) {
        if (game && game.maybeAbsent(gap)) {
          saveNow();
          broadcast();
          buildTrayMenu();
          updateTrayTooltip();
          petPaintLog('absent unlock ' + Math.round(gap / 60000) + 'min');
        }
        say('主人，我等你好久…点我一下唤醒我', 8000);
      }
    });
  } catch (e) { /* ignore */ }
  setInterval(function () {
    if (TEST) return;
    if (!game || !game.s.alive || game.s.absent) return;
    if (game.s.away && game.s.away.active) return;
    try {
      const idle = powerMonitor.getSystemIdleTime();
      if (idle >= 2 * 3600) markAbsent('idle ' + Math.round(idle / 60) + 'min');
    } catch (e) { /* ignore */ }
  }, 60000);
}

function saveNow() {
  if (!game || TEST) return;
  game.s.savedAt = Date.now();
  store.save(app.getPath('userData'), game.s);
}

function saveThrottled() {
  const now = Date.now();
  if (now - lastSaveAt < 5000) return;
  lastSaveAt = now;
  saveNow();
}

function handleEvents(events) {
  (events || []).forEach(function (ev) {
    if (ev.type === 'say') {
      say(ev.text, ev.ms);
    } else if (ev.type === 'levelup') {
      // 只用气泡提示，不再弹系统通知
      if (game) applyPetScale(game.s.level);
      sendToWindows('effect', 'cheer');
    } else if (ev.type === 'died') {
      say('它离开了…右键宠物或托盘菜单可以用复活丹救回来。', 6000);
    }
  });
}

function tick() {
  if (!game) return;
  handleEvents(game.tick(1));
  broadcast();
  saveThrottled();
}

/* ---------------- 动作 ---------------- */

function act(name) {
  if (!game) return { ok: false, msg: '还没有领养' };
  if (game.activate()) { broadcast(); saveNow(); }

  let res;
  if (name.indexOf('feed:') === 0) res = game.feed(name.slice(5));
  else if (name === 'bath') res = game.bath();
  else if (name.indexOf('bath:') === 0) res = game.bathAt(name.slice(5));
  else if (name === 'work') res = game.workBest();
  else if (name === 'play') res = game.playToy('toss');
  else if (name.indexOf('toy:') === 0) res = game.playToy(name.slice(4));
  else if (name === 'cure') res = game.cure();
  else if (name.indexOf('cure:') === 0) res = game.cure(name.slice(5));
  else if (name.indexOf('spec:') === 0) res = game.pickSpec(name.slice(5));
  else if (name === 'dailyclaim') res = game.claimDaily();
  else if (name === 'repay') res = game.repayDebt();
  else if (name === 'sleep') res = game.toggleSleep();
  else if (name === 'revive') res = game.revive();
  else if (name.indexOf('job:') === 0) {
    const parts = name.split(':');
    res = parts.length > 2 ? game.startWorkRepeat(parts[1], Number(parts[2])) : game.workAt(parts[1]);
  }
  else if (name.indexOf('enroll:') === 0) {
    const parts = name.split(':');
    res = parts.length > 4
      ? game.startStudyRepeat(parts[1], parts[2], Number(parts[3]), Number(parts[4]))
      : game.enroll(parts[1], parts[2], Number(parts[3]));
  }
  else if (name === 'notifylow') res = game.setNotifyLow(!game.s.notifyLow);
  else if (name === 'stop') res = game.stopActivity();
  else if (name === 'study') res = { ok: false, msg: '在面板里选一门课' };
  else res = { ok: false, msg: '未知动作' };

  handleEvents(game.drain());

  if (res && res.ok) {
    if (res.anim) sendToWindows('effect', 'anim:' + res.anim);
    else if (name === 'bath') sendToWindows('effect', 'bath');
    else if (name === 'revive') sendToWindows('effect', 'revive');
    broadcast();
    saveNow();
    if (petVisible) petWin.showInactive();
  } else {
    say((res && res.msg) || '现在做不了', 2600);
    broadcast();
  }
  return res || { ok: false };
}

function setMuted(next) {
  if (!game) return;
  game.s.muted = !!next;
  if (game.s.muted) sendToWindows('bubble-clear');
  buildTrayMenu();
  broadcast();
  saveNow();
}

function setPetVisible(next) {
  // 串门期间宠物不在家，别被托盘「显示宠物」叫出来
  if (next && game && game.s.away && game.s.away.active) return;
  petVisible = !!next;
  if (!petWin || petWin.isDestroyed()) return;
  // 不用 hide()/show()：透明窗口隐藏再显示后，Windows 会丢掉鼠标穿透状态，
  // 表现为“看得见但点不到、拖不动”。改成透明度 + 穿透切换，窗口始终存在。
  if (!petVisible) {
    hidePetMenu();
    ignoreMouse = true;
    petWin.setIgnoreMouseEvents(true, { forward: false });
    petWin.setOpacity(0);
  } else {
    petWin.setOpacity(1);
    if (!petWin.isVisible()) petWin.showInactive();
    applyBounds();
    ignoreMouse = true;
    petWin.setIgnoreMouseEvents(true, { forward: false });
  }
  buildTrayMenu();
  saveNow();
}


/* ---------------- 串门 ---------------- */

function lanAddress() {
  const nets = os.networkInterfaces();
  const all = [];
  Object.keys(nets).forEach(function (name) {
    (nets[name] || []).forEach(function (n) {
      if (n.family === 'IPv4' && !n.internal) all.push(n.address);
    });
  });
  return all.find(function (a) { return /^192\.168\./.test(a); }) ||
    all.find(function (a) { return /^10\./.test(a); }) ||
    all[0] || '127.0.0.1';
}

function visitAnimName() {
  const s = game.s;
  if (!s.alive || s.sick) return '工作状态-垂头叹气冒汗';
  if (s.activity === 'sleep') return '原地小憩沉眠';
  if (s.activity === 'work') return '工作状态-忙碌点按';
  if (s.activity === 'study') return '写代码';
  if (walking) return '螃蟹走路';
  return '待机呼吸休闲';
}

function visitPayload() {
  const s = game.s;
  return {
    name: s.name,
    level: s.level,
    label: stateLabel(s),
    anim: visitAnimName(),
    loop: true,
    walking: !!walking,
    facing: facing,
    bubble: lastSay.text && Date.now() < lastSay.until ? lastSay.text : '',
    alive: s.alive,
  };
}

function toast(text) {
  if (!panelWin || panelWin.isDestroyed()) return;
  try { panelWin.webContents.send('visit:toast', text); } catch (e) { /* ignore */ }
}

function refreshVisitPanel() {
  if (!panelWin || panelWin.isDestroyed()) return;
  try { panelWin.webContents.send('visit:refresh'); } catch (e) { /* ignore */ }
}

function answerPickup(ok) {
  const picker = visitServer && visitServer.picker;
  if (!picker || picker.approved) return { ok: false };
  if (ok) {
    picker.approved = true;
    if (game) game.goOut(picker.name || '朋友家');
    setPetVisible(false);
    say('我出门啦～', 3200);
    toast('已经同意，' + (picker.name || '对方') + ' 接走了宠物');
  } else {
    visitServer.picker = null;
    toast('已拒绝');
  }
  buildTrayMenu();
  broadcast();
  refreshVisitPanel();
  saveNow();
  return { ok: true };
}

function rememberFriend(address, code, name) {
  if (!game || !address) return;
  const list = game.s.friends || (game.s.friends = []);
  const idx = list.findIndex(function (f) { return f.address === address; });
  const item = {
    address: address,
    code: code || '',
    name: name || (idx >= 0 ? list[idx].name : ''),
    at: Date.now(),
  };
  if (idx >= 0) list[idx] = item;
  else list.unshift(item);
  game.s.friends = list.slice(0, 8 + (game.perks().friends || 0));
  saveNow();
}

function guestAction(action) {
  if (pullClient) {
    pullClient.send(action);
    return true;
  }
  if (visitServer && visitServer.guest) {
    visitServer.push(action);
    return true;
  }
  return false;
}

function startPull(address, code) {
  if (!game) return Promise.resolve({ ok: false, msg: '还没有领养' });
  if (pullClient) return Promise.resolve({ ok: false, msg: '已经在招待了' });
  const client = new VisitPullClient({
    onPet: function (pet) {
      if (!pet) return;
      guestPet = pet;
      guestName = pet.name;
      guestLevel = pet.level;
      if (!guestWin || guestWin.isDestroyed()) openGuestWindow();
      pushGuestState();
    },
    onClosed: function (msg) {
      pullClient = null;
      closeGuest();
      toast(msg || '对方的宠物回家了');
    },
  });
  client.pollMs = Math.max(800, Math.round(2000 * (1 - (game ? game.perks().visitPoll : 0))));
  pullClient = client;
  if (game) game.s.visitLast = { address: address, code: code };
  return client.join(address, code, game ? game.s.name : '').then(function (r) {
    if (!r.ok) {
      pullClient = null;
      saveNow();
      return r;
    }
    rememberFriend(address, code, r.host);
    toast('接到 ' + (r.host || '朋友的宠物') + ' 啦');
    refreshVisitPanel();
    return { ok: true, host: r.host };
  });
}

function stopPull() {
  if (pullClient) {
    pullClient.leave();
    pullClient = null;
  }
  closeGuest();
}

function visitStatus() {
  const v = game ? game.s.visitHost : { enabled: false, port: 8737, code: '' };
  const ip = lanAddress();
  return {
    host: {
      enabled: !!v.enabled,
      port: v.port,
      code: v.code,
      ip: ip,
      address: ip + ':' + v.port,
      running: !!(visitServer && visitServer.server),
      guest: visitServer && visitServer.guest ? {
        name: visitServer.guest.name,
        level: visitServer.guest.level,
        since: visitServer.guest.lastSeen,
      } : null,
    },
    away: game ? game.s.away : { active: false },
    offer: game ? { enabled: !!(game.s.offer && game.s.offer.enabled) } : { enabled: false },
    picker: visitServer && visitServer.picker ? { name: visitServer.picker.name } : null,
    pulling: pullClient ? { active: true, name: guestName } : null,
    request: visitServer && visitServer.picker && !visitServer.picker.approved ? { name: visitServer.picker.name } : null,
    last: game ? (game.s.visitLast || { address: '', code: '' }) : { address: '', code: '' },
    friends: game ? (game.s.friends || []) : [],
    local: { name: game ? game.s.name : '', level: game ? game.s.level : 1 },
    canGoOut: game ? game.canGoOut() : { ok: false },
  };
}

function ensureVisitCode() {
  if (!game) return;
  if (!game.s.visitHost.code) {
    game.s.visitHost.code = String(1000 + Math.floor(Math.random() * 9000));
  }
}

function startVisitServer() {
  if (!game) return;
  const v = game.s.visitHost;
  if (!v.enabled) return;
  ensureVisitCode();
  if (visitServer && visitServer.server && visitServer.port === Number(v.port) && visitServer.code === String(v.code)) return;
  if (visitServer) { visitServer.stop(); visitServer = null; }
  const server = new VisitServer({
    hostName: function () { return game ? game.s.name : ''; },
    onArrive: function (g) {
      guestName = g.name;
      guestLevel = g.level;
      guestPet = g.pet;
      console.log('VISIT_GUEST_ARRIVED ' + g.name + ' Lv' + g.level);
      say(g.name + ' 来做客啦～', 4200);
      openGuestWindow();
      pushGuestState();
      buildTrayMenu();
      broadcast();
      refreshVisitPanel();
    },
    onState: function (g) {
      guestName = g.name;
      guestLevel = g.level;
      pushGuestState();
    },
    onLeave: function () { closeGuest(); },
    onGone: function () { closeGuest(); },
    offerActive: function () { return !!(game && game.s.offer && game.s.offer.enabled); },
    getPet: function () { return game ? visitPayload() : null; },
    onPickupJoin: function (picker) {
      if (!game) return;
      const chk = game.canGoOut();
      if (!chk.ok) {
        if (visitServer) visitServer.picker = null;
        return;
      }
      say('有人想接我出去玩～', 3200);
      toast(picker.name + ' 想接走宠物，等你同意');
      broadcast();
      refreshVisitPanel();
      if (!TEST) dialog.showMessageBox({
        type: 'question',
        buttons: ['同意', '拒绝'],
        defaultId: 0,
        cancelId: 1,
        noLink: true,
        title: '串门请求',
        message: picker.name + ' 想把 ' + game.s.name + ' 接去家里',
        detail: '同意后宠物会离开你的桌面，出现在对方家里。',
      }).then(function (r) {
        answerPickup(r.response === 0);
      });
    },
    onPickupAction: function (ev) {
      if (!game || !ev) return;
      if (ev.type === 'pat') game.guestPat();
      else if (ev.type === 'feed') game.guestFeed(ev.foodId);
      else if (ev.type === 'sendhome') returnPetHome('对方让我回家啦');
    },
    onPickupLeave: function () {
      if (game && game.s.away && game.s.away.active) returnPetHome('对方走啦，我回家～');
      refreshVisitPanel();
    },
  });
  visitServer = server;
  server.start(v.port, v.code).then(function (port) {
    v.port = port;
    broadcast();
    refreshVisitPanel();
  }).catch(function (err) {
    v.enabled = false;
    say('串门服务开不了：' + (err && err.message ? err.message : err), 4200);
    broadcast();
    saveNow();
  });
}

function stopVisitServer() {
  if (visitServer) { visitServer.stop(); visitServer = null; }
  closeGuest();
}

function openGuestWindow() {
  if (guestWin && !guestWin.isDestroyed()) return;
  const wa = screen.getPrimaryDisplay().workArea;
  guestPos = { x: Math.round(wa.x + wa.width / 2 - WIN_W / 2), y: wa.y + wa.height - WIN_H };
  guestWin = new BrowserWindow({
    width: WIN_W,
    height: WIN_H,
    x: Math.round(guestPos.x),
    y: Math.round(guestPos.y),
    show: false,
    useContentSize: true,
    transparent: true,
    frame: false,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    hasShadow: false,
    focusable: false,
    title: '来串门的宠物',
    webPreferences: {
      preload: path.join(__dirname, 'preload', 'guest.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      backgroundThrottling: false,
      spellcheck: false,
    },
  });
  guestWin.setAlwaysOnTop(true, 'screen-saver');
  guestWin.setIgnoreMouseEvents(true, { forward: true });
  guestIgnore = true;
  guestWin.webContents.on('context-menu', function (e) { e.preventDefault(); });
  guestWin.once('ready-to-show', function () { if (guestWin) guestWin.showInactive(); });
  guestWin.on('closed', function () { guestWin = null; stopGuestMove(); });
  guestWin.webContents.on('did-finish-load', function () { pushGuestState(); });
  if (TEST) {
    guestWin.webContents.on('console-message', function (event, level, message) {
      var m = (event && event.message) || message || '';
      console.log('GUEST ' + m);
    });
  }
  guestWin.loadFile(path.join(__dirname, 'renderer', 'guest.html'));
  startGuestMove();
}

function closeGuest() {
  if (guestWin && !guestWin.isDestroyed()) guestWin.close();
  guestWin = null;
  guestPet = null;
  stopGuestMove();
  // 客宠窗关掉后，把自家宠物重新提到最上层，避免它被残留的窗口盖住导致点不到
  if (petWin && !petWin.isDestroyed() && petVisible) {
    try {
      petWin.setAlwaysOnTop(true, 'screen-saver');
      petWin.moveTop();
      petWin.webContents.send('pet:resume');
    } catch (e) { /* ignore */ }
  }
  buildTrayMenu();
  broadcast();
  refreshVisitPanel();
}

function pushGuestState() {
  if (!guestWin || guestWin.isDestroyed() || guestWin.webContents.isLoading()) return;
  guestScale = scaleForLevel(guestLevel || 1);
  guestHit = {
    x: Math.round(260 - (BASE_HIT.w / 2) * guestScale),
    y: Math.round(357 - BASE_HIT.h * guestScale),
    w: Math.round(BASE_HIT.w * guestScale),
    h: Math.round(BASE_HIT.h * guestScale),
  };
  blog('push guest state ' + guestName + ' Lv' + guestLevel + ' anim=' + (guestPet && guestPet.anim));
  guestWin.webContents.send('guest:state', {
    name: guestName,
    level: guestLevel,
    pet: guestPet || {},
  });
}

function startGuestMove() {
  stopGuestMove();
  guestLocal = { walking: false, facing: 1, target: 0, nextAt: Date.now() + 2000 };
  guestMoveTimer = setInterval(function () {
    if (!guestWin || guestWin.isDestroyed()) return;
    const now = Date.now();
    const wa = displayFor(guestPos.x + WIN_W / 2, guestPos.y + WIN_H / 2).workArea;
    const minX = wa.x - guestHit.x;
    const maxX = wa.x + wa.width - guestHit.x - guestHit.w;
    if (!guestLocal.target) {
      if (now >= guestLocal.nextAt) {
        guestLocal.target = minX + Math.random() * Math.max(1, maxX - minX);
      }
    } else {
      const dx = guestLocal.target - guestPos.x;
      if (Math.abs(dx) <= 4) {
        guestLocal.target = 0;
        guestLocal.nextAt = now + 4000 + Math.random() * 6000;
        setGuestWalking(false);
      } else {
        const dir = dx > 0 ? 1 : -1;
        guestPos.x = clamp(guestPos.x + dir * 3.6, minX, maxX);
        setGuestWalking(true, dir);
      }
    }
    guestWin.setPosition(Math.round(guestPos.x), Math.round(guestPos.y));
  }, 60);
}

function setGuestWalking(on, dir) {
  if (guestLocal.walking === on && (!dir || guestLocal.facing === dir)) return;
  guestLocal.walking = on;
  if (dir) guestLocal.facing = dir;
  if (guestWin && !guestWin.isDestroyed()) {
    guestWin.webContents.send('guest:motion', { walking: guestLocal.walking, facing: guestLocal.facing });
  }
}

function stopGuestMove() {
  if (guestMoveTimer) clearInterval(guestMoveTimer);
  guestMoveTimer = null;
}

function watchGuestPointer() {
  if (!guestWin || guestWin.isDestroyed()) return;
  const p = screen.getCursorScreenPoint();
  const b = guestWin.getBounds();
  const inside = p.x >= b.x + guestHit.x && p.x <= b.x + guestHit.x + guestHit.w &&
    p.y >= b.y + guestHit.y && p.y <= b.y + guestHit.y + guestHit.h;
  const next = !inside;
  if (next === guestIgnore) return;
  guestIgnore = next;
  try { guestWin.setIgnoreMouseEvents(next, { forward: true }); } catch (e) { /* ignore */ }
}

function guestSay(text) {
  if (!guestWin || guestWin.isDestroyed()) return;
  guestWin.webContents.send('guest:bubble', text);
}

function guestPlay(anim) {
  if (!guestWin || guestWin.isDestroyed()) return;
  guestWin.webContents.send('guest:play', anim);
}

function patGuest() {
  if (!pullClient && (!visitServer || !visitServer.guest)) return;
  if (Date.now() - guestPatAt < 2500) return;
  guestPatAt = Date.now();
  if (!guestAction({ type: 'pat' })) return;
  guestSay('嘿嘿，好痒～');
  guestPlay('点击回应-挠痒咯咯笑');
  toast('你摸了摸 ' + guestName);
}

function feedGuest(food) {
  if (!game) return;
  if (!pullClient && (!visitServer || !visitServer.guest)) return;
  if (Date.now() - guestFeedAt < 5 * 60 * 1000) {
    toast('刚喂过啦，等几分钟再喂');
    return;
  }
  if (game.s.money < food.price) {
    toast('金币不够，喂不了' + food.name);
    return;
  }
  guestFeedAt = Date.now();
  game.s.money -= food.price;
  guestAction({ type: 'feed', foodId: food.id });
  guestPlay(food.anim);
  guestSay('谢谢款待！');
  toast('喂了 ' + guestName + ' 一份' + food.name);
  broadcast();
  saveNow();
}

function sendGuestHome() {
  if (!pullClient && (!visitServer || !visitServer.guest)) return;
  if (!guestAction({ type: 'sendhome' })) return;
  guestSay('那我先回家啦～');
  toast('已送 ' + guestName + ' 回家');
}

function showGuestMenu() {
  if (!guestWin) return;
  if (!pullClient && (!visitServer || !visitServer.guest)) return;
  const foods = FOODS.map(function (f) {
    return { label: f.name + '  ' + f.price + ' 金币', click: function () { feedGuest(f); } };
  });
  Menu.buildFromTemplate([
    { label: '摸头', click: patGuest },
    { label: '喂食', submenu: foods },
    { type: 'separator' },
    { label: '送客', click: sendGuestHome },
  ]).popup({ window: guestWin });
}

function sendPetOut(address, code) {
  if (!game) return { ok: false, msg: '还没有领养' };
  if (visitClient) return { ok: false, msg: '已经在外面了' };
  const chk = game.canGoOut();
  if (!chk.ok) return chk;
  const client = new VisitClient(visitPayload, {
    onPat: function () { game.guestPat(); toast('有人摸了摸我～'); },
    onFeed: function (id) {
      const f = FOODS.find(function (x) { return x.id === id; });
      game.guestFeed(id);
      toast('对方喂了我 ' + (f ? f.name : '好吃的'));
    },
    onSendHome: function () { returnPetHome('对方让我回家啦'); },
    onClosed: function (msg) { returnPetHome(msg); },
  });
  if (game) game.s.visitLast = { address: address, code: code };
  client.pollMs = Math.max(800, Math.round(2000 * (1 - game.perks().visitPoll)));
  visitClient = client;
  return client.arrive(address, code).then(function (r) {
    if (!r.ok) {
      visitClient = null;
      saveNow();
      return r;
    }
    rememberFriend(address, code, r.host);
    game.goOut(r.host || address);
    setPetVisible(false);
    buildTrayMenu();
    visitHomeTimer = setTimeout(function () { returnPetHome('在外面玩够啦，回家～'); }, 60 * 60 * 1000);
    saveNow();
    broadcast();
    return { ok: true, host: r.host || address };
  });
}

function returnPetHome(why) {
  if (!game) return;
  const client = visitClient;
  visitClient = null;
  if (visitHomeTimer) { clearTimeout(visitHomeTimer); visitHomeTimer = null; }
  if (client) client.leave();
  if (visitServer && visitServer.picker) visitServer.picker = null;
  if (game.s.offer) game.s.offer.enabled = false;
  if (game.s.away && game.s.away.active) game.comeHome(why);
  if (petWin && !petWin.isDestroyed()) {
    // 串门期间窗口是透明度 0，视频容易停在最后一帧：重载页面后再显示，最稳
    let shown = false;
    const showPet = function () {
      if (shown) return;
      shown = true;
      setPetVisible(true);
      try { petWin.webContents.send('pet:scale', { scale: petScale, hit: HIT }); } catch (e) { /* ignore */ }
    };
    petWin.webContents.once('did-finish-load', showPet);
    try {
      petWin.webContents.reload();
    } catch (e) {
      showPet();
    }
    setTimeout(showPet, 1500);
  } else {
    setPetVisible(true);
  }
  buildTrayMenu();
  saveNow();
  broadcast();
  refreshVisitPanel();
  if (why) toast(why);
}

function quitApp() {
  quitting = true;
  if (visitClient) visitClient.leave();
  saveNow();
  app.quit();
}

/* ---------------- IPC ---------------- */

function positionPetMenu() {
  if (!menuWin || menuWin.isDestroyed() || !petWin) return;
  const b = petWin.getBounds();
  const wa = displayFor(b.x + b.width / 2, b.y + b.height / 2).workArea;
  const mb = menuWin.getBounds();
  // 和详情面板同一套相对位置：贴着身体右侧，放不下就翻到左侧
  let x = Math.round(b.x + HIT.x + HIT.w + 12);
  if (x + mb.width > wa.x + wa.width - 8) x = Math.round(b.x + HIT.x - mb.width - 12);
  x = clamp(x, wa.x + 8, wa.x + wa.width - mb.width - 8);
  const y = clamp(Math.round(b.y + HIT.y - 20), wa.y + 8, wa.y + wa.height - mb.height - 8);
  menuWin.setPosition(x, y);
}

function showPetMenu() {
  if (!game || !menuWin || menuWin.isDestroyed() || !petWin) return;
  hidePanel();
  menuOpen = true;
  positionPetMenu();
  if (!menuWin.webContents.isLoading()) menuWin.webContents.send('menu:refresh');
  menuWin.show();
  menuWin.setAlwaysOnTop(true, 'screen-saver');
  menuWin.moveTop();
  menuWin.focus();
  watchPointer();
}

function hidePetMenu() {
  if (!menuOpen) return;
  menuOpen = false;
  if (menuWin && !menuWin.isDestroyed() && menuWin.isVisible()) menuWin.hide();
  watchPointer();
}

function createMenuWindow() {
  menuWin = new BrowserWindow({
    width: 206,
    height: 104,
    show: false,
    frame: false,
    resizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    transparent: true,
    hasShadow: false,
    backgroundColor: '#00000000',
    title: '桌面宠物',
    webPreferences: {
      preload: path.join(__dirname, 'preload', 'menu.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      spellcheck: false,
    },
  });

  menuWin.setAlwaysOnTop(true, 'screen-saver');
  menuWin.on('blur', function () { hidePetMenu(); });
  menuWin.on('closed', function () { menuWin = null; });
  menuWin.loadFile(path.join(__dirname, 'renderer', 'menu.html'));
}

function setupIpc() {
  ipcMain.on('pet:ready', function () {
    if (game) petWin.webContents.send('state', currentSnapshot());
    petWin.webContents.send('motion', { walking: walking, facing: facing });
  });

  ipcMain.on('pet:drag-start', function (e, p) {
    if (!petWin || !p || !Number.isFinite(p.x) || !Number.isFinite(p.y)) return;
    dragging = true;
    hidePetMenu();
    hidePanel();
    dragOffset = { x: p.x - petPos.x, y: p.y - petPos.y };
    trail = [{ t: Date.now(), x: p.x, y: p.y }];
    dragTarget = { x: petPos.x, y: petPos.y };
    dragVX = 0;
    dragVY = 0;
    targetX = null;
    setWalking(false);
    setFlying(false);
    setInteractive(true);
  });

  ipcMain.on('pet:drag-move', function (e, p) {
    if (!dragging || !p || !Number.isFinite(p.x) || !Number.isFinite(p.y)) return;
    const wa = displayFor(p.x, p.y).workArea;
    dragTarget = {
      x: clamp(p.x - dragOffset.x, wa.x - HIT.x, wa.x + wa.width - HIT.x - HIT.w),
      y: clamp(p.y - dragOffset.y, wa.y - 12, wa.y + wa.height - WIN_H),
    };
    trail.push({ t: Date.now(), x: p.x, y: p.y });
    if (trail.length > 16) trail.shift();
  });

  ipcMain.on('pet:drag-end', function (e, allowThrow) {
    dragging = false;
    const waEnd = displayFor(petPos.x + WIN_W / 2, petPos.y + WIN_H / 2).workArea;
    petPos.x = clamp(petPos.x, waEnd.x - HIT.x, waEnd.x + waEnd.width - HIT.x - HIT.w);
    const v = Physics.velocityFromTrail(trail, Date.now());
    trail = [];
    dragTarget = null;
    dragVX = 0;
    dragVY = 0;

    // 参考 dsh-pet：最后 150ms 的释速低于 500 或松手前停顿 → 原地放下
    if (!v || !game || !game.s.alive) {
      vy = 0;
      floating = petPos.y < groundY() - 2;
      return;
    }

    const speed = Math.sqrt(v.vx * v.vx + v.vy * v.vy);
    const res = game.canThrow(speed);
    if (!res.ok) {
      vy = 0;
      if (res.msg) say(res.msg, 2400);
      return;
    }

    game.applyThrow(res.cost, res.mood);
    handleEvents(game.drain());
    vel = { vx: v.vx, vy: v.vy };
    vy = 0;
    floating = false;
    // 冻结在松手时所在的这块屏：整段飞行只在这块屏的工作区里反弹，不会跨到隔壁屏
    flightArea = displayFor(petPos.x + WIN_W / 2, petPos.y + WIN_H / 2).workArea;
    setFlying(true);
    broadcast();
  });

  ipcMain.on('anim-log', function (e, msg) {
    try {
      if (fs.existsSync(ANIM_LOG) && fs.statSync(ANIM_LOG).size > 512 * 1024) fs.unlinkSync(ANIM_LOG);
      fs.appendFileSync(ANIM_LOG, new Date().toISOString() + ' ' + String(msg).slice(0, 400) + '\n');
    } catch (err) { /* ignore */ }
  });

  ipcMain.on('pet:pat', function (e, zone) {
    if (!game) return;
    hidePanel();
    game.pat(zone);
    handleEvents(game.drain());
    sendToWindows('pat');
    broadcast();
  });

  ipcMain.on('pet:menu', function () { showPetMenu(); });
  ipcMain.on('menu:hide', function () { hidePetMenu(); });
  ipcMain.handle('menu:get', function () { return currentSnapshot(); });
  ipcMain.on('menu:act', function (e, name) {
    hidePetMenu();
    if (!game) return;
    if (game.activate()) {
      broadcast();
      saveNow();
    }
    if (name === 'restart') { resetPet(); return; }
    if (name === 'mute') { setMuted(!game.s.muted); return; }
    if (name === 'hide') { setPetVisible(false); return; }
    if (name === 'quit') { quitApp(); return; }
    if (name === 'panel') { showPanel(); return; }
    if (name === 'chatter') { petChatter(); return; }
    if (name === 'recall') { recallPet(); return; }
    if (name.indexOf('panel:') === 0) { openSheet(name.slice(6)); return; }
    act(name);
  });

  ipcMain.on('pet:panel', function () { showPanel(); });

  ipcMain.handle('panel:get', function () { return currentSnapshot(); });

  ipcMain.handle('save:export', async function () {
    if (!game) return { ok: false, msg: '还没有存档' };
    saveNow();
    const r = await dialog.showSaveDialog(panelWin || undefined, {
      title: '导出存档',
      defaultPath: path.join(app.getPath('desktop'), 'DeskPet-save.json'),
      filters: [{ name: 'JSON', extensions: ['json'] }],
    });
    if (r.canceled || !r.filePath) return { ok: false, msg: '' };
    try {
      fs.copyFileSync(path.join(app.getPath('userData'), 'save.json'), r.filePath);
      return { ok: true, path: r.filePath };
    } catch (e) {
      return { ok: false, msg: '导出失败：' + e.message };
    }
  });

  ipcMain.handle('save:import', async function () {
    const r = await dialog.showOpenDialog(panelWin || undefined, {
      title: '导入存档',
      properties: ['openFile'],
      filters: [{ name: 'JSON', extensions: ['json'] }],
    });
    if (r.canceled || !r.filePaths[0]) return { ok: false, msg: '' };
    try {
      const raw = fs.readFileSync(r.filePaths[0], 'utf8');
      const data = JSON.parse(raw);
      if (!data || typeof data !== 'object' || !data.started) {
        return { ok: false, msg: '不是桌面宠物存档' };
      }
      saveNow();
      const target = path.join(app.getPath('userData'), 'save.json');
      fs.copyFileSync(target, target + '.bak-import');
      fs.writeFileSync(target, JSON.stringify(data, null, 2));
      setTimeout(function () {
        app.relaunch();
        app.exit(0);
      }, 200);
      return { ok: true };
    } catch (e) {
      return { ok: false, msg: '导入失败：' + e.message };
    }
  });
  ipcMain.handle('panel:act', function (e, name) { return act(name); });
  ipcMain.on('panel:hide', function () { hidePanel(); });
  ipcMain.on('panel:restart', function () { resetPet(); });
  ipcMain.on('panel:chatter', function (e, payload) {
    if (!game || !payload) return;
    if (payload.op === 'add') game.addChatter(payload.text);
    else if (payload.op === 'update') game.updateChatter(payload.index, payload.text);
    else if (payload.op === 'remove') game.removeChatter(payload.index);
    broadcast();
    saveNow();
  });

  ipcMain.on('panel:offwork', function (e, value) {
    if (!game) return;
    game.setOffWork(value);
    broadcast();
    saveNow();
  });

  ipcMain.handle('visit:status', function () { return visitStatus(); });
  ipcMain.handle('visit:host', function (e, payload) {
    if (!game) return { ok: false };
    const v = game.s.visitHost;
    if (payload && typeof payload.enabled === 'boolean') v.enabled = payload.enabled;
    if (payload && payload.port) v.port = clamp(Number(payload.port) || 8737, 1024, 65535);
    if (v.enabled) startVisitServer(); else stopVisitServer();
    saveNow();
    broadcast();
    return { ok: true, status: visitStatus() };
  });
  ipcMain.handle('visit:code', function () {
    if (!game) return { ok: false };
    game.s.visitHost.code = String(1000 + Math.floor(Math.random() * 9000));
    if (visitServer) visitServer.code = game.s.visitHost.code;
    saveNow();
    broadcast();
    return { ok: true, status: visitStatus() };
  });
  ipcMain.handle('visit:send', function (e, p) {
    if (!game) return { ok: false, msg: '还没有领养' };
    return sendPetOut(String((p && p.address) || '').trim(), String((p && p.code) || '').trim());
  });
  ipcMain.handle('visit:offer', function (e, payload) {
    if (!game) return { ok: false };
    const enable = !!(payload && payload.enabled);
    if (enable) {
      const chk = game.canGoOut();
      if (!chk.ok) return chk;
      game.s.offer.enabled = true;
      game.s.visitHost.enabled = true;
      ensureVisitCode();
      startVisitServer();
    } else {
      game.s.offer.enabled = false;
      if (visitServer && visitServer.picker) visitServer.picker = null;
      if (game.s.away && game.s.away.active) returnPetHome('我回家啦');
    }
    saveNow();
    broadcast();
    refreshVisitPanel();
    return { ok: true, status: visitStatus() };
  });
  ipcMain.handle('visit:pull', function (e, p) {
    if (!game) return { ok: false, msg: '还没有领养' };
    return startPull(String((p && p.address) || '').trim(), String((p && p.code) || '').trim());
  });
  ipcMain.handle('visit:stopPull', function () {
    stopPull();
    return { ok: true };
  });
  ipcMain.handle('visit:friendRemove', function (e, address) {
    if (!game || !Array.isArray(game.s.friends)) return { ok: false };
    game.s.friends = game.s.friends.filter(function (f) { return f.address !== address; });
    saveNow();
    broadcast();
    refreshVisitPanel();
    return { ok: true };
  });
  ipcMain.handle('visit:answer', function (e, p) {
    return answerPickup(!!(p && p.ok));
  });
  ipcMain.handle('visit:probe', function (e, address) {
    const addr = normalizeAddress(address);
    if (!addr) return { ok: false, msg: '地址格式不对，示例 192.168.1.23:8737' };
    const host = addr.split(':')[0];
    const port = Number(addr.split(':')[1]);
    return new Promise(function (resolve) {
      let done = false;
      const sock = net.connect({ host: host, port: port });
      const finish = function (r) {
        if (done) return;
        done = true;
        try { sock.destroy(); } catch (err) { /* ignore */ }
        resolve(r);
      };
      sock.setTimeout(3000);
      sock.once('connect', function () { finish({ ok: true, msg: '端口通，可以送过去' }); });
      sock.once('timeout', function () { finish({ ok: false, msg: '连接超时：可能不同网段，或被防火墙拦截' }); });
      sock.once('error', function (err) {
        const code = err && err.code;
        finish({ ok: false, msg: code === 'ECONNREFUSED' ? '端口没开：对方没启动接待' : '连不上（' + code + '）' });
      });
    });
  });
  ipcMain.handle('visit:call', function () {
    returnPetHome('我叫它回家了');
    return { ok: true };
  });
  ipcMain.on('visit:guestReady', function () { pushGuestState(); });
  ipcMain.on('visit:guestHome', function () { sendGuestHome(); });
  ipcMain.on('visit:copy', function (e, text) {
    try { clipboard.writeText(String(text || '')); } catch (err) { /* ignore */ }
  });
  ipcMain.on('visit:menu', function () { showGuestMenu(); });
  ipcMain.on('visit:guestPat', function () { patGuest(); });
  ipcMain.on('visit:feed', function (e, id) {
    const f = FOODS.find(function (x) { return x.id === id; });
    if (f) feedGuest(f);
  });

  ipcMain.on('panel:cmd', function (e, name) {
    if (!game) return;
    if (name === 'panel') { showPanel(); return; }
    if (name === 'chatter') { petChatter(); return; }
    if (name === 'recall') { recallPet(); return; }
    if (name === 'mute') { setMuted(!game.s.muted); return; }
    if (name === 'restart') { resetPet(); return; }
    if (name === 'hide') { setPetVisible(false); return; }
    if (name === 'quit') { quitApp(); }
  });
  ipcMain.on('panel:quit', function () { quitApp(); });

  ipcMain.handle('adopt:submit', function (e, data) {
    return adoptPet(data);
  });

  ipcMain.on('adopt:cancel', function () { quitApp(); });
}

function adoptPet(data) {
  const name = String((data && data.name) || '').trim().slice(0, 8) || '小蓝';
  const gender = data && data.gender === 'MM' ? 'MM' : 'GG';

  game = new Game(Game.fresh(name));
  applyPetScale(game.s.level, true);
  petVisible = true;
  petWin.showInactive();
  startLoops();
  broadcast();
  say('主人你好，我是你的小宠物！', 4200);
  if (adoptWin && !adoptWin.isDestroyed()) adoptWin.close();
  buildTrayMenu();
  saveNow();
  return { ok: true };
}

/* ---------------- 生命周期 ---------------- */

function startLoops() {
  if (tickTimer) return;
  lastMoveAt = Date.now();
  lastSaveAt = Date.now();
  tickTimer = setInterval(tick, TICK_MS);
  moveTimer = setInterval(moveTick, MOVE_MS);
  ignoreTimer = setInterval(function () { watchPointer(); if (guestWin) watchGuestPointer(); }, 30);
  if (!lowTimer) lowTimer = setInterval(checkLowStats, 60000);
  if (!paintTimer) paintTimer = setInterval(checkPetPaint, 4000);
}


async function runHoverTest() {
  game = new Game(Game.fresh('小蓝'));
  game.s.level = 25;
  game.s.specs = ['scholar', 'diligent', 'health', 'social', 'lucky'];
  petVisible = true;
  petWin.showInactive();
  startLoops();
  showPanel();
  await sleep(500);
  if (petWin && !petWin.isDestroyed()) petWin.hide();
  await sleep(400);
  const info = await panelWin.webContents.executeJavaScript("(function(){var b=document.querySelector('[data-spec-tip]');if(!b)return 'no-badge';var r=b.getBoundingClientRect();var e=document.elementFromPoint(r.left+r.width/2,r.top+r.height/2);var cs=getComputedStyle(b);return JSON.stringify({x:r.left+r.width/2,y:r.top+r.height/2,hit:e?e.tagName+'|'+e.className+'|'+e.id:'none',pe:cs.pointerEvents,vis:cs.visibility,display:cs.display});})()");
  console.log('HOVER_INFO ' + info);
  const pb = panelWin.getBounds();
  try {
    const bi = JSON.parse(info);
    const sf = screen.getPrimaryDisplay().scaleFactor;
    const pt = screen.dipToScreenPoint({ x: pb.x + bi.x, y: pb.y + bi.y });
    console.log('HOVER_SCALE ' + sf + ' bounds=' + JSON.stringify(pb) + ' dip=' + (pb.x + bi.x) + ',' + (pb.y + bi.y) + ' phys=' + pt.x + ',' + pt.y);
  } catch (e) { console.log('HOVER_ERR ' + e.message); }
  setInterval(async function () {
    try {
      const st = await panelWin.webContents.executeJavaScript("(function(){var n=[];document.querySelectorAll(':hover').forEach(function(e){if(e.className)n.push(String(e.className))});return n.join('|')+' :: '+(document.getElementById('specTip').hidden?'hidden':'shown');})()");
      console.log('HOVER_STATE ' + st);
    } catch (e) { /* ignore */ }
  }, 1200);
}

async function runDailyTest() {
  game = new Game(Game.fresh('小蓝'));
  game.s.level = 4;
  game.s.money = 50;
  game.ensureDaily();
  game.s.daily.tasks.forEach(function (t) { t.done = t.target; });
  petVisible = true;
  petWin.showInactive();
  startLoops();
  showPanel();
  await sleep(800);
  panelWin.webContents.send('open-sheet', 'daily');
  await sleep(600);
  const txt = await panelWin.webContents.executeJavaScript("document.getElementById('sheetBody').textContent");
  console.log('DAILY ' + txt.replace(/\s+/g, ' ').slice(0, 200));
  try {
    fs.mkdirSync(path.join(os.tmpdir(), 'qqpet-smoke'), { recursive: true });
    fs.writeFileSync(path.join(os.tmpdir(), 'qqpet-smoke', 'panel-daily.png'), (await panelWin.webContents.capturePage()).toPNG());
  } catch (e) { /* ignore */ }
  await panelWin.webContents.executeJavaScript("var b=document.getElementById('dailyClaim'); if(b) b.click();");
  await sleep(1200);
  console.log('DAILY_CLAIM money=' + game.s.money + ' claimed=' + (game.s.daily && game.s.daily.claimed));
  quitApp();
}

async function runBusyTest() {
  game = new Game(Game.fresh('小蓝'));
  game.s.money = 100;
  game.s.courses['kid:zhi:0'] = 5;
  game.s.courses['kid:mei:0'] = 5;
  game.s.courses['kid:wu:0'] = 5;
  petVisible = true;
  petWin.showInactive();
  startLoops();
  showPanel();
  await sleep(700);
  game.enroll('primary', 'zhi', 0);
  broadcast();
  await sleep(900);
  const meta = await panelWin.webContents.executeJavaScript("document.getElementById('activityMeta').textContent");
  console.log('BUSY_META ' + meta);
  try {
    fs.mkdirSync(path.join(os.tmpdir(), 'qqpet-smoke'), { recursive: true });
    fs.writeFileSync(path.join(os.tmpdir(), 'qqpet-smoke', 'panel-busy.png'), (await panelWin.webContents.capturePage()).toPNG());
  } catch (e) { /* ignore */ }
  await panelWin.webContents.executeJavaScript("document.getElementById('activityStop').click()");
  await sleep(350);
  const stopShown = await panelWin.webContents.executeJavaScript("document.getElementById('stopModal').classList.contains('show') + '|' + document.getElementById('stopTitle').textContent + '|' + document.getElementById('stopHint').textContent");
  console.log('STOP_MODAL ' + stopShown);
  try {
    fs.writeFileSync(path.join(os.tmpdir(), 'qqpet-smoke', 'panel-stop.png'), (await panelWin.webContents.capturePage()).toPNG());
  } catch (e) { /* ignore */ }
  quitApp();
}

async function runSchoolTest() {
  game = new Game(Game.fresh('小蓝'));
  game.s.level = 4;
  game.s.money = 50;
  petVisible = true;
  petWin.showInactive();
  startLoops();
  showPanel();
  await sleep(900);
  panelWin.webContents.send('open-sheet', 'school');
  await sleep(500);
  await panelWin.webContents.executeJavaScript("var t=document.querySelector('[data-stage=\"kid\"]'); if(t) t.click();");
  await sleep(600);
  const rows = await panelWin.webContents.executeJavaScript("[].slice.call(document.querySelectorAll('.course')).map(function(r){return r.textContent.trim()})");
  console.log('KID_ROWS ' + JSON.stringify(rows));
  try {
    fs.mkdirSync(path.join(os.tmpdir(), 'qqpet-smoke'), { recursive: true });
    fs.writeFileSync(path.join(os.tmpdir(), 'qqpet-smoke', 'panel-kid.png'), (await panelWin.webContents.capturePage()).toPNG());
  } catch (e) { /* ignore */ }
  quitApp();
}

async function runPerksTest() {
  game = new Game(Game.fresh('小蓝'));
  game.s.level = 25;
  game.s.specs = ['scholar', 'diligent', 'health', 'social', 'lucky'];
  petVisible = true;
  petWin.showInactive();
  startLoops();
  showPanel();
  await sleep(1000);
  const modal = await panelWin.webContents.executeJavaScript("document.getElementById('specModal').classList.contains('show')");
  const list = await panelWin.webContents.executeJavaScript("document.querySelectorAll('#specList [data-spec]').length");
  console.log('SPEC modal=' + modal + ' list=' + list + ' left=' + game.specLeft());
  const statTips = await panelWin.webContents.executeJavaScript("[].map.call(document.querySelectorAll('.stat'), function (e) { return e.getAttribute('data-tip'); })");
  console.log('STAT TIPS ' + JSON.stringify(statTips));
  try {
    fs.mkdirSync(path.join(os.tmpdir(), 'qqpet-smoke'), { recursive: true });
    fs.writeFileSync(path.join(os.tmpdir(), 'qqpet-smoke', 'panel-spec.png'), (await panelWin.webContents.capturePage()).toPNG());
  } catch (e) { /* ignore */ }
  await panelWin.webContents.executeJavaScript("document.getElementById('specLater').click()");
  await sleep(500);
  const rect = await panelWin.webContents.executeJavaScript("(function(){var b=document.querySelector('[data-spec-tip]');if(!b)return null;var r=b.getBoundingClientRect();return {x:Math.round(r.left+r.width/2),y:Math.round(r.top+r.height/2)};})()");
  if (rect) {
    panelWin.webContents.sendInputEvent({ type: 'mouseMove', x: rect.x, y: rect.y });
    await sleep(500);
    const tip = await panelWin.webContents.executeJavaScript("document.getElementById('specTip').hidden + '|' + document.getElementById('specTip').textContent");
    console.log('SPEC TIP ' + JSON.stringify(rect) + ' => ' + tip);
  } else {
    console.log('SPEC TIP no-badge');
  }
  try {
    fs.writeFileSync(path.join(os.tmpdir(), 'qqpet-smoke', 'panel-perks-main.png'), (await panelWin.webContents.capturePage()).toPNG());
  } catch (e) { /* ignore */ }
  game.pickSpec('health');
  broadcast();
  await sleep(700);
  console.log('SPEC picked=' + JSON.stringify(game.s.specs) + ' left=' + game.specLeft());
  try {
    fs.writeFileSync(path.join(os.tmpdir(), 'qqpet-smoke', 'panel-perks-main2.png'), (await panelWin.webContents.capturePage()).toPNG());
  } catch (e) { /* ignore */ }
  panelWin.webContents.send('open-sheet', 'perks');
  await sleep(800);
  const txt = await panelWin.webContents.executeJavaScript("document.getElementById('sheetBody').textContent");
  console.log('PERKS_TEXT ' + txt.replace(/\s+/g, ' ').slice(0, 160));
  try {
    fs.writeFileSync(path.join(os.tmpdir(), 'qqpet-smoke', 'panel-perks.png'), (await panelWin.webContents.capturePage()).toPNG());
  } catch (e) { /* ignore */ }
  panelWin.webContents.send('open-sheet', 'jobs');
  await sleep(500);
  const reps = await panelWin.webContents.executeJavaScript("document.querySelectorAll('.rep').length");
  console.log('REP_INPUTS ' + reps);
  await panelWin.webContents.executeJavaScript("(function(){var i=document.querySelector('.rep');i.value=4;i.dispatchEvent(new Event('input',{bubbles:true}));})()");
  await sleep(1600);
  const kept = await panelWin.webContents.executeJavaScript("document.querySelector('.rep').value");
  console.log('REP_KEEP ' + kept);
  panelWin.webContents.send('open-sheet', 'more');
  await sleep(500);
  const more = await panelWin.webContents.executeJavaScript("document.getElementById('sheetBody').textContent");
  console.log('MORE_TEXT ' + more.replace(/\s+/g, ' ').slice(0, 220));
  quitApp();
}

async function runPanelPosTest() {
  game = new Game(Game.fresh('小蓝'));
  petVisible = true;
  petWin.showInactive();
  startLoops();
  await sleep(800);
  const tb = tray ? tray.getBounds() : null;
  showPanel('tray');
  await sleep(600);
  console.log('POS tray=' + JSON.stringify(tb) + ' panel=' + JSON.stringify(panelWin.getBounds()));
  const id = petWin.webContents.id;
  hidePanel();
  await sleep(700);
  console.log('POS samePet=' + (petWin && !petWin.isDestroyed() && petWin.webContents.id === id) + ' panelVisible=' + panelWin.isVisible());
  quitApp();
}

async function runCureTest() {
  game = new Game(Game.fresh('小蓝'));
  game.s.sick = true;
  game.s.illness = 'gastro';
  game.s.health = 40;
  game.s.money = 10;
  petVisible = true;
  petWin.showInactive();
  startLoops();
  showPanel();
  await sleep(800);
  panelWin.webContents.send('open-sheet', 'cures');
  await sleep(700);
  const header = await panelWin.webContents.executeJavaScript("document.getElementById('pState').textContent + '|' + (document.getElementById('sickTag').hidden ? 'hidden' : document.getElementById('sickTag').textContent)");
  console.log('HEADER_SICK ' + header);
  const txt = await panelWin.webContents.executeJavaScript("document.getElementById('sheetBody').textContent");
  console.log('CURES_TEXT ' + txt.replace(/\s+/g, ' ').slice(0, 300));
  game.s.debt = 66;
  broadcast();
  await sleep(400);
  const tile = await panelWin.webContents.executeJavaScript("document.getElementById('cureTxt').textContent + '|' + document.getElementById('costCure').textContent");
  console.log('TILE_DEBT ' + tile);
  game.s.debt = 0;
  game.s.sick = false;
  game.s.illness = null;
  broadcast();
  await sleep(300);
  const header2 = await panelWin.webContents.executeJavaScript("document.getElementById('pState').textContent + '|' + (document.getElementById('sickTag').hidden ? 'hidden' : document.getElementById('sickTag').textContent)");
  console.log('HEADER_WELL ' + header2);
  const tile2 = await panelWin.webContents.executeJavaScript("document.getElementById('cureTxt').textContent + '|' + document.getElementById('cureTile').disabled");
  console.log('TILE_HEALTHY ' + tile2);
  quitApp();
}

async function runVisitTest() {
  blog('visit test begin');
  game = new Game(Game.fresh('小蓝'));
  game.s.money = 200;
  petVisible = true;
  petWin.showInactive();
  startLoops();
  showPanel();
  game.s.visitHost.enabled = true;
  game.s.visitHost.port = 0;
  startVisitServer();
  await sleep(900);
  console.log('VISIT_HOST ' + JSON.stringify(visitStatus().host));
  const pet = { name: '小白', level: 5, label: '悠闲', anim: '待机呼吸休闲', loop: true, walking: true, facing: -1, bubble: '来做客啦', alive: true };
  const client = new VisitClient(function () { return pet; }, {
    onPat: function () { console.log('VISIT_EVT pat'); },
    onFeed: function (id) { console.log('VISIT_EVT feed ' + id); },
    onSendHome: function () { console.log('VISIT_EVT sendhome'); },
    onClosed: function (m) { console.log('VISIT_EVT closed ' + m); },
  });
  const r = await client.arrive('127.0.0.1:' + visitServer.port, game.s.visitHost.code);
  console.log('VISIT_ARRIVE ' + JSON.stringify(r));
  await sleep(2600);
  if (guestWin && !guestWin.isDestroyed()) {
    const badge = await guestWin.webContents.executeJavaScript("document.getElementById('gname').textContent + '/' + document.getElementById('glv').textContent");
    console.log('VISIT_BADGE ' + badge);
    fs.writeFileSync(path.join(os.tmpdir(), 'qqpet-smoke', 'guest.png'), (await guestWin.webContents.capturePage()).toPNG());
    console.log('VISIT_GUEST_OK');
  } else {
    console.log('VISIT_GUEST_MISSING');
  }
  patGuest();
  feedGuest(FOODS[0]);
  await sleep(2600);
  console.log('VISIT_MONEY ' + game.s.money);
  sendGuestHome();
  await sleep(600);
  client.leave();
  await sleep(900);
  console.log('VISIT_DONE guest=' + (guestWin && !guestWin.isDestroyed()));

  // A 端流程（回环）：把自己的宠物送到本机服务上，不应崩
  const out = await sendPetOut('127.0.0.1:' + visitServer.port, game.s.visitHost.code);
  console.log('VISIT_OUT ' + JSON.stringify(out) + ' away=' + game.s.away.active + ' visible=' + petVisible);
  await sleep(1200);
  returnPetHome('测试回家');
  await sleep(800);
  console.log('VISIT_HOME away=' + game.s.away.active + ' visible=' + petVisible + ' guest=' + (guestWin && !guestWin.isDestroyed()));

  panelWin.webContents.send('open-sheet', 'more');
  await sleep(250);
  await panelWin.webContents.executeJavaScript("document.querySelector('[data-sheet=\"chatter\"]').click()");
  await sleep(250);
  const t1 = await panelWin.webContents.executeJavaScript("document.getElementById('sheetTitle').textContent");
  await panelWin.webContents.executeJavaScript("document.getElementById('sheetClose').click()");
  await sleep(250);
  const t2 = await panelWin.webContents.executeJavaScript("document.getElementById('sheetTitle').textContent");
  console.log('SHEET_BACK ' + t1 + ' -> ' + t2);

  panelWin.webContents.send('open-sheet', 'visit');
  await sleep(700);

  // 取宠模式：对方连不上时，接收端主动来拉
  game.s.offer.enabled = true;
  game.s.visitHost.enabled = true;
  game.s.visitHost.port = 0;
  startVisitServer();
  await sleep(700);
  let pulled = null;
  const pull = new VisitPullClient({ onPet: function (p) { pulled = p; } });
  const jr = await pull.join('127.0.0.1:' + visitServer.port, game.s.visitHost.code, 'B');
  await sleep(700);
  console.log('PULL_JOIN ' + JSON.stringify(jr) + ' request=' + !!(visitStatus().request) + ' away=' + game.s.away.active);
  answerPickup(true);
  await sleep(2600);
  console.log('PULL_APPROVED away=' + game.s.away.active + ' visible=' + petVisible + ' got=' + (pulled && pulled.name));
  pull.send({ type: 'pat' });
  await sleep(2400);
  console.log('PULL_PAT mood=' + game.s.mood.toFixed(1));
  await pull.leave();
  await sleep(900);
  console.log('PULL_LEAVE away=' + game.s.away.active + ' visible=' + petVisible);
  console.log('GUEST_AFTER ' + !!(guestWin && !guestWin.isDestroyed()));
  showPanel();
  await sleep(500);
  console.log('PANEL_AFTER ' + (panelWin && panelWin.isVisible()));
  hidePanel();
  quitApp();
}

async function runSmoke() {
  blog('smoke begin');
  const dir = path.join(os.tmpdir(), 'qqpet-smoke');
  fs.mkdirSync(dir, { recursive: true });

  // 领养窗
  adoptWin.show();
  blog('smoke adopt shown');
  await sleep(700);
  blog('smoke adopt wait done');
  fs.writeFileSync(path.join(dir, 'adopt.png'), (await adoptWin.webContents.capturePage()).toPNG());
  blog('smoke adopt captured');
  adoptWin.hide();

  // 宠物 + 面板
  game = new Game(Game.fresh('小蓝', 'GG'));
  game.s.courses['kid:zhi:0'] = 5;
  game.s.courses['kid:mei:0'] = 5;
  game.s.courses['kid:wu:0'] = 5;
  petVisible = true;
  petWin.showInactive();
  startLoops();
  showPanel();
  blog('smoke panel shown');
  say('主人你好，我是你的小宠物！', 8000);

  await sleep(1500);
  blog('smoke capture pet');
  fs.writeFileSync(path.join(dir, 'pet.png'), (await petWin.webContents.capturePage()).toPNG());
  blog('smoke pet captured');
  await sleep(600);
  fs.writeFileSync(path.join(dir, 'pet-frame2.png'), (await petWin.webContents.capturePage()).toPNG());
  blog('smoke capture panel');
  fs.writeFileSync(path.join(dir, 'panel.png'), (await panelWin.webContents.capturePage()).toPNG());
  blog('smoke panel captured');

  // 死亡面板（复活 / 重新领养）
  game.s.alive = false;
  game.s.sick = false;
  game.s.activity = 'dead';
  broadcast();
  await sleep(300);
  await panelWin.webContents.executeJavaScript("document.getElementById('cureTile').click()");
  await sleep(350);
  fs.writeFileSync(path.join(dir, 'panel-dead.png'), (await panelWin.webContents.capturePage()).toPNG());
  await panelWin.webContents.executeJavaScript("document.getElementById('deadModal').classList.remove('show')");
  game.s.alive = true;
  game.s.activity = 'idle';
  broadcast();

  // 忙碌状态的面板（进度条）
  game.s.activity = 'work';
  game.s.jobName = '收银员';
  game.s.busyTotal = 45 * 60 * 1000;
  game.s.busyUntil = Date.now() + 45 * 60 * 1000 * 0.4;
  broadcast();
  await sleep(400);
  fs.writeFileSync(path.join(dir, 'panel-busy.png'), (await panelWin.webContents.capturePage()).toPNG());
  game.s.activity = 'idle';
  game.s.busyTotal = 0;
  broadcast();

  await panelWin.webContents.executeJavaScript("document.querySelector('[data-open=\"food\"]').click()");
  await sleep(500);
  fs.writeFileSync(path.join(dir, 'panel-food.png'), (await panelWin.webContents.capturePage()).toPNG());
  await panelWin.webContents.executeJavaScript("document.getElementById('sheetClose').click()");

  await panelWin.webContents.executeJavaScript("document.querySelector('[data-open=\"toys\"]').click()");
  await sleep(500);
  fs.writeFileSync(path.join(dir, 'panel-toys.png'), (await panelWin.webContents.capturePage()).toPNG());
  await panelWin.webContents.executeJavaScript("document.getElementById('sheetClose').click()");

  await panelWin.webContents.executeJavaScript("document.querySelector('[data-open=\"baths\"]').click()");
  await sleep(400);
  fs.writeFileSync(path.join(dir, 'panel-baths.png'), (await panelWin.webContents.capturePage()).toPNG());
  await panelWin.webContents.executeJavaScript("document.getElementById('sheetClose').click()");

  panelWin.webContents.send('open-sheet', 'school');
  await sleep(600);
  fs.writeFileSync(path.join(dir, 'panel-school.png'), (await panelWin.webContents.capturePage()).toPNG());
  const enrollClicked = await panelWin.webContents.executeJavaScript(
    "(function(){var b=document.querySelector('[data-enroll]'); if(!b) return 'none'; b.click(); return b.getAttribute('data-enroll');})()"
  );
  blog('smoke enroll ' + enrollClicked);
  await sleep(1500);
  fs.writeFileSync(path.join(dir, 'panel-school-after.png'), (await panelWin.webContents.capturePage()).toPNG());
  const vid = await petWin.webContents.executeJavaScript(
    "(function(){var v=document.querySelector('#stage video.front');return JSON.stringify({src:v&&v.currentSrc?v.currentSrc.split('/').pop():'none',paused:v?v.paused:null,t:v?v.currentTime:null,err:v?!!v.error:null})})()"
  );
  console.log('AFTER_ENROLL ' + decodeURIComponent(vid) + ' activity=' + game.s.activity + ' pending=' + JSON.stringify(game.s.pendingCourse));
  const rowText = await panelWin.webContents.executeJavaScript(
    "(function(){var r=document.querySelector('.course'); return r? r.textContent : 'none';})()"
  );
  console.log('SCHOOL_ROW ' + rowText);
  const panelBits = await panelWin.webContents.executeJavaScript(
    "JSON.stringify({money:document.getElementById('pMoney').textContent,state:document.getElementById('pState').textContent,cure:document.getElementById('cureTxt').textContent})"
  );
  console.log('PANEL_BITS ' + decodeURIComponent(panelBits));

  panelWin.webContents.send('open-sheet', 'jobs');
  await sleep(600);
  fs.writeFileSync(path.join(dir, 'panel-jobs.png'), (await panelWin.webContents.capturePage()).toPNG());
  game.s.sick = true;
  game.s.illness = 'gastro';
  game.s.health = 40;
  broadcast();
  await sleep(300);
  panelWin.webContents.send('open-sheet', 'cures');
  await sleep(400);
  fs.writeFileSync(path.join(dir, 'panel-cures.png'), (await panelWin.webContents.capturePage()).toPNG());
  game.s.sick = false;
  game.s.illness = null;
  broadcast();
  await sleep(200);

  panelWin.webContents.send('open-sheet', 'more');
  await sleep(250);
  await panelWin.webContents.executeJavaScript("document.querySelector('[data-sheet=\"chatter\"]').click()");
  await sleep(250);
  const t1 = await panelWin.webContents.executeJavaScript("document.getElementById('sheetTitle').textContent");
  await panelWin.webContents.executeJavaScript("document.getElementById('sheetClose').click()");
  await sleep(250);
  const t2 = await panelWin.webContents.executeJavaScript("document.getElementById('sheetTitle').textContent");
  console.log('SHEET_BACK ' + t1 + ' -> ' + t2);

  panelWin.webContents.send('open-sheet', 'visit');
  await sleep(500);
  fs.writeFileSync(path.join(dir, 'panel-visit.png'), (await panelWin.webContents.capturePage()).toPNG());

  game.s.sick = true;
  game.s.illness = 'gastro';
  game.s.health = 40;
  broadcast();
  await sleep(300);
  panelWin.webContents.send('open-sheet', 'cures');
  await sleep(400);
  fs.writeFileSync(path.join(dir, 'panel-cures.png'), (await panelWin.webContents.capturePage()).toPNG());
  game.s.sick = false;
  game.s.illness = null;
  broadcast();
  await sleep(200);

  panelWin.webContents.send('open-sheet', 'more');
  await sleep(400);
  fs.writeFileSync(path.join(dir, 'panel-more.png'), (await panelWin.webContents.capturePage()).toPNG());
  panelWin.webContents.send('open-sheet', 'chatter');
  await sleep(400);
  await panelWin.webContents.executeJavaScript(
    "document.getElementById('chatterInput').value='该下班啦，别卷了'; document.getElementById('chatterAdd').click()"
  );
  await sleep(400);
  fs.writeFileSync(path.join(dir, 'panel-chatter.png'), (await panelWin.webContents.capturePage()).toPNG());
  panelWin.webContents.send('open-sheet', 'offwork');
  await sleep(400);
  await panelWin.webContents.executeJavaScript(
    "document.getElementById('offworkInput').value='18:00'; document.getElementById('offworkSave').click()"
  );
  await sleep(400);
  fs.writeFileSync(path.join(dir, 'panel-offwork.png'), (await panelWin.webContents.capturePage()).toPNG());

  panelWin.webContents.send('panel:hide');

  const before = petWin.getBounds();
  await sleep(6000);
  const after = petWin.getBounds();

  fs.writeFileSync(path.join(dir, 'pet-later.png'), (await petWin.webContents.capturePage()).toPNG());

  // 各状态各截一张，确认状态→动画的映射能加载
  const shots = [
    ['work', function () { game.s.activity = 'work'; game.s.busyUntil = Date.now() + 60000; }],
    ['sleep', function () { game.s.activity = 'sleep'; }],
    ['sick', function () { game.s.activity = 'idle'; game.s.sick = true; }],
  ];
  for (const pair of shots) {
    pair[1]();
    broadcast();
    await sleep(1800);
    fs.writeFileSync(path.join(dir, 'state-' + pair[0] + '.png'), (await petWin.webContents.capturePage()).toPNG());
    const src = await petWin.webContents.executeJavaScript(
      "(function(){var v=document.querySelector('#stage video.front');return v&&v.currentSrc?v.currentSrc.split('/').pop():'none'})()"
    );
    console.log('STATE ' + pair[0] + ' -> ' + decodeURIComponent(src));
  }
  game.s.sick = false;
  game.s.activity = 'idle';
  broadcast();

  // 走路朝向诊断：停掉自动漫游，手动指定朝右/朝左各截一张
  game.s.activity = 'play';
  game.s.busyUntil = Date.now() + 60000;
  broadcast();
  sendToWindows('motion', { walking: true, facing: 1 });
  await sleep(900);
  fs.writeFileSync(path.join(dir, 'walk-f1.png'), (await petWin.webContents.capturePage()).toPNG());
  sendToWindows('motion', { walking: true, facing: -1 });
  await sleep(900);
  fs.writeFileSync(path.join(dir, 'walk-f2.png'), (await petWin.webContents.capturePage()).toPNG());

  // 等级缩放：L1 和 L30 各截一张
  game.s.level = 1;
  applyPetScale(1, true);
  await sleep(700);
  fs.writeFileSync(path.join(dir, 'pet-L1.png'), (await petWin.webContents.capturePage()).toPNG());
  game.s.level = 30;
  applyPetScale(30, true);
  await sleep(700);
  fs.writeFileSync(path.join(dir, 'pet-L30.png'), (await petWin.webContents.capturePage()).toPNG());
  console.log('SCALE_L1 ' + JSON.stringify({ hit: HIT, scale: petScale }));
  game.s.level = 12;
  applyPetScale(12, true);
  await sleep(700);
  fs.writeFileSync(path.join(dir, 'pet-L12.png'), (await petWin.webContents.capturePage()).toPNG());
  console.log('SCALE_L12 ' + JSON.stringify({ hit: HIT, scale: petScale }));

  // 动画压力测试：快速切换 30 次，看会不会卡
  const clips = ['吃西瓜', '吃糖葫芦', '点击回应-开心跃动', '踢毽子', '吹气球', '照镜子', '原地专心玩魔方', '荡秋千', '涮火锅', '吃大闸蟹'];
  for (let ai = 0; ai < 30; ai++) {
    sendToWindows('effect', 'anim:' + clips[ai % clips.length]);
    await sleep(110);
  }
  await sleep(1600);
  const stress = await petWin.webContents.executeJavaScript(
    "(function(){var v=document.querySelector('#stage video.front');return JSON.stringify({src:(v.currentSrc||'').split('/').pop(),paused:v.paused,ended:v.ended,rs:v.readyState,t:v.currentTime})})()"
  );
  console.log('ANIM_STRESS ' + decodeURIComponent(stress));

  console.log('SMOKE_OK ' + dir);
  console.log('SMOKE_MOVE ' + JSON.stringify({
    before: { x: before.x, y: before.y },
    after: { x: after.x, y: after.y },
    walking: walking,
    facing: facing,
    state: game.snapshot(),
  }));

  quitting = true;
  app.quit();
}

async function runUiTest() {
  adoptPet({ name: '测试鹅', gender: 'MM' });
  if (game) { game.s.courses['kid:zhi:0'] = 5; game.s.courses['kid:mei:0'] = 5; game.s.courses['kid:wu:0'] = 5; }
  await sleep(900);
  showPanel();
  await sleep(400);

  const out = {};
  const cx = Math.round(HIT.x + HIT.w / 2);
  const cy = Math.round(HIT.y + HIT.h / 2);

  // 1) 抚摸：注入一次点击
  const mood0 = game.s.mood;
  petWin.webContents.sendInputEvent({ type: 'mouseDown', x: cx, y: cy, button: 'left', clickCount: 1 });
  petWin.webContents.sendInputEvent({ type: 'mouseUp', x: cx, y: cy, button: 'left', clickCount: 1 });
  await sleep(400);
  out.pat = { mood0: mood0, mood1: game.s.mood, ok: game.s.mood > mood0 };

  // 2) 拖动：直接向渲染端派发 pointer 事件（sendInputEvent 的 mouseMove 不会产生 pointermove）
  const before = petWin.getBounds();
  await petWin.webContents.executeJavaScript(
    '(async function () {' +
    '  const b = ' + JSON.stringify({ x: before.x, y: before.y }) + ';' +
    '  const pet = document.getElementById("hit");' +
    '  const cx = ' + cx + ', cy = ' + cy + ';' +
    '  function ev(type, lx, ly, buttons) {' +
    '    return new PointerEvent(type, { bubbles: true, cancelable: true, pointerId: 1,' +
    '      pointerType: "mouse", isPrimary: true, button: 0, buttons: buttons,' +
    '      clientX: lx, clientY: ly, screenX: b.x + lx, screenY: b.y + ly });' +
    '  }' +
    '  pet.dispatchEvent(ev("pointerdown", cx, cy, 1));' +
    '  await new Promise(r => setTimeout(r, 30));' +
    '  pet.dispatchEvent(ev("pointermove", cx - 40, cy - 20, 1));' +
    '  await new Promise(r => setTimeout(r, 60));' +
    '  pet.dispatchEvent(ev("pointermove", cx - 80, cy - 40, 1));' +
    '  await new Promise(r => setTimeout(r, 400));' +
    '  pet.dispatchEvent(ev("pointerup", cx - 80, cy - 40, 0));' +
    '})()'
  );
  await sleep(400);
  const after = petWin.getBounds();
  out.drag = {
    before: before.x + ',' + before.y,
    after: after.x + ',' + after.y,
    moved: before.x !== after.x || before.y !== after.y,
  };

  // 2.5) 抛掷：带间隔的 pointer 事件，让轨迹有真实速度
  // 悬停时视频必须还在播（防止待机定格）
  await sleep(700);
  const vt1 = await petWin.webContents.executeJavaScript(
    "document.querySelector('video.front') ? document.querySelector('video.front').currentTime : -1"
  );
  await sleep(700);
  const vt2 = await petWin.webContents.executeJavaScript(
    "document.querySelector('video.front') ? document.querySelector('video.front').currentTime : -1"
  );
  out.video = { t1: vt1, t2: vt2, ok: vt2 > vt1 };

  // 拖到半空松手：应该停在原地，不再下落
  const wbF = petWin.getBounds();
  await petWin.webContents.executeJavaScript(
    "(async function(){" +
    "  const b = " + JSON.stringify({ x: wbF.x, y: wbF.y }) + ";" +
    "  const hit = document.getElementById('hit');" +
    "  const r = hit.getBoundingClientRect();" +
    "  const cx = r.left + r.width / 2, cy = r.top + r.height / 2;" +
    "  const mk = (t, x, y, bt, bn) => new PointerEvent(t, { bubbles: true, cancelable: true, pointerId: 1," +
    "    pointerType: 'mouse', isPrimary: true, button: bn || 0, buttons: bt," +
    "    clientX: x, clientY: y, screenX: b.x + x, screenY: b.y + y });" +
    "  hit.dispatchEvent(mk('pointerdown', cx, cy, 1, 0));" +
    "  for (let i = 1; i <= 4; i++) {" +
    "    await new Promise(r => setTimeout(r, 200));" +
    "    hit.dispatchEvent(mk('pointermove', cx, cy - i * 30, 1, 0));" +
    "  }" +
    "  await new Promise(r => setTimeout(r, 500));" +
    "  hit.dispatchEvent(mk('pointerup', cx, cy - 120, 0, 0));" +
    "})()"
  );
  await sleep(1200);
  const yFloat = petWin.getBounds().y;
  out.float = { y: yFloat, expect: wbF.y - 120, ok: Math.abs(yFloat - (wbF.y - 120)) < 6 };

  const stamina0 = game.s.stamina;
  const wb = petWin.getBounds();
  await petWin.webContents.executeJavaScript(
    "(async function(){" +
    "  const b = " + JSON.stringify({ x: wb.x, y: wb.y }) + ";" +
    "  const hit = document.getElementById('hit');" +
    "  const r = hit.getBoundingClientRect();" +
    "  const cx = r.left + r.width / 2, cy = r.top + r.height / 2;" +
    "  const mk = (t, x, y, bt, bn) => new PointerEvent(t, { bubbles: true, cancelable: true, pointerId: 1," +
    "    pointerType: 'mouse', isPrimary: true, button: bn || 0, buttons: bt," +
    "    clientX: x, clientY: y, screenX: b.x + x, screenY: b.y + y });" +
    "  hit.dispatchEvent(mk('pointerdown', cx, cy, 1, 0));" +
    "  for (let i = 1; i <= 5; i++) {" +
    "    await new Promise(r => setTimeout(r, 30));" +
    "    hit.dispatchEvent(mk('pointermove', cx + i * 42, cy - i * 8, 1, 0));" +
    "  }" +
    "  await new Promise(r => setTimeout(r, 20));" +
    "  hit.dispatchEvent(mk('pointerup', cx + 210, cy - 40, 0, 0));" +
    "})()"
  );
  await sleep(500);
  out.throw = {
    stamina0: stamina0,
    stamina1: game.s.stamina,
    flying: flying,
    ok: game.s.stamina < stamina0,
  };

  // 抛掷后 1.5 秒内采样窗口位置：必须始终在当前屏幕工作区内（碰到右边缘会反弹）
  const area = displayFor(petPos.x + WIN_W / 2, petPos.y + WIN_H / 2).workArea;
  const limit = area.x + area.width - HIT.x - HIT.w;
  let maxX = -Infinity;
  const xs = [];
  for (let i = 0; i < 50; i++) {
    await sleep(30);
    const bb = petWin.getBounds();
    xs.push(bb.x);
    if (bb.x > maxX) maxX = bb.x;
  }
  const lastX = xs[xs.length - 1];
  for (let i = 0; i < 100 && flying; i++) await sleep(100);
  out.settled = { flying: flying, ok: !flying };

  out.bounce = {
    maxX: maxX,
    limit: limit,
    ok: maxX <= limit + 1,
    area: area,
    pet: { x: petPos.x, y: petPos.y },
    xs: xs,
  };

  // 3) 面板按钮：preload → ipcMain → act
  const money0 = game.s.money;
  await panelWin.webContents.executeJavaScript(
    "document.querySelector('[data-open=\"baths\"]').click()"
  );
  await sleep(300);
  await panelWin.webContents.executeJavaScript(
    "document.querySelector('[data-shop=\"bath:basic\"]').click()"
  );
  await sleep(500);
  out.panel = { money0: money0, money1: game.s.money, ok: game.s.money === money0 - 5 };

  // 4) 学校弹层：点第一节「上课」
  const moneyEdu = game.s.money;
  await panelWin.webContents.executeJavaScript(
    "(function(){" +
    "  var open = document.querySelector('[data-open=\"school\"]');" +
    "  if (open) open.click();" +
    "  var b = document.querySelector('[data-enroll]');" +
    "  if (b) b.click();" +
    "  return !!b;" +
    "})()"
  );
  await sleep(600);
  out.school = {
    money0: moneyEdu,
    money1: game.s.money,
    activity: game.s.activity,
    ok: game.s.money === moneyEdu - 2 && game.s.activity === 'study',
  };

  // 5) 学历门槛：没文凭时接不了编辑
  out.jobLock = game.workAt('editor').ok === false;

  // 6) 托盘菜单构建
  try {
    buildTrayMenu();
    out.tray = { title: trayTitle, ok: trayTitle.indexOf('测试鹅') >= 0 };
  } catch (e) {
    out.tray = false;
  }

  setPetVisible(false);
  await sleep(300);
  const hiddenOk = !petVisible && petWin.getOpacity() === 0;
  recallPet();
  await sleep(400);
  const shownOk = petVisible && petWin.getOpacity() === 1;
  out.recall = { hiddenOk: hiddenOk, visible: shownOk, petVisible: petVisible, ok: hiddenOk && shownOk };

  out.hit = await petWin.webContents.executeJavaScript(
    "JSON.stringify({hit: document.getElementById('hit').getBoundingClientRect(), stage: document.getElementById('stage').getBoundingClientRect(), dpr: window.devicePixelRatio})"
  );

  console.log('UI_TEST ' + JSON.stringify(out));
  quitting = true;
  app.quit();
}

function init() {
  blog('init start');
  setupIpc();

  const saved = TEST ? null : store.load(app.getPath('userData'));
  const hasSave = !!(saved && saved.started);

  createPetWindow();
  if (TEST) {
    petWin.webContents.on('console-message', function (e, details) {
      var msg = details && typeof details === 'object' ? details.message : details;
      if (msg) console.log('RENDERER ' + msg);
    });
  }
  createPanelWindow();
  createMenuWindow();
  createAdoptWindow();
  createTray();
  setupPresenceWatch();
  blog('windows + tray ready, smoke=' + SMOKE + ' uiTest=' + UI_TEST);

  if (hasSave) {
    game = new Game(saved);
    applyPetScale(game.s.level, true);
    updateTrayTooltip();
    // 退出即完全暂停：不结算离线消耗/收益，只把进行中的计时顺延
    const gapMs = Date.now() - (saved.savedAt || Date.now());
    game.freezeTimers(gapMs);
    const wasAbsent = game.maybeAbsent(gapMs);
    petVisible = true;
    petWin.webContents.once('did-finish-load', function () {
      petWin.showInactive();
      broadcast();
      applyPetScale(game.s.level, true);
      if (wasAbsent) say('主人，我等你好久，都睡着了…点我一下唤醒我', 9000);
    });
    startLoops();
    broadcast();
    if (game.s.visitHost.enabled) {
      setTimeout(function () { startVisitServer(); }, 800);
    }
    if (HOST_VISIT) {
      game.s.visitHost.enabled = true;
      setTimeout(function () {
        startVisitServer();
        setTimeout(function () { console.log('VISIT_HOST ' + JSON.stringify(visitStatus().host)); }, 700);
      }, 300);
    }
    if (OFFER_VISIT) {
      game.s.visitHost.enabled = true;
      game.s.visitHost.port = 0;
      game.s.offer.enabled = true;
      setTimeout(function () {
        startVisitServer();
        setTimeout(function () { console.log('VISIT_HOST ' + JSON.stringify(visitStatus().host)); }, 700);
        setTimeout(function () { returnPetHome('测试叫回家'); }, 15000);
      }, 300);
    }
    if (PULL_VISIT) {
      const parts = PULL_VISIT.split('|');
      setTimeout(function () {
        startPull(parts[0], parts[1]).then(function (r) { console.log('PULL_START ' + JSON.stringify(r)); });
        setTimeout(function () {
          console.log('PULL_STATE guest=' + !!(guestWin && !guestWin.isDestroyed()) + ' panel=' + (panelWin && panelWin.isVisible()));
          if (petWin && !petWin.isDestroyed()) {
            petWin.webContents.executeJavaScript(
              "(function(){var h=document.getElementById('hit'); h.dispatchEvent(new MouseEvent('dblclick',{bubbles:true})); return 'ok';})()"
            ).then(function () {
              setTimeout(function () {
                console.log('PULL_PANEL_AFTER ' + (panelWin && panelWin.isVisible()));
                quitApp();
              }, 600);
            });
          }
        }, 20000);
      }, 1200);
    }
    if (SEND_VISIT) {
      const parts = SEND_VISIT.split('|');
      setTimeout(function () {
        sendPetOut(parts[0], parts[1]).then(function (r) {
          console.log('VISIT_SENT ' + JSON.stringify(r));
        });
      }, 1200);
    }
  } else if (!TEST) {
    adoptWin.once('ready-to-show', function () { adoptWin.show(); });
  }

  if (SMOKE) runSmoke();
  else if (VISIT_TEST) runVisitTest();
  else if (CURE_TEST) runCureTest();
  else if (PANEL_POS_TEST) runPanelPosTest();
  else if (PERKS_TEST) runPerksTest();
  else if (SCHOOL_TEST) runSchoolTest();
  else if (BUSY_TEST) runBusyTest();
  else if (DAILY_TEST) runDailyTest();
  else if (HOVER_TEST) runHoverTest();
  else if (UI_TEST) runUiTest();
  else if (DRAG_TEST) {
    game = new Game(store.load() || Game.fresh('小蓝'));
    if (game.s.activity === 'work' || game.s.activity === 'study') {
      game.s.busyTotal = 3600 * 1000;
      game.s.busyUntil = Date.now() + 3600 * 1000;
    }
    petVisible = true;
    petPos.x = 1200;
    petPos.y = groundY();
    applyBounds();
    nextWanderAt = Date.now() + 3600 * 1000;
    petWin.showInactive();
    startLoops();
    broadcast();
    setInterval(function () {
      blog('bounds ' + JSON.stringify(petWin.getBounds()) + ' panel=' + (panelWin && panelWin.isVisible() ? JSON.stringify(panelWin.getBounds()) : '-'));
    }, 500);
    if (process.argv.includes('--menu-test')) {
      setTimeout(function () { showPetMenu(); }, 3000);
      setTimeout(function () {
        if (!menuWin || menuWin.isDestroyed()) return;
        menuWin.webContents.capturePage().then(function (img) {
          fs.mkdirSync(path.join(os.tmpdir(), 'qqpet-smoke'), { recursive: true });
          fs.writeFileSync(path.join(os.tmpdir(), 'qqpet-smoke', 'menu.png'), img.toPNG());
        }).catch(function () { /* ignore */ });
      }, 3400);
      setTimeout(function () {
        if (!menuWin) return;
        menuWin.webContents.executeJavaScript("document.querySelector('.item').click()");
        setTimeout(function () { blog('menu panel=' + (panelWin && panelWin.isVisible())); }, 500);
      }, 3600);
    }
    if (process.argv.includes('--panel-test')) setTimeout(function () { showPanel(); }, 3000);
    if (process.argv.includes('--tray-test')) {
      const dump = "(function(){var out=[];document.querySelectorAll('#stage video').forEach(function(v){out.push({c:v.className,p:v.paused,t:+v.currentTime.toFixed(2),src:(v.src||'').split('/').pop()})});return JSON.stringify({hid:document.hidden,v:out});})()";
      setTimeout(function () {
        game.s.money = 100;
        const r = game.enroll('kid', 'kid', 0);
        blog('tray enroll=' + JSON.stringify(r) + ' act=' + game.s.activity);
        broadcast();
      }, 1500);
      setTimeout(function () { showPanel(); }, 5000);
      setTimeout(function () { hidePanel(); }, 5200);
      setTimeout(function () { setPetVisible(true); showPanel(); }, 5400);
      setTimeout(function () {
        petWin.webContents.executeJavaScript(dump).then(function (t) { blog('tray videos ' + t); });
      }, 7000);
      setTimeout(function () {
        petWin.webContents.executeJavaScript(dump).then(function (t) { blog('tray videos2 ' + t); });
      }, 9500);
      setTimeout(function () { hidePanel(); }, 10500);
      setTimeout(function () {
        if (!petWin || petWin.isDestroyed()) { blog('tray no-pet'); return; }
        petWin.webContents.executeJavaScript(dump).then(function (t) { blog('tray videos3 ' + t); });
      }, 11800);
    }
    if (process.argv.includes('--occlusion-test')) {
      setTimeout(function () { showPanel(); }, 3000);
      setTimeout(function () {
        if (!petWin || petWin.isDestroyed()) return;
        petWin.webContents.executeJavaScript("document.visibilityState").then(function (v) { blog('occ state=' + v); });
        petWin.webContents.executeJavaScript("(function(){var v=document.querySelector('#stage video.front');return v?v.currentTime:-1})()").then(function (t) { blog('occ t1=' + t.toFixed(2)); });
      }, 9000);
      setTimeout(function () {
        if (!petWin || petWin.isDestroyed()) return;
        petWin.webContents.executeJavaScript("(function(){var v=document.querySelector('#stage video.front');return v?v.currentTime:-1})()").then(function (t) { blog('occ t2=' + t.toFixed(2)); });
      }, 11000);
      setTimeout(function () { hidePanel(); blog('occ panel closed'); }, 13000);
    }
    if (process.argv.includes('--freeze-test')) {
      setTimeout(function () {
        if (!petWin || petWin.isDestroyed()) return;
        petWin.webContents.executeJavaScript("document.querySelectorAll('video').forEach(function(v){v.pause();})");
        blog('freeze-test paused videos');
      }, 5000);
    }
    if (process.argv.includes('--panel-move-test')) {
      setTimeout(function () {
        if (!panelWin) return;
        blog('panel move test before ' + JSON.stringify(panelWin.getBounds()));
        panelWin.setPosition(300, 300);
        blog('panel move test after ' + JSON.stringify(panelWin.getBounds()));
      }, 5000);
    }
  }
}

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', function () {
    if (!game) {
      if (adoptWin) adoptWin.show();
      return;
    }
    setPetVisible(true);
    showPanel();
  });

  app.whenReady().then(function () {
    if (process.platform === 'win32') app.setAppUserModelId('com.deskpet.desktop');
    init();
  });

  // 关掉窗口不退出：托盘才是常驻入口
  app.on('window-all-closed', function () { /* 保持后台 */ });

  app.on('child-process-gone', function (e, details) {
    if (!details) return;
    if (details.type === 'GPU') {
      petPaintLog('gpu-gone reason=' + details.reason);
      setTimeout(function () {
        if (petWin && !petWin.isDestroyed()) {
          try { petWin.webContents.reload(); } catch (err) { /* ignore */ }
        }
      }, 800);
    }
  });
  app.on('render-process-gone', function (e, contents, details) {
    if (petWin && !petWin.isDestroyed() && contents === petWin.webContents) {
      petPaintLog('pet-renderer-gone reason=' + (details && details.reason));
      setTimeout(rebuildPetWindow, 500);
    }
  });

  app.on('before-quit', function () {
    quitting = true;
    saveNow();
  });
}
