# Discord Per-User Audio Splitter

## Project Overview

A Windows desktop Electron app that runs a self-hosted Discord bot locally. The bot follows a specified user into their voice channel and routes each speaker's audio to a separate VB-Audio Virtual Cable output — so each person can be processed, recorded, or monitored independently in real time.

---

## Tech Stack

- **Electron** — desktop GUI wrapper
- **discord.js v14** — Discord bot + voice channel access
- **@discordjs/voice** — per-user audio stream receiving
- **sodium-native or libsodium-wrappers** — required for discord voice encryption
- **naudiodon** (or `node-speaker` + `node-portaudio`) — write PCM audio to Windows audio devices (Virtual Cables)
- **VB-Audio Virtual Cable** — creates virtual audio output devices (user installs this separately, free)

---

## Features to Build

### 1. Bot Setup & Connection
- Input field for **Bot Token**
- Input field for **Target User ID** — the bot watches this user and auto-joins whatever voice channel they're in
- If the target user moves channels, the bot follows automatically
- Bot appears in the voice channel (can be named something neutral like "AudioRouter" in the Discord dev portal)
- Connection status indicator (disconnected / connecting / live)

### 2. Speaker → Virtual Cable Routing
- Enumerate all Windows audio input devices on startup using naudiodon, filter to only show devices whose name contains "CABLE" or "Virtual" — these are the user's installed virtual cables
- Each Discord user can be assigned to any available virtual cable
- Assignments are stored and re-applied on next launch (by userId → device name)
- If a user leaves the channel, their assignment is preserved so it reapplies if they rejoin
- If a virtual cable device is no longer found on the system, show a warning badge on that cable card but don't crash

### 3. Bot Filtering
- **Auto-filter bots**: bots (Discord users with `bot: true`) are always hidden from the left panel — they never appear as assignable users
- No manual mute — routing is all-or-nothing per user

### 4. GUI Layout

**Main window — two-panel assignment interface:**

```
┌──────────────────────────────────────────────────────────────┐
│  🎙 Discord Audio Splitter                                   │
├──────────────────────────────────────────────────────────────┤
│  Bot Token   [______________________]                        │
│  Follow User ID [__________________]   [Connect]  [Stop]    │
│  Status: ● LIVE — General Voice (4 users)                   │
├───────────────────────────┬──────────────────────────────────┤
│  VOICE CHANNEL USERS      │  VIRTUAL CABLES                  │
│  (bots auto-hidden)       │                                  │
│                           │  ┌──────────────────────────┐   │
│  [Avatar] Username A  ●───┼─▶│ CABLE-A Input        [✕] │   │
│                           │  │ assigned: Username A      │   │
│  [Avatar] Username B  ●───┼─▶│ CABLE-B Input        [✕] │   │
│                           │  │ assigned: Username B      │   │
│  [Avatar] Username C      │  │ CABLE-C Input        [✕] │   │
│                           │  │ unassigned                │   │
│  [Avatar] Username D      │  │ CABLE-D Input        [✕] │   │
│                           │  │ unassigned                │   │
│                           │  └──────────────────────────┘   │
└───────────────────────────┴──────────────────────────────────┘
```

**Interaction model — drag and drop:**
- Left panel lists all non-bot users currently in the voice channel, each as a card with avatar + username
- Right panel lists all detected virtual cable devices on the system, each as a card showing device name and currently assigned user (or "unassigned")
- User drags a person card from the left panel and drops it onto a cable card on the right to assign them
- The cable card updates immediately to show the assigned username
- The [✕] button on each cable card clears that cable's assignment (stops routing, cable goes back to unassigned)
- A user can only be assigned to one cable at a time — if dragged to a second cable, the first assignment is automatically cleared
- Active assignments show a colored connector dot on the user card indicating they're routed
- Config auto-saves to `config.json` on every change and reloads on open (see Config Persistence section below)

### 5. System Tray
- App minimizes to system tray
- Tray icon shows green (connected) or grey (disconnected)
- Right-click tray menu: Open, Disconnect, Quit

---

## Audio Pipeline (How It Works)

```
Discord Voice Channel
        │
  discord.js bot (local)
        │
  @discordjs/voice — createAudioReceiver()
        │  (per-user Opus streams)
        │
  Decode Opus → PCM (48kHz, 16-bit, stereo)
        │
  naudiodon OutputStream → VB-Audio Virtual Cable device
        │
  DAW / OBS / Headphones read each cable independently
```

