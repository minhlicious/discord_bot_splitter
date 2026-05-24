'use strict';

const naudiodon = require('naudiodon');

// deviceId -> { stream: AudioIO, userId: string }
const activeStreams = new Map();
// userId -> deviceId
const userToDevice = new Map();

function getDevices() {
  const all = naudiodon.getDevices();
  return all
    .filter(d => d.maxOutputChannels > 0)
    .filter(d => d.name.includes('CABLE') || d.name.toLowerCase().includes('virtual'))
    .map(d => ({ id: d.id, name: d.name }));
}

function _closeStream(deviceId) {
  const entry = activeStreams.get(deviceId);
  if (!entry) return;
  try { entry.stream.quit(); } catch {}
  userToDevice.delete(entry.userId);
  activeStreams.delete(deviceId);
}

function assign(userId, deviceId) {
  const allDevices = naudiodon.getDevices();
  if (!allDevices.find(d => d.id === deviceId)) {
    const err = new Error(`Audio device ${deviceId} not found`);
    err.code = 'DEVICE_MISSING';
    throw err;
  }

  // Close any existing stream on this device
  _closeStream(deviceId);

  // Remove userId from any previous device
  if (userToDevice.has(userId)) {
    _closeStream(userToDevice.get(userId));
  }

  const stream = new naudiodon.AudioIO({
    outOptions: {
      channelCount: 2,
      sampleFormat: naudiodon.SampleFormat16Bit,
      sampleRate: 48000,
      deviceId,
      closeOnError: false,
    },
  });

  stream.on('error', (err) => {
    console.error(`Audio stream error on device ${deviceId}:`, err.message);
  });

  stream.start();
  activeStreams.set(deviceId, { stream, userId });
  userToDevice.set(userId, deviceId);
}

// Returns the userId that was unassigned, or null
function unassign(deviceId) {
  const entry = activeStreams.get(deviceId);
  const userId = entry ? entry.userId : null;
  _closeStream(deviceId);
  return userId;
}

function write(userId, pcmBuffer) {
  const deviceId = userToDevice.get(userId);
  if (!deviceId) return;
  const entry = activeStreams.get(deviceId);
  if (!entry) return;
  try {
    entry.stream.write(pcmBuffer);
  } catch {
    // Drop frame on backpressure or stream error — real-time audio, no buffering
  }
}

function closeAll() {
  for (const deviceId of [...activeStreams.keys()]) {
    _closeStream(deviceId);
  }
}

module.exports = { getDevices, assign, unassign, write, closeAll };
