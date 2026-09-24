import { useState, useEffect } from 'react';
import { useImageCache } from '../App';
import { IconButton, ToggleSwitch } from './controls';
import { CartridgeSprite } from './CartridgeSprite';
import { LibraryTab } from './LibraryTab';
import { MemoriesTab } from './MemoriesTab';
import { ScreenshotsTab } from './ScreenshotsTab';
import { cartridgeShellColor } from '../lib/cartColors';
import { apiFetch, errorMessage } from '../lib/api';
import { LabelTab } from './cartridge/LabelTab';
import { SettingsTab } from './cartridge/SettingsTab';
import { GamePakTab } from './cartridge/GamePakTab';
import type { LookupResult } from './cartridge/types';
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
