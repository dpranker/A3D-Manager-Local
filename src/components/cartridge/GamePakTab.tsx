import { useState, useRef, useEffect, useCallback } from 'react';

interface GamePakSaveInfo {
  pagesUsed: number;
  pagesFree: number;
  percentUsed: number;
}

interface GamePakInfoItem {
  exists: boolean;
  source: 'local' | 'sd';
  path: string;
  size?: number;
  lastModified?: string;
  isValidSize?: boolean;
  saveInfo?: GamePakSaveInfo;
  md5Hash?: string;
}

interface GamePakSyncStatus {
  localHash: string | null;
  sdHash: string | null;
  inSync: boolean;
  hasConflict: boolean;
}

interface GamePakInfoResponse {
  local: GamePakInfoItem;
  sd: GamePakInfoItem | null;
  syncStatus?: GamePakSyncStatus;
}

interface GamePakBackup {
  id: string;
  name: string;
  description?: string;
  createdAt: string;
  md5Hash: string;
  size: number;
}

interface GamePakTabProps {
  cartId: string;
  sdCardPath?: string;
  gameName?: string;
}

type GamePakConflictResolution = 'pending' | 'use-local' | 'use-sd' | 'resolved';

export function GamePakTab({ cartId, sdCardPath, gameName }: GamePakTabProps) {
  const [info, setInfo] = useState<GamePakInfoResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [downloading, setDownloading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [conflictState, setConflictState] = useState<GamePakConflictResolution>('resolved');
  const inputRef = useRef<HTMLInputElement>(null);

  // Backup-related state
  const [backups, setBackups] = useState<GamePakBackup[]>([]);
  const [backupsLoading, setBackupsLoading] = useState(false);
  const [showBackupForm, setShowBackupForm] = useState(false);
  const [newBackupName, setNewBackupName] = useState('');
  const [newBackupDescription, setNewBackupDescription] = useState('');
  const [creatingBackup, setCreatingBackup] = useState(false);
  const [editingBackupId, setEditingBackupId] = useState<string | null>(null);
  const [editBackupName, setEditBackupName] = useState('');
  const [editBackupDescription, setEditBackupDescription] = useState('');

  // Update conflict state when info changes
  useEffect(() => {
    if (info?.syncStatus?.hasConflict) {
      setConflictState('pending');
    } else {
      setConflictState('resolved');
    }
  }, [info?.syncStatus?.hasConflict]);

  const fetchInfo = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const params = new URLSearchParams();
      if (sdCardPath) params.set('sdCardPath', sdCardPath);
      params.set('includeHash', 'true');
      const response = await fetch(`/api/cartridges/${cartId}/game-pak?${params}`);
      if (response.ok) {
        const data = await response.json();
        setInfo(data);
      } else {
        setInfo({ local: { exists: false, source: 'local', path: '' }, sd: null });
      }
    } catch {
      setError('Failed to load game pak info');
    } finally {
      setLoading(false);
    }
  }, [cartId, sdCardPath]);

  useEffect(() => {
    fetchInfo();
  }, [fetchInfo]);

  // Fetch backups
  const fetchBackups = useCallback(async () => {
    try {
      setBackupsLoading(true);
      const response = await fetch(`/api/cartridges/${cartId}/game-pak/backups`);
      if (response.ok) {
        const data = await response.json();
        setBackups(data.backups || []);
      }
    } catch {
      // Silently fail - backups are optional
    } finally {
      setBackupsLoading(false);
    }
  }, [cartId]);

  useEffect(() => {
    fetchBackups();
  }, [fetchBackups]);

  const handleDownloadFromSD = async () => {
    if (!sdCardPath) return;
    try {
      setDownloading(true);
      setError(null);
      const response = await fetch(`/api/cartridges/${cartId}/game-pak/download`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sdCardPath }),
      });
      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'Download failed');
      }
      await fetchInfo();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Download failed');
    } finally {
      setDownloading(false);
    }
  };

  const handleUploadToSD = async () => {
    if (!sdCardPath) return;
    try {
      setUploading(true);
      setError(null);
      const response = await fetch(`/api/cartridges/${cartId}/game-pak/upload`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sdCardPath }),
      });
      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'Upload failed');
      }
      await fetchInfo();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Upload failed');
    } finally {
      setUploading(false);
    }
  };

  const handleImportFile = async (file: File) => {
    try {
      setError(null);
      const formData = new FormData();
      formData.append('file', file);
      const response = await fetch(`/api/cartridges/${cartId}/game-pak/import`, {
        method: 'POST',
        body: formData,
      });
      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'Import failed');
      }
      await fetchInfo();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Import failed');
    }
  };

  const handleExport = async () => {
    try {
      const response = await fetch(`/api/cartridges/${cartId}/game-pak/export`);
      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'Export failed');
      }
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${cartId}-controller_pak.img`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Export failed');
    }
  };

  const handleDelete = async () => {
    if (!confirm('Delete local game pak? This cannot be undone.')) return;
    try {
      setError(null);
      const response = await fetch(`/api/cartridges/${cartId}/game-pak`, { method: 'DELETE' });
      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'Delete failed');
      }
      await fetchInfo();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Delete failed');
    }
  };

  const handleResolveConflict = async (choice: 'use-local' | 'use-sd') => {
    if (!sdCardPath) return;
    setSyncing(true);
    setError(null);

    try {
      if (choice === 'use-local') {
        // Upload local to SD
        const response = await fetch(`/api/cartridges/${cartId}/game-pak/upload`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ sdCardPath, title: gameName }),
        });
        if (!response.ok) {
          const data = await response.json();
          throw new Error(data.error || 'Failed to sync to SD card');
        }
      } else {
        // Download SD to local
        const response = await fetch(`/api/cartridges/${cartId}/game-pak/download`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ sdCardPath, title: gameName }),
        });
        if (!response.ok) {
          const data = await response.json();
          throw new Error(data.error || 'Failed to sync from SD card');
        }
      }

      setConflictState('resolved');
      await fetchInfo();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Sync failed');
    } finally {
      setSyncing(false);
    }
  };

  // Backup handlers
  const handleCreateBackup = async () => {
    try {
      setCreatingBackup(true);
      setError(null);
      const response = await fetch(`/api/cartridges/${cartId}/game-pak/backups`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: newBackupName || undefined,
          description: newBackupDescription || undefined,
        }),
      });
      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'Failed to create backup');
      }
      // Reset form and refresh backups
      setNewBackupName('');
      setNewBackupDescription('');
      setShowBackupForm(false);
      await fetchBackups();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create backup');
    } finally {
      setCreatingBackup(false);
    }
  };

  const handleUpdateBackup = async (backupId: string) => {
    try {
      setError(null);
      const response = await fetch(`/api/cartridges/${cartId}/game-pak/backups/${backupId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: editBackupName,
          description: editBackupDescription,
        }),
      });
      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'Failed to update backup');
      }
      setEditingBackupId(null);
      await fetchBackups();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update backup');
    }
  };

  const handleDeleteBackup = async (backupId: string, backupName: string) => {
    if (!confirm(`Delete backup "${backupName}"? This cannot be undone.`)) return;
    try {
      setError(null);
      const response = await fetch(`/api/cartridges/${cartId}/game-pak/backups/${backupId}`, {
        method: 'DELETE',
      });
      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'Failed to delete backup');
      }
      await fetchBackups();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete backup');
    }
  };

  const handleRestoreBackup = async (backupId: string, backupName: string) => {
    const syncToSD = sdCardPath && confirm(
      `Restore backup "${backupName}"?\n\nThis will replace your current local game pak.\n\nClick OK to also sync to SD card, or Cancel to only restore locally.`
    );

    if (!confirm(`Restore backup "${backupName}" to local storage?${syncToSD ? ' This will also update the SD card.' : ''}`)) return;

    try {
      setError(null);
      const response = await fetch(`/api/cartridges/${cartId}/game-pak/backups/${backupId}/restore`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          syncToSD: !!syncToSD,
          sdCardPath,
          title: gameName,
        }),
      });
      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'Failed to restore backup');
      }
      const result = (await response.json()) as { sd: 'ok' | 'skipped' | { error: string } };
      await fetchInfo();
      if (typeof result.sd === 'object') {
        setError(`Restored locally, but copying to the SD card failed: ${result.sd.error}`);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to restore backup');
    }
  };

  const handleExportBackup = async (backupId: string, backupName: string) => {
    try {
      const response = await fetch(`/api/cartridges/${cartId}/game-pak/backups/${backupId}`);
      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'Export failed');
      }
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      // Build filename with game name if available
      const sanitizedGameName = gameName ? gameName.replace(/[^a-z0-9]/gi, '_') : cartId;
      const sanitizedBackupName = backupName.replace(/[^a-z0-9]/gi, '_');
      a.download = `${sanitizedGameName}-${sanitizedBackupName}.img`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Export failed');
    }
  };

  const startEditBackup = (backup: GamePakBackup) => {
    setEditingBackupId(backup.id);
    setEditBackupName(backup.name);
    setEditBackupDescription(backup.description || '');
  };

  if (loading) {
    return <div className="tab-content loading">Loading game pak info...</div>;
  }

  const hasLocal = info?.local?.exists;
  const hasSD = info?.sd?.exists;
  const localSaveInfo = info?.local?.saveInfo;
  const sdSaveInfo = info?.sd?.saveInfo;

  return (
    <div className="tab-content gamepak-tab">
      <div className="data-status">
        <div className={`status-item ${hasLocal ? 'has-data' : ''}`}>
          <span className="status-icon">{hasLocal ? '✓' : '○'}</span>
          <span>Local Game Pak</span>
          {localSaveInfo && (
            <span className="status-detail">
              ({localSaveInfo.percentUsed}% used)
            </span>
          )}
        </div>
        {sdCardPath && (
          <div className={`status-item ${hasSD ? 'has-data' : ''}`}>
            <span className="status-icon">{hasSD ? '✓' : '○'}</span>
            <span>SD Card Game Pak</span>
            {sdSaveInfo && (
              <span className="status-detail">
                ({sdSaveInfo.percentUsed}% used)
              </span>
            )}
          </div>
        )}
      </div>

      {/* Sync Status Indicator */}
      {sdCardPath && hasLocal && hasSD && info?.syncStatus?.inSync && (
        <div className="sync-status in-sync">
          <span className="sync-icon">✓</span>
          <span>Local and SD Card are in sync</span>
        </div>
      )}

      {/* Conflict Resolution UI */}
      {conflictState === 'pending' && (
        <div className="conflict-resolution">
          <h4>Game Pak Conflict Detected</h4>
          <p>Your local game pak differs from the SD card. Which version would you like to use?</p>
          <div className="conflict-options">
            <button
              className="btn-secondary conflict-btn"
              onClick={() => handleResolveConflict('use-local')}
              disabled={syncing}
            >
              <span className="conflict-btn-title">Use Local Game Pak</span>
              <span className="conflict-btn-desc">Update SD card to match your local save</span>
            </button>
            <button
              className="btn-secondary conflict-btn"
              onClick={() => handleResolveConflict('use-sd')}
              disabled={syncing}
            >
              <span className="conflict-btn-title">Use SD Card Game Pak</span>
              <span className="conflict-btn-desc">Replace local with SD card save</span>
            </button>
          </div>
          {syncing && <p className="syncing-message">Syncing...</p>}
        </div>
      )}

      {/* Save Info Details */}
      {(localSaveInfo || sdSaveInfo) && (
        <div className="save-info-details">
          {localSaveInfo && (
            <div className="save-info-card">
              <h4 className="text-label">Local Save Data</h4>
              <div className="save-stats">
                <div className="stat">
                  <span className="stat-value">{localSaveInfo.pagesUsed}</span>
                  <span className="stat-label">Pages Used</span>
                </div>
                <div className="stat">
                  <span className="stat-value">{localSaveInfo.pagesFree}</span>
                  <span className="stat-label">Pages Free</span>
                </div>
                <div className="stat">
                  <span className="stat-value">{localSaveInfo.percentUsed}%</span>
                  <span className="stat-label">Capacity</span>
                </div>
              </div>
              <div className="capacity-bar">
                <div
                  className="capacity-fill"
                  style={{ width: `${localSaveInfo.percentUsed}%` }}
                />
              </div>
            </div>
          )}
        </div>
      )}

      {error && <div className="error-message">{error}</div>}

      <div className="action-buttons">
        {sdCardPath && hasSD && (
          <button
            className="btn-secondary"
            onClick={handleDownloadFromSD}
            disabled={downloading || uploading}
          >
            {downloading ? 'Downloading...' : 'Download from SD'}
          </button>
        )}

        {sdCardPath && hasLocal && (
          <button
            className="btn-secondary"
            onClick={handleUploadToSD}
            disabled={downloading || uploading}
          >
            {uploading ? 'Uploading...' : 'Upload to SD'}
          </button>
        )}

        <button
          className="btn-secondary"
          onClick={() => inputRef.current?.click()}
        >
          Import from File
        </button>

        {hasLocal && (
          <>
            <button className="btn-secondary" onClick={handleExport}>
              Export
            </button>
            <button className="btn-ghost btn-danger-text" onClick={handleDelete}>
              Delete Local
            </button>
          </>
        )}
      </div>

      <input
        ref={inputRef}
        type="file"
        accept=".img,.bin"
        onChange={(e) => e.target.files?.[0] && handleImportFile(e.target.files[0])}
        style={{ display: 'none' }}
      />

      {!hasLocal && !hasSD && (
        <p className="empty-message">
          No game pak (controller pak save) available for this cartridge.
          {sdCardPath ? ' Play the game and save data to create a game pak.' : ' Connect an SD card to check for saves.'}
        </p>
      )}

      {/* Backups Section */}
      <div className="backups-section">
        <div className="backups-header">
          <h4 className="text-label">Backups</h4>
          {hasLocal && (
            <button
              className="btn-ghost btn-sm"
              onClick={() => setShowBackupForm(!showBackupForm)}
            >
              {showBackupForm ? 'Cancel' : '+ Create Backup'}
            </button>
          )}
        </div>

        {showBackupForm && (
          <div className="backup-form">
            <input
              type="text"
              placeholder="Backup name (optional)"
              value={newBackupName}
              onChange={(e) => setNewBackupName(e.target.value)}
              className="backup-input"
            />
            <textarea
              placeholder="Description (optional)"
              value={newBackupDescription}
              onChange={(e) => setNewBackupDescription(e.target.value)}
              className="backup-textarea"
              rows={2}
            />
            <button
              className="btn-primary btn-sm"
              onClick={handleCreateBackup}
              disabled={creatingBackup}
            >
              {creatingBackup ? 'Creating...' : 'Create Backup'}
            </button>
          </div>
        )}

        {backupsLoading ? (
          <p className="loading-text">Loading backups...</p>
        ) : backups.length === 0 ? (
          <p className="empty-message">
            No backups yet.{hasLocal ? ' Create a backup to save your current game pak state.' : ''}
          </p>
        ) : (
          <div className="backups-list">
            {[...backups].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()).map((backup) => (
              <div key={backup.id} className="backup-item">
                {editingBackupId === backup.id ? (
                  <div className="backup-edit-form">
                    <input
                      type="text"
                      value={editBackupName}
                      onChange={(e) => setEditBackupName(e.target.value)}
                      className="backup-input"
                    />
                    <textarea
                      value={editBackupDescription}
                      onChange={(e) => setEditBackupDescription(e.target.value)}
                      className="backup-textarea"
                      rows={2}
                      placeholder="Description (optional)"
                    />
                    <div className="backup-edit-actions">
                      <button
                        className="btn-primary btn-sm"
                        onClick={() => handleUpdateBackup(backup.id)}
                      >
                        Save
                      </button>
                      <button
                        className="btn-ghost btn-sm"
                        onClick={() => setEditingBackupId(null)}
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                ) : (
                  <>
                    <div className="backup-info">
                      <span className="backup-name">{backup.name}</span>
                      <span className="backup-date">
                        {new Date(backup.createdAt).toLocaleDateString()}
                      </span>
                      {backup.description && (
                        <span className="backup-description">{backup.description}</span>
                      )}
                    </div>
                    <div className="backup-actions">
                      <button
                        className="btn-ghost btn-sm"
                        onClick={() => handleRestoreBackup(backup.id, backup.name)}
                        title="Restore this backup"
                      >
                        Restore
                      </button>
                      <button
                        className="btn-ghost btn-sm"
                        onClick={() => handleExportBackup(backup.id, backup.name)}
                        title="Download this backup"
                      >
                        Export
                      </button>
                      <button
                        className="btn-ghost btn-sm"
                        onClick={() => startEditBackup(backup)}
                        title="Edit backup details"
                      >
                        Edit
                      </button>
                      <button
                        className="btn-ghost btn-sm btn-danger-text"
                        onClick={() => handleDeleteBackup(backup.id, backup.name)}
                        title="Delete this backup"
                      >
                        Delete
                      </button>
                    </div>
                  </>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="info-box">
        <h4 className="text-label">About Game Paks</h4>
        <p>
          Game Paks are 32KB controller pak save files (controller_pak.img).
          These contain save data for games that use the Controller Pak accessory.
          The N64 Controller Pak has 123 user-accessible pages for save data.
        </p>
      </div>
    </div>
  );
}
