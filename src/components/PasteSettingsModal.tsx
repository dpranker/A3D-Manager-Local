import { useState, useEffect } from 'react';
import { useSettingsClipboard } from '../App';
import { Modal } from './ui/Modal';
import { Button } from './ui/Button';
import './PasteSettingsModal.css';

interface PasteSettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  onPasteComplete: () => void;
  selectedCartIds: string[];
  cartIdToName: Record<string, string | undefined>;
  sdCardPath?: string;
}

export function PasteSettingsModal({
  isOpen,
  onClose,
  onPasteComplete,
  selectedCartIds,
  cartIdToName,
  sdCardPath,
}: PasteSettingsModalProps) {
  const { copiedSettings } = useSettingsClipboard();
  const [isPasting, setIsPasting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [results, setResults] = useState<{ success: number; failed: number; sdFailed: number; sdError?: string } | null>(null);

  // Reset state when modal opens
  useEffect(() => {
    if (isOpen) {
      setIsPasting(false);
      setError(null);
      setResults(null);
    }
  }, [isOpen]);

  const handlePaste = async () => {
    if (!copiedSettings) return;
    setIsPasting(true);
    setError(null);
    setResults(null);

    let successCount = 0;
    let failCount = 0;
    let sdFailCount = 0;
    let sdError: string | undefined;

    try {
      for (const targetCartId of selectedCartIds) {
        try {
          // Save settings to local (the title only names a new local folder for this cart)
          const title = cartIdToName[targetCartId];
          const query = title && title !== 'Unknown Cartridge' ? `?title=${encodeURIComponent(title)}` : '';
          const response = await fetch(`/api/cartridges/${targetCartId}/settings${query}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(copiedSettings.settings),
          });

          if (!response.ok) {
            throw new Error(`Failed to save settings for ${targetCartId}`);
          }

          // If SD card is connected, also upload to SD (refused for cards not yet on 3Dos 1.5.1)
          if (sdCardPath) {
            const sdResponse = await fetch(`/api/cartridges/${targetCartId}/settings/upload`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ sdCardPath }),
            });
            if (!sdResponse.ok) {
              sdFailCount++;
              sdError ??= ((await sdResponse.json().catch(() => ({}))) as { error?: string }).error;
            }
          }

          successCount++;
        } catch (err) {
          console.error(`Failed to paste settings to ${targetCartId}:`, err);
          failCount++;
        }
      }

      setResults({ success: successCount, failed: failCount, sdFailed: sdFailCount, sdError });

      // If all succeeded, auto-close after a brief delay
      if (failCount === 0 && sdFailCount === 0) {
        setTimeout(() => {
          // Reset state before closing so next open shows confirmation
          setResults(null);
          setError(null);
          setIsPasting(false);
          onPasteComplete();
        }, 1500);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Paste failed');
    } finally {
      setIsPasting(false);
    }
  };

  const handleClose = () => {
    setResults(null);
    setError(null);
    onClose();
  };

  const footer = results ? (
    <div className="paste-results-footer">
      {results.failed === 0 && results.sdFailed === 0 ? (
        <span className="paste-success-message">All settings applied successfully!</span>
      ) : (
        <Button variant="primary" onClick={handleClose}>
          Done
        </Button>
      )}
    </div>
  ) : (
    <>
      <Button variant="ghost" onClick={handleClose} disabled={isPasting}>
        Cancel
      </Button>
      <Button variant="primary" onClick={handlePaste} disabled={isPasting}>
        {isPasting ? 'Pasting...' : `Paste to ${selectedCartIds.length} Cartridge${selectedCartIds.length !== 1 ? 's' : ''}`}
      </Button>
    </>
  );

  return (
    <Modal
      isOpen={isOpen}
      onClose={handleClose}
      title="Paste Settings"
      footer={footer}
      size="sm"
    >
      <div className="paste-settings-content">
        {!results ? (
          <>
            <div className="paste-info">
              <div className="paste-source">
                <span className="paste-label">Copy settings from:</span>
                <span className="paste-value">{copiedSettings?.gameName ?? 'Unknown'}</span>
                <code className="paste-cart-id">{copiedSettings?.cartId ?? ''}</code>
              </div>
              <div className="paste-arrow">→</div>
              <div className="paste-target">
                <span className="paste-label">Apply to:</span>
                <span className="paste-value">
                  {selectedCartIds.length} cartridge{selectedCartIds.length !== 1 ? 's' : ''}
                </span>
              </div>
            </div>

            <div className="paste-note">
              <p>This will copy all display and hardware settings to the selected cartridges.</p>
              {sdCardPath && (
                <p className="paste-sd-note">Settings will also be synced to the connected SD card.</p>
              )}
            </div>
          </>
        ) : (
          <div className="paste-results">
            {results.success > 0 && (
              <div className="paste-result-success">
                <span className="result-icon">✓</span>
                <span>Successfully applied settings to {results.success} cartridge{results.success !== 1 ? 's' : ''}</span>
              </div>
            )}
            {results.failed > 0 && (
              <div className="paste-result-failed">
                <span className="result-icon">✗</span>
                <span>Failed to apply settings to {results.failed} cartridge{results.failed !== 1 ? 's' : ''}</span>
              </div>
            )}
            {results.sdFailed > 0 && (
              <div className="paste-result-failed">
                <span className="result-icon">✗</span>
                <span>
                  Not copied to the SD card for {results.sdFailed} cartridge{results.sdFailed !== 1 ? 's' : ''}
                  {results.sdError ? `: ${results.sdError}` : ''}
                </span>
              </div>
            )}
          </div>
        )}

        {error && <div className="error-message">{error}</div>}
      </div>
    </Modal>
  );
}
