/**
 * Screen colors for the console's cartridge colors (settings.json
 * library.cartridge_color / library.json defaults.cart_color). Analogue doesn't
 * publish the exact shades. Gray approximates the standard retail cartridge
 * plastic and is also used for cartridges without a color.
 */
import type { CartridgeColor } from './defaultSettings';

export const CARTRIDGE_COLOR_HEX: Record<CartridgeColor, string> = {
  gray: '#7c7c7c',
  red: '#a8252b',
  green: '#2f7d3a',
  blue: '#2556a6',
  yellow: '#e5b82e',
  gold: '#c49a2c',
  black: '#0e0e0e',
  purple: '#5b3a9e',
  rose: '#d77a95',
};

/** Hex color to tint a cartridge shell with; retail gray when there's no (known) color */
export function cartridgeShellColor(color: string | undefined): string {
  return color && color in CARTRIDGE_COLOR_HEX ? CARTRIDGE_COLOR_HEX[color as CartridgeColor] : CARTRIDGE_COLOR_HEX.gray;
}
