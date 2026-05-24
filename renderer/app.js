'use strict';

// ── State ─────────────────────────────────────────────────────────────────────

const state = {
  users: [],       // [{ userId, username, avatarUrl }]
  devices: [],     // [{ id, name }]
  // userId → deviceId
  assignments: {},
  // deviceId → userId
  reverseAssignments: {},
  // Set of deviceIds with missing-device warning
  warnings: new Set(),
  connected: false,
};

// ── DOM refs ──────────────────────────────────────────────────────────────────

const tokenInput   = document.getElementById('token-input');
const useridInput  = document.getElementById('userid-input');
const connectBtn   = document.getElementById('connect-btn');
const stopBtn      = document.getElementById('stop-btn');
const statusDot    = document.getElementById('status-dot');
const statusText   = document.getElementById('status-text');
const errorBar     = document.getElementById('error-bar');
const usersList    = document.getElementById('users-list');
const cablesList   = document.getElementById('cables-list');

// ── Debounce helper ───────────────────────────────────────────────────────────

function debounce(fn, ms) {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), ms);
  };
}

// ── IPC event listeners ───────────────────────────────────────────────────────

window.electronAPI.onConfigLoad(({ botToken, followUserId, routing }) => {
  if (botToken)    tokenInput.value   = botToken;
  if (followUserId) useridInput.value = followUserId;

  // Restore assignments from saved config
  for (const [userId, deviceId] of Object.entries(routing || {})) {
    state.assignments[userId] = deviceId;
    state.reverseAssignments[deviceId] = userId;
  }
});

window.electronAPI.onStatus(({ status, message }) => {
  statusDot.className = 'status-dot ' + status;

  if (status === 'live') {
    statusText.textContent = message ? `LIVE — ${message}` : 'LIVE';
    setConnected(true);
  } else if (status === 'connecting') {
    statusText.textContent = message || 'Connecting…';
    setConnected(false);
  } else if (status === 'waiting') {
    statusText.textContent = message || 'Waiting…';
    setConnected(true); // bot is logged in, just waiting for the user
  } else if (status === 'error') {
    statusText.textContent = message || 'Error';
    showError(message);
    setConnected(false);
  } else {
    statusText.textContent = 'Disconnected';
    setConnected(false);
    state.users = [];
    renderUsers();
  }
});

window.electronAPI.onUsersUpdate(({ users }) => {
  // Remove assignments for users who no longer exist — keep device slot just clear the user link
  state.users = users;
  renderUsers();
  renderCables(); // update cable "assigned: username" text
});

window.electronAPI.onDevices(({ devices }) => {
  state.devices = devices;
  if (devices.length === 0) {
    cablesList.innerHTML = `
      <div class="empty-state">
        No virtual cable devices found.<br>
        Install <a href="#" onclick="return false;">VB-Audio Virtual Cable</a> (CABLE Pack A–D)
        and restart the app.
      </div>`;
  } else {
    renderCables();
  }
});

window.electronAPI.onDeviceMissing(({ deviceId }) => {
  state.warnings.add(deviceId);
  renderCables();
});

// ── UI helpers ────────────────────────────────────────────────────────────────

function setConnected(yes) {
  state.connected = yes;
  connectBtn.disabled = yes;
  stopBtn.disabled = !yes;
}

function showError(msg) {
  if (!msg) return;
  errorBar.textContent = msg;
  errorBar.hidden = false;
  setTimeout(() => { errorBar.hidden = true; }, 8000);
}

function clearError() {
  errorBar.hidden = true;
}

// ── Render: user cards (left panel) ──────────────────────────────────────────

function renderUsers() {
  usersList.innerHTML = '';

  if (state.users.length === 0) {
    const msg = state.connected
      ? 'No human users in the voice channel.'
      : 'Connect the bot to see users in voice.';
    usersList.innerHTML = `<div class="empty-state">${msg}</div>`;
    return;
  }

  for (const user of state.users) {
    const card = makeUserCard(user);
    usersList.appendChild(card);
  }
}

function makeUserCard(user) {
  const card = document.createElement('div');
  card.className = 'user-card' + (state.assignments[user.userId] ? ' assigned' : '');
  card.draggable = true;
  card.dataset.userId = user.userId;

  // Avatar
  const img = document.createElement('img');
  img.className = 'avatar';
  img.alt = user.username;
  img.src = user.avatarUrl;
  img.onerror = () => {
    const initials = makeInitialsEl(user.username);
    img.replaceWith(initials);
  };

  const name = document.createElement('span');
  name.className = 'username';
  name.textContent = user.username;

  const dot = document.createElement('span');
  dot.className = 'assignment-dot';
  dot.title = state.assignments[user.userId]
    ? `Routed to ${deviceNameFor(state.assignments[user.userId])}`
    : '';

  card.appendChild(img);
  card.appendChild(name);
  card.appendChild(dot);

  // Drag events
  card.addEventListener('dragstart', (e) => {
    e.dataTransfer.setData('text/plain', user.userId);
    e.dataTransfer.effectAllowed = 'move';
    card.classList.add('dragging');
  });
  card.addEventListener('dragend', () => card.classList.remove('dragging'));

  return card;
}

