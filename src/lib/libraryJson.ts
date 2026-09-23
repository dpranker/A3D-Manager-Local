/**
 * Per-game library.json model (3Dos 1.5.1+), mirroring server/lib/library-json.ts.
 * Only used for cartridges outside the console's built-in database.
 */
import type { CartridgeColor, Overclock, Region } from './defaultSettings';

export const LIBRARY_SCHEMA_URL = 'https://schemas.analogue.co/platform/3d/library.json';
export const MAX_TITLE_LENGTH = 127;
export const MAX_PLAYERS = 4;
export const MAX_ACCESSORIES = 5;

export const ACCESSORY_VALUES = [
  'controller-pak',
  'expansion-pak',
  'rumble-pak',
  'transfer-pak',
  'voice-recognition-unit-usa',
  'voice-recognition-system-japan',
  'denshadego-controller',
  'bio-sensor',
  'tsurikon-64',
  'n64-mouse',
] as const;
export const LIBRARY_REGION_VALUES = [
  'asia', 'australia', 'brazil', 'germany', 'europe', 'france', 'england', 'italy', 'japan', 'netherlands', 'spain', 'usa',
] as const;
export const VIRTUAL_ACCESSORY_VALUES = ['no-pak', 'controller-pak', 'rumble-pak'] as const;

export type Accessory = (typeof ACCESSORY_VALUES)[number];
export type LibraryRegion = (typeof LIBRARY_REGION_VALUES)[number];
export type VirtualAccessory = (typeof VIRTUAL_ACCESSORY_VALUES)[number];

export const ACCESSORY_LABELS: Record<Accessory, string> = {
  'controller-pak': 'Controller Pak',
  'expansion-pak': 'Expansion Pak',
  'rumble-pak': 'Rumble Pak',
  'transfer-pak': 'Transfer Pak',
  'voice-recognition-unit-usa': 'Voice Recognition Unit (USA)',
  'voice-recognition-system-japan': 'Voice Recognition System (Japan)',
  'denshadego-controller': 'Densha de Go! Controller',
  'bio-sensor': 'Bio Sensor',
  'tsurikon-64': 'Tsurikon 64',
  'n64-mouse': 'N64 Mouse',
};

export const VIRTUAL_ACCESSORY_LABELS: Record<VirtualAccessory, string> = {
  'no-pak': 'None',
  'controller-pak': 'Controller Pak',
  'rumble-pak': 'Rumble Pak',
};

export function libraryRegionLabel(region: LibraryRegion): string {
  return region === 'usa' ? 'USA' : region.charAt(0).toUpperCase() + region.slice(1);
}

export interface LibraryData {
  title: string;
  revision: number;
  player_count: number;
  accessories: Accessory[];
  region: LibraryRegion[];
  developers: string[];
  publishers: string[];
  release_year: number;
}

export interface LibraryDefaults {
  virtual_expansion_pak: boolean;
  region: Region;
  disable_deblur: boolean;
  enable_32_bit_color: boolean;
  force_progressive_output: boolean;
  disable_texture_filtering: boolean;
  disable_anti_aliasing: boolean;
  force_original_hardware: boolean;
  horizontal_upscaling: boolean;
  overclock: Overclock;
  virtual_accessory: VirtualAccessory;
  cart_color: CartridgeColor;
}

export interface LibraryJson {
  $schema: string;
  data: LibraryData;
  defaults: LibraryDefaults;
}

/** What 3Dos 1.5.1 writes for a new unknown cartridge (same as the server's createDefaultLibrary) */
export function createDefaultLibrary(title = 'Unknown Cartridge'): LibraryJson {
  return {
    $schema: LIBRARY_SCHEMA_URL,
    data: {
      title: title.slice(0, MAX_TITLE_LENGTH),
      revision: 0,
      player_count: 1,
      accessories: [],
      region: [],
      developers: ['Unknown'],
      publishers: ['Unknown'],
      release_year: new Date().getFullYear(),
    },
    defaults: {
      virtual_expansion_pak: true,
      region: 'auto',
      disable_deblur: false,
      enable_32_bit_color: false,
      force_progressive_output: false,
      disable_texture_filtering: false,
      disable_anti_aliasing: false,
      force_original_hardware: false,
      horizontal_upscaling: false,
      overclock: 'off',
      virtual_accessory: 'no-pak',
      cart_color: 'gray',
    },
  };
}
