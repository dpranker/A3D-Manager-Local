/** Browser-safe library.json model and defaults for unknown cartridges. */
import type { CartridgeColor, Overclock, Region } from './settings.js';

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

/** The library format uses disable_anti_aliasing, unlike settings.json. */
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

/** Defaults written for a new unknown cartridge, using the current release year. */
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
