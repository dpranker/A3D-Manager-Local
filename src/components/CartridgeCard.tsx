import { CartridgeSprite } from './CartridgeSprite';
import './CartridgeCard.css';

interface CartridgeCardProps {
  cartId: string;
  name?: string;
  /** Not in the built-in cart database; shows a Custom tag */
  custom?: boolean;
  gridIndex: number;
  hasLabel: boolean;
  selectionMode: boolean;
  isSelected: boolean;
  imageCacheBuster?: number;
  /** Shell color from the console's cartridge color setting; default shell if unset */
  shellColor?: string;
  onClick: () => void;
}

export function CartridgeCard({
  cartId,
  name,
  custom,
  gridIndex,
  hasLabel,
  selectionMode,
  isSelected,
  imageCacheBuster,
  shellColor,
  onClick,
}: CartridgeCardProps) {
  const imageUrl = hasLabel
    ? `/api/labels/${cartId}${imageCacheBuster ? `?v=${imageCacheBuster}` : ''}`
    : '/cart-placeholder.png';

  return (
    <div
      className={`cartridge-card ${name ? 'has-name' : ''} ${selectionMode ? 'selectable' : ''} ${isSelected ? 'selected' : ''}`}
      style={{ '--tile-index': gridIndex } as React.CSSProperties}
      onClick={onClick}
    >
      {selectionMode && <div className="selection-checkbox" />}
      {custom && <span className="cartridge-card-custom">Custom</span>}
      <div className="cart-sprite-wrapper">
        <CartridgeSprite
          artworkUrl={imageUrl}
          alt={name || cartId}
          color="dark"
          size="large"
          className="cart-sprite-base"
          shellColor={shellColor}
        />
        <CartridgeSprite
          artworkUrl={imageUrl}
          alt={name || cartId}
          color="black"
          size="large"
          className="cart-sprite-hover"
          // Hover darkens the shell: black for the default shell, a darker shade of a custom color
          shellColor={shellColor ? `color-mix(in srgb, ${shellColor} 60%, black)` : undefined}
        />
      </div>
      <div className="cartridge-card-info">
        <span className={`cartridge-card-name ${!name ? 'unknown' : ''}`}>
          {name || 'Unknown Cartridge'}
        </span>
        <span className="cartridge-card-id text-pixel">{cartId}</span>
      </div>
    </div>
  );
}
