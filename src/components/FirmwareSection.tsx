import { useCallback, useEffect, useState } from 'react';
import { useSDCard } from '../App';
import { ProgressBar } from './ProgressBar';
import { Button } from './ui';
import './FirmwareSection.css';

type ReleaseNotesBlock =
  | { type: 'heading'; text: string }
  | { type: 'paragraph'; text: string }
  | { type: 'list'; ordered: boolean; items: string[] };

interface FirmwareRelease {
  version: string;
  publishedAt: string | null;
  releaseNotesUrl: string;
  installGuideUrl: string;
  notes: ReleaseNotesBlock[];
}

interface SDFirmwareFile {
  name: string;
  version: string;
  size: number;
}

interface FirmwareStatus {
  latest: FirmwareRelease | null;
  newerReleases: FirmwareRelease[];
  checkedAt: string | null;
  feedError: string | null;
  sdCard: {
    files: SDFirmwareFile[];
    archivedFiles: SDFirmwareFile[];
    installedVersion: string | null;
    pendingVersion: string | null;
    consoleArchives: boolean;
    trashedFiles: { path: string; size: number }[];
  } | null;
  sdCardError: string | null;
  updateAvailable: boolean;
}

interface InstallProgress {
  phase: 'download' | 'copy';
  percentage: number;
  bytesWritten: string;
  totalBytes: string;
  speed: string;
  eta: string;
}

type InstallState =
  | { step: 'idle' }
  | { step: 'confirm' }
  | { step: 'running'; progress: InstallProgress | null }
  | { step: 'complete'; version: string; fileName: string; removed: string[] }
  | { step: 'error'; message: string };

function formatDate(iso: string | null): string {
  return iso ? new Date(iso).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }) : '';
}

/** Mirrors server/lib/firmware.ts firmwareFileName: "1.5.1" -> "a3d_os_01_05_01.bin" */
function firmwareFileName(version: string): string {
  return `a3d_os_${version.split('.').map((p) => p.padStart(2, '0')).join('_')}.bin`;
}

