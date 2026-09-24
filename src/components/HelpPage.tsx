import './HelpPage.css';

export function HelpPage() {
  return (
    <div className="help-page">
      <div className="help-content">
        <h1>About A3D Manager</h1>

        <section className="help-section">
          <h2>What is this?</h2>
          <p>
            A3D Manager is an unofficial, community-created utility for managing your Analogue 3D (N64)
            SD card. It lets you browse your cartridge collection and edit label artwork (the{' '}
            <code>labels.db</code> file the console uses to display game artwork), per-game display and
            hardware settings, and Controller Pak saves, then sync them to your SD card. It can also check
            for 3D<sup>os</sup> firmware updates and copy them to the card.
          </p>
        </section>

        <section className="help-section disclaimer">
          <h2>Important Disclaimer</h2>
          <div className="warning-box">
            <p>
              <strong>This is NOT official Analogue software.</strong> This tool is a community project
              and is not affiliated with, endorsed by, or supported by Analogue.
            </p>
            <p>
              <strong>Use at your own risk.</strong> While we've taken care to ensure this tool works correctly,
              we are not responsible for any data loss, corruption, or damage to your SD card or Analogue 3D.
              Always back up your SD card before making changes.
            </p>
          </div>
        </section>

        <section className="help-section">
          <h2>How to Use This Tool</h2>

          <h3>1. Connect Your SD Card</h3>
          <ul>
            <li>Insert your Analogue 3D SD card; the header shows "SD Card Connected" once it's detected</li>
            <li>
              In the desktop app, click "Choose SD Card…" in the header to pick the card (or the folder it's
              mounted under). The web version finds it using the <code>SD_VOLUMES_PATH</code> setting
            </li>
          </ul>

          <h3>2. Browse Your Cartridges</h3>
          <ul>
            <li>The Cartridges page lists every cartridge in your local library</li>
            <li>Search by game name or cartridge ID (hex code), and filter by region, language and video mode</li>
            <li>Switch between All and Owned to focus on your own collection</li>
            <li>Use "Import Owned from SD" to mark the cartridges on your SD card as owned</li>
            <li>Use "Select" to act on several cartridges at once, e.g. pasting settings</li>
          </ul>

          <h3>3. Edit a Cartridge</h3>
          <ul>
            <li>
              <strong>Label:</strong> upload a PNG or JPG. It's resized to 74×86 pixels, converted to the
              console's format and saved locally
            </li>
            <li>
              <strong>Settings:</strong> per-game display mode and hardware settings, and the cartridge color
              the console uses in its library (also shown in the cartridge grid). Copy them from one cartridge
              and paste them to others
            </li>
            <li>
              <strong>Library</strong> (unknown cartridges only, 3D<sup>os</sup> 1.5.1+): title, developers,
              publishers, release year, players, regions, accessories and default settings. The title also
              becomes the cartridge's name in A3D Manager
            </li>
            <li>
              <strong>Game Pak:</strong> manage the cartridge's virtual Controller Pak save and its backups
            </li>
            <li>
              <strong>Screenshots:</strong> the screenshots and 4K exports the console saved for this cartridge on
              the SD card. View them, save copies (exactly as the console wrote them) and delete them
            </li>
            <li>
              <strong>Memories:</strong> the cartridge's Memories (save states) on the SD card. Back them up as the
              complete file, or all at once as a zip; A3D Manager never changes or deletes them
            </li>
          </ul>

          <h3>4. Save and Sync Your Changes</h3>
          <table className="help-save-table">
            <caption>How each type of cartridge data is saved</caption>
            <thead>
              <tr><th scope="col">Data</th><th scope="col">How it saves</th></tr>
            </thead>
            <tbody>
              <tr>
                <th scope="row">Labels</th>
                <td>Saved locally when you update the label. Use <strong>Sync Now</strong> in the header to copy labels to the SD card.</td>
              </tr>
              <tr>
                <th scope="row">Settings</th>
                <td>Autosaved locally after a short pause, and copied to a connected, supported SD card.</td>
              </tr>
              <tr>
                <th scope="row">Library details</th>
                <td>Click <strong>Save</strong> or <strong>Create library.json</strong>. Saves locally and to a connected, supported SD card.</td>
              </tr>
              <tr>
                <th scope="row">Controller Pak saves</th>
                <td>Use the Game Pak tab to download from the card, upload to it, or restore a backup.</td>
              </tr>
            </tbody>
          </table>
          <p>
            Writing Settings and Library details to a card requires a console running 3D<sup>os</sup> 1.5.1
            or later. If the card uses an older format, follow the app's update instructions first.
          </p>

          <h3>Save Status and Retry</h3>
          <p>
            In the cartridge's Settings tab, <strong>Unsaved changes</strong> means an autosave is waiting;
            <strong> Saving…</strong> means it is in progress. If a save fails, resolve the reported problem
            and click <strong>Retry</strong>. For example, reconnect the card if it was disconnected.
          </p>
          <p>
            A local save can succeed even if the SD card copy fails. Check the message before assuming the
            card is up to date, and retry the card operation after resolving the problem. Before closing,
            finish manual saves in the Label and Library tabs, wait for transfers to complete, and resolve
            any save errors. The desktop app attempts to finish pending settings saves when you close it.
          </p>

          <h3>Choosing Which Labels to Keep</h3>
          <p>
            Click <strong>Sync Now</strong> beside the label status in the header. When both your computer
            and the card have labels, the dialog shows which cartridges have different artwork or labels
            on only one side. Review those differences before choosing:
          </p>
          <ul>
            <li><strong>Use Local Labels:</strong> replace the SD card's label database with the one on your computer.</li>
            <li><strong>Use SD Card Labels:</strong> replace your computer's label database with the one on the card.</li>
          </ul>
          <p>
            This replaces the entire destination <code>labels.db</code>; it does not merge individual labels.
            Labels found only in the destination will no longer be in the active database after replacement.
          </p>

          <h3>5. Settings Page</h3>
          <ul>
            <li>
              <strong>Firmware:</strong> check for new 3D<sup>os</sup> releases, read the release notes and
              copy the update to your SD card. The console installs it the next time it's powered on
            </li>
            <li><strong>Backup & Restore:</strong> export or import <code>.a3d</code> bundles of your data</li>
            <li>Import a <code>labels.db</code> file, clear the image cache, or delete local or SD card data</li>
            <li>"Show Advanced Settings" lets you add a cartridge manually by its ID</li>
          </ul>
        </section>

        <section className="help-section">
          <h2>Backup & Restore</h2>
          <p>
            In Settings, use <strong>Export Bundle</strong> to back up your managed local data as an{' '}
            <code>.a3d</code> file. To export only certain cartridges, select them on the Cartridges page
            and export that selection. Choose what to include:
          </p>
          <ul>
            <li><strong>Labels:</strong> artwork and custom cartridge names.</li>
            <li><strong>Settings:</strong> per-game display and hardware settings, plus Library details.</li>
            <li><strong>Game Paks:</strong> locally stored Controller Pak saves.</li>
            <li><strong>Game Pak Backups:</strong> saved backup copies, selected separately from current saves.</li>
            <li><strong>Ownership Data:</strong> your owned-cartridge list.</li>
          </ul>
          <p>
            Bundles contain the data stored on your computer. Download any Controller Pak saves you want
            from the card before exporting. A bundle is not a complete SD card backup: Screenshots,
            Memories and firmware are not included. Save Screenshots and back up Memories from their
            cartridge tabs, or copy the whole SD card separately.
          </p>
          <p>
            Use <strong>Import Bundle</strong> in Settings, select a file, and choose the data to restore.
            <strong> Keep existing (skip duplicates)</strong> preserves existing data where it conflicts;
            <strong> Overwrite with imported data</strong> replaces conflicting data for the selected categories.
            Ownership is merged, and identical Game Pak backups are deduplicated. Importing a full labels
            database replaces that database as a whole when overwrite is selected.
          </p>
          <p>
            Review the import results for skipped entries and errors, even if some items imported
            successfully. Imported data is stored locally; use the appropriate save or sync action above
            to copy it to your SD card.
          </p>
        </section>

        <section className="help-section">
          <h2>Tips & Best Practices</h2>
          <ul>
            <li><strong>Always back up your SD card</strong> before syncing changes</li>
            <li>
              <strong>Eject the SD card in your file manager before removing it.</strong> Writes can still be
              in progress after the app reports success, and pulling the card early can leave incomplete files
            </li>
            <li>Test with one or two labels first before doing a full sync</li>
            <li>Use high-quality source images for best results</li>
            <li>The tool automatically handles image resizing and format conversion</li>
            <li>Check save status and finish manual saves before closing the app</li>
          </ul>
        </section>

        <section className="help-section">
          <h2>How the Analogue 3D Works</h2>

          <h3>Cartridge Recognition</h3>
          <p>
            When you insert a cartridge, the Analogue 3D computes a unique identifier (CRC32 hash)
            from the first 8 KB of the ROM data. This ID is used to:
          </p>
          <ul>
            <li>Look up the game title in the console's internal firmware database</li>
            <li>Create a folder on your SD card at <code>/Library/N64/Games/[Game Name] [hex_id]/</code></li>
            <li>Find matching artwork in <code>labels.db</code> to display in the console's menu</li>
          </ul>

          <h3>Label Artwork Database</h3>
          <p>
            The file at <code>/Library/N64/Images/labels.db</code> contains all the label artwork
            displayed on your Analogue 3D. Each image is:
          </p>
          <ul>
            <li>74 × 86 pixels in size</li>
            <li>Stored in BGRA color format (Blue, Green, Red, Alpha)</li>
            <li>Indexed by the cartridge's unique hex ID</li>
          </ul>
          <p>
            The Analogue 3D does not ship with artwork pre-installed. You need to either create
            your own or use community resources like{' '}
            <a href="https://github.com/retrogamecorps/Analogue-3D-Images" target="_blank" rel="noopener noreferrer">
              retrogamecorps/Analogue-3D-Images
            </a>.
          </p>

          <h3>Game Names and Unknown Cartridges</h3>
          <p>
            <strong>Known games can't be renamed through the SD card.</strong> The Analogue 3D takes their
            titles from its internal database, so renaming folders or editing <code>settings.json</code>{' '}
            files has no effect on what the console displays.
          </p>
          <p>
            Unknown cartridges (flash carts, homebrew, reproduction carts) appear as "Unknown Cartridge".
            Since 3D<sup>os</sup> 1.5.1 you can give them a title, developer, publisher, release year and
            default settings with a <code>library.json</code> file in the game's folder (see{' '}
            <a href="https://www.analogue.co/developer/docs/platform/library-json" target="_blank" rel="noopener noreferrer">
              Analogue's library.json docs
            </a>
            ). In A3D Manager, open the cartridge and use its <strong>Library</strong> tab. You can add custom
            label artwork for any cartridge, known or unknown.
          </p>
        </section>

        <section className="help-section">
          <h2>Technical Details</h2>
          <p>
            If you're interested in the technical workings of the Analogue 3D SD card format,
            check out the documentation in the project repository:
          </p>
          <ul>
            <li><a href="https://github.com/dpranker/A3D-Manager-Local/blob/main/docs/LABELS_DB_SPECIFICATION.md" target="_blank" rel="noopener noreferrer"><code>docs/LABELS_DB_SPECIFICATION.md</code></a> — Label database binary format</li>
            <li><a href="https://github.com/dpranker/A3D-Manager-Local/blob/main/docs/ANALOGUE_3D_SD_CARD_FORMAT.md" target="_blank" rel="noopener noreferrer"><code>docs/ANALOGUE_3D_SD_CARD_FORMAT.md</code></a> — Complete SD card structure</li>
            <li><a href="https://github.com/dpranker/A3D-Manager-Local/blob/main/docs/CART_ID_ALGORITHM.md" target="_blank" rel="noopener noreferrer"><code>docs/CART_ID_ALGORITHM.md</code></a> — How cartridge IDs are computed</li>
            <li><a href="https://github.com/dpranker/A3D-Manager-Local/blob/main/docs/FIRMWARE_CHANGELOG.md" target="_blank" rel="noopener noreferrer"><code>docs/FIRMWARE_CHANGELOG.md</code></a> — Format changes across 3D<sup>os</sup> versions</li>
          </ul>
          <p>
            Analogue also documents the per-game files officially in its{' '}
            <a href="https://www.analogue.co/developer/docs/platform" target="_blank" rel="noopener noreferrer">
              platform docs
            </a>{' '}
            (<code>settings.json</code> and <code>library.json</code>) and publishes a{' '}
            <a href="https://www.analogue.co/developer/docs/api" target="_blank" rel="noopener noreferrer">
              firmware API
            </a>
            .
          </p>
        </section>

        <section className="help-section">
          <h2>Credits & Community</h2>
          <p>
            This tool was created by the community to help Analogue 3D owners customize their
            label artwork. Special thanks to:
          </p>
          <ul>
            <li><a href="https://github.com/retrogamecorps/Analogue-3D-Images" target="_blank" rel="noopener noreferrer">Retro Game Corps</a> for sharing their community label artwork collections</li>
            <li><a href="https://github.com/mroach/rom64/tree/master" target="_blank" rel="noopener noreferrer">mroach</a> for the roms.dat.xml file that helped us generate titles for cart labels</li>
            <li><a href="https://github.com/n64-tools/n64-flashcart-menu-metadata" target="_blank" rel="noopener noreferrer">n64-tools/n64-flashcart-menu-metadata</a> and its contributors for alternate searchable game names</li>
            <li>All contributors who computed and contributed cart IDs to the database. See our <a href="https://github.com/dpranker/A3D-Manager-Local/blob/main/docs/CART_DATA_SOURCES.md" target="_blank" rel="noopener noreferrer">cartridge data sources</a> for details.</li>
          </ul>
        </section>
      </div>
    </div>
  );
}
