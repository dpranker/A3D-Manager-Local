import { useCallback, useEffect, useState } from 'react';
import { ToggleSwitch, ValueSelector } from './controls';
import { ConnectionIndicator } from './ConnectionIndicator';
import { CARTRIDGE_COLOR_VALUES, OVERCLOCK_VALUES, REGION_VALUES } from '../lib/defaultSettings';
import {
  ACCESSORY_LABELS,
  ACCESSORY_VALUES,
  LIBRARY_REGION_VALUES,
  MAX_ACCESSORIES,
  MAX_PLAYERS,
  MAX_TITLE_LENGTH,
  VIRTUAL_ACCESSORY_LABELS,
  VIRTUAL_ACCESSORY_VALUES,
  createDefaultLibrary,
  libraryRegionLabel,
  type LibraryDefaults,
  type LibraryJson,
} from '../lib/libraryJson';
import './LibraryTab.css';

interface LibraryFileInfo {
  exists: boolean;
  library?: LibraryJson;
  error?: string;
}

interface LibraryInfoResponse {
  local: LibraryFileInfo;
  sd: LibraryFileInfo | null;
  editable: boolean;
  sdSupport: { supported: boolean; reason?: string } | null;
}

interface SaveResponse {
  success: boolean;
  sd: { success: boolean; error?: string } | null;
}

interface LibraryTabProps {
  cartId: string;
  sdCardPath?: string;
  /** The app's custom name for this cart, used to pre-fill the title of a new library.json */
  customName?: string;
  /** Called after a save that changed the title, so the app's custom name can follow it */
  onTitleSaved?: (title: string) => void;
}

const PLAYER_VALUES = Array.from({ length: MAX_PLAYERS }, (_, i) => String(i + 1));

function linesToList(text: string): string[] {
  return text.split('\n').map((line) => line.trim()).filter(Boolean);
}

function validate(library: LibraryJson): string | null {
  const { data } = library;
  if (!data.title.trim()) return 'Title is required';
  if (data.title.length > MAX_TITLE_LENGTH) return `Title can be at most ${MAX_TITLE_LENGTH} characters`;
  if (!Number.isInteger(data.revision) || data.revision < 0 || data.revision > 99) return 'Revision must be a whole number from 0 to 99';
  if (!Number.isInteger(data.release_year) || data.release_year < 1970 || data.release_year > 2100) return 'Release year must be between 1970 and 2100';
  if (data.accessories.length > MAX_ACCESSORIES) return `At most ${MAX_ACCESSORIES} accessories`;
  return null;
}

