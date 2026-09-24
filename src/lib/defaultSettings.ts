/** Settings control labels; the model is shared with the server. */
import type { DisplayMode } from '../../shared/settings.js';
export * from '../../shared/settings.js';

export const DISPLAY_MODE_LABELS: Record<DisplayMode, string> = {
  bvm: 'BVM',
  pvm: 'PVM',
  crt: 'CRT',
  scanlines: 'Scanlines',
  clean: 'Clean',
};

export const VALUE_LABELS: Record<string, string> = {
  'cinema-zoom': 'Cinema Zoom',
  'integer-plus': 'Integer+',
  'bc-spline': 'BC Spline',
  'blackman-harris': 'Blackman Harris',
  lanczos2: 'Lanczos2',
  'very-soft': 'Very Soft',
  'very-sharp': 'Very Sharp',
  'enhanced-plus': 'Enhanced+',
  ntsc: 'NTSC',
  pal: 'PAL',
};

export function valueLabel(value: string): string {
  return VALUE_LABELS[value] ?? value.charAt(0).toUpperCase() + value.slice(1);
}
