'use strict';

const { contextBridge, ipcRenderer } = require('electron');

function sub(channel, cb) {
  return ipcRenderer.on(channel, function (_e, payload) { cb(payload); });
}

contextBridge.exposeInMainWorld('qqpet', {
  ready: function () { ipcRenderer.send('pet:ready'); },
  onState: function (cb) { sub('state', cb); },
  onMotion: function (cb) { sub('motion', cb); },
  onSay: function (cb) { sub('say', cb); },
  onEffect: function (cb) { sub('effect', cb); },
  onBubbleClear: function (cb) { sub('bubble-clear', cb); },
  dragStart: function (x, y) { ipcRenderer.send('pet:drag-start', { x: x, y: y }); },
  dragMove: function (x, y) { ipcRenderer.send('pet:drag-move', { x: x, y: y }); },
  dragEnd: function (allowThrow) { ipcRenderer.send('pet:drag-end', !!allowThrow); },
  pat: function (zone) { ipcRenderer.send('pet:pat', zone); },
  animLog: function (msg) { ipcRenderer.send('anim-log', String(msg)); },
  onResume: function (cb) {
    ipcRenderer.on('pet:resume', function () { cb(); });
  },
  onScale: function (cb) {
    ipcRenderer.on('pet:scale', function (_e, s) { cb(s); });
  },
  menu: function (x, y) { ipcRenderer.send('pet:menu', { x: x, y: y }); },
  openPanel: function () { ipcRenderer.send('pet:panel'); },
});
