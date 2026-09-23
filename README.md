# A3D Manager Local

![CI](https://github.com/dpranker/A3D-Manager-Local/actions/workflows/ci.yml/badge.svg)

**A3D Manager Local** is a fork of [TheLeggett/A3D-Manager](https://github.com/TheLeggett/A3D-Manager) that adds a desktop app (Electron, Linux AppImage and Windows installer), 3D<sup>os</sup> firmware updates, support for the 3D<sup>os</sup> 1.5.1 `settings.json` format, a `library.json` editor for unknown cartridges, and cartridge colors. It keeps upstream's history and stays mergeable with it; all credit for the original app goes to its authors.

**The unofficial companion app for managing your Analogue 3D N64 cartridge collection.**

A3D Manager is a desktop utility that lets you manage label artwork, per-game display and hardware settings, and controller pak saves for your Analogue 3D. Build and maintain your perfect cartridge library with full control over every aspect of your N64 gaming experience.

![Cartridge Explorer](src/assets/screenshots/Cartridge%20Explorer.png)

---

## Features

### Cartridge Explorer

Browse and manage your entire N64 cartridge collection:

- **Real-time search** by game name or cart ID
- **Filter by region, language, and video mode** (NTSC/PAL)
- **Toggle between All and Owned** to focus on your personal collection
- **Smart badges** identify known games, custom names, and unknown/homebrew carts
- **Selection mode** for bulk operations on multiple cartridges

### Per-Game Display Settings

Configure display settings individually for each cartridge:

- **Display Mode**: BVM, PVM, CRT, Scanlines, or Clean
- **CRT Mode Options**: Beam Convergence (Horizontal/Vertical), Edge Overshoot, Edge Hardness, Image Size, Image Fit
- **Clean Mode Options**: Interpolation Algorithm, Gamma Transfer, Sharpness, Image Size, Image Fit
- **Cartridge Color** shown in the console's library
- **Copy & Paste Settings**: Copy settings from one cartridge and paste to multiple others in bulk using Selection Mode

![Edit Cartridge - Settings](src/assets/screenshots/Edit%20Cartridge%20-%20Settings.png)

### Per-Game Hardware Settings

Fine-tune hardware behavior for each game:

- **Virtual Expansion Pak** toggle
- **Region Override**: Auto, NTSC, or PAL
- **De-Blur** enhancement
- **32-bit Color** mode
- **Force Progressive Output** and **Horizontal Upscaling**
- **Disable Texture Filtering** option
- **Disable Antialiasing** option
- **Force Original Hardware** mode
- **Overclock**: Off, Auto, Enhanced, Enhanced+, or Unleashed

Settings use the `settings.json` format introduced in 3D<sup>os</sup> 1.5.1. Changes sync automatically to your SD card when connected, as long as its console is on 1.5.1 or later; settings from older firmware are detected but not used, since the 1.5.1 update reset them.

### Game Pak Management

Full control over controller pak (Game Pak) save data:

- **View save data usage** with pages used, pages free, and capacity percentage
- **Sync detection** shows when local and SD card saves differ
- **Download from SD** to backup saves locally
- **Upload to SD** to restore saves
- **Import/Export** game pak files (.img format)
- **Backup system** with named backups, descriptions, restore, and export

![Edit Cartridge - Game Paks](src/assets/screenshots/Edit%20Cartridge%20-%20Game%20Paks.png)

### Label Artwork

Customize the label artwork displayed on the Analogue 3D home screen:

- **Drag-and-drop** image upload (PNG, JPG, WebP)
- **Automatic resizing** to the required 74x86 pixel format
- **Side-by-side preview** of current and new labels
- **Custom names** for homebrew and flash carts

![Edit Cartridge - Label](src/assets/screenshots/Edit%20Cartridge%20-%20Label.png)

### SD Card Integration

Seamless synchronization with your Analogue 3D:

- **Auto-detect** connected Analogue 3D SD cards
- **Real-time sync status** indicator in the header
- **Automatic settings sync** when SD card is connected
- **Conflict detection** with resolution options when local and SD card data differ
- **Import games from SD** to discover cartridges you've played
- **Choose SD Card…** in the desktop app picks the card (or the folder it's mounted under) with a native folder picker

### Library Details for Unknown Cartridges

For cartridges outside the console's built-in database (homebrew, flash carts, reproductions), the **Library** tab edits their `library.json` (3D<sup>os</sup> 1.5.1+): title, revision, developers, publishers, release year, players, regions, accessories, and the default settings they start with. The title also becomes the cartridge's name in A3D Manager.

![Edit Cartridge - Library](src/assets/screenshots/Edit%20Cartridge%20-%20Library.png)

### Cartridge Colors

The cartridge grid and previews show each cartridge in the color the console uses for it in its library: the per-game Cartridge Color setting, or the `library.json` default. Games without a local copy of their settings take the color from the connected SD card, where the console records it. Everything else shows its default retail shell color: the North American releases that shipped in black, red, blue, green, yellow or gold shells ([data/retail-colors.json](data/retail-colors.json)). Regional variants and later gray reprints aren't covered.

### 3Dos Firmware Updates

Settings → Firmware uses Analogue's [firmware API](https://www.analogue.co/developer/docs/api) to check for new 3D<sup>os</sup> releases, shows the release notes, compares them with the update file on your SD card, and copies the new update to the card root (replacing any older update file there), verified against Analogue's published MD5 checksum. The console installs it the next time it's powered on.

![Settings - Firmware](src/assets/screenshots/Settings%20-%20Firmware.png)

### Import & Export

Flexible backup and sharing options:

- **Bundle Export** (.a3d format) with selective data:
  - Labels (artwork)
  - Per-game settings
  - Game Pak saves
  - Game Pak backups
  - Ownership data
- **Selection Export** to export specific cartridges
- **Bundle Import** with merge options for handling conflicts
- **Import labels.db** directly from file or community collections

![Export Selection](src/assets/screenshots/Export%20Selection.png)

### Getting Started

### Desktop App (Recommended)

The desktop app runs everything locally: no browser tab, no server to start, and a native SD card picker. It doesn't need Node.js.

- **Linux:** download the `.AppImage` from the [Releases page](https://github.com/dpranker/A3D-Manager-Local/releases), make it executable (`chmod +x A3D-Manager-Local-*.AppImage`) and run it. Some distributions need `libfuse2` installed to run AppImages. To get a menu entry with the app icon, integrate it with [Gear Lever](https://flathub.org/apps/it.mijorus.gearlever) or [AppImageLauncher](https://github.com/TheAssassin/AppImageLauncher). On Ubuntu 24.04 and later, Electron's sandbox is blocked by default; if the app doesn't start, run it with `--no-sandbox`.
- **Windows:** download and run the `Setup .exe` from the Releases page. The installer isn't code-signed yet, so SmartScreen warns on first run (More info → Run anyway).
- **SD card:** the app finds cards mounted under `/run/media/<user>` or `/media/<user>` (Linux) and `/Volumes` (macOS) automatically; otherwise click **Choose SD Card…** in the header and pick the card (the folder containing `Library/N64`) or the folder it's mounted under. The choice is remembered.
- **Data location:** `~/.config/A3D Manager/workspace/` (Linux), `%APPDATA%\A3D Manager\workspace\` (Windows) or `~/Library/Application Support/A3D Manager/workspace/` (macOS).

The first release is 0.1.0. You can also build the app yourself (below).

### Running From Source

Requires **Node.js 22.12 or later** (24 LTS recommended).

```bash
# Clone the repository
git clone https://github.com/dpranker/A3D-Manager-Local.git
cd A3D-Manager-Local

# Install dependencies
npm install

# Desktop app with hot reload (main-process changes restart Electron)
npm run electron:dev

# Or the web version: opens at http://localhost:5173, with the backend API on port 3001
npm run dev
```

Build the desktop app with `npm run electron:build`: it packages for the current OS into `release/` (Linux: AppImage; Windows: NSIS installer). Each platform has to be built on that OS, because sharp's native binary is platform-specific. The macOS (`dmg`) target is configured in `electron-builder.yml` but isn't built or tested.

In the web version, the SD card is found via `SD_VOLUMES_PATH` (see `.env.example`), and you can eject and re-insert it while the app runs. `electron:dev` and `npm run dev` share the repo's `.local/` folder.

The Electron code lives in `electron/` (main process, preload, embedded server, build scripts) and `src/desktop/` (renderer bridge and SD card picker). The Express server runs inside the app on `127.0.0.1` (random free port, local requests only).

### Releases

Pushing a tag like `v1.2.0` (or `v1.2.0-rc.1` for a pre-release) runs `.github/workflows/release.yml`: it builds the Linux AppImage and Windows installer on their own runners, smoke-tests both, and attaches them to a draft GitHub release to review and publish. The version comes from the tag. Add a `## [x.y.z]` section to [CHANGELOG.md](CHANGELOG.md) before tagging; it becomes the release notes.

### Docker Installation

A3D Manager can also run in Docker, though with some limitations around SD card handling:

```bash
# Using Docker Compose (recommended)
docker compose up -d

# Or build and run manually
docker build -t a3d-manager .
docker run -d \
  --name a3d-manager \
  -p 3001:3001 \
  -v a3d-data:/app/.local \
  a3d-manager
```

The app will be available at `http://localhost:3001`.

#### SD Card Access

The Docker container mounts your Analogue 3D SD card directly. By default, it expects the standard mount path `/Volumes/ANALOGUE 3D`.

> **Important:** Your SD card must be connected and mounted **before** running `docker compose up -d`. If the SD card isn't mounted, Docker will fail with a "permission denied" error.

**Connecting your SD Card:**

You can either use an external SD card reader, or connect directly to your Analogue 3D via USB-C:

1. Fully power off your Analogue 3D and disconnect all controllers and cables
2. Leave the SD card inserted in the Analogue 3D
3. Connect the Analogue 3D's power port to your computer using USB-C and wait 5 seconds
4. Press and hold the reset button, then while holding reset, press and hold the power switch
5. Hold both buttons until the Power LED turns green, then release
6. Your SD card should now appear as `ANALOGUE 3D` on your computer

See [Analogue's guide](https://www.analogue.co/support/3d/guide/getting-started#updating-3dos) for more details.

**Initial Setup (macOS):**

1. Connect your SD card (see above)
2. Run `docker compose up -d`

**Initial Setup (Linux):**

1. Create a `.env` file with your SD card path:
   ```bash
   cp .env.example .env
   # Edit SD_VOLUMES_PATH, e.g.:
   SD_VOLUMES_PATH=/media/$USER/ANALOGUE 3D
   ```
2. Run `docker compose up -d`

**If your SD card has a different name**, create a `.env` file:
```bash
SD_VOLUMES_PATH=/Volumes/YOUR_SD_CARD_NAME
```

#### Ejecting the SD Card (Important)

Due to how Docker Desktop works on macOS, you must **quit Docker Desktop entirely** before ejecting your SD card. The Docker VM keeps file shares active even when containers are stopped.

**Workflow for ejecting:**

1. Stop the container: `docker compose down`
2. Quit Docker Desktop (click Docker icon in menu bar → Quit Docker Desktop)
3. Eject your SD card normally

**When ready to use again:**

1. Connect your SD card first (it must be mounted before starting Docker)
2. Start Docker Desktop
3. Run `docker compose up -d`

> **Note:** If you frequently need to eject your SD card, consider using the [desktop app](#desktop-app-recommended) or [running from source](#running-from-source) instead, which have no restrictions on SD card ejection.

#### Docker Configuration

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3001` | Server port |
| `SD_VOLUMES_PATH` | `/Volumes/ANALOGUE 3D` | Path to your Analogue 3D SD card |
| `TRANSFER_CHUNK_SIZE` | `2097152` | File transfer chunk size (bytes) |
| `TRANSFER_FSYNC_PER_CHUNK` | `true` | Sync after each chunk for accurate progress |
| `READ_LABELS_FROM_SD` | `false` | Read labels directly from SD card (slower) |

### Quick Start

1. **Connect your SD card** - Insert your Analogue 3D SD card into your computer (in the desktop app, use **Choose SD Card…** if it isn't found)
2. **Import your games** - Use "Import Owned from SD" to mark your cartridges as owned, and "Download Labels" to import the card's label artwork
3. **Browse and configure** - Search for games, adjust settings, upload artwork
4. **Sync** - Per-game settings save to the card automatically while it's connected; label changes are written with **Sync Now** in the header, and Controller Pak saves from the Game Pak tab
5. **Eject the card** in your file manager before removing it

---

## How It Works

The Analogue 3D identifies N64 cartridges using a CRC32 checksum of the first 8 KiB of ROM data. This creates a unique 8-character hex ID for each cartridge. A3D Manager uses these IDs to associate custom label artwork, display settings, hardware settings, and controller pak saves with each cartridge.

### Data Storage

- **Local storage**: All data is stored in `.local/` (in the desktop app, inside its data folder) until synced
- **Settings**: Saved to the SD card automatically while it's connected (for consoles on 3D<sup>os</sup> 1.5.1 or later)
- **Game paks**: Copied between your computer and the card from the Game Pak tab
- **Labels**: Written to the card with **Sync Now** in the header

### Technical Documentation

- [Labels DB Specification](docs/LABELS_DB_SPECIFICATION.md) - Binary format details
- [Cart ID Algorithm](docs/CART_ID_ALGORITHM.md) - How cartridge identification works
- [SD Card Format](docs/ANALOGUE_3D_SD_CARD_FORMAT.md) - Analogue 3D SD card structure
- [Cartridge Management](docs/CARTRIDGE_MANAGEMENT.md) - Per-game settings and game pak management
- [Firmware Changelog](docs/FIRMWARE_CHANGELOG.md) - SD card format changes across 3D<sup>os</sup> versions, including 1.5.1
- [Analogue's JSON schemas](docs/analogue-schemas/) - Copies of the official `settings.json` and `library.json` schemas
- [Roadmap](docs/roadmap.md) - This fork's decisions and open questions

---

## Tech Stack

- **Frontend**: React 19 + TypeScript + Vite
- **Backend**: Express.js + TypeScript
- **Desktop**: Electron (the Express server runs in-process), packaged with electron-builder
- **Image Processing**: Sharp

---

## Disclaimer

A3D Manager is an unofficial, community-created tool and is not affiliated with, endorsed by, or connected to Analogue, Inc. Use at your own risk. Always back up your SD card before making changes.

---

## Contributing

Contributions are welcome! Feel free to open issues or submit pull requests.

## License

Thanks to [n64-tools/n64-flashcart-menu-metadata](https://github.com/n64-tools/n64-flashcart-menu-metadata) and its contributors for the cartridge metadata! We source alternate searchable game names from that project's Unlicense-licensed data. See [Cartridge data sources](docs/CART_DATA_SOURCES.md) for the comparison, remaining ID gaps, and refresh instructions.

MIT License - see [LICENSE](LICENSE) for details. Based on [A3D Manager](https://github.com/TheLeggett/A3D-Manager) by TheLeggett and contributors, also MIT licensed; the original copyright notice is kept in the LICENSE file as the license requires.

The additions in this fork were developed with the help of [Claude Code](https://claude.com/claude-code) (Anthropic's AI coding assistant); individual commits don't carry an AI co-author line.
