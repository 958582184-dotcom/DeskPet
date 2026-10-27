'use strict';

/**
 * 纯逻辑层：不依赖 electron，可在 node 里直接单测。
 *
 * 节奏按「月」为单位设计（对齐当年原版）：
 *   · 一节课 45 分钟；每门课节数：小学 8 / 中学 20 / 大学 40。
 *     单科小学 6 小时、中学 15 小时、大学 30 小时；
 *     同方向小学毕业 18 小时，中学 45 小时，大学 90 小时。
 *   · 打工一班同样 45 分钟，工资按学历档位给。
 *   · 状态衰减按「10 小时左右见底」调，不然挂机一节课就饿死。
 */

const CFG = {
  hungerPerMin: 0.17,
  cleanPerMin: 0.14,
  moodPerMin: 0.12,
  growthPerMin: 0.1,
  sickChancePerMin: 0.08,
  healthPerMin: 0.1,      // 单项过低时健康衰减基准
  healthRegenPerMin: 0.08, // 状态都不错时的回复
  illnessAt: 45,           // 健康低于此值可能生病
  deathGraceMin: 60,
};

const FOODS = [
  { id: 'cookie', name: '小饼干', price: 5, hunger: 18, mood: 2, stamina: 4, anim: '大口吃零食' },
  { id: 'icecream', name: '冰淇淋', price: 8, hunger: 22, mood: 8, stamina: 6, anim: '吃冰淇淋融化' },
  { id: 'watermelon', name: '西瓜', price: 10, hunger: 30, mood: 6, stamina: 8, anim: '吃西瓜' },
  { id: 'tanghulu', name: '糖葫芦', price: 12, hunger: 32, mood: 8, stamina: 9, anim: '吃糖葫芦' },
  { id: 'mooncake', name: '月饼', price: 15, hunger: 35, mood: 10, stamina: 10, anim: '中秋赏月吃月饼' },
  { id: 'dumpling', name: '饺子', price: 18, hunger: 40, mood: 8, stamina: 12, anim: '吃饺子' },
  { id: 'crab', name: '大闸蟹', price: 30, hunger: 55, mood: 12, stamina: 16, anim: '吃大闸蟹' },
  { id: 'hotpot', name: '火锅', price: 45, hunger: 75, mood: 18, stamina: 22, anim: '涮火锅' },
];

/** 三个方向：每个方向三门课 */
const CATS = [
  { id: 'zhi', name: '智力', courses: ['语文', '数学', '政治'] },
  { id: 'mei', name: '魅力', courses: ['礼仪', '音乐', '美术'] },
  { id: 'wu', name: '武力', courses: ['武术', '劳技', '体育'] },
];

/**
 * 三个阶段：一节课 45 分钟；每门课 8 / 20 / 40 节；
 * 学费按「节」收；毕业奖学金一次性发。
 */
const KID_CATS = [
  { id: 'zhi', name: '智力', courses: ['学数数'] },
  { id: 'mei', name: '魅力', courses: ['学儿歌'] },
  { id: 'wu', name: '武力', courses: ['做手工'] },
];

const STAGES = [
  { id: 'kid', name: '幼儿园', lessons: 5, lessonMin: 20, cost: 1, attr: 3, bonus: 50, growth: 20 },
  { id: 'primary', name: '小学', lessons: 8, lessonMin: 30, cost: 2, attr: 5, bonus: 100, growth: 40 },
  { id: 'middle', name: '初中', lessons: 20, lessonMin: 40, cost: 6, attr: 8, bonus: 400, growth: 90 },
  { id: 'high', name: '高中', lessons: 24, lessonMin: 50, cost: 10, attr: 10, bonus: 900, growth: 150 },
  { id: 'college', name: '大学', lessons: 40, lessonMin: 60, cost: 15, attr: 12, bonus: 1500, growth: 200 },
];

/** 病种：不同诱因 → 不同治疗价格 */
const ILLNESSES = {
  gastro: { id: 'gastro', name: '肠胃炎', base: 30, cause: 'hunger', hint: '吃坏肚子' },
  skin: { id: 'skin', name: '皮肤病', base: 28, cause: 'clean', hint: '身上不干净' },
  blues: { id: 'blues', name: '心情低落', base: 20, cause: 'mood', hint: '心情太差' },
  fever: { id: 'fever', name: '发烧', base: 45, cause: 'health', hint: '健康太低' },
};

/** 洗澡项目 */
const BATHS = [
  { id: 'basic', name: '普通清洁', price: 5, clean: 32, mood: 0, stamina: 0, health: 0, anim: '玩水枪', say: '洗澡澡～好舒服' },
  { id: 'bubble', name: '泡泡浴', price: 12, clean: 45, mood: 12, stamina: 15, health: 0, anim: '玩水枪' },
  { id: 'sauna', name: '汗蒸', price: 18, clean: 30, mood: 5, stamina: -10, health: 12, anim: '超大伸懒腰' },
];

const WORK_MIN = 45;

/** 大约多少个 45 分钟的“课/班”升一级（经验按当前等级需求动态换算） */
const EXP_UNITS_PER_LEVEL = 6;

/** 玩耍项目：价格 / 心情 / 时长 / 对应动画（动画名在渲染端映射） */
const TOYS = [
  { id: 'tickle', name: '挠痒痒', price: 1, mood: 12, seconds: 4, anim: '点击回应-挠痒咯咯笑' },
  { id: 'toss', name: '丢丢乐', price: 3, mood: 22, seconds: 6, anim: '点击回应-开心跃动' },
  { id: 'balloon', name: '吹气球', price: 5, mood: 24, seconds: 7, anim: '吹气球' },
  { id: 'mirror', name: '照镜子', price: 6, mood: 30, seconds: 8, anim: '照镜子' },
  { id: 'jianzi', name: '踢毽子', price: 6, mood: 28, seconds: 8, anim: '踢毽子' },
  { id: 'watergun', name: '玩水枪', price: 8, mood: 35, seconds: 8, anim: '玩水枪' },
  { id: 'gomoku', name: '下五子棋', price: 8, mood: 32, seconds: 10, anim: '下五子棋' },
  { id: 'cat', name: '撸猫', price: 10, mood: 45, seconds: 10, anim: '撸猫' },
  { id: 'swing', name: '荡秋千', price: 10, mood: 42, seconds: 10, anim: '荡秋千' },
  { id: 'cube', name: '玩魔方', price: 12, mood: 50, seconds: 12, anim: '原地专心玩魔方' },
];

/**
 * 工作：reqs 为空 = 无学历要求；
 *   { any: 'primary' } = 任一方向小学毕业
 *   { course: 'college:zhi:0' } = 有大学语文单科文凭
 */
/**
 * 工作分 5 档（界面上不显示档位）：
 * 同档单位时间工资相同、班次时长不同；消耗按「吃/洗澡」折算（饱食 0.3、体力 1.0、清洁 0.3 金币/点），
 * 同档每小时的消耗金额也基本一致（T0≈30、T1≈26、T2≈22、T3≈18、T4≈14）。
 */
/**
 * 工作分 5 档（界面上不显示档位）：
 * 同档单位时间工资相同；1-2 档 10/20/30 分钟，3-4 档 15/25/35 分钟，5 档 30/45/60 分钟；
 * 消耗按「吃/洗澡」折算（饱食 0.3、体力 1.0、清洁 0.3 金币/点），同档每小时消耗金额基本一致。
 */
const JOBS = [
  // 第 1 档：无要求
  { id: 'dish', name: '洗碗工', pay: 8, min: 10, hunger: 2, stamina: 3, clean: 4, reqs: [], attr: 'wu', tier: 1 },
  { id: 'brick', name: '搬砖', pay: 15, min: 20, hunger: 5, stamina: 7, clean: 7, reqs: [], attr: 'wu', tier: 1 },
  { id: 'flyer', name: '发传单', pay: 23, min: 30, hunger: 10, stamina: 8, clean: 15, reqs: [], attr: 'wu', tier: 1 },
  // 第 2 档：任一方向小学毕业
  { id: 'waiter', name: '服务员', pay: 10, min: 10, hunger: 3, stamina: 2, clean: 4, reqs: [{ any: 'primary' }], attr: 'mei', tier: 2 },
  { id: 'kitchen', name: '后厨帮工', pay: 21, min: 20, hunger: 4, stamina: 5, clean: 9, reqs: [{ any: 'primary' }], attr: 'wu', tier: 2 },
  { id: 'courier', name: '快递员', pay: 31, min: 30, hunger: 11, stamina: 7, clean: 11, reqs: [{ any: 'primary' }], attr: 'wu', tier: 2 },
  // 第 3 档：任一方向中学毕业
  { id: 'typist', name: '打字员', pay: 14, min: 10, hunger: 2, stamina: 2, clean: 3, reqs: [{ any: 'middle' }], attr: 'zhi', tier: 3 },
  { id: 'seller', name: '售货员', pay: 28, min: 20, hunger: 6, stamina: 4, clean: 6, reqs: [{ any: 'middle' }], attr: 'mei', tier: 3 },
  { id: 'guard', name: '保安', pay: 42, min: 30, hunger: 11, stamina: 5, clean: 9, reqs: [{ any: 'middle' }], attr: 'wu', tier: 3 },
  // 第 4 档：大学单科
  { id: 'editor', name: '编辑', pay: 29, min: 15, hunger: 5, stamina: 2, clean: 5, reqs: [{ course: 'college:zhi:0' }], attr: 'zhi', tier: 4 },
  { id: 'model', name: '模特', pay: 48, min: 25, hunger: 5, stamina: 4, clean: 8, reqs: [{ course: 'college:mei:0' }], attr: 'mei', tier: 4 },
  { id: 'architect', name: '建筑师', pay: 67, min: 35, hunger: 9, stamina: 6, clean: 7, reqs: [{ course: 'college:zhi:1' }], attr: 'zhi', tier: 4 },
  // 第 5 档：大学双科（时长不变）
  { id: 'judge', name: '审判官', pay: 80, min: 30, hunger: 7, stamina: 3, clean: 7, reqs: [{ course: 'college:zhi:2' }, { course: 'college:wu:0' }], attr: 'zhi', tier: 5 },
  { id: 'chief', name: '主编', pay: 120, min: 45, hunger: 7, stamina: 4, clean: 14, reqs: [{ course: 'college:zhi:0' }, { course: 'college:mei:2' }], attr: 'zhi', tier: 5 },
  { id: 'king', name: '宠物王', pay: 160, min: 60, hunger: 12, stamina: 6, clean: 14, reqs: [{ course: 'college:zhi:1' }, { course: 'college:mei:2' }, { course: 'college:wu:2' }], attr: 'mei', tier: 5 },
];

