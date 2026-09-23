# a3d-local-manager roadmap

## Decisions
- Private standalone repo (GitHub forbids private forks of public repos); upstream tracked as a git remote.
- Desktop shell: Electron, running the existing Express server in-process (keep sharp and fs-based SD card access).
- Firmware releases come from Analogue's documented firmware API (https://www.analogue.co/developer/docs/api): GET /support/3d/firmware/list (versions + dates), /support/3d/firmware/{version|latest}/details (file_name, download_url on assets.analogue.co, md5, file_size, release notes as HTML and Markdown), /latest (307 to the version page) and /{version}/download. Downloads are verified against the published MD5, and the copy on the card is read back and compared. (Earlier options: the RSS feed https://www.analogue.co/feed/firmwares, or scraping the support page; neither has checksums.)
- Installed firmware detection: the only marker on the card is the a3d_os_MM_mm_pp.bin update file. Up to 1.5.0 the console leaves it in the card root after installing; 1.5.1+ moves it to /System/Archived (per release notes, not yet seen on a real card). Root file newer than the archive = pending. With several update files in the root, the console installs the highest version, so the app never deletes old ones.
- sharp must stay >= 0.34: 0.33's prebuilt libvips exports its own GLib/GObject, which clashes with the system GLib Electron loads on Linux and aborts the main process (VIPS_IS_OBJECT assertion).

## Upstream architecture
- Express server (server/index.ts, server/routes/, server/lib/sd-card.ts, etc.) + React/Vite client (src/). SD card is accessed via the filesystem.

## Features
1. Firmware update check (done: Settings → Firmware). Latest as of 2026-09-23: 3Dos 1.5.1 (21,915,936 bytes, MD5 75f14fd5e3961acff208d154e1ea8c9f). Compares against the version on the SD card and downloads the update to the card root. Existing update files are left alone (the console archives them).
2. Electron desktop app (no browser/WebUSB).
3. library.json editor: /Library/N64/Games/{Game Folder}/library.json, only for carts not in the built-in DB (console support since 3Dos 1.5.1, "Library customization for Unknown Cartridges"). Docs: https://www.analogue.co/developer/docs/platform/library-json. Schema: https://schemas.analogue.co/platform/3d/library.json (copy in docs/analogue-schemas/3d-library.json, fetched 2026-09-23). The schema is authoritative where the docs page disagrees.
   - Required: $schema, data, defaults.
   - data: title (string, max 127), revision (number, 0-based, shown as "Rev N"), player_count (max 4), accessories[] (max 5; controller-pak, expansion-pak, rumble-pak, transfer-pak, voice-recognition-unit-usa, voice-recognition-system-japan, denshadego-controller, bio-sensor, tsurikon-64, n64-mouse), region[] (asia, australia, brazil, germany, europe, france, england, italy, japan, netherlands, spain, usa; the docs page also lists portugal, but the schema doesn't), developers[], release_year (number), publishers[] (optional).
   - defaults: virtual_expansion_pak, region (auto|ntsc|pal), disable_deblur, enable_32_bit_color, force_progressive_output, disable_texture_filtering, disable_anti_aliasing, force_original_hardware, horizontal_upscaling, overclock (off|auto|enhanced|enhanced-plus|unleashed; the docs page's list omits "off" but its sample and the schema include it), virtual_accessory (no-pak|controller-pak|rumble-pak), cart_color (gray|red|green|blue|yellow|gold|black|purple|rose; can be overridden per game in settings.json library.cartridge_color).
   - Note the key spelling differs from settings.json: disable_anti_aliasing here vs disable_antialiasing there.
   - After implementing: update the in-app Help page (src/components/HelpPage.tsx: "Game Names and Unknown Cartridges" says A3D Manager can't edit library.json yet; add library.json editing to "How to Use This Tool" → "Edit a Cartridge") and the README feature list.

## Open questions
- settings.json format after 3Dos 1.5.1: Analogue's docs and schema (https://schemas.analogue.co/platform/3d/settings.json, copy in docs/analogue-schemas/3d-settings.json) use snake_case keys and lowercase values (e.g. "horizontal_beam_convergence": "professional", "overclock": "auto"), require $schema and library.cartridge_color, and add horizontal_upscaling, overclock "off", sharpness very-soft…very-sharp, image_size integer/integer-plus, image_fit cinema-zoom. Files written by 3Dos 1.5.0 (and upstream's server/lib/cartridge-settings.ts) use camelCase keys with Title-case values ("horizontalBeamConvergence": "Professional") plus a "title" field. The docs say files that fail validation are reset to defaults at boot. Once the console runs 1.5.1, check which format it writes; if it's the new one, upstream's settings editor needs updating before it writes to the card again.
## Status
- [x] Push upstream history to origin
- [x] Electron wrapper
- [x] Firmware checker
- [ ] library.json editor (then update the Help page and README, see feature 3)
- [ ] Check the settings.json format written by 3Dos 1.5.1 (see Open questions)
- [ ] App icon (the app ships none, so desktops show a generic placeholder)
