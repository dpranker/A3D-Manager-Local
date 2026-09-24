import { useState, useRef, useEffect } from 'react';
import { OptionSelector, ToggleSwitch, ValueSelector } from '../controls';
import { Button } from '../ui';
import { cancelPendingSave, onSaveStatus, queueSettingsSave, retrySave } from '../../lib/settingsAutoSave';
import {
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
} from '../../lib/defaultSettings';

const BIT_COLOR_OPTIONS = ['Off', 'Auto'];

interface SettingsEditorProps {
  cartId: string;
  settings: CartridgeSettings;
  sdCardPath?: string;
  onSettingsChange?: (settings: CartridgeSettings) => void;
  onCartridgeColorChange?: (color: string) => void;
}

type SettingsEditorTab = 'display' | 'hardware';

export function SettingsEditor({ cartId, settings: initialSettings, sdCardPath, onSettingsChange, onCartridgeColorChange }: SettingsEditorProps) {
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