const ACT_LABEL = { work: '打工', study: '上课', play: '玩耍', sleep: '睡觉' };

/** 面板要展示的花费/效果，集中放这里，避免 UI 和逻辑两套数字 */
const SPECS = [
  { id: 'diligent', name: '勤劳', desc: '打工更快、体力消耗更少' },
  { id: 'scholar', name: '学霸', desc: '上课经验更多、学费更低' },
  { id: 'health', name: '养生', desc: '消耗更慢、睡觉恢复更多' },
  { id: 'social', name: '社交', desc: '串门更快、好友位更多' },
  { id: 'lucky', name: '幸运', desc: '奖金更多、看病复活更便宜' },
];

const ATTR_NAMES = { zhi: '智力', mei: '魅力', wu: '武力' };

const DAILY_POOL = [
  { id: 'feed', label: '喂食', target: 3 },
  { id: 'bath', label: '洗澡', target: 2 },
  { id: 'work', label: '打一班工', target: 1 },
  { id: 'study', label: '上一节课', target: 2 },
  { id: 'play', label: '玩耍', target: 2 },
  { id: 'pat', label: '抚摸宠物', target: 5 },
  { id: 'throw', label: '抛掷', target: 3 },
  { id: 'visit', label: '去串门', target: 1 },
  { id: 'sleep', label: '睡觉', target: 2 },
];

const PET_EVENTS = [
  { id: 'coin', text: '咦，地上有 3 金币！', money: 3 },
  { id: 'coin2', text: '在沙发缝里翻到 2 金币～', money: 2 },
  { id: 'fruit', text: '邻居送来一个苹果！', hunger: 8 },
  { id: 'water', text: '不小心打翻了水杯…', clean: -5 },
  { id: 'puddle', text: '踩到水坑了，鞋都湿了…', clean: -4, mood: -1 },
  { id: 'dream', text: '想起一件开心的事～', mood: 4 },
  { id: 'photo', text: '翻到一张旧照片，笑出声', mood: 3 },
  { id: 'fly', text: '有只小虫飞过，扑了个空', mood: 2 },
  { id: 'dizzy', text: '转圈转得有点晕…', mood: -2 },
];

const ACTIONS = {
  bath: { cost: 5, clean: 32, mood: 5, stamina: 10 },
  play: { cost: 3, mood: 22 },
  cure: { cost: 50 },
  revive: { cost: 500 },
  sleep: { cost: 0 },
  workMin: WORK_MIN,
  lessonMin: 45,
};

function clamp(v, a, b) {
  return v < a ? a : v > b ? b : v;
}

function pickOne(list) {
  return list[Math.floor(Math.random() * list.length)];
}

function levelInfo(growth) {
  let lv = 1;
  let need = 60;
  let acc = 0;
  while (growth >= acc + need) {
    acc += need;
    lv += 1;
    need = 60 + 45 * (lv - 1) + 8 * Math.pow(lv - 1, 2);
  }
  return { lv: lv, cur: Math.round(growth - acc), need: Math.round(need) };
}

function pickLine(list) {
  return list[Math.floor(Math.random() * list.length)];
}

function stageById(id) {
  return STAGES.filter(function (s) { return s.id === id; })[0];
}

function catById(id) {
  return CATS.filter(function (c) { return c.id === id; })[0];
}

function catsOf(stageId) {
  return stageId === 'kid' ? KID_CATS : CATS;
}

function catOf(stageId, id) {
  return catsOf(stageId).filter(function (c) { return c.id === id; })[0];
}

function courseKey(stage, cat, idx) {
  return stage + ':' + cat + ':' + idx;
}

function stateLabel(s) {
  if (!s.alive) return '已经离开';
  if (s.absent) return '离开';
  if (s.activity === 'work') return '打工中';
  if (s.activity === 'study') return '上课中';
  if (s.activity === 'sleep') return '睡觉中';
  if (s.activity === 'play') return '玩耍中';
  if (s.hunger < 20) return '饿坏了';
  if (s.clean < 20) return '脏兮兮';
  if (s.mood < 30) return '闷闷不乐';
  return '空闲';
}

class Game {
  constructor(state) {
    this.s = state;
    this.events = [];
    this.ensureState();
  }

  ensureState() {
    const s = this.s;
    if (!s.courses || typeof s.courses !== 'object') s.courses = {};
    // 老存档里 courses 的值是 true/false，统一迁移成「已完成节数」
    Object.keys(s.courses).forEach(function (k) {
      if (s.courses[k] === true) s.courses[k] = 1;
      if (s.courses[k] === false) delete s.courses[k];
      if (typeof s.courses[k] !== 'number') delete s.courses[k];
    });
    if (!s.attrs || typeof s.attrs !== 'object') s.attrs = { zhi: 0, mei: 0, wu: 0 };
    if (typeof s.attrs.zhi !== 'number') s.attrs.zhi = 0;
    if (typeof s.attrs.mei !== 'number') s.attrs.mei = 0;
    if (typeof s.attrs.wu !== 'number') s.attrs.wu = 0;
    if (!s.jobId) s.jobId = null;
    if (!s.pendingCourse) s.pendingCourse = null;
    if (typeof s.busyTotal !== 'number') s.busyTotal = 0;
    if (typeof s.health !== 'number') s.health = 100;
    if (typeof s.healthZero !== 'number') s.healthZero = 0;
    if (s.illness === undefined) s.illness = null;
    if (!Array.isArray(s.chatter)) s.chatter = [];
    if (typeof s.offWorkAt !== 'string') s.offWorkAt = '';
    if (s.offWorkAt && !/^\d{1,2}:\d{2}$/.test(s.offWorkAt)) {
      const mm = /^(\d{1,2}:\d{2})/.exec(s.offWorkAt);
      s.offWorkAt = mm ? mm[1] : '';
      s.offWorkLast = -1;
    }
    if (typeof s.offWorkNotice !== 'string') s.offWorkNotice = '';
    if (typeof s.offWorkLast !== 'number') s.offWorkLast = -1;
    if (!s.visitHost || typeof s.visitHost !== 'object') s.visitHost = { enabled: false, port: 8737, code: '' };
    if (!s.away || typeof s.away !== 'object') s.away = { active: false, since: 0, host: '' };
    if (!s.offer || typeof s.offer !== 'object') s.offer = { enabled: false };
    if (typeof s.debt !== 'number') s.debt = 0;
    if (!s.visitLast || typeof s.visitLast !== 'object') s.visitLast = { address: '', code: '' };
    if (!Array.isArray(s.friends)) s.friends = [];
    if (!Array.isArray(s.specs)) s.specs = [];
    s.specs = s.specs.filter(function (x) {
      return SPECS.some(function (sp) { return sp.id === x; });
    }).slice(0, 6);
    if (!s.prof || typeof s.prof !== 'object') s.prof = {};
    if (!s.freeBuy || typeof s.freeBuy !== 'object') s.freeBuy = { day: '', used: 0 };
    if (typeof s.freeBuy.day !== 'string') s.freeBuy.day = '';
    if (typeof s.freeBuy.used !== 'number') s.freeBuy.used = 0;
    if (!s.daily || typeof s.daily !== 'object') s.daily = null;
    if (typeof s.nextEventAt !== 'number') s.nextEventAt = 0;
    if (typeof s.distractAt !== 'number') s.distractAt = 0;
    if (typeof s.distractUntil !== 'number') s.distractUntil = 0;
    if (typeof s.absent !== 'boolean') s.absent = false;
    if (typeof s.notifyLow !== 'boolean') s.notifyLow = true;
    if (!s.repeat || typeof s.repeat !== 'object') s.repeat = null;
    if ((s.activity === 'work' || s.activity === 'study' || s.activity === 'play') && s.busyTotal <= 0) {
      s.busyTotal = Math.max(60000, s.busyUntil - Date.now());
    }
    if (typeof s.money !== 'number') s.money = 50;
    if (typeof s.stamina !== 'number') s.stamina = 100;
    if (s.pendingCourse) {
      const pc = s.pendingCourse;
      if (!catOf(pc.stage, pc.cat)) {
        if (pc.stage === 'kid' && pc.cat === 'kid') {
          s.pendingCourse = { stage: 'kid', cat: pc.idx === 2 ? 'mei' : 'zhi', idx: 0 };
        } else {
          s.pendingCourse = null;
          if (s.activity === 'study') {
            s.activity = 'idle';
            s.busyUntil = 0;
            s.busyTotal = 0;
          }
        }
      }
    }
    if (s.courses && typeof s.courses === 'object') {
      const old0 = s.courses['kid:kid:0'] || 0;
      const old1 = s.courses['kid:kid:1'] || 0;
      const old2 = s.courses['kid:kid:2'] || 0;
      if (old0 || old1 || old2) {
        s.courses['kid:zhi:0'] = Math.max(s.courses['kid:zhi:0'] || 0, old0, old1);
        s.courses['kid:mei:0'] = Math.max(s.courses['kid:mei:0'] || 0, old2);
        delete s.courses['kid:kid:0'];
        delete s.courses['kid:kid:1'];
        delete s.courses['kid:kid:2'];
      }
    }
  }

