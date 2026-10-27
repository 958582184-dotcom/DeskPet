'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('qqpetAdopt', {
  submit: function (data) { return ipcRenderer.invoke('adopt:submit', data); },
  cancel: function () { ipcRenderer.send('adopt:cancel'); },
});