function formatMB(bytes: number): string {
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function ReleaseNotes({ release }: { release: FirmwareRelease }) {
  return (
    <details className="firmware-notes">
      <summary>
        What's new in 3D<sup>os</sup> {release.version}
        {release.publishedAt && <span className="firmware-muted"> · {formatDate(release.publishedAt)}</span>}
      </summary>
      <div className="firmware-notes-body">
        {release.notes.map((block, i) => {
          if (block.type === 'heading') return <h4 key={i}>{block.text}</h4>;
          if (block.type === 'paragraph') return <p key={i}>{block.text}</p>;
          const items = block.items.map((item, j) => <li key={j}>{item}</li>);
          return block.ordered ? <ol key={i}>{items}</ol> : <ul key={i}>{items}</ul>;
        })}
        <a href={release.releaseNotesUrl} target="_blank" rel="noopener noreferrer">
          Full release notes on analogue.co
        </a>
      </div>
    </details>
  );
}

export function FirmwareSection() {
  const { selectedSDCard } = useSDCard();
  const sdCardPath = selectedSDCard?.path ?? null;
  const [status, setStatus] = useState<FirmwareStatus | null>(null);
  const [checking, setChecking] = useState(false);
  const [install, setInstall] = useState<InstallState>({ step: 'idle' });

  const checkStatus = useCallback(
    async (refresh = false) => {
      setChecking(true);
      try {
        const params = new URLSearchParams();
        if (sdCardPath) params.set('sdCardPath', sdCardPath);
        if (refresh) params.set('refresh', '1');
        const response = await fetch(`/api/firmware/status?${params}`);
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        setStatus(await response.json());
      } catch (err) {
        setStatus({
          latest: null,
          newerReleases: [],
          checkedAt: null,
          feedError: err instanceof Error ? err.message : String(err),
          sdCard: null,
          sdCardError: null,
          updateAvailable: false,
        });
      } finally {
        setChecking(false);
      }
    },
    [sdCardPath],
  );

  useEffect(() => {
    checkStatus();
  }, [checkStatus]);

  const startInstall = () => {
    if (!sdCardPath) return;
    setInstall({ step: 'running', progress: null });
    const events = new EventSource(`/api/firmware/install-stream?sdCardPath=${encodeURIComponent(sdCardPath)}`);
    let finished = false;

    events.onmessage = (event) => {
      const data = JSON.parse(event.data);
      if (data.type === 'progress') {
        setInstall({
          step: 'running',
          progress: {
            phase: data.phase,
            percentage: data.percentage,
            bytesWritten: data.bytesWrittenFormatted,
            totalBytes: data.totalBytesFormatted,
            speed: data.speed,
            eta: data.eta,
          },
        });
      } else if (data.type === 'complete') {
        finished = true;
        events.close();
        setInstall({ step: 'complete', version: data.version, fileName: data.fileName, removed: data.removed });
        checkStatus();
      } else if (data.type === 'error') {
        finished = true;
        events.close();
        setInstall({ step: 'error', message: data.error });
        checkStatus();
      }
    };
    events.onerror = () => {
      events.close();
      if (!finished) {
        setInstall({ step: 'error', message: 'Lost connection to the server during the update' });
        checkStatus();
      }
    };
  };

  const latest = status?.latest ?? null;
  const sdCard = status?.sdCard ?? null;
  const oldRootFiles = sdCard?.files.filter((f) => f.version !== latest?.version) ?? [];
  const trashedBytes = sdCard?.trashedFiles.reduce((sum, f) => sum + f.size, 0) ?? 0;
  const running = install.step === 'running';

  let cardSummary: React.ReactNode;
  if (!sdCardPath) {
    cardSummary = 'Connect your SD card to see which version it has.';
  } else if (status?.sdCardError) {
    cardSummary = `Couldn't read the SD card: ${status.sdCardError}`;
  } else if (!sdCard) {
    cardSummary = 'Checking…';
  } else if (sdCard.pendingVersion) {
    cardSummary = (
      <>
        3D<sup>os</sup> {sdCard.pendingVersion} is on the card and will install the next time you power on your Analogue 3D
        {sdCard.installedVersion && <> (installed: {sdCard.installedVersion})</>}.
      </>
    );
  } else if (sdCard.installedVersion) {
    cardSummary = sdCard.consoleArchives ? (
      <>Installed: 3D<sup>os</sup> {sdCard.installedVersion}</>
    ) : (
      <>
        3D<sup>os</sup> {sdCard.installedVersion}
        <span className="firmware-muted">
          {' '}
          — the last update copied to this card ({sdCard.files[0]?.name}). If the console hasn't been powered on since,
          it installs next time.
        </span>
      </>
    );
  } else {
    cardSummary = 'No 3Dos update file on this card, so the installed version is unknown.';
  }

  return (
    <section className="settings-section">
      <h2>Firmware</h2>
      <p>
        Check for new 3D<sup>os</sup> releases and copy the update to your SD card. The console installs it
        automatically the next time it's powered on with the card inserted.
      </p>

      <div className="setting-row">
        <div className="setting-info">
          <h3>
            Latest release
            {latest && (
              <span className={`firmware-badge ${status?.updateAvailable ? 'firmware-badge--update' : ''}`}>
                {status?.updateAvailable ? 'Update available' : sdCard?.installedVersion || sdCard?.pendingVersion ? 'Up to date' : ''}
              </span>
            )}
          </h3>
          <p className="setting-description">
            {latest ? (
              <>
                3D<sup>os</sup> {latest.version}
                {latest.publishedAt && <> · released {formatDate(latest.publishedAt)}</>}
              </>
            ) : status?.feedError ? (
              `Couldn't check for updates: ${status.feedError}`
            ) : (
              'Checking…'
            )}
          </p>
          <p className="setting-description firmware-card-line">
            <strong>SD card:</strong> {cardSummary}
          </p>
          {status?.checkedAt && (
            <p className="setting-description firmware-muted">Last checked {new Date(status.checkedAt).toLocaleTimeString()}</p>
          )}
        </div>
        <Button variant="secondary" onClick={() => checkStatus(true)} loading={checking} disabled={running}>
          Check Now
        </Button>
      </div>

      {status?.updateAvailable && latest && sdCardPath && (
        <div className="setting-row firmware-install">
          <div className="setting-info">
            <h3>
              Copy 3D<sup>os</sup> {latest.version} to SD Card
            </h3>

            {install.step === 'idle' && (
              <p className="setting-description">
                Downloads the update from analogue.co and writes it to the root of your SD card
                {oldRootFiles.length > 0 && <>, replacing {oldRootFiles.map((f) => f.name).join(', ')}</>}.
              </p>
            )}

            {install.step === 'confirm' && (
              <p className="setting-description firmware-confirm">
                This writes <code>{firmwareFileName(latest.version)}</code> to the card root
                {oldRootFiles.length > 0 && <> and deletes {oldRootFiles.map((f) => f.name).join(', ')} from it</>}. Continue?
              </p>
            )}

            {install.step === 'running' && (
              <div className="firmware-progress">
                <p className="setting-description">
                  {install.progress?.phase === 'copy' ? 'Writing to SD card…' : 'Downloading from analogue.co…'}
                </p>
                <ProgressBar
                  progress={install.progress?.percentage}
                  showPercentage={Boolean(install.progress)}
                  transferDetails={
                    install.progress
                      ? {
                          bytesWritten: install.progress.bytesWritten,
                          totalBytes: install.progress.totalBytes,
                          speed: install.progress.speed,
                          eta: install.progress.eta,
                        }
                      : undefined
                  }
                />
              </div>
            )}

            {install.step === 'error' && <p className="setting-description firmware-error">{install.message}</p>}

            {latest.notes.length > 0 && install.step !== 'running' && (
              <div className="firmware-notes-list">
                {(status.newerReleases.length > 0 ? status.newerReleases : [latest]).map((release) => (
                  <ReleaseNotes key={release.version} release={release} />
                ))}
              </div>
            )}
          </div>

          {install.step === 'confirm' ? (
            <div className="firmware-actions">
              <Button variant="primary" onClick={startInstall}>
                Copy to SD Card
              </Button>
              <Button variant="ghost" onClick={() => setInstall({ step: 'idle' })}>
                Cancel
              </Button>
            </div>
          ) : (
            <Button variant="primary" onClick={() => setInstall({ step: 'confirm' })} loading={running}>
              {install.step === 'error' ? 'Try Again' : 'Update SD Card'}
            </Button>
          )}
        </div>
      )}

      {install.step === 'complete' && (
        <div className="setting-row firmware-complete">
          <div className="setting-info">
            <h3>
              3D<sup>os</sup> {install.version} is on your SD card
            </h3>
            <p className="setting-description">
              Wrote <code>{install.fileName}</code>
              {install.removed.length > 0 && <> and removed {install.removed.join(', ')}</>}. Next: eject the card, put
              it in your Analogue 3D and power on. The update starts automatically (yellow power LED, blinking
              controller LEDs) and takes 3–6 minutes. Don't power off during the update.{' '}
              {latest && (
                <a href={latest.installGuideUrl} target="_blank" rel="noopener noreferrer">
                  Install guide
                </a>
              )}
            </p>
          </div>
        </div>
      )}

      {sdCard && sdCard.trashedFiles.length > 0 && (
        <p className="setting-description firmware-muted firmware-trash-note">
          {sdCard.trashedFiles.length === 1 ? '1 old update file' : `${sdCard.trashedFiles.length} old update files`} (
          {formatMB(trashedBytes)}) {sdCard.trashedFiles.length === 1 ? 'is' : 'are'} still on the card in its trash folder ({sdCard.trashedFiles[0].path.split('/')[0]}). Empty the trash in
          your file manager while the card is connected to free the space.
        </p>
      )}
    </section>
  );
}