  static fresh(name) {
    return {
      v: 3,
      started: true,
      name: name || '小蓝',
      hunger: 80,
      clean: 80,
      mood: 80,
      stamina: 100,
      health: 100,
      illness: null,
      healthZero: 0,
      chatter: [],
      offWorkAt: '',
      offWorkNotice: '',
      visitHost: { enabled: false, port: 8737, code: '' },
      away: { active: false, since: 0, host: '' },
      offer: { enabled: false },
      debt: 0,
      visitLast: { address: '', code: '' },
      friends: [],
      specs: [],
      prof: {},
      freeBuy: { day: '', used: 0 },
      absent: false,
      notifyLow: true,
      repeat: null,
      daily: null,
      nextEventAt: 0,
      distractAt: 0,
      distractUntil: 0,
      offWorkLast: -1,
      growth: 0,
      level: 1,
      money: 50,
      alive: true,
      sick: false,
      starving: 0,
      activity: 'idle',
      busyUntil: 0,
      jobPay: 20,
      jobName: '',
      jobId: null,
      busyTotal: 0,
      pendingCourse: null,
      courses: {},
      attrs: { zhi: 0, mei: 0, wu: 0 },
      muted: false,
      born: Date.now(),
      savedAt: Date.now(),
    };
  }

  emit(type, payload) {
    this.events.push(Object.assign({ type: type }, payload || {}));
  }

  drain() {
    const list = this.events;
    this.events = [];
    return list;
  }

  say(text, ms) {
    this.emit('say', { text: text, ms: ms || 2600 });
  }

  unitExp() {
    return Math.max(1, Math.round(levelInfo(this.s.growth).need / EXP_UNITS_PER_LEVEL));
  }

  /** 上课经验：学历越高给得越多（小学 ×1、中学 ×1.1、大学 ×1.2） */
  studyExp(stageId) {
    let idx = 0;
    for (let i = 0; i < STAGES.length; i++) if (STAGES[i].id === stageId) idx = i;
    return Math.round(this.unitExp() * (1 + idx * 0.1));
  }

  /** 打工经验：工资（≈岗位要求）越高给得越多，最低约 ×0.67，最高 ×1.2 */
  workExp(pay) {
    const p = Math.min(Math.max(Number(pay) || 0, 0), 180);
    return Math.round(this.unitExp() * (0.6 + 0.6 * p / 180));
  }

  chatterLine() {
    const s = this.s;
    if (Array.isArray(s.chatter) && s.chatter.length) {
      return s.chatter[Math.floor(Math.random() * s.chatter.length)];
    }
    if (!s.alive) return '……';
    if (s.sick) return pickOne(['头好晕…想喝热水…', '咳咳…我歇会儿就好']);
    if (s.hunger < 30) return pickOne(['肚子在叫了…有吃的吗？', '我闻到饭香了…']);
    if (s.clean < 30) return pickOne(['身上有点痒…想洗澡']);
    if (s.mood < 30) return pickOne(['陪我玩会儿嘛…', '有点无聊…']);
    if (s.activity === 'work') return pickOne(['认真打工中，别打扰我～', '再干一会儿就下班啦']);
    if (s.activity === 'study') return pickOne(['这道题好难…', '等我上完这节课']);
    if (s.mood > 80) return pickOne(['今天心情超好！', '要不要一起玩？']);
    return pickOne(['今天天气不错～', '嘿嘿，被你发现我在发呆', '我在想晚上吃什么…']);
  }

  addChatter(text) {
    const t = String(text || '').trim().slice(0, 60);
    if (!t) return { ok: false, msg: '内容不能为空' };
    if (this.s.chatter.length >= 30) return { ok: false, msg: '最多 30 条' };
    this.s.chatter.push(t);
    return { ok: true };
  }

  updateChatter(index, text) {
    const t = String(text || '').trim().slice(0, 60);
    if (!t) return { ok: false, msg: '内容不能为空' };
    if (!this.s.chatter[index]) return { ok: false, msg: '这条不存在了' };
    this.s.chatter[index] = t;
    return { ok: true };
  }

  removeChatter(index) {
    if (index < 0 || index >= this.s.chatter.length) return { ok: false, msg: '这条不存在了' };
    this.s.chatter.splice(index, 1);
    return { ok: true };
  }

  setOffWork(value) {
    const v = String(value || '').trim();
    if (v && !/^\d{1,2}:\d{2}$/.test(v)) return { ok: false, msg: '时间格式不对' };
    this.s.offWorkAt = v;
    this.s.offWorkNotice = '';
    this.s.offWorkLast = -1;
    return { ok: true };
  }

  offWorkLeft() {
    const s = this.s;
    if (!s.offWorkAt) return null;
    const m = /^(\d{1,2}):(\d{2})$/.exec(s.offWorkAt);
    if (!m) return null;
    const now = new Date();
    const target = new Date(now.getFullYear(), now.getMonth(), now.getDate(), Number(m[1]), Number(m[2]), 0, 0);
    const left = (target.getTime() - now.getTime()) / 60000;
    if (left < -2) return null;
    return left;
  }

  offWorkText(mark) {
    if (mark === 0) return '下班啦！收工～';
    if (mark === 60) return '还有 1 小时下班，撑住！';
    if (mark === 30) return '还有半小时下班，再坚持一下！';
    if (mark < 60) return '还有 ' + mark + ' 分钟下班，加油！';
    const hours = mark / 60;
    const whole = Math.floor(hours);
    const half = hours - whole >= 0.5;
    const h = half ? whole + ' 个半小时' : whole + ' 小时';
    return '呼，还有 ' + h + '才下班…';
  }

  checkOffWork() {
    const s = this.s;
    if (!s.offWorkAt) return;
    const left = this.offWorkLeft();
    if (left === null) return;
    // 超过 1 小时按半小时一档，1 小时内用固定档位；同一档不重复
    let mark;
    if (left > 60) mark = Math.round(left / 30) * 30;
    else if (left > 30) mark = 60;
    else if (left > 10) mark = 30;
    else if (left > 5) mark = 10;
    else if (left > 1) mark = 5;
    else if (left > 0) mark = 1;
    else mark = 0;
    if (mark > 5 * 60) return; // 夜里别报“还有十几小时”
    if (mark === s.offWorkLast) return;
    s.offWorkLast = mark;
    this.say(this.offWorkText(mark), 4200);
  }

  busy() {
    const a = this.s.activity;
    return a === 'work' || a === 'study' || a === 'play';
  }

  awayReason() {
    return this.s.away && this.s.away.active ? '宠物在别人家串门，先叫它回来' : null;
  }

  guard() {
    const s = this.s;
    if (!s.alive) return '我已经离开了…先用复活丹吧';
    const away = this.awayReason();
    if (away) return away;
    if (this.busy()) return '我正在' + (ACT_LABEL[s.activity] || '忙') + '，等会儿吧';
    return null;
  }

  /** 抚摸/喂食/洗澡/抛掷这类即时互动：忙碌时也允许，不打断上课或打工 */
  interactGuard() {
    if (!this.s.alive) return '我已经离开了…先用复活丹吧';
    const away = this.awayReason();
    if (away) return away;
    return null;
  }

  /* ---------------- 串门 ---------------- */

  canGoOut() {
    const s = this.s;
    if (!s.alive) return { ok: false, msg: '……' };
    if (s.away && s.away.active) return { ok: false, msg: '已经在别人家啦' };
    if (s.sick) return { ok: false, msg: '生病了，不能出门…' };
    if (s.activity !== 'idle') return { ok: false, msg: '正在' + (ACT_LABEL[s.activity] || '忙') + '，出不了门' };
    return { ok: true };
  }

  goOut(host) {
    const r = this.canGoOut();
    if (!r.ok) return r;
    this.s.away = { active: true, since: Date.now(), host: String(host || '').slice(0, 40) };
    this.countTask('visit');
    this.say('我出门玩啦～', 2600);
    return { ok: true };
  }

  comeHome(why) {
    const s = this.s;
    if (!s.away || !s.away.active) return { ok: false };
    s.away = { active: false, since: 0, host: '' };
    this.say(why || '我回来啦！', 2600);
    return { ok: true };
  }

  /** 客宠被喂：对方付钱，这里只加属性 */
  guestFeed(foodId) {
    const s = this.s;
    const food = FOODS.filter(function (f) { return f.id === foodId; })[0];
    if (!food) return { ok: false, msg: '没有这个食物' };
    s.hunger = clamp(s.hunger + food.hunger, 0, 100);
    s.mood = clamp(s.mood + food.mood, 0, 100);
    s.stamina = clamp(s.stamina + food.stamina, 0, 100);
    return { ok: true, anim: food.anim };
  }

  guestPat() {
    this.s.mood = clamp(this.s.mood + 1, 0, 100);
    return { ok: true };
  }

