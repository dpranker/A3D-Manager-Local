# Analogue 3D SD Card Format Documentation

This document describes the file structure and formats used by the Analogue 3D (N64) SD card.

## Directory Structure

```
/
├── Library/
│   └── N64/
│       ├── Games/
│       │   └── [Game Title] [hex_id]/
│       │       ├── controller_pak.img    # Virtual Controller Pak save data (32KB)
│       │       └── settings.json         # Per-game settings
│       ├── Images/
│       │   └── labels.db                 # Master label/artwork database (22MB)
│       └── library.db                    # Game library database
└── Settings/
    └── Global/                           # Global settings (may be empty)
```

## Game Folders

Each game the system recognizes gets a folder in `/Library/N64/Games/`.

### Folder Naming Convention

```
[Game Title] [8-character hex ID]
```

Examples:
- `GoldenEye 007 ac631da0`
- `Super Mario 64 b393776d`
- `Unknown Cartridge 1c414340`

**Important**: The game title displayed by the Analogue 3D is determined internally by the console's firmware, NOT from the folder name. Renaming the folder or updating `settings.json` has no effect on the displayed title. The Analogue 3D uses its own internal database to identify games by their cartridge ID.

### Hex ID (Cartridge Identification)

The 8-character hex ID is a unique identifier for each physical cartridge. **The Analogue 3D computes this ID by calculating a CRC32 checksum of the first 8 KiB (8,192 bytes) of the ROM data.**

For complete technical details, see **[CART_ID_ALGORITHM.md](./CART_ID_ALGORITHM.md)**.

#### Quick Reference

| Property | Value |
|----------|-------|
| Algorithm | CRC32 (IEEE 802.3) |
| Input | First 8,192 bytes of ROM (Z64 format) |
| Output | 8 lowercase hex characters |

#### Calculating Cart IDs

```bash
npx tsx scripts/compute-a3d-id.ts "game.z64"
npx tsx scripts/compute-a3d-id.ts /path/to/roms --batch
```

#### ID Characteristics

- Known games have IDs recognized by Analogue's internal database
- Unknown cartridges (flash carts, homebrew) get unique IDs based on ROM content
- The special ID `fffffffe` is a placeholder for unidentified cartridges

## File Formats

### controller_pak.img (Controller Pak Save Data)

**Format**: Raw N64 Controller Pak memory dump
**Size**: 32,768 bytes (32KB) - exactly 256Kbit
**Purpose**: Virtual Controller Pak save data for games that use the N64 memory card

The N64 Controller Pak was a memory card that plugged into the controller for saving game progress. This file emulates that storage for each game.

**Structure**:
- Pages: 123 pages of 256 bytes each
- First pages contain index/allocation tables
- Remaining pages store actual save data

**Note**: The `file` command may misidentify this as a TGA image due to coincidental byte patterns, but it is NOT an image file.

### settings.json (Per-Game Configuration)

JSON configuration file for each game with its display, library and hardware settings.

