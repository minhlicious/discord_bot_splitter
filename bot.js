'use strict';

const { Client, GatewayIntentBits } = require('discord.js');
const {
  joinVoiceChannel,
  entersState,
  VoiceConnectionStatus,
  EndBehaviorType,
} = require('@discordjs/voice');
const { EventEmitter } = require('events');
const audioRouter = require('./audioRouter');

// Try native Opus first, fall back to pure-JS opusscript
let OpusDecoder;
try {
  OpusDecoder = require('@discordjs/opus').OpusEncoder;
} catch {
  OpusDecoder = null;
}
const OpusScript = require('opusscript');

const events = new EventEmitter();

let client = null;
let connection = null;
let receiver = null;
let _followUserId = null;
let _currentChannel = null;
let _savedRouting = {};
let _targetUsername = null;

// userId -> { username, avatarUrl }
const channelUsers = new Map();
// userId -> OpusScript decoder instance
const decoders = new Map();
// Set of userIds currently subscribed to an audio stream
const subscribed = new Set();

let destroyed = false;
let reconnectTimer = null;
let reconnectDelay = 1000;

function getDecoder(userId) {
  if (!decoders.has(userId)) {
    decoders.set(userId, new OpusScript(48000, 2, OpusScript.Application.AUDIO));
  }
  return decoders.get(userId);
}

function emitStatus(status, message = '') {
  events.emit('status', { status, message, userCount: channelUsers.size });
}

function emitUsers() {
  const users = Array.from(channelUsers.entries()).map(([userId, info]) => ({
    userId,
    username: info.username,
    avatarUrl: info.avatarUrl,
  }));
  events.emit('usersUpdate', { users });
}

function applyRoutingForUser(userId) {
  const deviceId = _savedRouting[userId];
  if (!deviceId) return;
  try {
    audioRouter.assign(userId, deviceId);
  } catch (err) {
    if (err.code === 'DEVICE_MISSING') {
      events.emit('deviceMissing', { deviceId });
    }
  }
}

function addUserToChannel(member) {
  if (!member || member.user.bot || member.id === client?.user?.id) return;
  const avatarUrl = member.user.displayAvatarURL({ size: 64, extension: 'png', forceStatic: true });
  channelUsers.set(member.id, { username: member.user.username, avatarUrl });
  applyRoutingForUser(member.id);
}

function subscribeUser(userId) {
  if (destroyed || !receiver || !channelUsers.has(userId) || subscribed.has(userId)) return;

  let stream;
  try {
    stream = receiver.subscribe(userId, {
      end: { behavior: EndBehaviorType.AfterSilence, duration: 100 },
    });
  } catch {
    return;
  }

  subscribed.add(userId);
  const decoder = getDecoder(userId);

  stream.on('data', (packet) => {
    try {
      // 960 samples = 20ms frame at 48 kHz
      const raw = decoder.decode(packet, 960);
      audioRouter.write(userId, Buffer.from(raw.buffer, raw.byteOffset, raw.byteLength));
    } catch {
      // Ignore malformed/partial Opus packets
    }
  });

  stream.on('end', () => {
    subscribed.delete(userId);
    // Re-subscribe immediately for the next speech burst
    if (!destroyed && channelUsers.has(userId) && receiver) {
      setImmediate(() => subscribeUser(userId));
    }
  });

  stream.on('error', () => {
    subscribed.delete(userId);
  });
}

async function joinChannel(channel) {
  _currentChannel = channel;
  channelUsers.clear();
  subscribed.clear();

  if (connection) {
    try { connection.destroy(); } catch {}
    connection = null;
    receiver = null;
  }

  connection = joinVoiceChannel({
    channelId: channel.id,
    guildId: channel.guild.id,
    adapterCreator: channel.guild.voiceAdapterCreator,
    selfDeaf: false,
    selfMute: true,
  });

  connection.on(VoiceConnectionStatus.Disconnected, async () => {
    if (destroyed) return;
    try {
      await Promise.race([
        entersState(connection, VoiceConnectionStatus.Signalling, 5_000),
        entersState(connection, VoiceConnectionStatus.Connecting, 5_000),
      ]);
    } catch {
      if (connection) {
        try { connection.destroy(); } catch {}
        connection = null;
        receiver = null;
      }
      if (!destroyed) {
        emitStatus('disconnected', 'Voice disconnected — reconnecting...');
        scheduleReconnect();
      }
    }
  });

  connection.on(VoiceConnectionStatus.Destroyed, () => {
    connection = null;
    receiver = null;
  });

  receiver = connection.receiver;

  for (const [, member] of channel.members) {
    addUserToChannel(member);
  }

  for (const userId of channelUsers.keys()) {
    subscribeUser(userId);
  }

  emitUsers();
  emitStatus('live', channel.name);
}

