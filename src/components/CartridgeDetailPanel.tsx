import { useState, useRef, useEffect, useCallback } from 'react';
import { useImageCache, useSettingsClipboard } from '../App';
import { IconButton, OptionSelector, ToggleSwitch, ValueSelector } from './controls';
import { Tooltip } from './ui/Tooltip';
import { Button } from './ui';
import { CartridgeSprite } from './CartridgeSprite';
import { ConnectionIndicator } from './ConnectionIndicator';
import { useLabelSync } from './LabelSyncIndicator';
import { LibraryTab } from './LibraryTab';
import { MemoriesTab } from './MemoriesTab';
import { ScreenshotsTab } from './ScreenshotsTab';
import { cartridgeShellColor } from '../lib/cartColors';
import { cancelPendingSave, onSaveStatus, queueSettingsSave, retrySave } from '../lib/settingsAutoSave';
import { apiFetch, apiPostJson, errorMessage } from '../lib/api';
import {
  createDefaultSettings,
  valueLabel,
  DISPLAY_MODE_VALUES,
  DISPLAY_MODE_LABELS,
  BEAM_CONVERGENCE_VALUES,
  EDGE_HARDNESS_VALUES,
  IMAGE_SIZE_VALUES,
  IMAGE_FIT_VALUES,
  SHARPNESS_VALUES,
  INTERPOLATION_VALUES,
  GAMMA_TRANSFER_VALUES,
  REGION_VALUES,
  OVERCLOCK_VALUES,
  CARTRIDGE_COLOR_VALUES,
  type DisplayMode,
  type CRTModeSettings,
  type CleanModeSettings,
  type DisplayCatalog,
  type CartridgeSettings,
  type HardwareSettings,
} from '../lib/defaultSettings';
import './CartridgeDetailPanel.css';

interface CartridgeDetailPanelProps {
  cartId: string;
  gameName?: string;
  /** Shell color from the console's cartridge color setting */
  shellColor?: string;
  sdCardPath?: string;
  onClose: () => void;
  onUpdate: () => void;
  onDelete?: () => void;
}

interface LookupResult {
  found: boolean;
  source?: 'internal' | 'user';
  cartId: string;
  name?: string;
  region?: string;
  videoMode?: string;
}

// Option arrays for controls
const BIT_COLOR_OPTIONS = ['Off', 'Auto'];


// API response types matching backend
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

type TabId = 'label' | 'settings' | 'gamepak' | 'library' | 'screenshots' | 'memories';