**Format change in 3D OS 1.5.1:** the update rewrote every `settings.json` for the
cartridges in `library.db` in a new format (and reset hardware settings to new
defaults). Analogue documents it at
[developer/docs/platform/settings-json](https://www.analogue.co/developer/docs/platform/settings-json)
with a JSON schema at `https://schemas.analogue.co/platform/3d/settings.json`
(copy in [analogue-schemas/3d-settings.json](./analogue-schemas/3d-settings.json)).
The docs say a file that fails validation is overwritten with defaults at the next boot.

#### Format (3D OS 1.5.1+)

Example written by the console (Turok 3 after the 1.5.1 update; `pvm`, `crt` and
`scanlines` have the same fields as `bvm`):

```json
{
  "$schema": "https://schemas.analogue.co/platform/3d/settings.json",
  "display": {
    "odm": "bvm",
    "catalog": {
      "bvm": {
        "horizontal_beam_convergence": "professional",
        "vertical_beam_convergence": "professional",
        "enable_edge_overshoot": false,
        "enable_edge_hardness": "soft",
        "image_fit": "original",
        "image_size": "fill"
      },
      "pvm": { ... },
      "crt": { ... },
      "scanlines": { ... },
      "clean": {
        "interpolation_alg": "bc-spline",
        "gamma_transfer_function": "tube",
        "sharpness": "medium",
        "image_fit": "original",
        "image_size": "fill"
      }
    }
  },
  "library": {
    "cartridge_color": "gray"
  },
  "hardware": {
    "disable_antialiasing": false,
    "disable_deblur": false,
    "disable_texture_filtering": false,
    "enable_32_bit_color": true,
    "force_original_hardware": false,
    "force_progressive_output": true,
    "overclock": "auto",
    "region": "auto",
    "virtual_expansion_pak": true,
    "horizontal_upscaling": true
  }
}
```

| Setting | Values |
|---------|--------|
| `display.odm` | `bvm`, `pvm`, `crt`, `scanlines`, `clean` |
| `horizontal_beam_convergence`, `vertical_beam_convergence` | `consumer`, `professional`, `off` |
| `enable_edge_overshoot` | boolean (only adjustable in `bvm`; see below) |
| `enable_edge_hardness` | `soft`, `hard` (a boolean before 1.5.1) |
| `image_fit` | `original`, `stretch`, `cinema-zoom` |
| `image_size` | `fill`, `integer`, `integer-plus` |
| `interpolation_alg` | `bc-spline`, `bilinear`, `blackman-harris`, `lanczos2` |
| `gamma_transfer_function` | `tube`, `modern` |
| `sharpness` | `very-soft`, `soft`, `medium`, `sharp`, `very-sharp` |
| `library.cartridge_color` | `gray`, `red`, `green`, `blue`, `yellow`, `gold`, `black`, `purple`, `rose` |
| `hardware.overclock` | `off`, `auto`, `enhanced`, `enhanced-plus`, `unleashed` |
| `hardware.region` | `auto`, `ntsc`, `pal` |
| other `hardware.*` | boolean |

**Schema vs. console:** the published schema has `additionalProperties: false` and
only lists `enable_edge_overshoot` for `bvm`, but 3D OS 1.5.1 writes it in `pvm`,
`crt` and `scanlines` too (locked to `true`, `true` and `false`). Every file the
console wrote in testing failed the published schema for that reason only.
A3D Manager writes files in the console's shape.

#### Before 3D OS 1.5.1

Older firmware wrote camelCase keys with Title-case values (for example
`"horizontalBeamConvergence": "Professional"`, `"overclock": "Enhanced+"`), a
top-level `"title"`, and JSON with trailing commas. Files in this format that the
1.5.1 update didn't convert (game folders no longer in `library.db`) are ignored
by the console. A3D Manager detects them but doesn't use or convert them, because
the update reset the settings they describe.

### library.db (Game Library Database)

**Format**: Proprietary Analogue binary format
**Size**: Variable (~16KB minimum, grows with entries)
**Location**: `/Library/N64/library.db`
**Purpose**: Index of all games and their play statistics

#### Overview

The library.db file tracks which games have been played on the Analogue 3D and stores play statistics for each game including:
- **Added Time**: When the game was first added to the library
- **Play Time**: Total cumulative play time in seconds
- **Sessions**: Number of times the game has been launched

#### Structure

```
Offset      Size      Description
────────────────────────────────────────────────────────────────
0x00        1         Magic byte (0x07)
0x01        31        Identifier "Analogue-Co" (null-padded to 32 bytes)
0x20        32        File type "Analogue-3D.library" (null-padded)
0x40        4         Version (0x00010000 = v1.0)
0x44        4         Unknown (observed: 0x00010000)
0x48-0xFF             Reserved (zeros)

0x100       16KB      Cart ID Table - Fixed array of 4096 32-bit little-endian cart IDs
                      Empty slots contain 0xFFFFFFFF

0x4100      N×12      Extended Data - Per-cart statistics (12 bytes each)
                      Corresponds 1:1 with Cart ID Table entries
```

#### Cart ID Table (0x100 - 0x40FF)

The cartridge IDs are stored in **little-endian** format:
- Folder `ac631da0` → stored as `a0 1d 63 ac`
- Folder `e5240d18` → stored as `18 0d 24 e5`
- Empty slot → stored as `ff ff ff ff`

#### Extended Data Section (0x4100+)

Each cart has 12 bytes of extended data at offset `0x4100 + (index × 12)`:

| Offset | Size | Type | Description |
|--------|------|------|-------------|
| +0 | 4 | uint32_le | `addedTime` - Minutes since Unix epoch (Jan 1, 1970) |
| +4 | 4 | uint32_le | `playTime` - Total play time in seconds |
| +8 | 4 | uint32_le | `sessions` - Number of times the game has been launched |

#### Timestamp Format

The `addedTime` field stores time as **minutes since the Unix epoch** (January 1, 1970 00:00:00 UTC), not seconds.

**Converting addedTime to Date:**
```javascript
// addedTime × 60 × 1000 = milliseconds since Unix epoch
const date = new Date(addedTime * 60 * 1000);
```

**Converting Date to addedTime:**
```javascript
// Date in milliseconds ÷ 1000 ÷ 60 = minutes since Unix epoch
const addedTime = Math.floor(date.getTime() / 1000 / 60);
```

**Note:** The Analogue 3D stores and displays times in local time. When setting dates programmatically, use local time values to match what the console displays.

#### Example

For a game at index 5 in the Cart ID Table:
- Cart ID location: `0x100 + (5 × 4) = 0x114`
- Extended data location: `0x4100 + (5 × 12) = 0x413C`

If the extended data bytes at 0x413C are:
```
a0 e7 b5 01  |  45 01 00 00  |  00 00 00 00
```

This decodes as:
- `addedTime`: 0x01B5E7A0 = 28,829,600 minutes since epoch → Jan 31, 2025 8:33 AM
- `playTime`: 0x00000145 = 325 seconds (5 minutes 25 seconds)
- `sessions`: 0x00000000 = 0 (game added to library but never launched)

### labels.db (Master Label/Artwork Database)

**Format**: Proprietary Analogue binary format
**Size**: Variable (depends on number of entries)
**Purpose**: Label artwork for N64 games displayed in the carousel UI

This is the primary source of game artwork. When a cartridge is inserted, the system looks up its ID in this database to display the appropriate label image.

| Property | Value |
|----------|-------|
| Location | `/Library/N64/Images/labels.db` |
| Image Dimensions | 74 × 86 pixels |
| Color Format | BGRA (Blue, Green, Red, Alpha) |
| Bytes Per Image Slot | 25,600 |

For complete technical specification, see **[LABELS_DB_SPECIFICATION.md](./LABELS_DB_SPECIFICATION.md)**.

**Note**: This file is user-generated. The Analogue 3D does not ship with a pre-populated labels.db. Community resources like [retrogamecorps/Analogue-3D-Images](https://github.com/retrogamecorps/Analogue-3D-Images) provide stock artwork.

## Cartridge Recognition Flow

When a cartridge is inserted:

1. The Analogue 3D reads the cartridge and computes its unique hex ID
2. It looks up this ID in its internal firmware database to determine the game title
3. The game folder in `/Library/N64/Games/` is created/accessed using this ID
4. Artwork is loaded from `labels.db` using the cartridge ID as a lookup key
5. Unknown cartridges not in the firmware database display as "Unknown Cartridge"
6. Unknown cartridges not in `labels.db` display with no artwork

## Customizing Unknown Cartridges

### Game Names (Not Customizable)

Unfortunately, the Analogue 3D does not support renaming games through the SD card. The console uses an internal firmware database to determine game titles based on cartridge ID. Modifications to folder names or `settings.json` files have no effect on the displayed title.

Unknown cartridges (flash carts, homebrew, etc.) will always display as "Unknown Cartridge" regardless of what the folder is named on the SD card.

### Adding Custom Artwork

Custom artwork can be added to `labels.db` to display label images for any cartridge, including unknown ones. The A3D Manager tool can:
1. Add new entries to the labels database
2. Update existing label artwork
3. Export the modified database back to your SD card

See **[LABELS_DB_SPECIFICATION.md](./LABELS_DB_SPECIFICATION.md)** for technical details.

## Notes

- All files use `rwx------` (700) permissions
- macOS may create `._` metadata files (e.g., `._labels.db`) - these are safe to ignore
- The `Settings/Global/` directory may be empty or contain global device settings
- For changes across firmware versions, see **[FIRMWARE_CHANGELOG.md](./FIRMWARE_CHANGELOG.md)**
