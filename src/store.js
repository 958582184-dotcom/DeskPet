'use strict';

const fs = require('node:fs');
const path = require('node:path');

/** 存档：userData/save.json，先写临时文件再 rename，避免半截文件 */
function savePath(dir) {
  return path.join(dir, 'save.json');
}

function load(dir) {
  try {
    const raw = fs.readFileSync(savePath(dir), 'utf8');
    const data = JSON.parse(raw);
    return data && data.started ? data : null;
  } catch (e) {
    return null;
  }
}

function save(dir, state) {
  try {
    fs.mkdirSync(dir, { recursive: true });
    const target = savePath(dir);
    const tmp = target + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(state), 'utf8');
    fs.renameSync(tmp, target);
    return true;
  } catch (e) {
    console.error('[qqpet] 存档失败：', e && e.message ? e.message : e);
    return false;
  }
}

module.exports = { load, save, savePath };
