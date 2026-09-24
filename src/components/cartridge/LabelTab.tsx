import { useState, useRef, useEffect } from 'react';
import { CartridgeSprite } from '../CartridgeSprite';
import { useLabelSync } from '../LabelSyncIndicator';
import { apiFetch, errorMessage } from '../../lib/api';
import type { LookupResult } from './types';

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

export function LabelTab({
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
