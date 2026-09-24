import { useState, useEffect, useCallback } from 'react';
import { useSDCard } from '../App';
import { useLabelSync } from './LabelSyncIndicator';
import { ProgressBar } from './ProgressBar';
import './LabelSyncModal.css';

interface SyncStatus {
  local: {
    exists: boolean;
    entryCount: number;
    fileSize: number;
    fileSizeFormatted: string;
  };
  sd: {
    exists: boolean;
    entryCount: number;
    fileSize: number;
    fileSizeFormatted: string;
  };
}

interface TransferProgress {
  percentage: number;
  bytesWritten: string;
  totalBytes: string;
  speed: string;
  eta: string;
}

type SyncDirection = 'upload' | 'download';
type ModalStep = 'loading' | 'choose' | 'syncing' | 'complete' | 'error';

interface LabelSyncModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSyncComplete?: () => void;
}

interface LabelDiff {
  identical: boolean;
  onlyInLocal: string[];
  onlyInOther: string[];
  modified: string[];
}

const MAX_NAMED = 5;

/** Which carts' labels differ, so the choice of side isn't made on entry counts alone */
function LabelDifferences({ sdCardPath }: { sdCardPath: string }) {
  const [diff, setDiff] = useState<LabelDiff | null>(null);
  const [names, setNames] = useState<Record<string, string>>({});
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let current = true;
    (async () => {
      try {
        const params = new URLSearchParams({ sdCardPath });
        const response = await fetch(`/api/labels/compare/detailed?${params}`);
        if (!response.ok) throw new Error('compare failed');
        const result = (await response.json()) as LabelDiff;
        if (!current) return;
        setDiff(result);
        const ids = [result.modified, result.onlyInLocal, result.onlyInOther].flatMap((list) => list.slice(0, MAX_NAMED));
        const found = await Promise.all(
          ids.map(async (id) => {
            const lookup = await fetch(`/api/labels/lookup/${id}`).then((r) => (r.ok ? r.json() : null)).catch(() => null);
            return [id, lookup?.name || id] as const;
          }),
        );
        if (current) setNames(Object.fromEntries(found));
      } catch {
        if (current) setFailed(true);
      }
    })();
    return () => {
      current = false;
    };
  }, [sdCardPath]);

  if (failed) return null;
  if (!diff) return <p className="sync-differences-loading">Comparing labels…</p>;
  if (diff.identical) return <p className="sync-differences">Both have the same labels.</p>;

  const row = (count: number, label: string, ids: string[]) =>
    count > 0 && (
      <li>
        <strong>{count}</strong> {label}
        {': '}
        {ids.slice(0, MAX_NAMED).map((id) => names[id] ?? id).join(', ')}
        {count > MAX_NAMED && `, and ${count - MAX_NAMED} more`}
      </li>
    );

  return (
    <ul className="sync-differences">
      {row(diff.modified.length, 'different on each', diff.modified)}
      {row(diff.onlyInLocal.length, 'only on this computer', diff.onlyInLocal)}
      {row(diff.onlyInOther.length, 'only on the SD card', diff.onlyInOther)}
    </ul>
  );
}