Key implementation notes:
- Use `receiver.subscribe(userId, { end: { behavior: EndBehaviorType.AfterSilence, duration: 100 } })` for each user
- Re-subscribe when a user starts speaking again (streams end on silence)
- PCM format: 48000 Hz sample rate, 2 channels, 16-bit signed little-endian
- naudiodon device selection: enumerate devices, match by name containing "CABLE-A", "CABLE-B", etc.
- Handle device-not-found gracefully (show warning in GUI if a cable isn't installed)

---

## File Structure

```
discord-splitter/
├── package.json
├── .npmrc               # pnpm config + security settings
├── .pnpmfile.cjs        # package age enforcement hook
├── pnpm-lock.yaml       # lockfile (commit this)
├── main.js              # Electron main process, tray, window management
├── preload.js           # contextBridge IPC exposure
├── bot.js               # discord.js bot logic, audio receiver, cable routing
├── audioRouter.js       # naudiodon device enumeration + PCM output streams
├── config.json          # persisted settings (token, user ID, slot assignments)
└── renderer/
    ├── index.html
    ├── app.js           # renderer logic, IPC calls to main
    └── styles.css
```

---

## IPC Channels (main ↔ renderer)

| Channel | Direction | Payload |
|---|---|---|
| `bot:connect` | renderer → main | `{ token, followUserId }` |
| `bot:disconnect` | renderer → main | — |
| `bot:status` | main → renderer | `{ status, channelName, userCount }` |
| `bot:users-update` | main → renderer | `{ users: [{ userId, username, avatarUrl, assignedDevice }] }` |
| `audio:devices` | main → renderer | `{ devices: [{ id, name }] }` |
| `routing:assign` | renderer → main | `{ userId, deviceId }` — assign user to a cable |
| `routing:unassign` | renderer → main | `{ deviceId }` — clear a cable's assignment |

---

## Setup Instructions to Include in README

1. Install [Node.js](https://nodejs.org) (v18+)
2. Install pnpm: `npm install -g pnpm`
3. Install [VB-Audio Virtual Cable](https://vb-audio.com/Cable/) — install all 4 cables (A/B/C/D) via VB-Audio's VBCABLE_Pack
4. Go to [Discord Developer Portal](https://discord.com/developers/applications) → New Application → Bot → copy token
5. Enable **Server Members Intent** and **Voice States Intent** in the bot settings
6. Invite bot to your server with `connect` + `speak` permissions
7. Run `pnpm install` then `pnpm start`
8. Paste token, paste your own Discord User ID, hit Connect

---

## Package Manager: pnpm

Use pnpm exclusively. Do not use npm or yarn.

```bash
# Install pnpm globally if not present
npm install -g pnpm
```

### `.npmrc` — pnpm security config

Create this file at the project root:

```ini
# Use pnpm
engine-strict=true
node-linker=node-modules

# Security: only allow packages published more than 5 days ago
# Protects against "newest package" supply chain attacks (e.g. typosquatting, malicious publishes)
package-import-method=copy

# Audit on install
audit=true

# Disallow install if lockfile is out of sync
frozen-lockfile=false

# Reject any package version published less than 5 days ago
# Implemented via .pnpmfile.cjs (see below)
```

### `.pnpmfile.cjs` — enforce minimum package age

pnpm runs this hook during install. It checks the npm registry publish date and rejects packages newer than 5 days:

```js
const https = require('https');

function fetchPublishDate(name, version) {
  return new Promise((resolve, reject) => {
    const url = `https://registry.npmjs.org/${encodeURIComponent(name)}/${version}`;
    https.get(url, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          resolve(new Date(json.time || json._time || 0));
        } catch {
          resolve(new Date(0));
        }
      });
    }).on('error', () => resolve(new Date(0)));
  });
}