  /* ---------------- 学校 ---------------- */

  /** 已完成的节数 */
  progress(stage, cat, idx) {
    const v = this.s.courses[courseKey(stage, cat, idx)];
    return typeof v === 'number' ? v : 0;
  }

  lessonsOf(stage) {
    return stageById(stage).lessons;
  }

  /** 这门课是否修完 */
  hasCourse(stage, cat, idx) {
    return this.progress(stage, cat, idx) >= this.lessonsOf(stage);
  }

  /** 某方向某阶段是否毕业（三门课全修完） */
  hasDiploma(stage, cat) {
    const c = catOf(stage, cat);
    const n = c ? c.courses.length : 3;
    for (let i = 0; i < n; i++) {
      if (!this.hasCourse(stage, cat, i)) return false;
    }
    return true;
  }

  /** 该方向该阶段已修完几门课 */
  doneCount(stage, cat) {
    const c = catOf(stage, cat);
    const total = c ? c.courses.length : 3;
    let n = 0;
    for (let i = 0; i < total; i++) if (this.hasCourse(stage, cat, i)) n += 1;
    return n;
  }

  anyDiploma(stage) {
    return CATS.some((c) => this.hasDiploma(stage, c.id));
  }

  eduLabel() {
    if (this.anyDiploma('college')) return '大学';
    if (this.anyDiploma('high')) return '高中';
    if (this.anyDiploma('middle')) return '初中';
    if (this.anyDiploma('primary')) return '小学';
    if (KID_CATS.every((c) => this.hasDiploma('kid', c.id))) return '幼儿园';
    return '无';
  }

  stageUnlocked(stage, cat) {
    if (stage === 'kid') return true;
    if (stage === 'primary') return KID_CATS.every((c) => this.hasDiploma('kid', c.id));
    const idx = STAGES.findIndex((x) => x.id === stage);
    if (idx <= 0) return true;
    return this.hasDiploma(STAGES[idx - 1].id, cat);
  }

  courseBlockReason(stage, cat, idx) {
    const s = this.s;
    if (!s.alive) return '我已经离开了';
    const away = this.awayReason();
    if (away) return away;
    if (this.busy()) return '正在' + (ACT_LABEL[s.activity] || '忙');
    if (s.sick && s.health <= 30) return '病得没力气上课（健康超过 30 才行）';
    if (this.hasCourse(stage, cat, idx)) return '已经修完';
    if (!this.stageUnlocked(stage, cat) && this.progress(stage, cat, idx) === 0) {
      if (stage === 'primary') return '需要先幼儿园毕业';
      const prev = STAGES[STAGES.findIndex((x) => x.id === stage) - 1];
      return '需要先' + prev.name + '·' + (catOf(prev.id, cat) || catById(cat)).name + '毕业';
    }
    const st = stageById(stage);
    const price = this.tuition(st);
    if (this.freeLeft() === 0 && s.money < price) return '金币不够（一节 ' + price + '）';
    if (s.hunger < 20 || s.clean < 20) return '状态太差，先喂饱洗干净';
    return null;
  }

  /** 上一节课（一节 45 分钟，按节扣学费） */
  enroll(stage, cat, idx) {
    const s = this.s;
    const err = this.courseBlockReason(stage, cat, idx);
    if (err) return { ok: false, msg: err };

    const st = stageById(stage);
    const c = catOf(stage, cat);
    if (!st || !c) return { ok: false, msg: '没有这门课' };
    const done = this.progress(stage, cat, idx);
    const price = this.tuition(st);
    const payState = this.pay(price);
    if (!payState) return { ok: false, msg: '金币不够（一节 ' + price + ' 金币）' };
    s.activity = 'study';
    s.busyTotal = Math.max(1, Math.round(st.lessonMin * (1 - this.perks().studyTime))) * 60 * 1000;
    s.busyUntil = Date.now() + s.busyTotal;
    s.hunger = clamp(s.hunger - 3, 0, 100);
    s.pendingCourse = { stage: stage, cat: cat, idx: idx };
    s.distractAt = 0;
    s.distractUntil = 0;
    if (Math.random() < 0.6) {
      const span = Math.max(2, Math.min(6, st.lessonMin - 3));
      s.distractAt = Date.now() + (2 + Math.random() * (span - 2)) * 60000;
    }
    this.say(pickLine([
      '去上' + st.name + c.name + '·' + c.courses[idx] + '（第 ' + (done + 1) + '/' + st.lessons + ' 节）',
      '我去上课啦～',
      '上课去咯，等我回来～',
    ]), 3200);
    return { ok: true, free: payState === 'free' };
  }

  finishCourse() {
    const s = this.s;
    const p = s.pendingCourse;
    s.pendingCourse = null;
    s.distractAt = 0;
    s.distractUntil = 0;
    if (!p) return;

    const st = stageById(p.stage);
    const c = catOf(p.stage, p.cat);
    if (!st || !c) {
      s.activity = 'idle';
      s.busyUntil = 0;
      s.busyTotal = 0;
      return;
    }
    const key = courseKey(p.stage, p.cat, p.idx);
    const done = Math.min(this.lessonsOf(p.stage), this.progress(p.stage, p.cat, p.idx) + 1);
    s.courses[key] = done;
    this.countTask('study');

    s.hunger = clamp(s.hunger - 3, 0, 100);
    s.growth += Math.round(this.studyExp(p.stage) * (1 + this.perks().studyExp));
    s.mood = clamp(s.mood - 2, 0, 100);

    const finished = done >= st.lessons;
    if (finished) {
      if (s.attrs[p.cat] !== undefined) s.attrs[p.cat] += st.attr;
      s.growth += st.growth;
      const graduated = this.hasDiploma(p.stage, p.cat);
      if (graduated) {
        s.money += st.bonus;
        this.say(pickLine([
          '主人，我放学回来啦～拿到' + st.name + '·' + c.name + '文凭！学校奖励我 ' + st.bonus + ' 金币奖学金',
          '主人，我放学回来啦～' + st.name + '·' + c.name + '文凭到手！还领了 ' + st.bonus + ' 金币奖学金',
          '主人，我放学回来啦～我毕业啦！' + st.name + '·' + c.name + '文凭，奖学金 ' + st.bonus + ' 金币',
        ]), 5000);
        this.emit('graduate', { stage: p.stage, cat: p.cat });
      } else {
        this.say(pickLine([
          '主人，我放学回来啦～学完了' + c.courses[p.idx] + '课，我感觉自己变聪明了呢',
          '主人，我放学回来啦～' + c.courses[p.idx] + '课学完啦，老师夸我进步很大！',
          '主人，我放学回来啦～' + c.courses[p.idx] + '修完了，现在的我可不是以前的我了！',
        ]), 4200);
        this.emit('course-done', { stage: p.stage, cat: p.cat });
      }
    } else {
      this.say(pickLine([
        '主人，我放学回来啦～今天学了' + c.courses[p.idx] + '，脑袋里又多了一点新知识！',
        '主人，我放学回来啦～' + c.courses[p.idx] + '上到第 ' + done + ' 节啦，再上 ' + (st.lessons - done) + ' 节就学完咯',
        '主人，我放学回来啦～今天学会了好多新东西，好开心！',
      ]), 3600);
    }
  }

  /* ---------------- 打工 ---------------- */

  reqMet(req) {
    if (req.any) return this.anyDiploma(req.any);
    if (req.course) {
      const parts = req.course.split(':');
      return this.hasCourse(parts[0], parts[1], Number(parts[2]));
    }
    return false;
  }

  jobAvailable(job) {
    return job.reqs.every((r) => this.reqMet(r));
  }

  reqText(job) {
    if (!job.reqs.length) return '无学历要求';
    return job.reqs.map((r) => {
      if (r.any) return '任一方向' + stageById(r.any).name + '毕业';
      const parts = r.course.split(':');
      return '大学' + catById(parts[1]).courses[Number(parts[2])];
    }).join(' + ');
  }

  workAt(jobId) {
    const s = this.s;
    if (s.level < 3) return { ok: false, msg: '我还太小了，不能打工…' };
    const job = JOBS.filter((j) => j.id === jobId)[0];
    if (!job) return { ok: false, msg: '没有这份工作' };
    const err = this.guard();
    if (err) return { ok: false, msg: err };
    if (s.sick && s.health <= 50) return { ok: false, msg: '病得没力气打工（健康超过 50 才行）' };
    if (!this.jobAvailable(job)) return { ok: false, msg: '学历不够：' + this.reqText(job) };
    if (s.hunger < 20 || s.clean < 20) return { ok: false, msg: '我状态太差，先喂饱洗干净' };

    const perks = this.perks();
    const mins = this.jobMinutes(job);
    s.jobId = job.id;
    s.jobName = job.name;
    s.jobPay = this.jobPay(job);
    s.jobMin = mins;
    s.activity = 'work';
    s.busyTotal = mins * 60 * 1000;
    s.busyUntil = Date.now() + s.busyTotal;
    s.hunger = clamp(s.hunger - (job.hunger || 0) / 2, 0, 100);
    s.stamina = clamp(s.stamina - this.jobStamina(job) * (1 - perks.workStamina) / 2, 0, 100);
    this.say(pickLine([
      '去做' + job.name + '啦，' + mins + ' 分钟后回来',
      '我去打工啦～',
      '出门干活去咯，等我回来！',
    ]), 3200);
    return { ok: true };
  }

  workBest() {
    let best = null;
    JOBS.forEach((j) => {
      if (!this.jobAvailable(j)) return;
      if (!best || j.pay > best.pay) best = j;
    });
    if (!best) return { ok: false, msg: '暂时没有能做的工作' };
    return this.workAt(best.id);
  }

