import { useState } from 'react';
import { useSDCard } from '../App';
import { LabelsBrowser } from './LabelsBrowser';
import { CartridgeDetailPanel } from './CartridgeDetailPanel';

export function CartridgesPage() {
  const { selectedSDCard } = useSDCard();
  const [selectedCartridge, setSelectedCartridge] = useState<{ cartId: string; name?: string; shellColor?: string } | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [colorsRefreshKey, setColorsRefreshKey] = useState(0);

  return (
    <>
      <LabelsBrowser
        sdCardPath={selectedSDCard?.path}
        onSelectLabel={(cartId, name, shellColor) => setSelectedCartridge({ cartId, name, shellColor })}
        refreshKey={refreshKey}
        colorsRefreshKey={colorsRefreshKey}
      />
      {selectedCartridge && (
        <CartridgeDetailPanel
          key={selectedCartridge.cartId}
          cartId={selectedCartridge.cartId}
          gameName={selectedCartridge.name}
          shellColor={selectedCartridge.shellColor}
          sdCardPath={selectedSDCard?.path}
          onClose={() => {
            setSelectedCartridge(null);
            // The cartridge color may have changed in the Settings or Library tab
            setColorsRefreshKey((k) => k + 1);
          }}
          onUpdate={() => {
            setRefreshKey(k => k + 1);
          }}
          onDelete={() => {
            setRefreshKey(k => k + 1);
            setSelectedCartridge(null);
          }}
        />
      )}
    </>
  );
}
