import { useCallback, useEffect, useState } from 'react';
import { ConnectionIndicator } from './ConnectionIndicator';
import { IconButton } from './controls';
import { Button, Modal } from './ui';
import './ScreenshotsTab.css';

// Memories are save states and have their own tab (MemoriesTab)
type CaptureKind = 'screenshot' | 'export';

interface Capture {
  kind: CaptureKind;
  file: string;
  takenAt: string | null;
  width: number;
  height: number;
  size: number;
  firmware: string | null;
  displayMode: string | null;
  /** Captured with HDR on; thumbnails are then the original file, not a re-encoded copy */
  hdr: boolean;
}

interface DeleteResponse {
  deleted: { kind: CaptureKind; file: string }[];
  failed: { kind: CaptureKind; file: string; error: string }[];
}

interface ScreenshotsTabProps {
  cartId: string;
  sdCardPath?: string;
}

const SECTIONS: { kind: CaptureKind; title: string; hint: string }[] = [
  { kind: 'screenshot', title: 'Screenshots', hint: 'Gallery/Screenshots' },
  { kind: 'export', title: '4K Exports', hint: 'Gallery/4K Export' },
];

const captureKey = (c: { kind: CaptureKind; file: string }) => `${c.kind}:${c.file}`;

function formatTakenAt(takenAt: string | null): string {
  if (!takenAt) return 'Unknown date';
  // The console writes local time without a time zone, which Date also reads as local
  return new Date(takenAt).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

function formatSize(bytes: number): string {
  return bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.round(bytes / 1024)} KB`;
}

export function ScreenshotsTab({ cartId, sdCardPath }: ScreenshotsTabProps) {
  const [captures, setCaptures] = useState<Capture[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [viewing, setViewing] = useState<Capture | null>(null);
  const [selecting, setSelecting] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [pendingDelete, setPendingDelete] = useState<Capture[] | null>(null);
  const [deleting, setDeleting] = useState(false);

  const isConnected = !!sdCardPath;

  const imageUrl = useCallback(
    (c: Capture, variant: 'thumb' | 'full' | 'download') => {
      const params = new URLSearchParams({ sdCardPath: sdCardPath ?? '', kind: c.kind, file: c.file, variant });
      return `/api/screenshots/${cartId}/image?${params}`;
    },
    [cartId, sdCardPath],
  );

  const fetchCaptures = useCallback(async () => {
    if (!sdCardPath) {
      setCaptures([]);
      setLoading(false);
      return;
    }
    try {
      setLoading(true);
      setError(null);
      const params = new URLSearchParams({ sdCardPath, kinds: 'screenshot,export' });
      const response = await fetch(`/api/screenshots/${cartId}?${params}`);
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Could not read screenshots');
      setCaptures(data.captures);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [cartId, sdCardPath]);

  useEffect(() => {
    fetchCaptures();
  }, [fetchCaptures]);

  // Arrow keys step through everything in list order; Escape closes the viewer
  useEffect(() => {
    if (!viewing) return;
    const onKey = (e: KeyboardEvent) => {
      if (pendingDelete) return;
      if (e.key === 'Escape') {
        e.stopPropagation();
        setViewing(null);
      } else if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
        const index = captures.findIndex((c) => captureKey(c) === captureKey(viewing));
        const next = captures[index + (e.key === 'ArrowRight' ? 1 : -1)];
        if (next) setViewing(next);
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [viewing, captures, pendingDelete]);

  const toggleSelected = (c: Capture) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(captureKey(c))) next.delete(captureKey(c));
      else next.add(captureKey(c));
      return next;
    });

  const stopSelecting = () => {
    setSelecting(false);
    setSelected(new Set());
  };

  const confirmDelete = async () => {
    if (!pendingDelete || !sdCardPath) return;
    setDeleting(true);
    setError(null);
    try {
      const response = await fetch(`/api/screenshots/${cartId}/delete`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sdCardPath, items: pendingDelete.map(({ kind, file }) => ({ kind, file })) }),
      });
      const result = (await response.json()) as DeleteResponse & { error?: string };
      if (!response.ok) throw new Error(result.error || 'Could not delete');
      if (result.failed.length) {
        setError(`${result.failed.length} could not be deleted: ${result.failed[0].error}`);
      }
      const gone = new Set(result.deleted.map(captureKey));
      if (viewing && gone.has(captureKey(viewing))) setViewing(null);
      stopSelecting();
      await fetchCaptures();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setDeleting(false);
      setPendingDelete(null);
    }
  };

  const selectedCaptures = captures.filter((c) => selected.has(captureKey(c)));

  return (
    <div className="tab-content screenshots-tab">
      <div className={`connection-status ${isConnected ? 'connected' : 'disconnected'}`}>
        <ConnectionIndicator connected={isConnected} />
        <span className="status-text">{isConnected ? 'SD Card Connected' : 'SD Card Not Connected'}</span>
        <span className="status-note">Screenshots are read from the SD card</span>
      </div>

      {!isConnected ? (
        <p className="empty-message">Connect your SD card to see this cartridge's screenshots.</p>
      ) : loading ? (
        <div className="loading">Loading screenshots...</div>
      ) : (
        <>
          {error && <div className="error-message">{error}</div>}

          {captures.length === 0 ? (
            <p className="empty-message">No screenshots for this cartridge on the SD card.</p>
          ) : (
            <>
              {(
                <div className="screenshots-toolbar">
                  {selecting ? (
                    <>
                      <span className="screenshots-toolbar-count">{selected.size} selected</span>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() =>
                          setSelected(
                            selected.size === captures.length
                              ? new Set()
                              : new Set(captures.map(captureKey)),
                          )
                        }
                      >
                        {selected.size === captures.length ? 'Select None' : 'Select All'}
                      </Button>
                      <Button size="sm" variant="secondary" onClick={stopSelecting}>
                        Cancel
                      </Button>
                      <Button
                        size="sm"
                        variant="danger"
                        disabled={!selected.size}
                        onClick={() => setPendingDelete(selectedCaptures)}
                      >
                        Delete
                      </Button>
                    </>
                  ) : (
                    <Button size="sm" variant="secondary" onClick={() => setSelecting(true)}>
                      Select
                    </Button>
                  )}
                </div>
              )}

              {SECTIONS.map(({ kind, title, hint }) => {
                const items = captures.filter((c) => c.kind === kind);
                if (!items.length) return null;
                return (
                  <section key={kind} className="screenshots-section">
                    <div className="screenshots-section-header">
                      <h4>
                        {title} <span className="screenshots-count">{items.length}</span>
                      </h4>
                      <span className="screenshots-section-hint">{hint}</span>
                    </div>
                    <div className={`screenshots-grid ${kind === 'export' ? 'screenshots-grid--wide' : ''}`}>
                      {items.map((c) => {
                        const key = captureKey(c);
                        return (
                          <button
                            key={key}
                            className={`screenshot-thumb ${selected.has(key) ? 'selected' : ''}`}
                            onClick={() => (selecting ? toggleSelected(c) : setViewing(c))}
                            title={formatTakenAt(c.takenAt)}
                          >
                            {c.hdr && <span className="screenshot-hdr">HDR</span>}
                            {selecting && <span className="screenshot-check" aria-hidden />}
                            <img
                              src={imageUrl(c, 'thumb')}
                              alt={`${title} from ${formatTakenAt(c.takenAt)}`}
                              loading="lazy"
                              className={kind === 'export' ? 'wide' : ''}
                            />
                            <span className="screenshot-date">{formatTakenAt(c.takenAt)}</span>
                          </button>
                        );
                      })}
                    </div>
                  </section>
                );
              })}
            </>
          )}
        </>
      )}

      {viewing && (
        <div className="screenshot-viewer" onClick={() => setViewing(null)}>
          <div className="screenshot-viewer-body" onClick={(e) => e.stopPropagation()}>
            <div className="screenshot-viewer-header">
              <span>{formatTakenAt(viewing.takenAt)}</span>
              <IconButton onClick={() => setViewing(null)} aria-label="Close viewer">
                &times;
              </IconButton>
            </div>
            <img
              src={imageUrl(viewing, 'full')}
              alt={formatTakenAt(viewing.takenAt)}
              className={viewing.kind === 'export' ? 'wide' : 'console'}
            />
            <div className="screenshot-viewer-footer">
              <dl className="screenshot-meta">
                <div>
                  <dt>Resolution</dt>
                  <dd>
                    {viewing.width}×{viewing.height}
                  </dd>
                </div>
                {viewing.displayMode && (
                  <div>
                    <dt>Display</dt>
                    <dd>{viewing.displayMode}</dd>
                  </div>
                )}
                {viewing.hdr && (
                  <div>
                    <dt>HDR</dt>
                    <dd>On</dd>
                  </div>
                )}
                {viewing.firmware && (
                  <div>
                    <dt>3Dos</dt>
                    <dd>{viewing.firmware}</dd>
                  </div>
                )}
                <div>
                  <dt>File size</dt>
                  <dd>{formatSize(viewing.size)}</dd>
                </div>
              </dl>
              <div className="screenshot-viewer-actions">
                <a className="btn btn-secondary btn-sm" href={imageUrl(viewing, 'download')} download>
                  Save Copy
                </a>
                <Button size="sm" variant="danger" onClick={() => setPendingDelete([viewing])}>
                  Delete
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}

      <Modal
        isOpen={!!pendingDelete}
        onClose={() => !deleting && setPendingDelete(null)}
        title={pendingDelete?.length === 1 ? 'Delete Screenshot?' : `Delete ${pendingDelete?.length} Screenshots?`}
        size="sm"
        footer={
          <>
            <Button variant="secondary" onClick={() => setPendingDelete(null)} disabled={deleting}>
              Cancel
            </Button>
            <Button variant="danger" onClick={confirmDelete} loading={deleting}>
              Delete
            </Button>
          </>
        }
      >
        <p>
          {pendingDelete?.length === 1 ? 'This file is' : 'These files are'} removed from the SD card and can't be
          restored. Use Save Copy first to keep one.
        </p>
      </Modal>
    </div>
  );
}
