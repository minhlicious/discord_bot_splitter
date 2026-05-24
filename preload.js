'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  connect: (token, followUserId) =>
    ipcRenderer.send('bot:connect', { token, followUserId }),

  disconnect: () =>
    ipcRenderer.send('bot:disconnect'),

  assign: (userId, deviceId) =>
    ipcRenderer.send('routing:assign', { userId, deviceId }),

  unassign: (deviceId) =>
    ipcRenderer.send('routing:unassign', { deviceId }),

  saveField: (key, value) =>
    ipcRenderer.send('config:save-field', { key, value }),

  onStatus: (cb) => {
    const handler = (_, data) => cb(data);
    ipcRenderer.on('bot:status', handler);
    return () => ipcRenderer.removeListener('bot:status', handler);
  },

  onUsersUpdate: (cb) => {
    const handler = (_, data) => cb(data);
    ipcRenderer.on('bot:users-update', handler);
    return () => ipcRenderer.removeListener('bot:users-update', handler);
  },

  onDevices: (cb) => {
    const handler = (_, data) => cb(data);
    ipcRenderer.on('audio:devices', handler);
    return () => ipcRenderer.removeListener('audio:devices', handler);
  },

  onConfigLoad: (cb) => {
    const handler = (_, data) => cb(data);
    ipcRenderer.on('config:load', handler);
    return () => ipcRenderer.removeListener('config:load', handler);
  },

  onDeviceMissing: (cb) => {
    const handler = (_, data) => cb(data);
    ipcRenderer.on('audio:device-missing', handler);
    return () => ipcRenderer.removeListener('audio:device-missing', handler);
  },
});