module.exports = {
  hooks: {
    async readPackage(pkg, context) {
      const MIN_AGE_DAYS = 5;
      const now = Date.now();

      for (const [name, versionRange] of Object.entries({
        ...pkg.dependencies,
        ...pkg.devDependencies,
      })) {
        // Strip semver range chars to get a concrete version for lookup
        const version = versionRange.replace(/^[\^~>=<]/, '');
        if (!version || version.includes('*')) continue;

        try {
          const published = await fetchPublishDate(name, version);
          const ageMs = now - published.getTime();
          const ageDays = ageMs / (1000 * 60 * 60 * 24);

          if (ageDays < MIN_AGE_DAYS) {
            throw new Error(
              `[security] Package "${name}@${version}" was published ${ageDays.toFixed(1)} days ago — ` +
              `must be at least ${MIN_AGE_DAYS} days old. ` +
              `If intentional, wait until ${new Date(published.getTime() + MIN_AGE_DAYS * 86400000).toDateString()} to install.`
            );
          }
        } catch (err) {
          if (err.message.startsWith('[security]')) throw err;
          // Registry fetch failed — allow and warn rather than block
          context.log(`[warn] Could not verify age of ${name}@${version}: ${err.message}`);
        }
      }

      return pkg;
    }
  }
};
```

### `package.json`

```json
{
  "name": "discord-audio-splitter",
  "version": "1.0.0",
  "main": "main.js",
  "engines": {
    "node": ">=18.0.0",
    "pnpm": ">=8.0.0"
  },
  "scripts": {
    "start": "electron .",
    "postinstall": "electron-rebuild -f -w naudiodon,@discordjs/opus",
    "build": "electron-builder --win --x64",
    "build:portable": "electron-builder --win portable --x64",
    "audit": "pnpm audit --audit-level=moderate"
  },
  "dependencies": {
    "discord.js": "^14.0.0",
    "@discordjs/voice": "^0.17.0",
    "libsodium-wrappers": "^0.7.13",
    "naudiodon": "^2.0.0",
    "opusscript": "^0.1.0",
    "@discordjs/opus": "^0.9.0",
    "electron-store": "^8.0.0"
  },
  "devDependencies": {
    "electron": "^28.0.0",
    "electron-builder": "^24.0.0",
    "@electron/rebuild": "^3.0.0"
  },
  "build": {
    "appId": "com.discordaudiosplitter.app",
    "productName": "Discord Audio Splitter",
    "win": {
      "target": [
        { "target": "nsis", "arch": ["x64"] },
        { "target": "portable", "arch": ["x64"] }
      ],
      "icon": "assets/icon.ico"
    },
    "nsis": {
      "oneClick": false,
      "allowToChangeInstallationDirectory": true,
      "createDesktopShortcut": true,
      "createStartMenuShortcut": true
    },
    "files": [
      "main.js",
      "preload.js",
      "bot.js",
      "audioRouter.js",
      "renderer/**/*",
      "assets/**/*",
      "node_modules/**/*"
    ],
    "asar": true,
    "asarUnpack": [
      "node_modules/naudiodon/**/*",
      "node_modules/@discordjs/opus/**/*",
      "node_modules/opusscript/**/*"
    ]
  }
}
```

### Build Steps

```bash
pnpm install               # installs deps, runs .pnpmfile.cjs age check + postinstall rebuild
pnpm audit                 # check for known vulnerabilities
pnpm run build             # produces both exe types in /dist
```

Output in `/dist/`:
- `Discord Audio Splitter Setup 1.0.0.exe` — NSIS installer with Start Menu shortcut + uninstaller
- `Discord Audio Splitter 1.0.0.exe` — portable single exe, no install needed, run from anywhere

### Why asarUnpack for native modules
`naudiodon` and `@discordjs/opus` are native Node addons (`.node` binary files). Electron packages everything into an `asar` archive by default, but native `.node` files can't be loaded from inside an asar — `asarUnpack` tells electron-builder to keep those specific modules unpacked on disk next to the asar.

### Icon Requirement
Place a 256×256 `icon.ico` at `assets/icon.ico` — required by electron-builder for Windows. Convert any PNG at https://icoconvert.com.

---

## Config Persistence

Use `electron-store` (already in dependencies) to persist all user inputs. It saves to `%APPDATA%/discord-audio-splitter/config.json` on Windows automatically.

### What gets saved

```json
{
  "botToken": "MTExxx...",
  "followUserId": "123456789012345678",
  "routing": {
    "123456789012345678": "CABLE-A Input",
    "987654321098765432": "CABLE-B Input"
  }
}
```

| Field | Type | Saved when |
|---|---|---|
| `botToken` | string | On every keystroke (debounced 500ms) or on blur |
| `followUserId` | string | On every keystroke (debounced 500ms) or on blur |
| `routing` | `{ userId: deviceName }` | Immediately on every drag-drop assign or unassign |

### Restore on startup

When the app launches:
1. Load `config.json` via `electron-store`
2. Pre-fill the Bot Token and Follow User ID input fields in the GUI
3. Store the saved `routing` map in memory — apply it automatically when the bot connects and users appear in the channel (match by `userId`)
4. If `botToken` and `followUserId` are both present, optionally show a "Reconnect" button prominently so the user can resume with one click

### Security note for bot token

The token is stored in plaintext in `electron-store`'s JSON file. Add a comment in the code noting this and that the user should treat `config.json` like a password file. Do not log the token anywhere in the app.

---

## Edge Cases to Handle

- User joins channel after bot is already connected → appear in left panel immediately, re-apply saved assignment if one exists for their userId
- User leaves channel → remove from left panel, keep their cable assignment saved in config for when they return
- Target follow-user is not in any voice channel on connect → show "Waiting for [username] to join a channel…"
- No virtual cable devices detected → show empty right panel with a message linking to VB-Audio download
- User dragged to a cable that already has someone assigned → swap: previous user becomes unassigned, new user takes the cable
- Same user dragged to a second cable → first cable clears automatically
- VB-Audio cable device disappears (e.g. driver uninstall) → show warning badge on that cable card, stop routing to it
- Bot token invalid → show clear error message in GUI
- Discord rate limits / reconnects → auto-reconnect with exponential backoff

---

## Notes for Vibe Coding

- Use `pnpm` for all package operations — never `npm install` or `yarn`
- Commit `pnpm-lock.yaml` — this ensures reproducible installs
- `.pnpmfile.cjs` runs on every `pnpm install` — if it throws a `[security]` error, the package is too new; wait or pin an older version explicitly
- Keep `bot.js` and `audioRouter.js` separate — bot handles Discord logic, audioRouter handles Windows audio device I/O
- All Discord bot logic runs in the **main process** (Node.js), never in the renderer
- Use `contextBridge` + `ipcRenderer` properly — don't expose raw Electron APIs to renderer
- The renderer is just UI — it sends commands and displays state, does zero audio work
- Test audio output by routing CABLE-A to your headphones in Windows Sound settings and speaking in the channel
- Run `pnpm audit` before building the exe to catch any known CVEs in the dependency tree