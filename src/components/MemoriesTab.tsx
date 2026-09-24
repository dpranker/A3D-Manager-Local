import { useCallback, useEffect, useState } from 'react';
import { ConnectionIndicator } from './ConnectionIndicator';
import './MemoriesTab.css';

/** A Memory is a save state; its PNG is the thumbnail, with the state stored after the image data */
interface Memory {
  kind: 'memory';
  file: string;
  takenAt: string | null;
  size: number;
  firmware: string | null;
}

interface MemoriesTabProps {
  cartId: string;
  sdCardPath?: string;
}

function formatTakenAt(takenAt: string | null): string {
  if (!takenAt) return 'Unknown date';
  // The console writes local time without a time zone, which Date also reads as local
  return new Date(takenAt).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

const formatSize = (bytes: number) => `${(bytes / 1024 / 1024).toFixed(1)} MB`;

export function MemoriesTab({ cartId, sdCardPath }: MemoriesTabProps) {
  const [memories, setMemories] = useState<Memory[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const isConnected = !!sdCardPath;

  const fileUrl = (m: Memory, variant: 'thumb' | 'download') =>
    `/api/screenshots/${cartId}/image?${new URLSearchParams({ sdCardPath: sdCardPath ?? '', kind: m.kind, file: m.file, variant })}`;

  const fetchMemories = useCallback(async () => {
    if (!sdCardPath) {
      setMemories([]);
      setLoading(false);
      return;
    }
    try {
      setLoading(true);
      setError(null);
      const response = await fetch(`/api/screenshots/${cartId}?${new URLSearchParams({ sdCardPath, kinds: 'memory' })}`);
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Could not read Memories');
      setMemories(data.captures);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [cartId, sdCardPath]);

  useEffect(() => {
    fetchMemories();
  }, [fetchMemories]);

  return (
    <div className="tab-content memories-tab">
      <div className={`connection-status ${isConnected ? 'connected' : 'disconnected'}`}>
        <ConnectionIndicator connected={isConnected} />
        <span className="status-text">{isConnected ? 'SD Card Connected' : 'SD Card Not Connected'}</span>
        <span className="status-note">Memories are read from the SD card</span>
      </div>

      <p className="field-hint">
        Memories are save states made on the console. Each file holds the whole state, with its picture as a
        preview. Back Up saves the complete file exactly as the console wrote it, and Back Up All saves them all in
        one zip. A3D Manager never changes or deletes Memories; manage them on the console.
      </p>

      {!isConnected ? (
        <p className="empty-message">Connect your SD card to see this cartridge's Memories.</p>
      ) : loading ? (
        <div className="loading">Loading Memories...</div>
      ) : error ? (
        <div className="error-message">{error}</div>
      ) : memories.length === 0 ? (
        <p className="empty-message">No Memories for this cartridge on the SD card.</p>
      ) : (
        <>
          <div className="memories-toolbar">
            <span>
              {memories.length} {memories.length === 1 ? 'Memory' : 'Memories'} ·{' '}
              {formatSize(memories.reduce((total, m) => total + m.size, 0))}
            </span>
            <a
              className="btn btn-primary btn-sm"
              href={`/api/screenshots/${cartId}/archive?${new URLSearchParams({ sdCardPath: sdCardPath ?? '', kinds: 'memory' })}`}
              download
            >
              Back Up All
            </a>
          </div>
          <ul className="memories-list">
            {memories.map((m) => (
              <li key={m.file} className="memory-row">
                <img src={fileUrl(m, 'thumb')} alt="" loading="lazy" />
                <div className="memory-info">
                  <span className="memory-date">{formatTakenAt(m.takenAt)}</span>
                  <span className="memory-meta">
                    {m.firmware ? `Made with 3Dos ${m.firmware}` : 'Firmware unknown'} · {formatSize(m.size)}
                  </span>
                </div>
                <a className="btn btn-secondary btn-sm" href={fileUrl(m, 'download')} download>
                  Back Up
                </a>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
