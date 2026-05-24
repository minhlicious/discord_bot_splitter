# Discord Audio Splitter — CLAUDE.md

## What this is

Windows Electron desktop app. Runs a local Discord bot that follows a target user into voice channels and routes each speaker's audio to a separate VB-Audio Virtual Cable output device. Each cable can be read independently by DAWs, OBS, etc.

## Package manager

**pnpm only.** Never use `npm install` or `yarn`. The `.pnpmfile.cjs` hook rejects packages newer than 5 days — if it throws a `[security]` error during install, the package is too new; wait or pin an older version.

```
pnpm install
pnpm start
pnpm run build
```

## Architecture

All Discord/audio logic runs in the **Electron main process** (Node.js). The renderer is UI-only — it sends commands and displays state via IPC. Never put audio or Discord code in the renderer.

```
main.js          Electron main — window, tray, IPC dispatch, electron-store config
  ├── bot.js     Discord client, voice receiver, Opus→PCM decode, per-user subscriptions
  └── audioRouter.js  naudiodon device enum + PCM output streams (one per cable)

preload.js       contextBridge — the only way renderer talks to main
renderer/
  index.html     Shell — two-panel layout
  app.js         All UI logic: drag-drop, state, IPC calls
  styles.css     Dark Discord theme
```

## IPC channels

| Channel | Direction | Payload |
|---|---|---|
| `bot:connect` | renderer→main | `{ token, followUserId }` |
| `bot:disconnect` | renderer→main | — |
| `bot:status` | main→renderer | `{ status, message, userCount }` — status: `connecting / live / waiting / error / disconnected` |
| `bot:users-update` | main→renderer | `{ users: [{ userId, username, avatarUrl }] }` |
| `audio:devices` | main→renderer | `{ devices: [{ id, name }] }` |
| `audio:device-missing` | main→renderer | `{ deviceId }` |
| `routing:assign` | renderer→main | `{ userId, deviceId }` |
| `routing:unassign` | renderer→main | `{ deviceId }` |
| `config:load` | main→renderer | `{ botToken, followUserId, routing }` |
| `config:save-field` | renderer→main | `{ key, value }` — key: `botToken` or `followUserId` |

## Key implementation details

**Audio pipeline:** Discord → Opus packets (per user) → `opusscript` decode → 48kHz 16-bit stereo PCM → naudiodon `AudioIO` OutputStream → VB-Audio Virtual Cable.

**Per-user subscriptions:** `receiver.subscribe(userId, { end: AfterSilence 100ms })` ends on silence. `subscribeUser()` re-subscribes via `setImmediate` on every `'end'` event to catch the next speech burst. Each user has their own `OpusScript` decoder instance (stateful).

**Bot follows target user:** `voiceStateUpdate` tracks the follow-user ID. If they switch channels the bot leaves and rejoins. If they leave voice entirely, the bot waits.

**Device detection:** naudiodon `getDevices()` filtered to output devices (`maxOutputChannels > 0`) whose name contains `CABLE` or `virtual`. VB-Audio devices appear as "CABLE-A Input", etc.

**Config persistence:** `electron-store` writes to `%APPDATA%/discord-audio-splitter/config.json`. Stores `botToken` (plaintext — treat like a password file), `followUserId`, and `routing` (userId→deviceId map). Never log the token.

**Tray icons:** Generated in-memory as 16×16 RGBA buffers via `nativeImage.createFromBuffer` — no icon files needed for dev. `assets/icon.ico` is only required for `pnpm run build`.

**Reconnect:** Exponential backoff (1s → 30s max) on voice disconnection. Discord gateway reconnects are handled automatically by discord.js.

## Native modules

`naudiodon` and `@discordjs/opus` are native Node addons. After `pnpm install`, the `postinstall` script runs `electron-rebuild` to compile them against the installed Electron version. If you change the Electron version, run `pnpm run postinstall` again manually.

These modules are in `asarUnpack` in the build config — they can't be loaded from inside an asar archive.

## Discord bot requirements

The bot needs these intents enabled in the Discord Developer Portal:
- **Server Members Intent**
- **Voice States Intent**

And these permissions when invited: `Connect`, `Speak`.

## Adding features

- New IPC channels: add handler in `main.js` (`ipcMain.on`) and expose in `preload.js` (`contextBridge`)
- New UI: `renderer/app.js` + `renderer/styles.css` only — no Node APIs
- New audio behavior: `audioRouter.js` (device I/O) or `bot.js` (Discord/stream logic)