function scheduleReconnect() {
  if (destroyed || reconnectTimer) return;
  const delay = reconnectDelay;
  reconnectDelay = Math.min(reconnectDelay * 2, 30_000);

  reconnectTimer = setTimeout(async () => {
    reconnectTimer = null;
    if (destroyed || !client) return;

    try {
      for (const guild of client.guilds.cache.values()) {
        const member = await guild.members.fetch(_followUserId).catch(() => null);
        if (member?.voice?.channel) {
          reconnectDelay = 1000;
          await joinChannel(member.voice.channel);
          return;
        }
      }
      emitStatus('waiting', `Waiting for ${_targetUsername || 'user'} to join a channel...`);
    } catch {
      scheduleReconnect();
    }
  }, delay);
}

async function connect(token, followUserId, savedRouting) {
  await disconnect();
  destroyed = false;
  _followUserId = followUserId;
  _savedRouting = savedRouting || {};
  reconnectDelay = 1000;

  client = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildVoiceStates,
      GatewayIntentBits.GuildMembers,
    ],
  });

  client.on('ready', async () => {
    reconnectDelay = 1000;
    emitStatus('connecting', 'Looking for user...');

    let targetChannel = null;
    for (const guild of client.guilds.cache.values()) {
      try {
        const member = await guild.members.fetch(followUserId).catch(() => null);
        if (!member) continue;
        _targetUsername = member.user.username;
        if (member.voice?.channel) {
          targetChannel = member.voice.channel;
          break;
        }
      } catch {}
    }

    if (targetChannel) {
      await joinChannel(targetChannel);
    } else {
      emitStatus('waiting', `Waiting for ${_targetUsername || followUserId} to join a voice channel...`);
    }
  });

  client.on('voiceStateUpdate', async (oldState, newState) => {
    const userId = newState.member?.id ?? oldState.member?.id;
    if (!userId) return;

    if (userId === _followUserId) {
      if (!newState.channelId) {
        // Target left voice entirely
        _currentChannel = null;
        channelUsers.clear();
        subscribed.clear();
        if (connection) { try { connection.destroy(); } catch {} connection = null; receiver = null; }
        emitUsers();
        emitStatus('waiting', `Waiting for ${_targetUsername || 'user'} to join a voice channel...`);
      } else if (newState.channelId !== _currentChannel?.id) {
        // Target moved to a different channel — follow
        if (newState.channel) await joinChannel(newState.channel);
      }
      return;
    }

    if (!_currentChannel) return;

    const joinedOurChannel = newState.channelId === _currentChannel.id;
    const leftOurChannel =
      oldState.channelId === _currentChannel.id &&
      newState.channelId !== _currentChannel.id;

    if (joinedOurChannel && newState.member && !newState.member.user.bot) {
      addUserToChannel(newState.member);
      subscribeUser(userId);
      emitUsers();
      emitStatus('live', _currentChannel.name);
    } else if (leftOurChannel) {
      channelUsers.delete(userId);
      subscribed.delete(userId);
      emitUsers();
      emitStatus('live', _currentChannel.name);
    }
  });

  client.on('error', (err) => {
    console.error('Discord client error:', err.message);
  });

  try {
    emitStatus('connecting', 'Connecting...');
    // Token is never logged — treat config.json like a password file
    await client.login(token);
  } catch (err) {
    const msg = String(err.message || '');
    const isInvalidToken =
      msg.includes('TOKEN_INVALID') ||
      msg.includes('Disallowed') ||
      msg.includes('401') ||
      msg.includes('invalid token');
    emitStatus('error', isInvalidToken ? 'Invalid bot token — check the Discord developer portal.' : `Login failed: ${msg}`);
    client = null;
  }
}

async function disconnect() {
  destroyed = true;
  if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
  subscribed.clear();
  channelUsers.clear();
  if (connection) { try { connection.destroy(); } catch {} connection = null; receiver = null; }
  if (client) { try { await client.destroy(); } catch {} client = null; }
  _currentChannel = null;
  emitStatus('disconnected');
}

module.exports = { connect, disconnect, events };