  /* ---------------- 时间推进 ---------------- */

  tick(dtSec) {
    const s = this.s;
    if (!s.alive) return this.drain();
    if (s.absent) return this.drain();

    const min = dtSec / 60;
    const working = s.activity === 'work' || s.activity === 'study';
    const sleeping = s.activity === 'sleep';
    const slow = sleeping ? 0.45 : 1;

    const perks = this.perks();
    s.hunger = clamp(s.hunger - CFG.hungerPerMin * slow * min * (1 - perks.decay), 0, 100);
    s.clean = clamp(s.clean - CFG.cleanPerMin * slow * min * (1 - perks.decay), 0, 100);

    let staminaRegen = sleeping ? 6 * (1 + perks.sleepStamina) : 1.5;
    if (s.activity === 'study') staminaRegen = 0.4;
    if (s.activity === 'work') staminaRegen = 0;
    s.stamina = clamp(s.stamina + staminaRegen * min, 0, 100);

    if (sleeping) {
      s.mood = clamp(s.mood + 0.5 * min, 0, 100);
    } else {
      let dm = 0;
      if (s.hunger < 50) dm -= 0.12 * (1 - perks.decay);
      if (s.clean < 50) dm -= 0.12 * (1 - perks.decay);
      if (s.hunger > 60 && s.clean > 60) dm += 0.05;
      if (working) dm -= 0.08;
      if (s.sick) dm -= 0.6;
      s.mood = clamp(s.mood + dm * min, 0, 100);
    }

    if (!s.sick) {
      // 挂机经验；打工/上课的经验在完成时结算
      let rate = CFG.growthPerMin;
      if (s.mood >= 90) rate *= 1.3;
      else if (s.mood < 40) rate *= 0.6;
      if (sleeping) rate *= 0.5;
      if (working) rate = 0;
      s.growth += rate * min;
    }

    // 健康：饱食/清洁/心情过低会掉，状态都不错会慢慢回
    let dh = 0;
    if (s.hunger < 25) dh -= 0.10;
    if (s.clean < 25) dh -= 0.08;
    if (s.mood < 25) dh -= 0.06;
    if (s.hunger >= 50 && s.clean >= 50 && s.mood >= 50 && s.activity !== 'work') dh += 0.08;
    if (s.sick) dh += sleeping ? 0.05 : (working ? -0.22 : -0.15);
    s.health = clamp(s.health + dh * min, 0, 100);
    if (s.sick && s.health > 80) s.health = 80; // 生病时最多靠休息恢复到 80

    // 带病硬撑：健康掉到不能工作/上课就直接中断
    if (s.sick && s.activity === 'work' && s.health <= 50) this.interruptJob();
    if (s.sick && s.activity === 'study' && s.health <= 30) this.interruptStudy();

    if (!s.sick && s.health < CFG.illnessAt) {
      const p = ((CFG.illnessAt - s.health) / CFG.illnessAt) * 0.02 * min * (1 - perks.illness);
      if (Math.random() < p) this.fallIll();
    }

    if (s.sick) {
      s.healthZero = s.health <= 0 ? s.healthZero + min : 0;
      if (s.healthZero >= CFG.deathGraceMin) {
        this.die();
        return this.drain();
      }
    } else {
      s.healthZero = 0;
    }

    this.checkOffWork();
    this.maybeEvent();

    if (s.activity === 'study') {
      if (s.distractAt && !s.distractUntil && Date.now() >= s.distractAt) {
        s.distractUntil = Date.now() + 12000;
        this.say('走神了…点我一下！', 12000);
        this.emit('distract');
      }
      if (s.distractUntil && Date.now() > s.distractUntil) {
        s.distractUntil = 0;
        s.distractAt = 0;
        this.say('…走神走到下课了', 2400);
      }
    }

    if ((working || s.activity === 'play') && Date.now() >= s.busyUntil) {
      this.finishBusy();
    }

    const li = levelInfo(s.growth);
    if (li.lv > s.level) {
      s.level = li.lv;
      s.money += 20;
      this.emit('levelup', { level: li.lv });
      this.say(pickLine([
        '我升到 Lv.' + li.lv + ' 啦！',
        '主人主人，我 Lv.' + li.lv + ' 了！',
        '又长大一点，Lv.' + li.lv + ' 啦～',
      ]), 3200);
    }

    return this.drain();
  }

  freezeTimers(gapMs) {
    const s = this.s;
    if (!(gapMs > 0)) return;
    // 退出即暂停：把进行中的计时整体顺延，不在离线期间结算
    if (s.busyUntil) s.busyUntil += gapMs;
    if (s.away && s.away.active) this.comeHome('程序关掉了');
  }

  stopActivity() {
    const s = this.s;
    if (!this.busy()) return { ok: false, msg: '现在没在忙' };
    if (s.activity === 'work') {
      this.interruptJob(true);
      return { ok: true };
    }
    if (s.activity === 'study') {
      this.interruptStudy(true);
      return { ok: true };
    }
    s.activity = 'idle';
    s.busyUntil = 0;
    s.busyTotal = 0;
    s.repeat = null;
    this.say('不玩了～', 2200);
    return { ok: true };
  }

  interruptJob(byUser) {
    const s = this.s;
    const job = JOBS.filter(function (j) { return j.id === s.jobId; })[0];
    const total = s.busyTotal || 1;
    const left = Math.max(0, s.busyUntil - Date.now());
    const frac = clamp(1 - left / total, 0, 1);
    s.activity = 'idle';
    s.busyUntil = 0;
    s.busyTotal = 0;
    s.repeat = null;
    if (!job) {
      this.say(pickLine(['身体撑不住，提前收工了…', '不行了，我得先回去了…']), 3200);
      return;
    }
    const pay = Math.round(job.pay * frac);
    s.money += pay;
    s.hunger = clamp(s.hunger - (job.hunger || 0) / 2, 0, 100);
    s.stamina = clamp(s.stamina - this.jobStamina(job) * (1 - this.perks().workStamina) / 2, 0, 100);
    s.clean = clamp(s.clean - (job.clean || 0), 0, 100);
    s.growth += this.workExp(pay);
    this.say(byUser ? ('提前收工～赚了 ' + pay + ' 金币') : pickLine(['身体撑不住，提前收工…赚了 ' + pay + ' 金币', '干不动了，先回来…赚了 ' + pay + ' 金币']), 3800);
    this.emit('work-done', { pay: pay, interrupted: true });
  }

  interruptStudy(byUser) {
    const s = this.s;
    s.activity = 'idle';
    s.busyUntil = 0;
    s.busyTotal = 0;
    s.pendingCourse = null;
    s.distractAt = 0;
    s.distractUntil = 0;
    s.repeat = null;
    s.hunger = clamp(s.hunger - 3, 0, 100);
    this.say(byUser ? '这节课先不上了…' : pickLine(['身体撑不住，这节课没上完…', '难受，课没上完就回来了…']), 3600);
  }

  finishBusy() {
    const s = this.s;
    const a = s.activity;

    if (a === 'study') {
      s.activity = 'idle';
      this.finishCourse();
      if (s.repeat && s.repeat.kind === 'study' && s.repeat.left > 0) {
        s.repeat.left -= 1;
        const rp = s.repeat;
        const rr = this.enroll(rp.stage, rp.cat, rp.idx);
        if (!rr.ok) {
          s.repeat = null;
          if (rr.msg) this.say(rr.msg, 2800);
        } else if (s.repeat && s.repeat.left === 0) {
          s.repeat = null;
        }
      }
      return;
    }

    s.activity = 'idle';

    if (a === 'work') {
      const job = JOBS.filter(function (j) { return j.id === s.jobId; })[0];
      const perks = this.perks();
      const loss = job || { hunger: 12, stamina: 0, clean: 12 };
      s.hunger = clamp(s.hunger - (loss.hunger || 0) / 2, 0, 100);
      s.stamina = clamp(s.stamina - (job ? this.jobStamina(job) : (loss.stamina || 0)) * (1 - perks.workStamina) / 2, 0, 100);
      s.clean = clamp(s.clean - (loss.clean || 0), 0, 100);

      let pay = s.jobPay;
      let note = '';
      const roll = Math.random();
      if (roll < 0.1 + perks.bonusChance) {
        const bonus = Math.round(pay * 0.3);
        pay += bonus;
        note = '（老板多给了 ' + bonus + '）';
      } else if (roll < 0.18 + perks.bonusChance) {
        const fine = Math.max(1, Math.round(pay * 0.2));
        pay -= fine;
        note = '（迟到扣了 ' + fine + '）';
      }
      s.money += pay;
      this.countTask('work');
      if (job) {
        s.prof[job.id] = Math.min(this.masteryNeed(job), (s.prof[job.id] || 0) + 1);
      }
      const exp = this.workExp(s.jobPay);
      s.growth += exp;
      const jobLabel = s.jobName || '打工';
      this.say(pickLine([
        '主人，我打工回来啦～今天' + jobLabel + '赚了 ' + pay + ' 金币' + note + '，虽然累但值得！',
        '主人，我打工回来啦！' + jobLabel + '赚了 ' + pay + ' 金币' + note + '，可以加餐啦～',
        '主人，我打工回来啦～' + jobLabel + '赚了 ' + pay + ' 金币' + note + '，我是不是很能干？',
      ]), 4000);
      this.emit('work-done', { pay: pay });
      if (s.repeat && s.repeat.kind === 'work' && s.repeat.left > 0) {
        s.repeat.left -= 1;
        const rp = s.repeat;
        const rr = this.workAt(rp.jobId);
        if (!rr.ok) {
          s.repeat = null;
          if (rr.msg) this.say(rr.msg, 2800);
        } else if (s.repeat && s.repeat.left === 0) {
          s.repeat = null;
        }
      }
    } else if (a === 'play') {
      s.growth += 3;
      this.say(pickLine(['嘿嘿嘿，真有意思！', '玩得好开心～', '这个真好玩，下次还玩！']), 2200);
    }
  }

