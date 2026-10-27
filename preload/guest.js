'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('qqpetGuest', {
  onState: function (cb) {
    ipcRenderer.on('guest:state', function (_e, s) { cb(s); });
  },
  onPlay: function (cb) {
    ipcRenderer.on('guest:play', function (_e, name) { cb(name); });
  },
  onMotion: function (cb) {
    ipcRenderer.on('guest:motion', function (_e, m) { cb(m); });
  },
  onBubble: function (cb) {
    ipcRenderer.on('guest:bubble', function (_e, text) { cb(text); });
  },
  ready: function () { ipcRenderer.send('visit:guestReady'); },
  menu: function () { ipcRenderer.send('visit:menu'); },
  pat: function () { ipcRenderer.send('visit:guestPat'); },
});
