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

          <h3>4. Sync to Your SD Card</h3>
          <ul>
            <li>
              Label changes stay on your computer until you click "Sync Now" next to the label status in the
              header, which writes <code>labels.db</code> to your SD card
            </li>
            <li>
              Per-game settings are saved to the SD card automatically while it's connected. This needs a console
              on 3D<sup>os</sup> 1.5.1 or later, which changed the settings format; for older cards the app explains
              how to update first
            </li>
            <li>
              Controller Pak saves are copied between your computer and the card from the Game Pak tab, which
              also helps you choose when the two differ
            </li>
          </ul>

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
            <li>Changes are stored locally until you explicitly sync to SD card</li>
            <li>You can safely close the app without losing your local changes</li>
          </ul>
        </section>

        <section className="help-section">
          <h2>Technical Details</h2>
          <p>
            If you're interested in the technical workings of the Analogue 3D SD card format,
            check out the documentation in the project repository:
          </p>
          <ul>
            <li><code>docs/LABELS_DB_SPECIFICATION.md</code> — Label database binary format</li>
            <li><code>docs/ANALOGUE_3D_SD_CARD_FORMAT.md</code> — Complete SD card structure</li>
            <li><code>docs/CART_ID_ALGORITHM.md</code> — How cartridge IDs are computed</li>
            <li><code>docs/FIRMWARE_CHANGELOG.md</code> — Format changes across 3D<sup>os</sup> versions</li>
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
            <li><a href="https://github.com/mroach/rom64/tree/master" target="_blank" rel="noopener noreferrer">mroach</a> for the an incredible roms.dat.xml file that helped us generate titles for cart labels</li>
            <li>All contributors who computed and contributed cart IDs to the database</li>
          </ul>
        </section>
      </div>
    </div>
  );
}