  fallIll() {
    const s = this.s;
    let id = 'fever';
    if (s.health >= 20) {
      const low = Math.min(s.hunger, s.clean, s.mood);
      if (low === s.hunger) id = 'gastro';
      else if (low === s.clean) id = 'skin';
      else id = 'blues';
    }
    s.sick = true;
    s.illness = id;
    s.activity = 'idle';
    s.busyUntil = 0;
    s.busyTotal = 0;
    s.pendingCourse = null;
    const ill = ILLNESSES[id];
    this.say(pickLine(['咳咳…我得了' + ill.name, '好难受…好像是' + ill.name, '主人，我不太舒服，可能是' + ill.name]), 4200);
    this.emit('sick', { illness: id });
  }

  die() {
    const s = this.s;
    s.debt = 0;
    s.alive = false;
    s.sick = false;
    s.illness = null;
    s.activity = 'dead';
    s.hunger = 0;
    s.clean = 0;
    s.mood = 0;
    s.stamina = 0;
    s.health = 0;
    s.healthZero = 0;
    s.starving = 0;
    s.busyUntil = 0;
    s.busyTotal = 0;
    s.pendingCourse = null;
    s.distractAt = 0;
    s.distractUntil = 0;
    s.repeat = null;
    this.say(pickLine(['主人…我先睡一会儿…', '有点累…我休息一下…']), 6000);
    this.emit('died');
  }

  /* ---------------- 日常动作 ---------------- */

  feed(foodId) {
    const s = this.s;
    const food = FOODS.filter(function (f) { return f.id === foodId; })[0];
    if (!food) return { ok: false, msg: '没有这种食物' };
    const err = this.interactGuard();
    if (err) return { ok: false, msg: err };
    const payState = this.pay(food.price);
    if (!payState) return { ok: false, msg: '金币不够啦，去打工赚点吧' };

    const boost = 1 + this.perks().effect;
    s.hunger = clamp(s.hunger + food.hunger * boost, 0, 100);
    s.mood = clamp(s.mood + food.mood * boost, 0, 100);
    s.stamina = clamp(s.stamina + (food.stamina || 0) * boost, 0, 100);
    s.growth += 1;
    this.countTask('feed');
    this.say(pickLine([
      '谢谢主人，' + food.name + '真好吃！',
      '哇，是' + food.name + '！',
      food.name + '！我开动啦～',
    ]), 2800);
    this.emit('fed');
    return { ok: true, food: food.id, anim: food.anim, free: payState === 'free' };
  }

  bath() {
    return this.bathAt('basic');
  }

  bathAt(id) {
    const s = this.s;
    const plan = BATHS.filter(function (b) { return b.id === id; })[0];
    if (!plan) return { ok: false, msg: '没有这个选项' };
    const err = this.interactGuard();
    if (err) return { ok: false, msg: err };
    const payState = this.pay(plan.price);
    if (!payState) return { ok: false, msg: plan.name + '要 ' + plan.price + ' 金币…' };

    const boost = 1 + this.perks().effect;
    s.clean = clamp(s.clean + plan.clean * boost, 0, 100);
    s.mood = clamp(s.mood + (plan.mood || 0) * boost, 0, 100);
    const st = plan.stamina || 0;
    s.stamina = clamp(s.stamina + (st > 0 ? st * boost : st), 0, 100);
    s.health = clamp(s.health + (plan.health || 0) * boost, 0, 100);
    s.growth += 1;
    this.countTask('bath');
    this.say(plan.say || (plan.name + '～好舒服'), 2800);
    return { ok: true, anim: plan.anim, free: payState === 'free' };
  }

  playToy(toyId) {
    const s = this.s;
    const toy = TOYS.filter(function (t) { return t.id === toyId; })[0];
    if (!toy) return { ok: false, msg: '没有这个玩具' };
    const err = this.guard();
    if (err) return { ok: false, msg: err };
    if (s.sick && s.health <= 30) return { ok: false, msg: '病得没力气玩（健康超过 30 才行）' };
    const payState = this.pay(toy.price);
    if (!payState) return { ok: false, msg: '金币不够，去打工赚点吧' };

    s.mood = clamp(s.mood + toy.mood * (1 + this.perks().effect), 0, 100);
    s.clean = clamp(s.clean - 2, 0, 100);
    this.countTask('play');
    s.activity = 'play';
    s.busyTotal = toy.seconds * 1000;
    s.busyUntil = Date.now() + s.busyTotal;
    this.say(pickLine([toy.name + '！', '玩' + toy.name + '咯～', '这个我最喜欢了！']), 2600);
    return { ok: true, toy: toy.id, anim: toy.anim, free: payState === 'free' };
  }

  play() {
    return this.playToy('toss');
  }

  cureHealth(before) {
    if (before > 80) return before;
    let h = before + 20;
    if (h < 40) h = 40;
    if (h > 80) h = 80;
    return h;
  }

  perks() {
    const s = this.s;
    const lv = s.level || 1;
    const n = function (id) {
      return (s.specs || []).filter(function (x) { return x === id; }).length;
    };
    return {
      // 每项来源独立封顶，再相加
      workTime: Math.min(0.10, 0.0015 * (lv - 1)) + Math.min(0.18, 0.03 * n('diligent')),
      workStamina: Math.min(0.30, 0.05 * n('diligent')),
      studyExp: Math.min(0.18, 0.03 * n('scholar')),
      studyTime: Math.min(0.18, 0.03 * n('scholar')),
      tuition: 0,
      decay: Math.min(0.10, 0.002 * (lv - 1)) + Math.min(0.09, 0.015 * n('health')),
      sleepStamina: Math.min(0.15, 0.003 * (lv - 1)) + Math.min(0.18, 0.03 * n('health')),
      illness: Math.min(0.20, 0.003 * (lv - 1)) + Math.min(0.18, 0.03 * n('health')),
      effect: Math.min(0.10, 0.002 * (lv - 1)),
      visitPoll: Math.min(0.30, 0.05 * n('social')),
      friends: Math.min(6, n('social')),
      bonusChance: Math.min(0.12, 0.02 * n('lucky')),
      cureCost: Math.min(0.30, 0.05 * n('lucky')),
      reviveCost: Math.min(0.30, 0.05 * n('lucky')),
    };
  }

  specSlots() {
    return Math.floor((this.s.level || 1) / 5);
  }

  specLeft() {
    return Math.max(0, this.specSlots() - (this.s.specs || []).length);
  }

  pickSpec(id) {
    const spec = SPECS.filter(function (x) { return x.id === id; })[0];
    if (!spec) return { ok: false, msg: '没有这个专精' };
    if (this.specLeft() <= 0) return { ok: false, msg: '现在没有可选的专精' };
    this.s.specs.push(id);
    this.say('我选了「' + spec.name + '」专精！', 3600);
    return { ok: true };
  }

  maybeAbsent(gapMs) {
    const s = this.s;
    if (!(gapMs > 2 * 3600 * 1000)) return false;
    if (!s.alive) return false;
    if (s.away && s.away.active) return false;
    s.absent = true;
    return true;
  }

  setNotifyLow(v) {
    this.s.notifyLow = !!v;
    return { ok: true, notifyLow: this.s.notifyLow };
  }

  startWorkRepeat(jobId, count) {
    const n = Math.max(1, Math.min(5, Math.round(Number(count) || 1)));
    const r = this.workAt(jobId);
    if (!r.ok) return r;
    this.s.repeat = n > 1 ? { kind: 'work', jobId: jobId, left: n - 1 } : null;
    return { ok: true };
  }

  startStudyRepeat(stage, cat, idx, count) {
    const n = Math.max(1, Math.min(5, Math.round(Number(count) || 1)));
    const r = this.enroll(stage, cat, idx);
    if (!r.ok) return r;
    this.s.repeat = n > 1 ? { kind: 'study', stage: stage, cat: cat, idx: idx, left: n - 1 } : null;
    return { ok: true };
  }

  activate() {
    if (!this.s.absent) return false;
    this.s.absent = false;
    this.say('我回来啦！', 3000);
    return true;
  }

  ensureDaily() {
    const day = this.todayKey();
    const d = this.s.daily;
    if (d && d.day === day && Array.isArray(d.tasks) && d.tasks.length) return d;
    const used = {};
    const tasks = [];
    while (tasks.length < 3) {
      const t = DAILY_POOL[Math.floor(Math.random() * DAILY_POOL.length)];
      if (used[t.id]) continue;
      used[t.id] = 1;
      tasks.push({ id: t.id, label: t.label, target: t.target, done: 0 });
    }
    this.s.daily = { day: day, tasks: tasks, claimed: false };
    return this.s.daily;
  }

  countTask(id) {
    const d = this.ensureDaily();
    const t = d.tasks.filter(function (x) { return x.id === id; })[0];
    if (!t || t.done >= t.target) return;
    t.done += 1;
    if (!d.claimed && d.tasks.every(function (x) { return x.done >= x.target; })) this.claimDaily();
  }

