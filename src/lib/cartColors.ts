/**
 * Screen colors for the console's cartridge colors (settings.json
 * library.cartridge_color / library.json defaults.cart_color). Analogue doesn't
 * publish the exact shades; gray matches the app's default dark shell so
 * cartridges without a color look unchanged.
 */
import type { CartridgeColor } from './defaultSettings';

export const CARTRIDGE_COLOR_HEX: Record<CartridgeColor, string> = {
  gray: '#2c2c2c',
  red: '#a8252b',
  green: '#2f7d3a',
  blue: '#2556a6',
  yellow: '#e5b82e',
  gold: '#c49a2c',
  black: '#0e0e0e',
  purple: '#5b3a9e',
  rose: '#d77a95',
};

/** Hex color to tint a cartridge shell with, or undefined for the default shell */
export function cartridgeShellColor(color: string | undefined): string | undefined {
  return color && color !== 'gray' && color in CARTRIDGE_COLOR_HEX ? CARTRIDGE_COLOR_HEX[color as CartridgeColor] : undefined;
}
