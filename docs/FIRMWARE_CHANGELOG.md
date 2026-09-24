# Analogue 3D Firmware Changelog

This document tracks discovered changes to the Analogue 3D's internal formats,
SD card structure, and settings across firmware versions.

## 3D OS 1.5.1

Release Date: September 2026

### SD Card Changes

Observed on a real card after updating from 1.5.0 (2026-09-23):

- 3D OS update files (`a3d_os_MM_mm_pp.bin`) are moved from the card root to
  `/System/Archived/` after updating. 1.5.0 and earlier left the update file in
  the root, and two update files in the root conflict, so older consoles need
  the old one removed first.
- **settings.json switched to a new format** matching Analogue's
  [schema](https://schemas.analogue.co/platform/3d/settings.json): a `$schema`
  key, snake_case keys and lowercase values (e.g.
  `"horizontal_beam_convergence": "professional"`, `"enable_edge_hardness": "soft"`),
  no `title` field. The update converted every cartridge listed in `library.db`
  (30: 24 known games and 6 unknown cartridges). The 7 files left in the old
  camelCase format belonged to game folders not in `library.db` (orphaned
  folders the console no longer tracks).
- For each newly added game the console writes a `settings.json` whose
  `library.cartridge_color` is the cartridge's retail shell color (Armorines, a
  black cart, got `"black"`); gray otherwise.
- **library.db changed layout** (the header still says v1.0). Seen on a card
  with 32 games (71,729 bytes; 17,012 bytes with 31 games before the update):
  - `0x0000-0x10100`: the same header and 4096-slot cart ID table, followed by
    a stats table sized for all 4096 slots (4096 × 12 bytes) instead of one
    entry per game. Unused slots are mostly, but not entirely, `0xFF`.
  - `0x10100-end` (5,937 bytes here): a second block with its own
    `Analogue-Co` / `Analogue-3D.library` v1.0 header. At offset `0x1100` in
    this block is a string of the library titles' first letters in
    alphabetical order (e.g. `ABBBBCGHLMMMMNNNOSSSSTTVW`), probably the
    alphabetical index the release notes mention. Not decoded further.
  - A3D Manager never writes `library.db`. It reads only the header and the
    cart ID table (to find orphaned unknown folders), which kept their layout,
    so the change doesn't affect the app. The format section in
    ANALOGUE_3D_SD_CARD_FORMAT.md describes the layout before 1.5.1.
- The console's converted files don't fully match Analogue's published schema:
  they include `enable_edge_overshoot` in the `pvm`, `crt` and `scanlines` modes,
  which the schema (with `additionalProperties: false`) only allows in `bvm`.
- The console created `library.json` files (library customization for Unknown
  Cartridges, see [Analogue's platform docs](https://www.analogue.co/developer/docs/platform/library-json))
  for the 6 unknown cartridges in `library.db`, with placeholder data (`"title": "Unknown Cartridge"`,
  `"developers": ["Unknown"]`) and default settings.

---

## 3D OS 1.2.0

Release Date: January 2026

### New Hardware Settings

| Setting | Type | Values | Description |
|---------|------|--------|-------------|
| `forceProgressiveOutput` | boolean | true/false | Forces progressive video output mode |

### File Format Changes

- **library.db**: No changes (remains v1.0)
- **labels.db**: No changes (remains v2.0)
- **controller_pak.img**: No changes (32KB raw format)
- **settings.json**: Added `hardware.forceProgressiveOutput` field

### Notes

- The `forceProgressiveOutput` setting only appears in settings.json files
  that were created or modified after updating to 1.2.0
- Older settings files remain compatible and work without this field

---

## 3D OS 1.1.x and Earlier

### Baseline Format Versions

| File | Version | Notes |
|------|---------|-------|
| library.db | v1.0 (0x00010000) | Game library with play statistics (addedTime, playTime) |
| labels.db | v2.0 (0x00020000) | Cartridge label artwork database |
| controller_pak.img | - | 32KB raw N64 Controller Pak dump |
| settings.json | - | JSON with 8 hardware settings |

### library.db Play Statistics

The library.db extended data section (offset 0x4100) was present from the initial release and tracks per-game statistics:

| Field | Description |
|-------|-------------|
| addedTime | Timestamp when game was first added to library (minutes since Unix epoch, Jan 1 1970) |
| playTime | Total cumulative play time in seconds |
| sessions | Number of times the game has been launched |

See [ANALOGUE_3D_SD_CARD_FORMAT.md](./ANALOGUE_3D_SD_CARD_FORMAT.md) for complete format specification.

### Original Hardware Settings

- virtualExpansionPak
- region
- disableDeblur
- enable32BitColor
- disableTextureFiltering
- disableAntialiasing
- forceOriginalHardware
- overclock
