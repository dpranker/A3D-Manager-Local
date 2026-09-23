import { useEffect, useState } from 'react';
import { useSDCard } from '../App';
import type { SDCard } from '../types';
import { getDesktopBridge } from './bridge';
import './DesktopSDCardPicker.css';

/**
 * Native "choose SD card folder" button, shown only in the Electron desktop app.
 * The web build keeps using SD_VOLUMES_PATH auto-detection.
 */
export function DesktopSDCardPicker() {
  const bridge = getDesktopBridge();
  const { selectedSDCard, setSelectedSDCard, detectSDCards } = useSDCard();
  const [location, setLocation] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    bridge?.getSDCardPath().then(setLocation).catch(() => setLocation(null));
  }, [bridge]);

  if (!bridge) return null;

  const choose = async () => {
    setBusy(true);
    setError(null);
    try {
      const result = await bridge.chooseSDCard();
      if (result.status === 'canceled') return;
      if (result.status === 'invalid') {
        setError(result.message);
        return;
      }

      setLocation(result.path);
      // Switch to the newly chosen card right away instead of waiting for the next poll
      const response = await fetch('/api/sync/sd-cards');
      if (response.ok) {
        const cards: SDCard[] = await response.json();
        setSelectedSDCard(cards.find((c) => c.path === result.path) ?? cards[0] ?? null);
      }
      await detectSDCards();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="desktop-sd-picker">
      <button
        className="desktop-sd-picker-button"
        onClick={choose}
        disabled={busy}
        title={selectedSDCard?.path ?? location ?? 'No SD card folder chosen'}
      >
        {selectedSDCard ? 'Change SD Card…' : 'Choose SD Card…'}
      </button>
      {error && <span className="desktop-sd-picker-error">{error}</span>}
    </div>
  );
}
