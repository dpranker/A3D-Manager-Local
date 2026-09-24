import { useState, useRef, useEffect, useCallback } from 'react';
import { useSettingsClipboard } from '../../App';
import { Tooltip } from '../ui/Tooltip';
import { ConnectionIndicator } from '../ConnectionIndicator';
import { apiPostJson, errorMessage } from '../../lib/api';
import { createDefaultSettings, type CartridgeSettings } from '../../lib/defaultSettings';
import { SettingsEditor } from './SettingsEditor';

interface SettingsInfoItem {
  exists: boolean;
  source: 'local' | 'sd';
  path: string;
  lastModified?: string;
  /** Only set when the file is valid and in the 3Dos 1.5.1+ format */
  settings?: CartridgeSettings;
  format?: 'current' | 'legacy';
  error?: string;
}

interface SettingsInfoResponse {
  local: SettingsInfoItem;
  sd: SettingsInfoItem | null;
  /** Whether settings can be written to the connected card (its console must be on 3Dos 1.5.1+) */
  sdSupport?: { supported: boolean; reason?: string } | null;
}

interface SettingsTabProps {
  cartId: string;
  sdCardPath?: string;
  gameName?: string;
  /** Reports the Cartridge Color as settings load and change, for the cart previews */
  onCartridgeColorChange?: (color: string) => void;
}

function settingsAreDifferent(a: CartridgeSettings | undefined, b: CartridgeSettings | undefined): boolean {
  if (!a || !b) return true;
  return JSON.stringify(a) !== JSON.stringify(b);
}

type ConflictResolution = 'pending' | 'use-local' | 'use-sd' | 'resolved';

