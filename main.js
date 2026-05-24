'use strict';

const { app, BrowserWindow, ipcMain, Tray, Menu, nativeImage } = require('electron');
const path = require('path');
const bot = require('./bot');
const audioRouter = require('./audioRouter');

let store = null;
let win = null;
let tray = null;

// Generate a small colored circle as a raw RGBA buffer — no icon files needed for tray
function makeCircleIcon(r, g, b) {
  const size = 16;
  const buf = Buffer.alloc(size * size * 4, 0);
  const cx = 7.5, cy = 7.5, radius = 5.5;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const d = Math.sqrt((x - cx) ** 2 + (y - cy) ** 2);
      if (d <= radius) {
        const i = (y * size + x) * 4;
        buf[i] = r; buf[i + 1] = g; buf[i + 2] = b; buf[i + 3] = 255;
      }
    }
  }
  return nativeImage.createFromBuffer(buf, { width: size, height: size });
}

const iconGrey = makeCircleIcon(120, 120, 120);
const iconGreen = makeCircleIcon(35, 165, 90);

function send(channel, data) {
  if (win && !win.isDestroyed()) {
    win.webContents.send(channel, data);
  }
}

function createWindow() {
  win = new BrowserWindow({
    width: 900,
    height: 620,
    minWidth: 700,
    minHeight: 480,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js'),
    },
    title: 'Discord Audio Splitter',
    backgroundColor: '#1e1f22',
    show: false,
    autoHideMenuBar: true,
  });

  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));

  win.once('ready-to-show', () => {
    win.show();
    send('config:load', {
      botToken: store.get('botToken', ''),
      followUserId: store.get('followUserId', ''),
      routing: store.get('routing', {}),
    });
    refreshDevices();
  });

  win.on('minimize', (e) => {
    e.preventDefault();
    win.hide();
  });

  win.on('close', (e) => {
    if (!app.isQuitting) {
      e.preventDefault();
      win.hide();
    }
  });
}

function refreshDevices() {
  let devices = [];
  try {
    devices = audioRouter.getDevices();
  } catch (err) {
    console.error('Device enumeration failed:', err.message);
  }
  send('audio:devices', { devices });
}

function createTray() {
  tray = new Tray(iconGrey);
  tray.setToolTip('Discord Audio Splitter');
  tray.on('click', () => { if (win) win.show(); });
  setTrayState(false);
}

function setTrayState(connected) {
  if (!tray) return;
  tray.setImage(connected ? iconGreen : iconGrey);
  const menu = Menu.buildFromTemplate([
    { label: 'Open', click: () => win && win.show() },
    { label: 'Disconnect', enabled: connected, click: () => bot.disconnect() },
    { type: 'separator' },
    {
      label: 'Quit', click: () => {
        app.isQuitting = true;
        app.quit();
      },
    },
  ]);
  tray.setContextMenu(menu);
}

// Forward bot events to renderer
bot.events.on('status', (payload) => {
  const connected = payload.status === 'live' || payload.status === 'waiting';
  setTrayState(connected);
  send('bot:status', payload);
});

bot.events.on('usersUpdate', (payload) => {
  send('bot:users-update', payload);
});

bot.events.on('deviceMissing', (payload) => {
  send('audio:device-missing', payload);
});

// IPC: connect / disconnect
ipcMain.on('bot:connect', (_, { token, followUserId }) => {
  // Token is stored as plaintext — treat config.json like a password file; never logged here
  store.set('botToken', token);
  store.set('followUserId', followUserId);
  const savedRouting = store.get('routing', {});
  bot.connect(token, followUserId, savedRouting);
});

ipcMain.on('bot:disconnect', () => bot.disconnect());

// IPC: routing
ipcMain.on('routing:assign', (_, { userId, deviceId }) => {
  try {
    audioRouter.assign(userId, deviceId);
    const routing = store.get('routing', {});
    // Clean stale entries for this userId or deviceId before writing new assignment
    for (const [uid, did] of Object.entries(routing)) {
      if (uid === userId || did === deviceId) delete routing[uid];
    }
    routing[userId] = deviceId;
    store.set('routing', routing);
  } catch (err) {
    if (err.code === 'DEVICE_MISSING') {
      send('audio:device-missing', { deviceId });
    } else {
      console.error('routing:assign error:', err.message);
    }
  }
});

ipcMain.on('routing:unassign', (_, { deviceId }) => {
  const removedUserId = audioRouter.unassign(deviceId);
  if (removedUserId) {
    const routing = store.get('routing', {});
    delete routing[removedUserId];
    store.set('routing', routing);
  }
});

// IPC: debounced field saves from renderer inputs
ipcMain.on('config:save-field', (_, { key, value }) => {
  if (key === 'botToken' || key === 'followUserId') {
    store.set(key, value);
  }
});

app.whenReady().then(() => {
  const Store = require('electron-store');
  store = new Store({ name: 'config' });
  createWindow();
  createTray();
});

// Keep the process alive in tray even after all windows close
app.on('window-all-closed', (e) => e.preventDefault());

app.on('before-quit', () => {
  audioRouter.closeAll();
  bot.disconnect();
});