export function CartridgeDetailPanel({
  cartId,
  gameName,
  shellColor,
  sdCardPath,
  onClose,
  onUpdate,
  onDelete,
}: CartridgeDetailPanelProps) {
  const [activeTab, setActiveTab] = useState<TabId>('label');
  const [isOwned, setIsOwned] = useState(false);
  const [ownershipError, setOwnershipError] = useState<string | null>(null);
  const [lookupResult, setLookupResult] = useState<LookupResult | null>(null);
  // Follows the Settings tab's Cartridge Color live; starts with the grid's value
  const [currentShellColor, setCurrentShellColor] = useState(shellColor);
  const { imageCacheBuster: globalCacheBuster } = useImageCache();
  const [localCacheBuster, setLocalCacheBuster] = useState(() => Date.now());
  // Combine global and local cache busters
  const imageCacheBuster = Math.max(globalCacheBuster, localCacheBuster);

  // Check ownership status
  useEffect(() => {
    const checkOwnership = async () => {
      try {
        const response = await fetch('/api/cartridges/owned');
        if (response.ok) {
          const data = await response.json();
          const ownedIds = data.cartridges.map((c: { cartId: string }) => c.cartId.toLowerCase());
          setIsOwned(ownedIds.includes(cartId.toLowerCase()));
        }
      } catch (err) {
        console.error('Failed to check ownership:', err);
      }
    };
    checkOwnership();
  }, [cartId]);

  // Look up cart info on mount
  useEffect(() => {
    const lookupCart = async () => {
      try {
        const response = await fetch(`/api/labels/lookup/${cartId}`);
        if (response.ok) {
          const data: LookupResult = await response.json();
          setLookupResult(data);
        }
      } catch (err) {
        console.error('Failed to lookup cart:', err);
      }
    };
    lookupCart();
  }, [cartId]);

  const handleToggleOwned = async (newValue: boolean) => {
    try {
      setOwnershipError(null);
      await apiFetch(`/api/cartridges/owned/${cartId}`, { method: newValue ? 'POST' : 'DELETE' });
      setIsOwned(newValue);
      onUpdate();
    } catch (err) {
      // The toggle stays as it was: the change wasn't saved
      console.error('Failed to toggle ownership:', err);
      setOwnershipError(`Ownership wasn't changed: ${errorMessage(err)}`);
    }
  };

  const displayName = lookupResult?.name || gameName || 'Unknown Cartridge';
  // library.json (3Dos 1.5.1+) is only for cartridges outside the built-in database
  const showLibraryTab = lookupResult !== null && lookupResult.source !== 'internal';

  // A title saved in library.json becomes the app's custom name for this cart
  const handleLibraryTitleSaved = async (title: string) => {
    try {
      const response = await fetch(`/api/labels/user-cart/${cartId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: title }),
      });
      if (response.ok) {
        setLookupResult((prev) => (prev ? { ...prev, found: true, source: 'user', name: title } : prev));
        onUpdate();
      }
    } catch (err) {
      console.error('Failed to update custom name:', err);
    }
  };

  return (
    <div className="slide-over-overlay" onClick={onClose}>
      <div className="slide-over-panel" onClick={(e) => e.stopPropagation()}>
        <div className="slide-over-header">
          <CartridgeSprite
            artworkUrl={`/api/labels/${cartId}?v=${imageCacheBuster}`}
            alt={displayName}
            color="dark"
            size="small"
            shellColor={currentShellColor}
          />
          <div className="slide-over-title">
            <h2>{displayName}</h2>
            <code className="text-label text-accent">{cartId}</code>
          </div>
          <IconButton onClick={onClose} aria-label="Close panel">
            &times;
          </IconButton>
        </div>

        {/* Tabs & Ownership Toggle */}
        <div className="slide-over-tabs">
          <div className="slide-over-tabs-left">
            <button
              className={`tab-btn ${activeTab === 'label' ? 'active' : ''}`}
              onClick={() => setActiveTab('label')}
            >
              Label
            </button>
            <button
              className={`tab-btn ${activeTab === 'settings' ? 'active' : ''}`}
              onClick={() => setActiveTab('settings')}
            >
              Settings
            </button>
            <button
              className={`tab-btn ${activeTab === 'gamepak' ? 'active' : ''}`}
              onClick={() => setActiveTab('gamepak')}
            >
              Game Pak
            </button>
            {showLibraryTab && (
              <button
                className={`tab-btn ${activeTab === 'library' ? 'active' : ''}`}
                onClick={() => setActiveTab('library')}
              >
                Library
              </button>
            )}
            <button
              className={`tab-btn ${activeTab === 'screenshots' ? 'active' : ''}`}
              onClick={() => setActiveTab('screenshots')}
            >
              Screenshots
            </button>
            <button
              className={`tab-btn ${activeTab === 'memories' ? 'active' : ''}`}
              onClick={() => setActiveTab('memories')}
            >
              Memories
            </button>
          </div>
          <div className="ownership-toggle">
            <ToggleSwitch
              label=""
              checked={isOwned}
              onChange={handleToggleOwned}
              onText="OWNED"
              offText="NOT OWNED"
            />
          </div>
        </div>

        <div className="slide-over-content">
          {ownershipError && <div className="error-message">{ownershipError}</div>}
          {activeTab === 'label' && (
            <LabelTab
              cartId={cartId}
              lookupResult={lookupResult}
              setLookupResult={setLookupResult}
              imageCacheBuster={imageCacheBuster}
              onImageUpdate={() => setLocalCacheBuster(Date.now())}
              onUpdate={onUpdate}
              onClose={onClose}
              onDelete={onDelete}
              shellColor={currentShellColor}
            />
          )}
          {activeTab === 'settings' && (
            <SettingsTab
              cartId={cartId}
              sdCardPath={sdCardPath}
              gameName={displayName}
              onCartridgeColorChange={(color) => setCurrentShellColor(cartridgeShellColor(color))}
            />
          )}
          {activeTab === 'gamepak' && (
            <GamePakTab
              cartId={cartId}
              sdCardPath={sdCardPath}
              gameName={displayName}
            />
          )}
          {activeTab === 'library' && showLibraryTab && (
            <LibraryTab
              cartId={cartId}
              sdCardPath={sdCardPath}
              customName={lookupResult?.source === 'user' ? lookupResult.name : undefined}
              onTitleSaved={handleLibraryTitleSaved}
            />
          )}
          {activeTab === 'screenshots' && <ScreenshotsTab cartId={cartId} sdCardPath={sdCardPath} />}
          {activeTab === 'memories' && <MemoriesTab cartId={cartId} sdCardPath={sdCardPath} />}
        </div>
      </div>
    </div>
  );
}

// ============================================================================
// Label Tab
// ============================================================================

interface LabelTabProps {
  cartId: string;
  lookupResult: LookupResult | null;
  setLookupResult: React.Dispatch<React.SetStateAction<LookupResult | null>>;
  imageCacheBuster: number;
  onImageUpdate: () => void;
  onUpdate: () => void;
  onClose: () => void;
  onDelete?: () => void;
  shellColor?: string;
}

function LabelTab({
  cartId,
  lookupResult,
  setLookupResult,
  imageCacheBuster,
  onImageUpdate,
  onUpdate,
  onClose,
  onDelete,
  shellColor,
}: LabelTabProps) {
  const { markLocalChanges } = useLabelSync();
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dragActive, setDragActive] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deletingLabel, setDeletingLabel] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // User cart editing state
  const [editableName, setEditableName] = useState(lookupResult?.name || '');
  const [savingName, setSavingName] = useState(false);
  const [nameChanged, setNameChanged] = useState(false);

  // Update editable name when lookup result changes
  useEffect(() => {
    if (lookupResult?.name) {
      setEditableName(lookupResult.name);
    }
  }, [lookupResult?.name]);

  const imageUrl = `/api/labels/${cartId}?v=${imageCacheBuster}`;

  const isUserCart = lookupResult?.source === 'user';
  const isUnknownCart = lookupResult && !lookupResult.found;
  const canEditName = isUserCart || isUnknownCart;

  const handleFile = (selectedFile: File) => {
    if (!selectedFile.type.startsWith('image/')) {
      setError('Please select an image file');
      return;
    }

    setFile(selectedFile);
    setError(null);

    const reader = new FileReader();
    reader.onloadend = () => {
      setPreview(reader.result as string);
    };
    reader.readAsDataURL(selectedFile);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragActive(false);
    if (e.dataTransfer.files?.[0]) {
      handleFile(e.dataTransfer.files[0]);
    }
  };

  const handleNameChange = (newName: string) => {
    setEditableName(newName);
    setNameChanged(newName !== (lookupResult?.name || ''));
  };

  const handleSaveName = async () => {
    if (!editableName.trim()) {
      setError('Name cannot be empty');
      return;
    }

    try {
      setSavingName(true);
      setError(null);

      const response = await fetch(`/api/labels/user-cart/${cartId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: editableName.trim() }),
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'Failed to save name');
      }

      setNameChanged(false);
      setLookupResult(prev => prev ? { ...prev, found: true, source: 'user', name: editableName.trim() } : null);
      onUpdate();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save name');
    } finally {
      setSavingName(false);
    }
  };

  const handleUpload = async () => {
    if (!file) return;

    try {
      setUploading(true);
      setError(null);

      const formData = new FormData();
      formData.append('image', file);

      const response = await fetch(`/api/labels/${cartId}`, {
        method: 'PUT',
        body: formData,
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'Upload failed');
      }

      setFile(null);
      setPreview(null);
      onImageUpdate();
      onUpdate();
      markLocalChanges(); // Mark that local labels have changed
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Upload failed');
    } finally {
      setUploading(false);
    }
  };

  const handleDelete = async () => {
    if (!confirm(`Delete label for ${cartId}? This cannot be undone.`)) {
      return;
    }

    try {
      setDeleting(true);
      setError(null);

      const response = await fetch(`/api/labels/${cartId}`, {
        method: 'DELETE',
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'Delete failed');
      }

      markLocalChanges(); // Mark that local labels have changed

      if (isUserCart) {
        try {
          await apiFetch(`/api/labels/user-cart/${cartId}`, { method: 'DELETE' });
        } catch (err) {
          // The label is gone; say so rather than closing as if the name went too
          onDelete?.();
          throw new Error(`The label was deleted, but the custom name wasn't removed: ${errorMessage(err)}`);
        }
      }

      onDelete?.();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Delete failed');
    } finally {
      setDeleting(false);
    }
  };

  const handleDeleteLabel = async () => {
    if (!confirm(`Delete the label image for ${cartId}? The cartridge entry will remain.`)) {
      return;
    }

    try {
      setDeletingLabel(true);
      setError(null);

      const response = await fetch(`/api/labels/${cartId}`, {
        method: 'DELETE',
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'Delete failed');
      }

      markLocalChanges();
      onImageUpdate();
      onUpdate();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Delete failed');
    } finally {
      setDeletingLabel(false);
    }
  };

  return (
    <div className="tab-content label-tab">
      {/* Game Name */}
      <div className="field-group">
        <label>
          Game Name
          {lookupResult?.source === 'internal' && (
            <span className="label-badge label-badge-internal">Known Game</span>
          )}
          {lookupResult?.source === 'user' && (
            <span className="label-badge label-badge-user">Custom Name</span>
          )}
          {isUnknownCart && (
            <span className="label-badge label-badge-unknown">Unknown Cart</span>
          )}
        </label>
        {canEditName ? (
          <div className="name-editor">
            <div className="name-editor-row">
              <input
                type="text"
                value={editableName}
                onChange={(e) => handleNameChange(e.target.value)}
                placeholder="Enter game name"
                autoComplete="off"
                data-1p-ignore
                data-lpignore="true"
                data-form-type="other"
              />
              {nameChanged && (
                <button
                  className="btn-primary btn-small"
                  onClick={handleSaveName}
                  disabled={savingName || !editableName.trim()}
                >
                  {savingName ? 'Saving...' : 'Save'}
                </button>
              )}
            </div>
            {lookupResult?.source === 'user' && (
              <span className="text-caption">
                This cart ID isn't in our database. You can edit the name above.
              </span>
            )}
            {isUnknownCart && (
              <span className="text-caption">
                This cart ID isn't in our database. Add a name above to identify it.
              </span>
            )}
          </div>
        ) : (
          <div className="known-game-info">
            <span className="readonly">{editableName || 'Unknown'}</span>
            {lookupResult?.source === 'internal' && lookupResult.region && (
              <span className="text-subtle">
                {lookupResult.region}
                {lookupResult.videoMode && lookupResult.videoMode !== 'Unknown' && ` • ${lookupResult.videoMode}`}
              </span>
            )}
          </div>
        )}
      </div>

      {/* Label Preview & Upload */}
      <div className="label-comparison">
        <div className="label-current">
          <h4 className="text-label">Current Label</h4>
          <CartridgeSprite
            artworkUrl={imageUrl}
            alt="Current label"
            color="dark"
            size="large"
            shellColor={shellColor}
          />
        </div>

        <div className="label-new">
          <h4 className="text-label">New Label</h4>
          <div
            className={`drop-zone ${dragActive ? 'active' : ''}`}
            onDragOver={(e) => {
              e.preventDefault();
              setDragActive(true);
            }}
            onDragLeave={() => setDragActive(false)}
            onDrop={handleDrop}
            onClick={() => inputRef.current?.click()}
          >
            {preview ? (
              <img src={preview} alt="Preview" className="preview-image" />
            ) : (
              <div className="drop-zone-content">
                <p>Drop image here</p>
                <p className="hint">or click to select</p>
              </div>
            )}
          </div>
        </div>
      </div>

      <input
        ref={inputRef}
        type="file"
        accept="image/png,image/jpeg,image/webp"
        onChange={(e) => e.target.files?.[0] && handleFile(e.target.files[0])}
        style={{ display: 'none' }}
      />

      <p className="artwork-note text-muted">
        Image will be resized to 74x86 pixels.
      </p>

      {error && <div className="error-message">{error}</div>}

      {/* Actions */}
      <div className="tab-actions">
        <div className="tab-actions-left">
          <button
            className="btn-ghost btn-danger-text"
            onClick={handleDelete}
            disabled={uploading || deleting || deletingLabel}
          >
            {deleting ? 'Deleting...' : 'Delete Cartridge'}
          </button>
          <button
            className="btn-ghost btn-danger-text"
            onClick={handleDeleteLabel}
            disabled={uploading || deleting || deletingLabel}
          >
            {deletingLabel ? 'Deleting...' : 'Delete Label'}
          </button>
        </div>
        <button
          className="btn-primary"
          onClick={handleUpload}
          disabled={!file || uploading || deleting || deletingLabel}
        >
          {uploading ? 'Uploading...' : 'Update Label'}
        </button>
      </div>
    </div>
  );
}

