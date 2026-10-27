'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('qqpetMenu', {
  get: function () { return ipcRenderer.invoke('menu:get'); },
  act: function (name) { ipcRenderer.send('menu:act', name); },
  hide: function () { ipcRenderer.send('menu:hide'); },
  onRefresh: function (cb) {
    ipcRenderer.on('menu:refresh', function () { cb(); });
  },
});