  dailySummary() {
    const d = this.ensureDaily();
    const total = d.tasks.length;
    let doneCount = 0;
    d.tasks.forEach(function (t) { if (t.done >= t.target) doneCount += 1; });
    return {
      day: d.day,
      tasks: d.tasks,
      claimed: d.claimed,
      total: total,
      doneCount: doneCount,
      canClaim: doneCount >= total && !d.claimed,
    };
  }

  claimDaily() {
    const d = this.ensureDaily();
    if (d.claimed) return { ok: false, msg: '今天的奖励已经领过了' };
    const all = d.tasks.every(function (t) { return t.done >= t.target; });
    if (!all) return { ok: false, msg: '还有任务没完成' };
    d.claimed = true;
    this.s.money += 30;
    this.s.mood = clamp(this.s.mood + 10, 0, 100);
    this.s.growth += 10;
    this.say('每日任务全完成！奖励 30 金币～', 4200);
    return { ok: true };
  }

  maybeEvent() {
    const s = this.s;
    const now = Date.now();
    if (!s.nextEventAt) {
      s.nextEventAt = now + (30 + Math.round(Math.random() * 30)) * 60000;
      return;
    }
    if (now < s.nextEventAt) return;
    s.nextEventAt = now + (30 + Math.round(Math.random() * 30)) * 60000;
    if (!s.alive || s.activity === 'sleep') return;
    const ev = PET_EVENTS[Math.floor(Math.random() * PET_EVENTS.length)];
    s.money = Math.max(0, s.money + (ev.money || 0));
    s.hunger = clamp(s.hunger + (ev.hunger || 0), 0, 100);
    s.clean = clamp(s.clean + (ev.clean || 0), 0, 100);
    s.mood = clamp(s.mood + (ev.mood || 0), 0, 100);
    this.say(ev.text, 3600);
  }

  todayKey() {
    const d = new Date();
    return d.getFullYear() + '-' + (d.getMonth() + 1) + '-' + d.getDate();
  }

  freeQuota() {
    const lv = this.s.level || 1;
    return lv >= 30 ? 3 : lv >= 20 ? 2 : lv >= 10 ? 1 : 0;
  }

  freeLeft() {
    const fb = this.s.freeBuy || { day: '', used: 0 };
    if (fb.day !== this.todayKey()) return this.freeQuota();
    return Math.max(0, this.freeQuota() - (fb.used || 0));
  }

  useFree() {
    const day = this.todayKey();
    if (!this.s.freeBuy || this.s.freeBuy.day !== day) this.s.freeBuy = { day: day, used: 0 };
    this.s.freeBuy.used += 1;
  }

  // 'free' | 'paid' | ''
  pay(price) {
    const p = Math.max(0, Math.round(price));
    if (p === 0) return 'paid';
    if (this.freeLeft() > 0) {
      this.useFree();
      return 'free';
    }
    if (this.s.money < p) return '';
    this.s.money -= p;
    return 'paid';
  }

  tuition(st) {
    return Math.max(1, Math.round(st.cost * (1 - this.perks().tuition)));
  }

  masteryNeed(job) {
    const list = [5, 8, 12, 16, 20];
    const idx = Math.max(0, Math.min(list.length - 1, (job.tier || 1) - 1));
    return list[idx];
  }

  rates() {
    const s = this.s;
    const p = this.perks();
    const sleeping = s.activity === 'sleep';
    const working = s.activity === 'work' || s.activity === 'study';
    const slow = sleeping ? 0.45 : 1;
    const hunger = -CFG.hungerPerMin * slow * (1 - p.decay) * 60;
    const clean = -CFG.cleanPerMin * slow * (1 - p.decay) * 60;
    let moodPerMin;
    if (sleeping) {
      moodPerMin = 0.5;
    } else {
      let dm = 0;
      if (s.hunger < 50) dm -= 0.12 * (1 - p.decay);
      if (s.clean < 50) dm -= 0.12 * (1 - p.decay);
      if (s.hunger > 60 && s.clean > 60) dm += 0.05;
      if (working) dm -= 0.08;
      if (s.sick) dm -= 0.6;
      moodPerMin = dm;
    }
    const staminaPerMin = sleeping ? 6 * (1 + p.sleepStamina) : s.activity === 'study' ? 0.4 : s.activity === 'work' ? 0 : 1.5;
    let dh = 0;
    if (s.hunger < 25) dh -= 0.10;
    if (s.clean < 25) dh -= 0.08;
    if (s.mood < 25) dh -= 0.06;
    if (s.hunger >= 50 && s.clean >= 50 && s.mood >= 50 && s.activity !== 'work') dh += 0.08;
    if (s.sick) dh += sleeping ? 0.05 : (working ? -0.22 : -0.15);

    const moodLabel = sleeping ? '睡觉中' : (working ? (s.activity === 'work' ? '打工中' : '上课中')
      : (s.sick ? '生病中' : (s.hunger > 60 && s.clean > 60 ? '心情不错' : (s.mood < 25 ? '有点低落' : '平稳'))));
    const healthLabel = s.sick ? (sleeping ? '生病中（睡觉）' : (working ? '生病中（硬撑）' : '生病中'))
      : (dh > 0 ? '康复中' : '平稳');
    return {
      hunger: { label: sleeping ? '睡觉中' : '正常消耗', rate: hunger },
      clean: { label: sleeping ? '睡觉中' : '正常消耗', rate: clean },
      mood: { label: moodLabel, rate: moodPerMin * 60 },
      stamina: { label: sleeping ? '睡觉中' : (s.activity === 'study' ? '上课中' : (s.activity === 'work' ? '打工中（不恢复）' : '恢复中')), rate: staminaPerMin * 60 },
      health: { label: healthLabel, rate: dh * 60 },
    };
  }

  jobMastery(job) {
    const need = this.masteryNeed(job);
    const raw = (this.s.prof && this.s.prof[job.id]) || 0;
    const prof = Math.min(need, raw);
    const mastered = prof >= need;
    return { prof: prof, need: need, mastered: mastered, reduction: mastered ? 0.10 : 0 };
  }

  jobStamina(job) {
    const raw = (job.stamina || 0) * 1.5;
    const base = Math.floor(raw / 10) * 10;
    const cands = [base, base + 2, base + 5, base + 10];
    let best = cands[0];
    cands.forEach(function (v) {
      const d = Math.abs(v - raw);
      if (d < Math.abs(best - raw) || (d === Math.abs(best - raw) && v > best)) best = v;
    });
    return best;
  }

  jobMinutes(job) {
    const base = job.min || WORK_MIN;
    const m = this.jobMastery(job);
    const factor = (1 - this.perks().workTime) * (m.mastered ? 0.9 : 1);
    return Math.max(1, Math.round(base * factor));
  }

  jobPay(job) {
    const s = this.s;
    const attr = s.attrs[job.attr] || 0;
    const attrBonus = Math.min(0.08, (attr / 15) * 0.01);
    return Math.round(job.pay * (1 + attrBonus));
  }

  cureCost(ill) {
    const base = (ill && ill.base) || 30;
    const raw = base + Math.round(Math.max(0, 100 - this.s.health) * 0.6);
    return Math.max(1, Math.round(raw * (1 - this.perks().cureCost)));
  }

  cure(illId) {
    const s = this.s;
    if (!s.alive) return { ok: false, msg: '我已经离开了' };
    if (s.debt > 0) return { ok: false, msg: '先还清欠款才能再看病' };
    if (!s.sick || !s.illness) return { ok: false, msg: '我没生病呀' };
    if (illId && illId !== s.illness) return { ok: false, msg: '得的不是这个病' };
    if (this.busy()) return { ok: false, msg: '我正在' + (ACT_LABEL[s.activity] || '忙') + '，先看完病吧' };

    const ill = ILLNESSES[s.illness];
    const cost = this.cureCost(ill);
    if (this.freeLeft() === 0 && s.money < cost) {
      // 可以欠一次诊费：先治病，下次看病前必须先还
      s.debt = cost;
      s.sick = false;
      s.illness = null;
      s.healthZero = 0;
      s.health = this.cureHealth(s.health);
      s.mood = clamp(s.mood + 2, 0, 100);
      this.say(pickLine(['先欠着 ' + cost + ' 金币，病治好啦…', '医生先给我看了，欠 ' + cost + ' 金币…']), 4200);
      return { ok: true, debt: cost };
    }

    const payState = this.pay(cost);
    if (!payState) {
      // fit fallback (shouldn't happen: debt path above)
      return { ok: false, msg: '金币不够' };
    }
    s.sick = false;
    s.illness = null;
    s.healthZero = 0;
    s.health = this.cureHealth(s.health);
    s.mood = clamp(s.mood + 6, 0, 100);
    this.say(pickLine([ill.name + '治好啦，花了 ' + cost + ' 金币', '病好啦！谢谢主人花 ' + cost + ' 金币']), 3200);
    return { ok: true, cost: cost, free: payState === 'free' };
  }

  repayDebt() {
    const s = this.s;
    if (!s.debt || s.debt <= 0) return { ok: false, msg: '没有欠款' };
    if (s.money < s.debt) return { ok: false, msg: '还差 ' + Math.ceil(s.debt - s.money) + ' 金币' };
    const paid = s.debt;
    s.money -= paid;
    s.debt = 0;
    this.say(pickLine(['欠的 ' + paid + ' 金币还清啦', '还完啦，无债一身轻～']), 3200);
    return { ok: true, paid: paid };
  }
  toggleSleep() {
    const s = this.s;
    if (!s.alive) return { ok: false, msg: '我已经离开了' };

    if (s.activity === 'sleep') {
      s.activity = 'idle';
      this.say(pickLine(['睡醒啦，精神多了！', '睡饱啦～', '哈啊…睡得真好']), 2600);
      return { ok: true };
    }
    if (this.busy()) return { ok: false, msg: '我正忙着呢' };

    s.activity = 'sleep';
    this.countTask('sleep');
    this.say(s.sick
      ? pickLine(['那我先睡一觉，养养病…', '睡一会儿，说不定就好了…'])
      : pickLine(['那我先睡一会儿…', '困了，眯一会儿～', '晚安…']), 2600);
    return { ok: true };
  }

