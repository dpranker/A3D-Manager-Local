# Cartridge data sources

The app matches Analogue cartridge IDs (CRC32 of the first 8 KiB of big-endian ROM data), not N64 game codes. `data/cart-names.json` retains the original project's 343 ID mappings and adds 593 IDs computed from locally supplied retail ROMs and revisions, for 936 entries.

## N64 Flashcart Menu metadata

Thanks to [n64-tools/n64-flashcart-menu-metadata](https://github.com/n64-tools/n64-flashcart-menu-metadata) and its contributors! Its metadata is released under the [Unlicense](https://github.com/n64-tools/n64-flashcart-menu-metadata/blob/main/LICENSE). We source alternate searchable game names from its `metadata.ini` files, matched by exact four-character game code. Artwork and descriptions are not bundled. ROM filenames supply region/revision display names.

To refresh from a local checkout after importing ROM IDs:

```sh
python3 scripts/import-flashcart-metadata.py /path/to/n64-flashcart-menu-metadata
```

The script updates `flashcartName` in the shipped database and writes [the comparison report](flashcart-metadata-comparison.json), including the upstream commit. The comparison now matches 305 of 307 metadata game codes (previously 295). The remaining two, `ZSAJ` (Vivid Dolls) and `ZSEA` (Super Real Mahjong VS), are Aleck64 arcade games. Local copies were flashcart conversions and deliberately excluded. Some upstream folders have only artwork: Evangelion (`NEVJ`) has no `metadata.ini` at this revision.

## ROM-derived IDs

```sh
python3 scripts/import-rom-cart-ids.py /path/to/retail-roms /path/to/retail-revisions
# Review the counts, then write the additions:
python3 scripts/import-rom-cart-ids.py /path/to/retail-roms /path/to/retail-revisions --write
```

The importer recursively reads only the first 8,192 bytes of `.z64`, `.v64`, and `.n64` files, normalizes byte order, and calculates IEEE CRC32. It takes the game code and revision from the header and the display name from the ROM filename. Existing entries are preserved. It adds each ID only once, in deterministic path order. ROM payloads are never copied into the repository.

Pass only trusted, unmodified retail/revision directories. Hacks and translations can share the original's first 8 KiB, so their names cannot safely identify a cartridge. The import used the US, Europe, Japan, Other Regions, and Revisions folders of the supplied collection. Hacks, translations, homebrew, tools, unlicensed and Aleck64 folders were excluded; filenames marked as patched, hacks, translations, GameCube builds, prototypes, demos or aftermarket were also excluded. These checks cannot detect an unmarked modified ROM.

[The import report](rom-cart-id-import.json) records the 593 new mappings from 947 files (354 already-known IDs, no read/format failures). All 343 original mappings are preserved; the import does not reclassify existing data.

Computed IDs were independently checked against these local collection folder IDs:

| Analogue ID | ROM title |
| --- | --- |
| `6758d3c4` | Neon Genesis Evangelion (Japan) |
| `5743ee3c` | Bass Rush - ECOGEAR PowerWorm Championship (Japan) |
| `1a9280c1` | HSV Adventure Racing! (Australia) |
| `53d8a515` | The Legend of Zelda: Ocarina of Time (USA, Rev 1) |
| `996b9452` | Virtual Pro Wrestling 2 - Oudou Keishou (Japan) |

The [Analogue platform overview](https://www.analogue.co/developer/docs/platform/overview) links the official settings/library configuration formats. Those pages do not specify the cartridge hash algorithm; the implementation follows this project's [documented algorithm](CART_ID_ALGORITHM.md), verified against observed card IDs.

## Verification

```sh
python3 -m unittest discover -s tests/rom-cart-ids
node --import tsx tests/run.ts
```

The importer tests cover all three byte orders, rejection of invalid/short headers, the 8 KiB boundary, region and revision parsing. The app tests check database ID uniqueness and runtime lookups, including Japanese Evangelion.