export function LibraryTab({ cartId, sdCardPath, customName, onTitleSaved }: LibraryTabProps) {
  const [info, setInfo] = useState<LibraryInfoResponse | null>(null);
  const [draft, setDraft] = useState<LibraryJson | null>(null);
  const [saved, setSaved] = useState<LibraryJson | null>(null);
  const [developersText, setDevelopersText] = useState('');
  const [publishersText, setPublishersText] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const isConnected = !!sdCardPath;
  const sdWritable = isConnected && (info?.sdSupport?.supported ?? true);

  const startEditing = useCallback((library: LibraryJson | null) => {
    setDraft(library);
    setSaved(library);
    setDevelopersText(library?.data.developers.join('\n') ?? '');
    setPublishersText(library?.data.publishers.join('\n') ?? '');
  }, []);

  // Titles that come from the card should also become the app's custom name (not the console's placeholder)
  const followCardTitle = useCallback(
    (library: LibraryJson | undefined) => {
      const title = library?.data.title;
      if (title && title !== 'Unknown Cartridge' && title !== customName) onTitleSaved?.(title);
    },
    [customName, onTitleSaved],
  );

  const load = useCallback(async (): Promise<LibraryInfoResponse | null> => {
    const params = sdCardPath ? `?sdCardPath=${encodeURIComponent(sdCardPath)}` : '';
    const response = await fetch(`/api/library/${cartId}${params}`);
    if (!response.ok) throw new Error((await response.json()).error || 'Failed to load library.json');
    const data: LibraryInfoResponse = await response.json();
    setInfo(data);
    return data;
  }, [cartId, sdCardPath]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      setMessage(null);
      try {
        let data = await load();
        // No local copy yet but the card has one (e.g. created by the console): use it
        if (data && !data.local.exists && data.sd?.library && sdCardPath) {
          const response = await fetch(`/api/library/${cartId}/download`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ sdCardPath }),
          });
          if (response.ok) {
            data = await load();
            if (!cancelled) followCardTitle(data?.local.library);
          }
        }
        if (!cancelled) startEditing(data?.local.library ?? null);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to load library.json');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
    // Only reload when the cart or card changes, not when the parent's callbacks do
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cartId, sdCardPath, load, startEditing]);

  const save = async (library: LibraryJson) => {
    const problem = validate(library);
    if (problem) {
      setError(problem);
      return;
    }
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const params = sdWritable ? `?sdCardPath=${encodeURIComponent(sdCardPath!)}` : '';
      const response = await fetch(`/api/library/${cartId}${params}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(library),
      });
      const result: SaveResponse & { error?: string } = await response.json();
      if (!response.ok) throw new Error(result.error || 'Failed to save library.json');

      if (result.sd && !result.sd.success) {
        setMessage(`Saved locally. Not written to the SD card: ${result.sd.error}`);
      } else if (result.sd?.success) {
        setMessage('Saved locally and to the SD card.');
      } else {
        setMessage(isConnected ? 'Saved locally only (see the note above).' : 'Saved locally. It will be written to your SD card when you save with the card connected.');
      }
      const titleChanged = library.data.title !== saved?.data.title;
      const data = await load();
      startEditing(data?.local.library ?? library);
      if (titleChanged && library.data.title !== 'Unknown Cartridge') onTitleSaved?.(library.data.title);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save library.json');
    } finally {
      setBusy(false);
    }
  };

  const useCardCopy = async () => {
    if (!sdCardPath) return;
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`/api/library/${cartId}/download`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sdCardPath }),
      });
      if (!response.ok) throw new Error((await response.json()).error || 'Failed to copy from the SD card');
      const data = await load();
      startEditing(data?.local.library ?? null);
      followCardTitle(data?.local.library);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to copy from the SD card');
    } finally {
      setBusy(false);
    }
  };

  const updateData = <K extends keyof LibraryJson['data']>(key: K, value: LibraryJson['data'][K]) =>
    setDraft((prev) => (prev ? { ...prev, data: { ...prev.data, [key]: value } } : prev));
  const updateDefaults = <K extends keyof LibraryDefaults>(key: K, value: LibraryDefaults[K]) =>
    setDraft((prev) => (prev ? { ...prev, defaults: { ...prev.defaults, [key]: value } } : prev));
  const toggleInList = <T extends string>(list: T[], value: T): T[] =>
    list.includes(value) ? list.filter((v) => v !== value) : [...list, value];

  if (loading) {
    return <div className="tab-content loading">Loading library details...</div>;
  }

  if (info && !info.editable) {
    return (
      <div className="tab-content library-tab">
        <p className="field-hint">
          This cartridge is in the console's built-in database, so it uses the console's own title and details.
          library.json only applies to unknown cartridges such as homebrew, flash carts and reproductions.
        </p>
      </div>
    );
  }

  const dirty = draft && JSON.stringify(draft) !== JSON.stringify(saved);
  const conflict =
    info?.local.library && info.sd?.library && JSON.stringify(info.local.library) !== JSON.stringify(info.sd.library);

  return (
    <div className="tab-content library-tab">
      <div className={`connection-status ${isConnected ? 'connected' : 'disconnected'}`}>
        <ConnectionIndicator connected={isConnected} />
        <span className="status-text">{isConnected ? 'SD Card Connected' : 'SD Card Not Connected'}</span>
        <span className="status-note">{sdWritable ? 'Saves go to local and SD card' : 'Saves are local only'}</span>
      </div>

      {isConnected && !sdWritable && info?.sdSupport?.reason && (
        <div className="settings-format-notice">{info.sdSupport.reason}</div>
      )}

      <p className="field-hint">
        Sets how this cartridge appears in your Analogue 3D library: its title and details, and the default settings
        it starts with. Supported since 3D<sup>os</sup> 1.5.1.
      </p>

      {error && <div className="error-message">{error}</div>}
      {message && <div className="library-message">{message}</div>}

      {conflict && !dirty && (
        <div className="conflict-resolution">
          <h4>SD Card Has Different Details</h4>
          <p>The library.json on your SD card differs from your local copy. Which one do you want to keep?</p>
          <div className="conflict-options">
            <button className="btn-secondary conflict-btn" onClick={() => draft && save(draft)} disabled={busy || !sdWritable}>
              <span className="conflict-btn-title">Keep Local</span>
              <span className="conflict-btn-desc">Write your local details to the SD card</span>
            </button>
            <button className="btn-secondary conflict-btn" onClick={useCardCopy} disabled={busy}>
              <span className="conflict-btn-title">Use SD Card</span>
              <span className="conflict-btn-desc">Replace your local copy with the card's</span>
            </button>
          </div>
        </div>
      )}

      {!draft ? (
        <div className="no-settings">
          <p className="empty-message">
            {info?.local.error || info?.sd?.error
              ? `The existing library.json couldn't be read: ${info?.local.error ?? info?.sd?.error}`
              : 'No library details for this cartridge yet.'}
          </p>
          <div className="create-settings-options">
            <button className="btn-primary" onClick={() => startEditing(createDefaultLibrary(customName || 'Unknown Cartridge'))}>
              Add Library Details
            </button>
          </div>
        </div>
      ) : (
        <>
          <div className="library-fields">
            <label className="library-field library-field--wide">
              <span>Title</span>
              <input
                type="text"
                value={draft.data.title}
                maxLength={MAX_TITLE_LENGTH}
                onChange={(e) => updateData('title', e.target.value)}
                autoComplete="off"
                data-1p-ignore
                data-lpignore="true"
              />
            </label>

            <label className="library-field">
              <span>Revision</span>
              <input
                type="number"
                min={0}
                max={99}
                value={draft.data.revision}
                onChange={(e) => updateData('revision', Number(e.target.value))}
              />
              <small>{draft.data.revision === 0 ? 'Original release' : `Shown as "Rev ${draft.data.revision}"`}</small>
            </label>

            <label className="library-field">
              <span>Release Year</span>
              <input
                type="number"
                min={1970}
                max={2100}
                value={draft.data.release_year}
                onChange={(e) => updateData('release_year', Number(e.target.value))}
              />
            </label>

            <label className="library-field">
              <span>Developers</span>
              <textarea
                rows={2}
                value={developersText}
                placeholder="One per line"
                onChange={(e) => {
                  setDevelopersText(e.target.value);
                  updateData('developers', linesToList(e.target.value));
                }}
              />
            </label>

            <label className="library-field">
              <span>Publishers</span>
              <textarea
                rows={2}
                value={publishersText}
                placeholder="One per line"
                onChange={(e) => {
                  setPublishersText(e.target.value);
                  updateData('publishers', linesToList(e.target.value));
                }}
              />
            </label>
          </div>

          <div className="settings-editor-content">
            <ValueSelector
              label="Players"
              values={PLAYER_VALUES}
              value={String(draft.data.player_count)}
              onChange={(val) => updateData('player_count', Number(val))}
            />
          </div>

          <div className="library-chips-group">
            <span className="library-chips-label">Regions</span>
            <div className="library-chips">
              {LIBRARY_REGION_VALUES.map((region) => (
                <button
                  key={region}
                  type="button"
                  className={`library-chip ${draft.data.region.includes(region) ? 'selected' : ''}`}
                  onClick={() => updateData('region', LIBRARY_REGION_VALUES.filter((r) => toggleInList(draft.data.region, region).includes(r)))}
                >
                  {libraryRegionLabel(region)}
                </button>
              ))}
            </div>
          </div>

          <div className="library-chips-group">
            <span className="library-chips-label">
              Accessories <small>(up to {MAX_ACCESSORIES})</small>
            </span>
            <div className="library-chips">
              {ACCESSORY_VALUES.map((accessory) => {
                const selected = draft.data.accessories.includes(accessory);
                return (
                  <button
                    key={accessory}
                    type="button"
                    className={`library-chip ${selected ? 'selected' : ''}`}
                    disabled={!selected && draft.data.accessories.length >= MAX_ACCESSORIES}
                    onClick={() =>
                      updateData('accessories', ACCESSORY_VALUES.filter((a) => toggleInList(draft.data.accessories, accessory).includes(a)))
                    }
                  >
                    {ACCESSORY_LABELS[accessory]}
                  </button>
                );
              })}
            </div>
          </div>

          <details className="library-defaults">
            <summary>Default Settings</summary>
            <p className="field-hint">
              What this cartridge starts with before you change anything. Your per-game settings (Settings tab) take
              priority.
            </p>
            <div className="settings-editor-content">
              <ValueSelector
                label="Cartridge Color"
                values={CARTRIDGE_COLOR_VALUES}
                value={draft.defaults.cart_color}
                onChange={(val) => updateDefaults('cart_color', val)}
              />
              <ValueSelector
                label="Virtual Accessory"
                values={VIRTUAL_ACCESSORY_VALUES}
                value={draft.defaults.virtual_accessory}
                labelFor={(v) => VIRTUAL_ACCESSORY_LABELS[v]}
                onChange={(val) => updateDefaults('virtual_accessory', val)}
              />
              <ToggleSwitch
                label="Virtual Expansion Pak"
                checked={draft.defaults.virtual_expansion_pak}
                onChange={(val) => updateDefaults('virtual_expansion_pak', val)}
              />
              <ValueSelector label="Region" values={REGION_VALUES} value={draft.defaults.region} onChange={(val) => updateDefaults('region', val)} />
              <ToggleSwitch label="De-Blur" checked={!draft.defaults.disable_deblur} onChange={(val) => updateDefaults('disable_deblur', !val)} />
              {/* Same presentation as the Settings tab (the console shows Off / Auto) */}
              <ValueSelector
                label="32bit Color"
                values={['off', 'auto'] as const}
                value={draft.defaults.enable_32_bit_color ? 'auto' : 'off'}
                onChange={(val) => updateDefaults('enable_32_bit_color', val === 'auto')}
              />
              <ToggleSwitch
                label="Force Progressive Output"
                checked={draft.defaults.force_progressive_output}
                onChange={(val) => updateDefaults('force_progressive_output', val)}
              />
              <ToggleSwitch
                label="Horizontal Upscaling"
                checked={draft.defaults.horizontal_upscaling}
                onChange={(val) => updateDefaults('horizontal_upscaling', val)}
              />
              <ToggleSwitch
                label="Disable Texture Filtering"
                checked={draft.defaults.disable_texture_filtering}
                onChange={(val) => updateDefaults('disable_texture_filtering', val)}
              />
              <ToggleSwitch
                label="Disable Antialiasing"
                checked={draft.defaults.disable_anti_aliasing}
                onChange={(val) => updateDefaults('disable_anti_aliasing', val)}
              />
              <ToggleSwitch
                label="Force Original Hardware"
                checked={draft.defaults.force_original_hardware}
                onChange={(val) => updateDefaults('force_original_hardware', val)}
              />
              <ValueSelector label="Overclock" values={OVERCLOCK_VALUES} value={draft.defaults.overclock} onChange={(val) => updateDefaults('overclock', val)} />
            </div>
          </details>

          <div className="library-actions">
            <button className="btn-primary" onClick={() => save(draft)} disabled={busy || (!dirty && info?.local.exists)}>
              {busy ? 'Saving...' : info?.local.exists ? 'Save' : 'Create library.json'}
            </button>
            {dirty && info?.local.exists && (
              <button className="btn-ghost" onClick={() => startEditing(saved)} disabled={busy}>
                Discard Changes
              </button>
            )}
          </div>
        </>
      )}
    </div>
  );
}
