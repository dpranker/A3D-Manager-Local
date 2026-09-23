# A3D Manager Local roadmap

## Decisions
- Public fork of TheLeggett/A3D-Manager: github.com/dpranker/A3D-Manager-Local (since 2026-09-23; origin). Upstream is tracked as the `upstream` remote and history stays mergeable. Development started in a private standalone repo (dpranker/a3d-local-manager, now archived, remote `private`; it holds PRs #1-#7). Before publishing, commit identities were rewritten to dpranker <3966993+dpranker@users.noreply.github.com>. PRs must target the fork (`gh repo set-default dpranker/A3D-Manager-Local`), never upstream.
- License: MIT, keeping upstream's notice plus "Copyright (c) 2026 dpranker".
- Desktop shell: Electron, running the existing Express server in-process (keep sharp and fs-based SD card access).
- Firmware releases come from Analogue's documented firmware API (https://www.analogue.co/developer/docs/api): GET /support/3d/firmware/list (versions + dates), /support/3d/firmware/{version|latest}/details (file_name, download_url on assets.analogue.co, md5, file_size, release notes as HTML and Markdown), /latest (307 to the version page) and /{version}/download. Downloads are verified against the published MD5, and the copy on the card is read back and compared. (Earlier options: the RSS feed https://www.analogue.co/feed/firmwares, or scraping the support page; neither has checksums.)
- Installed firmware detection: the only marker on the card is the a3d_os_MM_mm_pp.bin update file. Up to 1.5.0 the console leaves it in the card root after installing; 1.5.1+ moves it to /System/Archived after installing (confirmed on a real card, 2026-09-23). Root file newer than the archive = pending. Two update files in the root conflict (found on a 1.5.0 console), so when copying a new update the app deletes other root update files, as Analogue's install guide says. /System/Archived is never touched.
- sharp must stay >= 0.34: 0.33's prebuilt libvips exports its own GLib/GObject, which clashes with the system GLib Electron loads on Linux and aborts the main process (VIPS_IS_OBJECT assertion).

## Upstream architecture
- Express server (server/index.ts, server/routes/, server/lib/sd-card.ts, etc.) + React/Vite client (src/). SD card is accessed via the filesystem.

## Features
1. Firmware update check (done: Settings → Firmware). Latest as of 2026-09-23: 3Dos 1.5.1 (21,915,936 bytes, MD5 75f14fd5e3961acff208d154e1ea8c9f). Compares against the version on the SD card and downloads the update to the card root, replacing any other root update file.
2. Electron desktop app (no browser/WebUSB).
3. library.json editor: /Library/N64/Games/{Game Folder}/library.json, only for carts not in the built-in DB (console support since 3Dos 1.5.1, "Library customization for Unknown Cartridges"). Docs: https://www.analogue.co/developer/docs/platform/library-json. Schema: https://schemas.analogue.co/platform/3d/library.json (copy in docs/analogue-schemas/3d-library.json, fetched 2026-09-23). The schema is authoritative where the docs page disagrees.
   - Required: $schema, data, defaults.
   - data: title (string, max 127), revision (number, 0-based, shown as "Rev N"), player_count (max 4), accessories[] (max 5; controller-pak, expansion-pak, rumble-pak, transfer-pak, voice-recognition-unit-usa, voice-recognition-system-japan, denshadego-controller, bio-sensor, tsurikon-64, n64-mouse), region[] (asia, australia, brazil, germany, europe, france, england, italy, japan, netherlands, spain, usa; the docs page also lists portugal, but the schema doesn't), developers[], release_year (number), publishers[] (optional).
   - defaults: virtual_expansion_pak, region (auto|ntsc|pal), disable_deblur, enable_32_bit_color, force_progressive_output, disable_texture_filtering, disable_anti_aliasing, force_original_hardware, horizontal_upscaling, overclock (off|auto|enhanced|enhanced-plus|unleashed; the docs page's list omits "off" but its sample and the schema include it), virtual_accessory (no-pak|controller-pak|rumble-pak), cart_color (gray|red|green|blue|yellow|gold|black|purple|rose; can be overridden per game in settings.json library.cartridge_color).
   - Note the key spelling differs from settings.json: disable_anti_aliasing here vs disable_antialiasing there.
   - Done (2026-09-23): Library tab for carts outside the app's cart database (data/cart-names.json stands in for the console's built-in database; a console-created library.json on the card also counts as unknown). Files are validated against the schema (the console's own files match it exactly) plus the docs' limits, written in console key order; card writes need a 1.5.1 card. Titles become the app's custom name. Help page and README updated.
   - Open: whether the console renames a card folder like "Unknown Cartridge d3d9c98c" after its library.json title changes, or only shows the new title.
4. Cartridge colors: the grid tints each cart shell with its console cartridge color (settings.json library.cartridge_color, else library.json defaults.cart_color) via a CSS mask of the single-color shell sprite. Hex values in src/lib/cartColors.ts are approximations (Analogue doesn't publish them); gray keeps the default dark shell.

## settings.json format change (3Dos 1.5.1)
- Confirmed on a real card (2026-09-23): the 1.5.1 update rewrote settings.json for every cartridge in library.db (known and unknown) in the new format from Analogue's schema (https://schemas.analogue.co/platform/3d/settings.json, copy in docs/analogue-schemas/3d-settings.json): "$schema" key, snake_case keys, lowercase values (e.g. "horizontal_beam_convergence": "professional", "enable_edge_hardness": "soft" instead of false, "image_size": "integer-plus"), a new "library": {"cartridge_color"} section, hardware.horizontal_upscaling, overclock "off", no "title". Only orphaned folders not in library.db kept the old camelCase / Title-case format.
- Decision (2026-09-23): the app supports only the new format. Old-format files (local copies, bundles, orphaned folders on the card) are detected and reported but never converted, because the 1.5.1 update reset those settings anyway. Settings are only written to a card whose console uses the new format: any new-format settings.json on the card allows it; only old-format files block it (even if a 1.5.1 update file is waiting to be installed); with no settings files, the installed firmware version decides.
- Files are written in the console's shape, not strictly the published schema: 3Dos 1.5.1 writes enable_edge_overshoot in pvm/crt/scanlines, which the schema (additionalProperties: false) doesn't allow. Every console-written file tested fails the published schema for that reason only; tests validate against the schema with that one field patched in.
- Fixed along the way: upstream's Settings tab never auto-saved (a render loop kept resetting the save debounce, "Maximum update depth exceeded").

## Status
- [x] Push upstream history to origin
- [x] Electron wrapper
- [x] Firmware checker
- [x] library.json editor
- [x] Cartridge colors in the grid
- [x] settings.json: support the 3Dos 1.5.1 format (see "settings.json format change")
- [x] App icon (electron/resources, generated by electron/scripts/make-icons.ts)