function makeInitialsEl(username) {
  const el = document.createElement('div');
  el.className = 'avatar-initials';
  el.textContent = (username || '?').slice(0, 2).toUpperCase();
  return el;
}

function deviceNameFor(deviceId) {
  return state.devices.find(d => d.id === deviceId)?.name ?? deviceId;
}

// ── Render: cable cards (right panel) ────────────────────────────────────────

function renderCables() {
  if (state.devices.length === 0) return; // empty-state already set

  cablesList.innerHTML = '';

  for (const device of state.devices) {
    const card = makeCableCard(device);
    cablesList.appendChild(card);
  }
}

function makeCableCard(device) {
  const assignedUserId = state.reverseAssignments[device.id];
  const assignedUser   = state.users.find(u => u.userId === assignedUserId);
  const isWarning      = state.warnings.has(device.id);

  const card = document.createElement('div');
  card.className = [
    'cable-card',
    assignedUserId ? 'assigned' : '',
    isWarning      ? 'warning'  : '',
  ].filter(Boolean).join(' ');
  card.dataset.deviceId = device.id;

  const nameLine = document.createElement('div');
  nameLine.className = 'cable-name';
  nameLine.textContent = device.name;

  const assignedLine = document.createElement('div');
  assignedLine.className = 'cable-assigned';
  assignedLine.textContent = assignedUser ? assignedUser.username : 'unassigned';

  const clearBtn = document.createElement('button');
  clearBtn.className = 'clear-btn';
  clearBtn.textContent = '✕';
  clearBtn.title = 'Clear assignment';
  clearBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    doUnassign(device.id);
  });

  card.appendChild(nameLine);
  card.appendChild(assignedLine);
  card.appendChild(clearBtn);

  if (isWarning) {
    const badge = document.createElement('span');
    badge.className = 'warning-badge';
    badge.textContent = '⚠ Device not found — check VB-Audio installation';
    card.appendChild(badge);
  }

  // Drop target events
  card.addEventListener('dragover', (e) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    card.classList.add('drag-over');
  });
  card.addEventListener('dragleave', (e) => {
    // Only remove if actually leaving the card (not entering a child)
    if (!card.contains(e.relatedTarget)) {
      card.classList.remove('drag-over');
    }
  });
  card.addEventListener('drop', (e) => {
    e.preventDefault();
    card.classList.remove('drag-over');
    const userId = e.dataTransfer.getData('text/plain');
    if (userId) doAssign(userId, device.id);
  });

  return card;
}

// ── Assignment logic ──────────────────────────────────────────────────────────

function doAssign(userId, deviceId) {
  // Remove userId from any previous cable
  const prevDevice = state.assignments[userId];
  if (prevDevice) {
    delete state.reverseAssignments[prevDevice];
    delete state.assignments[userId];
    window.electronAPI.unassign(prevDevice);
  }

  // Remove whoever was on this cable before
  const prevUser = state.reverseAssignments[deviceId];
  if (prevUser && prevUser !== userId) {
    delete state.assignments[prevUser];
    delete state.reverseAssignments[deviceId];
    // No need to call unassign — main will overwrite the stream
  }

  state.assignments[userId] = deviceId;
  state.reverseAssignments[deviceId] = userId;
  state.warnings.delete(deviceId);

  window.electronAPI.assign(userId, deviceId);

  renderUsers();
  renderCables();
}

function doUnassign(deviceId) {
  const userId = state.reverseAssignments[deviceId];
  if (userId) {
    delete state.assignments[userId];
    delete state.reverseAssignments[deviceId];
  }
  window.electronAPI.unassign(deviceId);
  renderUsers();
  renderCables();
}

// ── Button handlers ───────────────────────────────────────────────────────────

connectBtn.addEventListener('click', () => {
  const token = tokenInput.value.trim();
  const followUserId = useridInput.value.trim();
  if (!token || !followUserId) {
    showError('Enter both a bot token and a user ID before connecting.');
    return;
  }
  clearError();
  window.electronAPI.connect(token, followUserId);
});

stopBtn.addEventListener('click', () => {
  window.electronAPI.disconnect();
  state.users = [];
  renderUsers();
});

// ── Debounced field saves ─────────────────────────────────────────────────────

const saveToken  = debounce((v) => window.electronAPI.saveField('botToken',    v), 500);
const saveUserId = debounce((v) => window.electronAPI.saveField('followUserId', v), 500);

tokenInput.addEventListener('input',  () => saveToken(tokenInput.value));
useridInput.addEventListener('input', () => saveUserId(useridInput.value));

// Also save on blur for immediate persistence when the user tabs away
tokenInput.addEventListener('blur',  () => window.electronAPI.saveField('botToken',    tokenInput.value));
useridInput.addEventListener('blur', () => window.electronAPI.saveField('followUserId', useridInput.value));
