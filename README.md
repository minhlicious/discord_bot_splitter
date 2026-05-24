# Discord Audio Splitter

A Windows desktop app that runs a self-hosted Discord bot locally. The bot follows a specified user into their voice channel and routes each speaker's audio to a separate **VB-Audio Virtual Cable** output — so each person can be recorded, processed, or monitored independently in real time.

```
Discord voice channel
  └─ Bot receives per-user Opus audio
       └─ Decoded to PCM (48 kHz, 16-bit stereo)
            └─ CABLE-A → DAW track 1
            └─ CABLE-B → OBS source 2
            └─ CABLE-C → headphones
            └─ CABLE-D → ...
```

## Requirements

- Windows 10/11 x64
- [Node.js](https://nodejs.org) v18 or later
- [pnpm](https://pnpm.io) v8 or later — `npm install -g pnpm`
- [VB-Audio Virtual Cable Pack](https://vb-audio.com/Cable/) — install all 4 cables (A/B/C/D)
- A Discord bot token (see setup below)

## Setup

### 1. Create a Discord bot

1. Go to the [Discord Developer Portal](https://discord.com/developers/applications) → **New Application**
2. Open **Bot** → copy the token
3. Enable **Server Members Intent** and **Voice States Intent** under Privileged Gateway Intents
4. Open **OAuth2 → URL Generator**, select scopes `bot` and permissions `Connect` + `Speak`
5. Open the generated URL and invite the bot to your server

### 2. Install VB-Audio cables

Download and install the **CABLE Pack** from [vb-audio.com/Cable](https://vb-audio.com/Cable/) — this gives you CABLE-A through CABLE-D as virtual audio output devices. Restart your PC after installing.

### 3. Run the app

```bash
git clone <repo>
cd discord-audio-splitter
pnpm install        # installs deps + rebuilds native modules for Electron
pnpm start          # opens the app
```

> **Note:** `pnpm install` runs a security hook (`.pnpmfile.cjs`) that checks package publish dates. It also runs `electron-rebuild` to compile `naudiodon` and `@discordjs/opus` against the installed Electron version. This may take a minute.

### 4. Use the app

1. Paste your bot token into the **Bot Token** field
2. Paste your own Discord **User ID** into the Follow User ID field
   - Find your user ID: Discord Settings → Advanced → enable Developer Mode → right-click your name → Copy User ID
3. Click **Connect** — the bot joins whatever voice channel you're in
4. Drag user cards from the left panel onto cable cards on the right to route their audio
5. Speak — audio flows to the assigned virtual cable

To read a cable's audio: open any app (DAW, OBS, Voice Meeter) and set its input to `CABLE-X Output`.

## Building a distributable `.exe`

```bash
# Add a 256×256 icon first (see assets/README.md)
pnpm run build
```

Output in `dist/`:
- `Discord Audio Splitter Setup 1.0.0.exe` — NSIS installer with Start Menu shortcut
- `Discord Audio Splitter 1.0.0.exe` — portable, run from anywhere

> **SmartScreen warning:** Unsigned executables show a Windows SmartScreen prompt on first run. Click "More info → Run anyway." To suppress this, sign the exe with a code-signing certificate.

## Security notes

- The bot token is stored in plaintext at `%APPDATA%\discord-audio-splitter\config.json`. Treat that file like a password — don't share it or commit it.
- The `.pnpmfile.cjs` hook rejects any package published less than 5 days ago to guard against supply-chain attacks. If install fails with a `[security]` error, a dependency is too new — wait or pin an older version.
- Run `pnpm audit` before distributing a build.

## Troubleshooting

| Problem | Fix |
|---|---|
| No cables appear in the right panel | Install VB-Audio Cable Pack and restart the app |
| Bot token invalid error | Re-copy the token from the Discord Developer Portal; tokens reset when you regenerate them |
| "Waiting for user to join" forever | Make sure you entered **your** user ID, not the bot's; check that the bot has Connect permission in that channel |
| No audio on the cable | Verify the assignment in the app; check Windows Sound settings that the cable's Output device is active |
| Native module error on install | Run `pnpm run postinstall` after changing the Electron version |
