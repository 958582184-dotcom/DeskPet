'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('qqpetPanel', {
  onState: function (cb) { ipcRenderer.on('state', function (_e, s) { cb(s); }); },
  onOpenSheet: function (cb) { ipcRenderer.on('open-sheet', function (_e, kind) { cb(kind); }); },
  get: function () { return ipcRenderer.invoke('panel:get'); },
  act: function (name) { return ipcRenderer.invoke('panel:act', name); },
  hide: function () { ipcRenderer.send('panel:hide'); },
  restart: function () { ipcRenderer.send('panel:restart'); },
  cmd: function (name) { ipcRenderer.send('panel:cmd', name); },
  chatter: function (payload) { ipcRenderer.send('panel:chatter', payload); },
  offWork: function (value) { ipcRenderer.send('panel:offwork', value); },
  exportSave: function () { return ipcRenderer.invoke('save:export'); },
  importSave: function () { return ipcRenderer.invoke('save:import'); },
  visitStatus: function () { return ipcRenderer.invoke('visit:status'); },
  visitHost: function (payload) { return ipcRenderer.invoke('visit:host', payload); },
  visitCode: function () { return ipcRenderer.invoke('visit:code'); },
  visitSend: function (payload) { return ipcRenderer.invoke('visit:send', payload); },
  visitCall: function () { return ipcRenderer.invoke('visit:call'); },
  visitProbe: function (address) { return ipcRenderer.invoke('visit:probe', address); },
  visitOffer: function (payload) { return ipcRenderer.invoke('visit:offer', payload); },
  visitPull: function (payload) { return ipcRenderer.invoke('visit:pull', payload); },
  visitStopPull: function () { return ipcRenderer.invoke('visit:stopPull'); },
  visitAnswer: function (payload) { return ipcRenderer.invoke('visit:answer', payload); },
  visitFriendRemove: function (address) { return ipcRenderer.invoke('visit:friendRemove', address); },
  visitGuestHome: function () { ipcRenderer.send('visit:guestHome'); },
  visitCopy: function (text) { ipcRenderer.send('visit:copy', text); },
  onVisitToast: function (cb) { ipcRenderer.on('visit:toast', function (_e, t) { cb(t); }); },
  onVisitRefresh: function (cb) { ipcRenderer.on('visit:refresh', function () { cb(); }); },
  quit: function () { ipcRenderer.send('panel:quit'); },
});