export function LabelSyncModal({ isOpen, onClose, onSyncComplete }: LabelSyncModalProps) {
  const { selectedSDCard } = useSDCard();
  const { checkSyncStatus, triggerLabelsRefresh } = useLabelSync();

  const [step, setStep] = useState<ModalStep>('loading');
  const [status, setStatus] = useState<SyncStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<TransferProgress>({
    percentage: 0,
    bytesWritten: '',
    totalBytes: '',
    speed: '',
    eta: '',
  });
  const [syncResult, setSyncResult] = useState<{ entryCount: number; direction: SyncDirection } | null>(null);

  const isSyncing = step === 'syncing';

  // Fetch sync status when modal opens
  const fetchStatus = useCallback(async () => {
    if (!selectedSDCard) return;

    setStep('loading');
    setError(null);

    try {
      const response = await fetch(
        `/api/sync/labels/status?sdCardPath=${encodeURIComponent(selectedSDCard.path)}`
      );

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'Failed to get sync status');
      }

      const data: SyncStatus = await response.json();
      setStatus(data);
      setStep('choose');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load sync status');
      setStep('error');
    }
  }, [selectedSDCard]);

  useEffect(() => {
    if (isOpen && selectedSDCard) {
      fetchStatus();
    }
  }, [isOpen, selectedSDCard, fetchStatus]);

  // Reset state when modal closes
  useEffect(() => {
    if (!isOpen) {
      setStep('loading');
      setStatus(null);
      setError(null);
      setProgress({ percentage: 0, bytesWritten: '', totalBytes: '', speed: '', eta: '' });
      setSyncResult(null);
    }
  }, [isOpen]);

  const handleSync = async (direction: SyncDirection) => {
    if (!selectedSDCard) return;

    setStep('syncing');
    setError(null);
    setProgress({ percentage: 0, bytesWritten: '', totalBytes: '', speed: '', eta: '' });

    const endpoint = direction === 'upload'
      ? '/api/sync/labels/upload-stream'
      : '/api/sync/labels/download-stream';

    try {
      const eventSource = new EventSource(
        `${endpoint}?sdCardPath=${encodeURIComponent(selectedSDCard.path)}`
      );

      eventSource.onmessage = (event) => {
        const data = JSON.parse(event.data);

        switch (data.type) {
          case 'start':
            setProgress({
              percentage: 0,
              bytesWritten: '0 B',
              totalBytes: data.totalBytes ? `${data.totalBytes} B` : '',
              speed: '',
              eta: '',
            });
            break;

          case 'progress':
            setProgress({
              percentage: data.percentage || 0,
              bytesWritten: data.bytesWrittenFormatted || '',
              totalBytes: data.totalBytesFormatted || '',
              speed: data.speed || '',
              eta: data.eta || '',
            });
            break;

          case 'complete':
            setSyncResult({ entryCount: data.entryCount, direction });
            setStep('complete');
            eventSource.close();
            // Update the sync status indicator
            checkSyncStatus();
            // Trigger labels browser refresh
            triggerLabelsRefresh();
            // Notify parent component
            onSyncComplete?.();
            break;

          case 'error':
            setError(data.error);
            setStep('error');
            eventSource.close();
            break;
        }
      };

      eventSource.onerror = () => {
        eventSource.close();
        setError('Connection lost during sync');
        setStep('error');
      };
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Sync failed');
      setStep('error');
    }
  };

  const handleClose = () => {
    if (!isSyncing) {
      onClose();
    }
  };

  // Handle escape key - only close if not syncing
  useEffect(() => {
    if (!isOpen) return;

    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !isSyncing) {
        onClose();
      }
    };

    document.addEventListener('keydown', handleEscape);
    return () => document.removeEventListener('keydown', handleEscape);
  }, [isOpen, isSyncing, onClose]);

  // Prevent body scroll
  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }
    return () => {
      document.body.style.overflow = '';
    };
  }, [isOpen]);

  if (!isOpen) return null;

  // Determine scenario
  const hasLocal = status?.local.exists && status.local.entryCount > 0;
  const hasSD = status?.sd.exists && status.sd.entryCount > 0;
  const localOnly = hasLocal && !hasSD;
  const sdOnly = hasSD && !hasLocal;
  const bothExist = hasLocal && hasSD;

  return (
    <div className="modal-overlay" onClick={handleClose}>
      <div
        className="modal modal-md label-sync-modal"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
      >
        <div className="modal-header">
          <h2>Sync Labels</h2>
          {!isSyncing && (
            <button className="modal-close-btn" onClick={handleClose} aria-label="Close modal">
              &times;
            </button>
          )}
        </div>

        <div className="modal-body">
          {step === 'loading' && (
            <div className="sync-modal-loading">
              <div className="spinner" />
              <p>Checking sync status...</p>
            </div>
          )}

          {step === 'choose' && status && (
            <div className="sync-modal-choose">
              {/* Status Summary */}
              <div className="sync-status-summary">
                <div className={`sync-status-item ${hasLocal ? 'has-data' : 'no-data'}`}>
                  <span className="sync-status-label">Local</span>
                  <span className="sync-status-value">
                    {hasLocal
                      ? `${status.local.entryCount} labels (${status.local.fileSizeFormatted})`
                      : 'No labels'}
                  </span>
                </div>
                <div className={`sync-status-item ${hasSD ? 'has-data' : 'no-data'}`}>
                  <span className="sync-status-label">SD Card</span>
                  <span className="sync-status-value">
                    {hasSD
                      ? `${status.sd.entryCount} labels (${status.sd.fileSizeFormatted})`
                      : 'No labels'}
                  </span>
                </div>
              </div>

              {/* Scenario: Local only - upload to SD */}
              {localOnly && (
                <div className="sync-scenario">
                  <p className="sync-description">
                    Your SD card doesn't have a <span className="text-code">labels.db</span> file yet. Syncing will copy your
                    local labels to the SD card so they appear on your Analogue 3D.
                  </p>
                  <div className="sync-actions">
                    <button className="btn-primary" onClick={() => handleSync('upload')}>
                      Upload to SD Card
                    </button>
                    <button className="btn-secondary" onClick={handleClose}>
                      Cancel
                    </button>
                  </div>
                </div>
              )}

              {/* Scenario: SD only - download to local */}
              {sdOnly && (
                <div className="sync-scenario">
                  <p className="sync-description">
                    You don't have any local labels yet. Syncing will download the labels
                    from your SD card so you can view and edit them in this app.
                  </p>
                  <div className="sync-actions">
                    <button className="btn-primary" onClick={() => handleSync('download')}>
                      Download from SD Card
                    </button>
                    <button className="btn-secondary" onClick={handleClose}>
                      Cancel
                    </button>
                  </div>
                </div>
              )}

              {/* Scenario: Both exist - choose direction */}
              {bothExist && (
                <div className="sync-scenario">
                  <p className="sync-description">
                    Both your local machine and SD card have labels. Choose which version to keep:
                  </p>
                  {selectedSDCard && <LabelDifferences sdCardPath={selectedSDCard.path} />}
                  <div className="sync-direction-options">
                    <button
                      className="sync-direction-btn"
                      onClick={() => handleSync('upload')}
                    >
                      <span className="sync-direction-title">Use Local Labels</span>
                      <span className="sync-direction-desc">
                        Replace SD card with your local labels ({status.local.entryCount} labels)
                      </span>
                    </button>
                    <button
                      className="sync-direction-btn"
                      onClick={() => handleSync('download')}
                    >
                      <span className="sync-direction-title">Use SD Card Labels</span>
                      <span className="sync-direction-desc">
                        Replace local with SD card labels ({status.sd.entryCount} labels)
                      </span>
                    </button>
                  </div>
                  <div className="sync-actions">
                    <button className="btn-secondary" onClick={handleClose}>
                      Cancel
                    </button>
                  </div>
                </div>
              )}

              {/* Scenario: Neither has labels */}
              {!hasLocal && !hasSD && (
                <div className="sync-scenario">
                  <p className="sync-description">
                    Neither your local machine nor SD card has any labels yet.
                    Import a labels.db file first, or add labels to individual cartridges.
                  </p>
                  <div className="sync-actions">
                    <button className="btn-secondary" onClick={handleClose}>
                      Close
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}

          {step === 'syncing' && (
            <div className="sync-modal-progress">
              <p className="sync-progress-status">Syncing labels...</p>
              <ProgressBar
                progress={progress.percentage}
                showPercentage
                label="labels.db"
                transferDetails={progress.bytesWritten ? {
                  bytesWritten: progress.bytesWritten,
                  totalBytes: progress.totalBytes,
                  speed: progress.speed || undefined,
                  eta: progress.eta || undefined,
                } : undefined}
              />
              <p className="sync-warning">Please do not close this window or remove the SD card.</p>
            </div>
          )}

          {step === 'complete' && syncResult && (
            <div className="sync-modal-complete">
              <div className="sync-success-icon">&#10003;</div>
              <h3>Sync Complete!</h3>
              <p>
                {syncResult.direction === 'upload'
                  ? `Uploaded ${syncResult.entryCount} labels to SD card.`
                  : `Downloaded ${syncResult.entryCount} labels from SD card.`}
              </p>
              <div className="sync-actions">
                <button className="btn-primary" onClick={handleClose}>
                  Done
                </button>
              </div>
            </div>
          )}

          {step === 'error' && (
            <div className="sync-modal-error">
              <div className="sync-error-icon">!</div>
              <h3>Sync Failed</h3>
              <p className="error-message">{error}</p>
              <div className="sync-actions">
                <button className="btn-secondary" onClick={fetchStatus}>
                  Try Again
                </button>
                <button className="btn-secondary" onClick={handleClose}>
                  Close
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
