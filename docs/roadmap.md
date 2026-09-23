# a3d-local-manager roadmap

## Decisions
- Private standalone repo (GitHub forbids private forks of public repos); upstream tracked as a git remote.
- Desktop shell: Electron, running the existing Express server in-process (keep sharp and fs-based SD card access).

## Upstream architecture
- Express server (server/index.ts, server/routes/, server/lib/sd-card.ts, etc.) + React/Vite client (src/). SD card is accessed via the filesystem.

## Features
1. Firmware update check: scrape https://www.analogue.co/support/3d/firmware (server-rendered HTML). Latest as of 2026-09-23: 3Dos 1.5.1, download https://www.analogue.co/support/3d/firmware/1.5.1/download (22.3MB). No checksums published. Compare against the installed version on the SD card; download to the SD card.
2. Electron desktop app (no browser/WebUSB).
3. library.json editor: /Library/N64/Games/{Game Folder}/library.json, only for carts not in the built-in DB. Schema: https://schemas.analogue.co/platform/3d/library.json
   - data: title (<=127), revision (num, 0-based), player_count (<=4), accessories[] (<=5), region[], developers[], release_year, publishers[] (optional)
   - defaults: virtual_expansion_pak, region (auto|ntsc|pal), disable_deblur, enable_32_bit_color, force_progressive_output, disable_texture_filtering, disable_anti_aliasing, force_original_hardware, horizontal_upscaling, overclock (off|auto|enhanced|enhanced-plus|unleashed), virtual_accessory (no-pak|controller-pak|rumble-pak), cart_color (gray|red|green|blue|yellow|gold|black|purple|rose)

## Status
- [x] Push upstream history to origin
- [ ] Electron wrapper
- [ ] Firmware checker
- [ ] library.json editor