  revive() {
    const s = this.s;
    if (s.alive) return { ok: false, msg: '我还活得好好的' };
    const reviveCost = Math.max(1, Math.round(ACTIONS.revive.cost * (1 - this.perks().reviveCost)));
    if (s.money < reviveCost) {
      return { ok: false, msg: '复活要 ' + reviveCost + ' 金币，还差 ' + Math.ceil(reviveCost - s.money) + '，也可以重新领养' };
    }

    s.money -= reviveCost;
    s.debt = 0;
    s.alive = true;
    s.sick = false;
    s.starving = 0;
    s.activity = 'idle';
    s.hunger = 80;
    s.clean = 80;
    s.mood = 80;
    s.stamina = 100;
    s.health = 80;
    this.say(pickLine(['我回来啦…谢谢你没放弃我', '又见到主人了，真好…']), 4200);
    return { ok: true };
  }

  /** 抛掷：按初速算体力消耗和心情收益；体力不够就扔不动 */
  canThrow(speed) {
    const s = this.s;
    if (!s.alive) return { ok: false, msg: '我已经离开了' };
    // 体力不足也能扔，只是扔完会累到 0；心情照常按速度加
    const mood = clamp(Math.round(speed / 140) + 3, 3, 16);
    return { ok: true, cost: 10, mood: mood };
  }

  applyThrow(cost, mood) {
    const s = this.s;
    s.stamina = clamp(s.stamina - cost, 0, 100);
    s.mood = clamp(s.mood + mood, 0, 100);
    this.countTask('throw');
    const lines = ['飞起来啦！', '哇——', '再扔高一点！', '好玩好玩！', '哈哈哈，再来一次！', '我要飞高高～', '接住我！'];
    this.say(lines[Math.floor(Math.random() * lines.length)], 2400);
    return { ok: true };
  }

  /** 抚摸：摸头和摸肚子反应不同 */
  pat(zone) {
    const s = this.s;
    if (!s.alive) return { ok: false };
    if (s.away && s.away.active) return { ok: false };
    if (s.absent) {
      this.activate();
      return { ok: true, woke: true };
    }
    if (s.distractUntil && Date.now() <= s.distractUntil) {
      s.distractUntil = 0;
      s.distractAt = 0;
      s.growth += 5;
      s.mood = clamp(s.mood + 2, 0, 100);
      this.countTask('pat');
      this.say('回神啦！差点错过重点…', 2600);
      return { ok: true, distract: true };
    }
    const head = zone === 'head';
    s.mood = clamp(s.mood + 1, 0, 100);
    this.countTask('pat');
    if (Math.random() < 0.45) {
      const lines = head
        ? ['别摸头啦…', '嘿嘿，痒~', '头发会乱的！', '摸头会长不高的…', '舒服…再摸一下']
        : ['咯咯咯…', '好舒服~', '再挠一下嘛', '这里这里！', '痒痒的，哈哈'];
      this.say(lines[Math.floor(Math.random() * lines.length)], 1800);
    }
    return { ok: true };
  }

  /* ---------------- 给 UI 的快照 ---------------- */

  eduSnapshot() {
    const self = this;
    return {
      label: this.eduLabel(),
      attrs: { zhi: this.s.attrs.zhi, mei: this.s.attrs.mei, wu: this.s.attrs.wu },
      stages: STAGES.map(function (st) {
        return {
          id: st.id,
          name: st.name,
          lessons: st.lessons,
          lessonMin: st.lessonMin,
          realLessonMin: Math.max(1, Math.round(st.lessonMin * (1 - self.perks().studyTime))),
          cost: st.cost,
          price: self.tuition(st),
          cats: catsOf(st.id).map(function (c) {
            return {
              id: c.id,
              name: c.name,
              done: self.doneCount(st.id, c.id),
              graduated: self.hasDiploma(st.id, c.id),
              courses: c.courses.map(function (name, idx) {
                return {
                  idx: idx,
                  name: name,
                  progress: self.progress(st.id, c.id, idx),
                  lessons: st.lessons,
                  done: self.hasCourse(st.id, c.id, idx),
                  reason: self.courseBlockReason(st.id, c.id, idx),
                };
              }),
            };
          }),
        };
      }),
    };
  }

  busySnapshot() {
    const s = this.s;
    if (s.activity !== 'work' && s.activity !== 'study' && s.activity !== 'play') return null;
    const total = s.busyTotal || 0;
    if (!total) return null;
    const left = Math.max(0, s.busyUntil - Date.now());
    return {
      kind: s.activity,
      total: total,
      left: left,
      progress: Math.max(0, Math.min(1, 1 - left / total)),
    };
  }

  jobsSnapshot() {
    const self = this;
    return JOBS.map(function (j) {
      const prof = (self.s.prof && self.s.prof[j.id]) || 0;
      return {
        id: j.id,
        name: j.name,
        pay: self.jobPay(j),
        base: j.pay,
        prof: prof,
        attr: j.attr,
        attrName: ATTR_NAMES[j.attr] || '',
        attrValue: self.s.attrs[j.attr] || 0,
        min: j.min,
        realMin: self.jobMinutes(j),
        mastery: self.jobMastery(j),
        hunger: j.hunger,
        stamina: self.jobStamina(j),
        clean: j.clean,
        req: self.reqText(j),
        available: self.jobAvailable(j) && self.s.alive && !self.busy() && (!self.s.sick || self.s.health > 50),
      };
    });
  }

  snapshot() {
    const s = this.s;
    const li = levelInfo(s.growth);
    const busy = this.busy();
    const awayActive = !!(s.away && s.away.active);

    let detail = '';
    if (s.activity === 'study' && s.pendingCourse) {
      const p = s.pendingCourse;
      const st2 = stageById(p.stage);
      const c2 = catOf(p.stage, p.cat);
      detail = (st2 ? st2.name : '') + (c2 ? c2.courses[p.idx] : '') +
        (this.progress(p.stage, p.cat, p.idx) + 1) + '/' + this.lessonsOf(p.stage);
    } else if (s.activity === 'work' && s.jobName) {
      detail = s.jobName;
    }

    return {
      name: s.name,
      hunger: s.hunger,
      clean: s.clean,
      mood: s.mood,
      stamina: s.stamina,
      health: s.health,
      chatter: s.chatter,
      offWorkAt: s.offWorkAt,
      offWorkLeft: this.offWorkLeft(),
      illness: s.sick ? (function (ill) {
        return { id: ill.id, name: ill.name, base: ill.base, cause: ill.cause, hint: ill.hint, cure: this.cureCost(ill) };
      }).call(this, ILLNESSES[s.illness] || ILLNESSES.gastro) : null,
      debt: s.debt || 0,
      specs: s.specs || [],
      specsList: SPECS,
      daily: this.dailySummary(),
      distract: !!(s.distractUntil && Date.now() <= s.distractUntil),
      rates: this.rates(),
      notifyLow: !!s.notifyLow,
      repeat: s.repeat,
      specLeft: this.specLeft(),
      specSlots: this.specSlots(),
      freeLeft: this.freeLeft(),
      freeQuota: this.freeQuota(),
      perks: this.perks(),
      money: s.money,
      level: li.lv,
      cur: li.cur,
      need: li.need,
      alive: s.alive,
      absent: !!s.absent,
      sick: s.sick,
      activity: s.activity,
      muted: s.muted,
      away: s.away,
      label: stateLabel(s),
      detail: detail,
      jobName: s.jobName || '',
      busy: this.busySnapshot(),
      edu: this.eduSnapshot(),
      jobs: this.jobsSnapshot(),
      actions: {
        foods: FOODS,
        toys: TOYS,
        bath: ACTIONS.bath,
        baths: BATHS,
        illnesses: Object.keys(ILLNESSES).map(function (k) {
          const it = ILLNESSES[k];
          return { id: it.id, name: it.name, base: it.base, hint: it.hint, cost: this.cureCost(it) };
        }, this),
        play: ACTIONS.play,
        cure: ACTIONS.cure,
        revive: { cost: Math.max(1, Math.round(ACTIONS.revive.cost * (1 - this.perks().reviveCost))) },
        sleep: ACTIONS.sleep,
        workMin: ACTIONS.workMin,
        lessonMin: ACTIONS.lessonMin,
      },
      can: {
        feed: s.alive && !awayActive,
        bath: s.alive && !awayActive,
        work: s.alive && !busy && !awayActive && (!s.sick || s.health > 50),
        study: s.alive && !busy && !awayActive && (!s.sick || s.health > 30),
        play: s.alive && !busy && !awayActive && (!s.sick || s.health > 30),
        sleep: s.alive && s.activity !== 'play' && !awayActive,
        cure: s.alive && s.sick && !busy && !awayActive,
        revive: !s.alive,
      },
    };
  }
}

module.exports = { Game, FOODS, TOYS, BATHS, ILLNESSES, CFG, CATS, STAGES, JOBS, WORK_MIN, ACTIONS, levelInfo, stateLabel };