// ============================================================================
// Settings Tab
// ============================================================================

interface SettingsTabProps {
  cartId: string;
  sdCardPath?: string;
  gameName?: string;
  /** Reports the Cartridge Color as settings load and change, for the cart previews */
  onCartridgeColorChange?: (color: string) => void;
}

// Helper to compare settings objects (shallow comparison of key values)
function settingsAreDifferent(a: CartridgeSettings | undefined, b: CartridgeSettings | undefined): boolean {
  if (!a || !b) return true;
  // Compare JSON strings for deep equality
  return JSON.stringify(a) !== JSON.stringify(b);
}

type ConflictResolution = 'pending' | 'use-local' | 'use-sd' | 'resolved';

function SettingsTab({ cartId, sdCardPath, gameName, onCartridgeColorChange }: SettingsTabProps) {
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

// ============================================================================
// Settings Editor Component
// ============================================================================

interface SettingsEditorProps {
  cartId: string;
  settings: CartridgeSettings;
  sdCardPath?: string;
  onSettingsChange?: (settings: CartridgeSettings) => void;
  onCartridgeColorChange?: (color: string) => void;
}

type SettingsEditorTab = 'display' | 'hardware';

function SettingsEditor({ cartId, settings: initialSettings, sdCardPath, onSettingsChange, onCartridgeColorChange }: SettingsEditorProps) {
  const [activeTab, setActiveTab] = useState<SettingsEditorTab>('display');
  const [settings, setSettings] = useState<CartridgeSettings>(initialSettings);
  const [saveStatus, setSaveStatus] = useState<'idle' | 'pending' | 'saving' | 'saved' | 'error'>('idle');
  const [error, setError] = useState<string | null>(null);

  // The settings as last saved, to detect actual changes
  const initialSettingsJson = useRef(JSON.stringify(initialSettings));
  // Whether this editor has a change queued (so undoing it can cancel it)
  const queuedChange = useRef(false);

  const currentDisplayMode = settings.display.odm;
  const isCleanMode = currentDisplayMode === 'clean';

  // Subscribe to save status updates for this cartridge
  useEffect(() => {
    const unsubscribe = onSaveStatus((statusCartId, status, errorMsg, savedJson) => {
      if (statusCartId === cartId) {
        setSaveStatus(status);
        if (status === 'error') {
          setError(errorMsg || 'Save failed');
        } else if (status === 'saved') {
          setError(null);
          // The baseline is what was written, which may be older than the editor's state
          if (savedJson !== undefined) initialSettingsJson.current = savedJson;
        }
      }
    });
    return unsubscribe;
  }, [cartId]);

  // The parent passes a new callback on every render and re-renders when it's called;
  // keep it out of the effect's dependencies or each notification re-queues the save
  // (resetting its debounce, so it never runs) in an endless render loop
  const onSettingsChangeRef = useRef(onSettingsChange);
  useEffect(() => {
    onSettingsChangeRef.current = onSettingsChange;
  }, [onSettingsChange]);

  // Report the cartridge color (on load and on change) so the cart previews follow it.
  // Same ref pattern as onSettingsChange: the parent's callback changes every render.
  const onCartridgeColorChangeRef = useRef(onCartridgeColorChange);
  useEffect(() => {
    onCartridgeColorChangeRef.current = onCartridgeColorChange;
  }, [onCartridgeColorChange]);
  const cartridgeColor = settings.library.cartridge_color;
  useEffect(() => {
    onCartridgeColorChangeRef.current?.(cartridgeColor);
  }, [cartridgeColor]);

  // Auto-save when settings actually change from initial/saved state
  useEffect(() => {
    const currentJson = JSON.stringify(settings);
    // Only queue save if settings differ from initial/last-saved state
    if (currentJson !== initialSettingsJson.current) {
      queueSettingsSave(cartId, settings, sdCardPath);
      queuedChange.current = true;
      // Notify parent of settings change so copy uses current settings
      onSettingsChangeRef.current?.(settings);
    } else if (queuedChange.current) {
      // Changed back to what's saved (A -> B -> A): drop the queued B
      cancelPendingSave(cartId);
      queuedChange.current = false;
      onSettingsChangeRef.current?.(settings);
    }
  }, [cartId, settings, sdCardPath]);

  // Helper to update display settings
  const updateDisplayMode = (mode: DisplayMode) => {
    setSettings(prev => ({
      ...prev,
      display: { ...prev.display, odm: mode }
    }));
  };

  // Helper to update CRT mode settings
  const updateCRTSetting = <K extends keyof CRTModeSettings>(
    mode: DisplayMode,
    key: K,
    value: CRTModeSettings[K]
  ) => {
    if (mode === 'clean') return;
    setSettings(prev => ({
      ...prev,
      display: {
        ...prev.display,
        catalog: {
          ...prev.display.catalog,
          [mode]: {
            ...prev.display.catalog[mode as keyof Omit<DisplayCatalog, 'clean'>],
            [key]: value
          }
        }
      }
    }));
  };

  // Helper to update Clean mode settings
  const updateCleanSetting = <K extends keyof CleanModeSettings>(
    key: K,
    value: CleanModeSettings[K]
  ) => {
    setSettings(prev => ({
      ...prev,
      display: {
        ...prev.display,
        catalog: {
          ...prev.display.catalog,
          clean: {
            ...prev.display.catalog.clean,
            [key]: value
          }
        }
      }
    }));
  };

  // Helper to update hardware settings
  const updateHardwareSetting = <K extends keyof HardwareSettings>(
    key: K,
    value: HardwareSettings[K]
  ) => {
    setSettings(prev => ({
      ...prev,
      hardware: { ...prev.hardware, [key]: value }
    }));
  };

  // Get current CRT mode settings
  const getCRTSettings = (): CRTModeSettings | null => {
    if (isCleanMode) return null;
    return settings.display.catalog[currentDisplayMode as keyof Omit<DisplayCatalog, 'clean'>] as CRTModeSettings;
  };

  const crtSettings = getCRTSettings();

  // Determine if Edge Overshoot is locked based on display mode
  const isEdgeOvershootLocked = currentDisplayMode === 'pvm' || currentDisplayMode === 'crt' || currentDisplayMode === 'scanlines';
  const edgeOvershootLockedValue = currentDisplayMode === 'scanlines' ? false : true;

  return (
    <div className="settings-editor">
      {/* Tab Switcher */}
      <div className="settings-editor-tabs">
        <button
          className={`settings-tab-btn ${activeTab === 'display' ? 'active' : ''}`}
          onClick={() => setActiveTab('display')}
        >
          Display
        </button>
        <button
          className={`settings-tab-btn ${activeTab === 'hardware' ? 'active' : ''}`}
          onClick={() => setActiveTab('hardware')}
        >
          Hardware
        </button>
      </div>

      {saveStatus === 'error' ? (
        <div className="settings-save-status error">
          Not saved: {error}{' '}
          <Button size="sm" variant="ghost" onClick={() => void retrySave(cartId)}>
            Retry
          </Button>
        </div>
      ) : (
        error && <div className="error-message">{error}</div>
      )}
      {(saveStatus === 'pending' || saveStatus === 'saving') && (
        <div className={`settings-save-status ${saveStatus}`}>{saveStatus === 'saving' ? 'Saving…' : 'Unsaved changes'}</div>
      )}

      {/* Display Settings */}
      {activeTab === 'display' && (
        <div className="settings-editor-content">
          <ValueSelector
            label="Display Mode"
            values={DISPLAY_MODE_VALUES.map((m) => DISPLAY_MODE_LABELS[m])}
            value={DISPLAY_MODE_LABELS[currentDisplayMode]}
            onChange={(label) => {
              const mode = DISPLAY_MODE_VALUES.find((m) => DISPLAY_MODE_LABELS[m] === label);
              if (mode) updateDisplayMode(mode);
            }}
          />

          {/* CRT-based mode settings (BVM, PVM, CRT, Scanlines) */}
          {!isCleanMode && crtSettings && (
            <>
              <ValueSelector
                label="Horiz. Beam Convergence"
                values={BEAM_CONVERGENCE_VALUES}
                value={crtSettings.horizontal_beam_convergence}
                onChange={(val) => updateCRTSetting(currentDisplayMode, 'horizontal_beam_convergence', val)}
              />

              <ValueSelector
                label="Vert. Beam Convergence"
                values={BEAM_CONVERGENCE_VALUES}
                value={crtSettings.vertical_beam_convergence}
                onChange={(val) => updateCRTSetting(currentDisplayMode, 'vertical_beam_convergence', val)}
              />

              <ToggleSwitch
                label="Edge Overshoot"
                checked={isEdgeOvershootLocked ? edgeOvershootLockedValue : crtSettings.enable_edge_overshoot}
                onChange={(val) => updateCRTSetting(currentDisplayMode, 'enable_edge_overshoot', val)}
                disabled={isEdgeOvershootLocked}
              />

              <ValueSelector
                label="Edge Hardness"
                values={EDGE_HARDNESS_VALUES}
                value={crtSettings.enable_edge_hardness}
                onChange={(val) => updateCRTSetting(currentDisplayMode, 'enable_edge_hardness', val)}
              />

              <ValueSelector
                label="Image Size"
                values={IMAGE_SIZE_VALUES}
                value={crtSettings.image_size}
                onChange={(val) => updateCRTSetting(currentDisplayMode, 'image_size', val)}
              />

              <ValueSelector
                label="Image Fit"
                values={IMAGE_FIT_VALUES}
                value={crtSettings.image_fit}
                onChange={(val) => updateCRTSetting(currentDisplayMode, 'image_fit', val)}
              />
            </>
          )}

          {/* Clean mode settings */}
          {isCleanMode && settings.display.catalog.clean && (
            <>
              <ValueSelector
                label="Interp. Algorithm"
                values={INTERPOLATION_VALUES}
                value={settings.display.catalog.clean.interpolation_alg}
                onChange={(val) => updateCleanSetting('interpolation_alg', val)}
              />

              <ValueSelector
                label="Gamma Transfer"
                values={GAMMA_TRANSFER_VALUES}
                value={settings.display.catalog.clean.gamma_transfer_function}
                onChange={(val) => updateCleanSetting('gamma_transfer_function', val)}
              />

              <ValueSelector
                label="Sharpness"
                values={SHARPNESS_VALUES}
                value={settings.display.catalog.clean.sharpness}
                onChange={(val) => updateCleanSetting('sharpness', val)}
              />

              <ValueSelector
                label="Image Size"
                values={IMAGE_SIZE_VALUES}
                value={settings.display.catalog.clean.image_size}
                onChange={(val) => updateCleanSetting('image_size', val)}
              />

              <ValueSelector
                label="Image Fit"
                values={IMAGE_FIT_VALUES}
                value={settings.display.catalog.clean.image_fit}
                onChange={(val) => updateCleanSetting('image_fit', val)}
              />
            </>
          )}

          {/* Library view (3Dos 1.5.1+) */}
          <ValueSelector
            label="Cartridge Color"
            values={CARTRIDGE_COLOR_VALUES}
            value={settings.library.cartridge_color}
            onChange={(val) => setSettings((prev) => ({ ...prev, library: { ...prev.library, cartridge_color: val } }))}
          />
        </div>
      )}

      {/* Hardware Settings */}
      {activeTab === 'hardware' && (
        <div className="settings-editor-content">
          <ToggleSwitch
            label="Virtual Expansion Pak"
            checked={settings.hardware.virtual_expansion_pak}
            onChange={(val) => updateHardwareSetting('virtual_expansion_pak', val)}
          />

          <ValueSelector
            label="Region"
            values={REGION_VALUES}
            value={settings.hardware.region}
            onChange={(val) => updateHardwareSetting('region', val)}
          />

          {/* De-Blur: Note the inverted logic - disable_deblur=false means ON */}
          <ToggleSwitch
            label="De-Blur"
            checked={!settings.hardware.disable_deblur}
            onChange={(val) => updateHardwareSetting('disable_deblur', !val)}
          />

          <OptionSelector
            label="32bit Color"
            options={BIT_COLOR_OPTIONS}
            value={settings.hardware.enable_32_bit_color ? 'Auto' : 'Off'}
            onChange={(val) => updateHardwareSetting('enable_32_bit_color', val === 'Auto')}
          />

          <ToggleSwitch
            label="Force Progressive Output"
            checked={settings.hardware.force_progressive_output}
            onChange={(val) => updateHardwareSetting('force_progressive_output', val)}
          />

          <ToggleSwitch
            label="Horizontal Upscaling"
            checked={settings.hardware.horizontal_upscaling}
            onChange={(val) => updateHardwareSetting('horizontal_upscaling', val)}
          />

          <ToggleSwitch
            label="Disable Texture Filtering"
            checked={settings.hardware.disable_texture_filtering}
            onChange={(val) => updateHardwareSetting('disable_texture_filtering', val)}
          />

          <ToggleSwitch
            label="Disable Antialiasing"
            checked={settings.hardware.disable_antialiasing}
            onChange={(val) => updateHardwareSetting('disable_antialiasing', val)}
          />

          <ToggleSwitch
            label="Force Original Hardware"
            checked={settings.hardware.force_original_hardware}
            onChange={(val) => updateHardwareSetting('force_original_hardware', val)}
          />

          {/* Overclock - disabled when Force Original Hardware is on */}
          {settings.hardware.force_original_hardware ? (
            <div className="control-row disabled">
              <span className="control-label">Overclock</span>
              <div className="option-selector disabled">
                <button className="arrow-btn disabled" disabled>
                  <img src="/pixel-arrow-left.png" alt="" className="arrow-icon" />
                </button>
                <span className="option-value">{valueLabel(settings.hardware.overclock)}</span>
                <button className="arrow-btn disabled" disabled>
                  <img src="/pixel-arrow-right.png" alt="" className="arrow-icon" />
                </button>
              </div>
            </div>
          ) : (
            <ValueSelector
              label="Overclock"
              values={OVERCLOCK_VALUES}
              value={settings.hardware.overclock}
              onChange={(val) => updateHardwareSetting('overclock', val)}
            />
          )}
        </div>
      )}

    </div>
  );
}

// ============================================================================
// Game Pak Tab
// ============================================================================

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