export function SettingsTab({ cartId, sdCardPath, gameName, onCartridgeColorChange }: SettingsTabProps) {
  const [info, setInfo] = useState<SettingsInfoResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [conflictState, setConflictState] = useState<ConflictResolution>('resolved');
  const [autoImported, setAutoImported] = useState(false);
  const [showCopiedMessage, setShowCopiedMessage] = useState(false);
  const [showExportImportMenu, setShowExportImportMenu] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const exportImportRef = useRef<HTMLDivElement>(null);
  const { copySettings: copyToClipboard } = useSettingsClipboard();

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (exportImportRef.current && !exportImportRef.current.contains(event.target as Node)) {
        setShowExportImportMenu(false);
      }
    };
    if (showExportImportMenu) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [showExportImportMenu]);

  const isConnected = !!sdCardPath;
  // Settings are only written to cards whose console already uses the 3Dos 1.5.1 format
  const sdWritable = isConnected && (info?.sdSupport?.supported ?? true);
  const syncPath = sdWritable ? sdCardPath : undefined;

  const fetchInfo = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const params = sdCardPath ? `?sdCardPath=${encodeURIComponent(sdCardPath)}` : '';
      const response = await fetch(`/api/cartridges/${cartId}/settings${params}`);
      if (response.ok) {
        const data = await response.json();
        setInfo(data);
        return data;
      } else {
        const emptyInfo = { local: { exists: false, source: 'local' as const, path: '' }, sd: null };
        setInfo(emptyInfo);
        return emptyInfo;
      }
    } catch {
      setError('Failed to load settings info');
      return null;
    } finally {
      setLoading(false);
    }
  }, [cartId, sdCardPath]);

  // Initial load and auto-import logic
  useEffect(() => {
    const loadAndCheck = async () => {
      const data = await fetchInfo();
      if (!data) return;

      // Only 3Dos 1.5.1+ format files count; older ones are stale (the 1.5.1 update reset them)
      const hasLocal = data.local?.format === 'current' && !!data.local.settings;
      const hasSD = data.sd?.format === 'current' && !!data.sd?.settings;

      // Auto-import from SD if there are no usable local settings but SD has them
      if (!hasLocal && hasSD && sdCardPath && !autoImported) {
        setAutoImported(true);
        setSyncing(true);
        try {
          const response = await fetch(`/api/cartridges/${cartId}/settings/download`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ sdCardPath }),
          });
          if (response.ok) {
            await fetchInfo();
          }
        } catch (err) {
          console.error('Auto-import failed:', err);
        } finally {
          setSyncing(false);
        }
        return;
      }

      // Check for conflicts if both exist
      if (hasLocal && hasSD && data.local.settings && data.sd?.settings) {
        if (settingsAreDifferent(data.local.settings, data.sd.settings)) {
          setConflictState('pending');
        } else {
          setConflictState('resolved');
        }
      } else {
        setConflictState('resolved');
      }
    };

    loadAndCheck();
  }, [cartId, sdCardPath, autoImported, fetchInfo]);

  const handleResolveConflict = async (choice: 'use-local' | 'use-sd') => {
    if (!sdCardPath) return;
    setSyncing(true);
    setError(null);

    try {
      if (choice === 'use-local') {
        // Upload local to SD
        const response = await fetch(`/api/cartridges/${cartId}/settings/upload`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ sdCardPath }),
        });
        if (!response.ok) {
          const data = await response.json();
          throw new Error(data.error || 'Failed to sync to SD card');
        }
      } else {
        // Download SD to local
        const response = await fetch(`/api/cartridges/${cartId}/settings/download`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ sdCardPath }),
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

  const handleCreateDefaults = async () => {
    setSyncing(true);
    setError(null);

    try {
      const defaultSettings = createDefaultSettings();
      const titleQuery = gameName ? `?title=${encodeURIComponent(gameName)}` : '';
      const response = await fetch(`/api/cartridges/${cartId}/settings${titleQuery}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(defaultSettings),
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'Failed to create settings');
      }

      await fetchInfo();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create settings');
    } finally {
      setSyncing(false);
    }
  };

  /** Copy the local settings to the card; returns an error to show, or null. The local save already happened. */
  const copySettingsToCard = async (cardPath: string): Promise<string | null> => {
    try {
      await apiPostJson(`/api/cartridges/${cartId}/settings/upload`, { sdCardPath: cardPath });
      return null;
    } catch (err) {
      return `Saved locally, but copying to the SD card failed: ${errorMessage(err)}`;
    }
  };

  const handleImportFile = async (file: File) => {
    try {
      setError(null);
      const formData = new FormData();
      formData.append('settings', file);
      const response = await fetch(`/api/cartridges/${cartId}/settings/import`, {
        method: 'POST',
        body: formData,
      });
      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'Import failed');
      }

      // If connected, also upload to SD
      const cardError = syncPath ? await copySettingsToCard(syncPath) : null;

      await fetchInfo();
      setConflictState('resolved');
      if (cardError) setError(cardError);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Import failed');
    }
  };

  const handleExport = async () => {
    try {
      const response = await fetch(`/api/cartridges/${cartId}/settings/export`);
      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'Export failed');
      }
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      // Use friendly filename if we have a game name
      const safeName = gameName?.replace(/[^a-zA-Z0-9\s-]/g, '').trim();
      a.download = safeName ? `${safeName} (${cartId}) settings.json` : `${cartId}-settings.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Export failed');
    }
  };

  const handleResetToDefault = async () => {
    try {
      setError(null);
      const defaultSettings = createDefaultSettings();
      const titleQuery = gameName ? `?title=${encodeURIComponent(gameName)}` : '';
      const response = await fetch(`/api/cartridges/${cartId}/settings${titleQuery}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(defaultSettings),
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'Failed to reset settings');
      }

      // If SD card connected, also sync to SD
      const cardError = syncPath ? await copySettingsToCard(syncPath) : null;

      await fetchInfo();
      if (cardError) setError(cardError);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to reset settings');
    }
  };

  const handleCopySettings = () => {
    if (!info?.local?.settings) return;
    copyToClipboard(cartId, gameName || 'Unknown', info.local.settings);
    setShowCopiedMessage(true);
    setTimeout(() => setShowCopiedMessage(false), 3000);
  };

  if (loading || syncing) {
    return (
      <div className="tab-content loading">
        {syncing ? 'Syncing settings...' : 'Loading settings...'}
      </div>
    );
  }

  const hasLocal = info?.local?.format === 'current' && !!info.local.settings;
  const hasSD = info?.sd?.format === 'current' && !!info.sd?.settings;
  const localLegacy = info?.local?.format === 'legacy';

  return (
    <div className="tab-content settings-tab">
      {/* Connection Status Banner */}
      <div className={`connection-status ${isConnected ? 'connected' : 'disconnected'}`}>
        <ConnectionIndicator connected={isConnected} />
        <span className="status-text">
          {isConnected ? 'SD Card Connected' : 'SD Card Not Connected'}
        </span>
        <span className="status-note">
          {sdWritable ? 'Changes will sync to both local and SD card' : 'Changes will only save locally'}
        </span>
      </div>

      {isConnected && !sdWritable && info?.sdSupport?.reason && (
        <div className="settings-format-notice">{info.sdSupport.reason}</div>
      )}

      {error && <div className="error-message">{error}</div>}

      {/* Conflict Resolution UI */}
      {conflictState === 'pending' && (
        <div className="conflict-resolution">
          <h4>Settings Conflict Detected</h4>
          <p>Your local settings differ from the SD card. Which version would you like to use?</p>
          <div className="conflict-options">
            <button
              className="btn-secondary conflict-btn"
              onClick={() => handleResolveConflict('use-local')}
              disabled={!sdWritable}
            >
              <span className="conflict-btn-title">Use Local Settings</span>
              <span className="conflict-btn-desc">Update SD card to match your local settings</span>
            </button>
            <button
              className="btn-secondary conflict-btn"
              onClick={() => handleResolveConflict('use-sd')}
            >
              <span className="conflict-btn-title">Use SD Card Settings</span>
              <span className="conflict-btn-desc">Replace local with SD card settings</span>
            </button>
          </div>
        </div>
      )}

      {/* No settings - show create option */}
      {!hasLocal && !hasSD && conflictState === 'resolved' && (
        <div className="no-settings">
          <p className="empty-message">
            {localLegacy
              ? 'The saved settings for this cartridge are from before 3Dos 1.5.1, which reset per-game settings and uses a new format. Create new settings or import a current settings.json.'
              : 'No settings found for this cartridge.'}
          </p>
          <div className="create-settings-options">
            <button className="btn-primary" onClick={handleCreateDefaults}>
              Create Default Settings
            </button>
            <button
              className="btn-secondary"
              onClick={() => inputRef.current?.click()}
            >
              Import from File
            </button>
          </div>
        </div>
      )}

      {/* Settings Editor - only show when conflict is resolved and we have settings */}
      {hasLocal && info?.local?.settings && conflictState === 'resolved' && (
        <>
          <SettingsEditor
            cartId={cartId}
            settings={info.local.settings}
            sdCardPath={syncPath}
            onCartridgeColorChange={onCartridgeColorChange}
            onSettingsChange={(newSettings) => {
              // Update local info so copy settings uses current values
              setInfo(prev => prev ? {
                ...prev,
                local: {
                  ...prev.local,
                  settings: newSettings,
                }
              } : prev);
            }}
          />

          {/* Secondary Actions */}
          <div className="settings-secondary-actions">
            <div className="export-import-dropdown" ref={exportImportRef}>
              <button
                className="btn-ghost dropdown-trigger"
                onClick={() => setShowExportImportMenu(!showExportImportMenu)}
              >
                Export / Import
                <img
                  src="/pixel-arrow-right.png"
                  alt=""
                  className={`dropdown-arrow ${showExportImportMenu ? 'open' : ''}`}
                />
              </button>
              {showExportImportMenu && (
                <div className="dropdown-menu">
                  <button
                    className="dropdown-item"
                    onClick={() => {
                      handleExport();
                      setShowExportImportMenu(false);
                    }}
                  >
                    Export settings.json
                  </button>
                  <button
                    className="dropdown-item"
                    onClick={() => {
                      inputRef.current?.click();
                      setShowExportImportMenu(false);
                    }}
                  >
                    Import settings.json
                  </button>
                </div>
              )}
            </div>
            <Tooltip content="Reset this cartridge to the Analogue 3D default display and hardware settings">
              <button className="btn-ghost btn-danger-text" onClick={handleResetToDefault}>
                Reset
              </button>
            </Tooltip>
            {showCopiedMessage ? (
              <div className="copied-message-inline">
                <span className="copied-icon">✓</span>
                <span>Copied!</span>
              </div>
            ) : (
              <Tooltip content="Copy these settings to paste to other cartridges in Select Mode">
                <button className="btn-ghost copy-settings-btn" onClick={handleCopySettings}>
                  <img src="/copy.png" alt="" className="copy-icon" />
                  <span>Copy</span>
                </button>
              </Tooltip>
            )}
          </div>
        </>
      )}

      <input
        ref={inputRef}
        type="file"
        accept=".json,application/json"
        onChange={(e) => e.target.files?.[0] && handleImportFile(e.target.files[0])}
        style={{ display: 'none' }}
      />
    </div>
  );
}
