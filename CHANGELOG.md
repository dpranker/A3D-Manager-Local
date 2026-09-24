# Changelog

All notable changes to A3D Manager Local. Each release's section is used as its GitHub release notes.

## [Unreleased]

### Added

- **Many more games recognized:** the cartridge database grew from 343 to 936 IDs, covering nearly every retail release and revision in every region (including Japanese games such as Neon Genesis Evangelion). These games no longer show as "Unknown Cartridge" or get the Library tab.
- **Alternate search names** from [n64-flashcart-menu-metadata](https://github.com/n64-tools/n64-flashcart-menu-metadata), so common alternate spellings of game titles also match in search.
- **Clean up orphaned unknowns** (Settings → Cartridge List): finds "Unknown Cartridge" folders on the SD card that the console no longer tracks in its `library.db`, and deletes the ones you select.
- **Screenshots tab** for each cartridge: browse the screenshots and 4K exports the console saved on the SD card, view them full size (at the console's 4:3 shape), save copies, and delete them.
- **Memories tab** for each cartridge: lists the console's Memories (save states) with when they were made and on which 3D<sup>os</sup> version, and backs them up as the complete, unchanged files, one at a time or all at once as a zip. The app never changes or deletes Memories.
- A **Custom** tag in the cartridge grid marks carts outside the built-in database (homebrew, flash carts, reproductions).

### Changed

- The firmware check shows smoother feedback while checking.

### Fixed

- **Interrupted transfers no longer damage files.** Everything the app writes, locally and to the SD card (labels, settings, `library.json`, Controller Pak saves, ownership and custom names), is written to a temporary file first and only then swapped in. If the app closes or the card is pulled mid-transfer, the previous file is still there, whole.
- **Replaced files are kept.** Syncing labels keeps the previous `labels.db` as `labels.db.bak`, on the card and locally. Replacing a local Controller Pak save keeps the old one as `controller_pak.img.bak`.
- **Downloading labels from the SD card checks the file first**, so an invalid `labels.db` on the card can't replace your local labels.
- **Your owned list and custom names can't be wiped by a damaged file.** If `owned-carts.json` or `user-carts.json` can't be read, it's kept as a `.corrupt-<time>` copy and the change shows an error, instead of the next change overwriting it with an empty list.
- **Simultaneous changes no longer overwrite each other** (ownership, custom names, label edits, Controller Pak backups).
- **"Labels Synced" checks the SD card you selected**, not whichever card was detected first, and a result for a previously selected card is ignored.
- **Copying a Controller Pak save to a card without that game's folder** no longer fails for titles with characters the card can't store (such as `:`). New card folders are named the same way for settings, `library.json` and Controller Pak saves.
- The app rejects any SD card path that isn't an Analogue 3D card, for every card operation.

## [0.1.0] - 2026-09-23

First release of A3D Manager Local, a fork of [TheLeggett/A3D-Manager](https://github.com/TheLeggett/A3D-Manager). See the [README](https://github.com/dpranker/A3D-Manager-Local#readme) for the full feature list and install instructions.

### Downloads

- **Linux:** `A3D-Manager-Local-0.1.0-x86_64.AppImage`
- **Windows:** `A3D-Manager-Local-0.1.0-x64.exe` (not code-signed; SmartScreen warns on first run)

### New compared to upstream

- **Desktop app** (Electron) with a native SD card picker, packaged as a Linux AppImage and a Windows installer. Upstream runs in a browser or Docker.
- **3D<sup>os</sup> firmware updates:** check for new releases, read the release notes, and copy the update to the SD card, verified against Analogue's checksum.
- **3D<sup>os</sup> 1.5.1 support:** reads and writes the new `settings.json` format, with the new options (Horizontal Upscaling, Overclock Off, Cartridge Color). Settings are only written to cards whose console is on 1.5.1 or later.
- **Library tab** for unknown cartridges (homebrew, flash carts, reproductions): edits their `library.json` title, details and default settings.
- **Cartridge colors:** the grid shows each cartridge in its console color, including default retail colors for carts that shipped in colored shells.
- **Fixes:** per-game settings now auto-save (upstream's Settings tab never saved), and game-name lookups work.
- **Other:** app icon, the Cartridges page remembers your All/Owned choice, Earthworm Jim 3D added to the cart database, Node.js 22.12+ required to run from source.

### Coming next

- **Missing game IDs:** many retail games (especially Japanese releases) still show as "Unknown Cartridge"; the cart database will be expanded to cover nearly every release.
- **Screenshot management** for the console's Gallery and Memories folders.

### Known issues

- On Ubuntu 24.04 and later, start the AppImage with `--no-sandbox` if it doesn't open.
- The dev version (`npm run electron:dev`) and the AppImage keep separate data folders.
