/** Browser-safe settings.json model and defaults for 3Dos 1.5.1+. */

export const SETTINGS_SCHEMA_URL = 'https://schemas.analogue.co/platform/3d/settings.json';

export const DISPLAY_MODE_VALUES = ['bvm', 'pvm', 'crt', 'scanlines', 'clean'] as const;

export const BEAM_CONVERGENCE_VALUES = ['off', 'consumer', 'professional'] as const;

export const EDGE_HARDNESS_VALUES = ['soft', 'hard'] as const;

export const IMAGE_FIT_VALUES = ['original', 'stretch', 'cinema-zoom'] as const;

export const IMAGE_SIZE_VALUES = ['fill', 'integer', 'integer-plus'] as const;

export const INTERPOLATION_VALUES = ['bc-spline', 'bilinear', 'blackman-harris', 'lanczos2'] as const;

export const GAMMA_TRANSFER_VALUES = ['tube', 'modern'] as const;

export const SHARPNESS_VALUES = ['very-soft', 'soft', 'medium', 'sharp', 'very-sharp'] as const;

export const CARTRIDGE_COLOR_VALUES = ['gray', 'red', 'green', 'blue', 'yellow', 'gold', 'black', 'purple', 'rose'] as const;

export const OVERCLOCK_VALUES = ['off', 'auto', 'enhanced', 'enhanced-plus', 'unleashed'] as const;

export const REGION_VALUES = ['auto', 'ntsc', 'pal'] as const;

export type DisplayMode = (typeof DISPLAY_MODE_VALUES)[number];

export type BeamConvergence = (typeof BEAM_CONVERGENCE_VALUES)[number];

export type EdgeHardness = (typeof EDGE_HARDNESS_VALUES)[number];

export type ImageFit = (typeof IMAGE_FIT_VALUES)[number];

export type ImageSize = (typeof IMAGE_SIZE_VALUES)[number];

export type InterpolationAlg = (typeof INTERPOLATION_VALUES)[number];

export type GammaTransfer = (typeof GAMMA_TRANSFER_VALUES)[number];

export type Sharpness = (typeof SHARPNESS_VALUES)[number];

export type CartridgeColor = (typeof CARTRIDGE_COLOR_VALUES)[number];

export type Overclock = (typeof OVERCLOCK_VALUES)[number];

export type Region = (typeof REGION_VALUES)[number];

export interface CRTModeSettings {
  horizontal_beam_convergence: BeamConvergence;
  vertical_beam_convergence: BeamConvergence;
  /** Only adjustable in BVM mode; the console still writes it for every CRT-style mode */
  enable_edge_overshoot: boolean;
  enable_edge_hardness: EdgeHardness;
  image_fit: ImageFit;
  image_size: ImageSize;
}

export interface CleanModeSettings {
  interpolation_alg: InterpolationAlg;
  gamma_transfer_function: GammaTransfer;
  sharpness: Sharpness;
  image_fit: ImageFit;
  image_size: ImageSize;
}

export interface DisplayCatalog {
  bvm: CRTModeSettings;
  pvm: CRTModeSettings;
  crt: CRTModeSettings;
  scanlines: CRTModeSettings;
  clean: CleanModeSettings;
}

export interface DisplaySettings {
  odm: DisplayMode;
  catalog: DisplayCatalog;
}

export interface LibrarySettings {
  cartridge_color: CartridgeColor;
}

export interface HardwareSettings {
  disable_antialiasing: boolean;
  disable_deblur: boolean;
  disable_texture_filtering: boolean;
  enable_32_bit_color: boolean;
  force_original_hardware: boolean;
  force_progressive_output: boolean;
  overclock: Overclock;
  region: Region;
  virtual_expansion_pak: boolean;
  horizontal_upscaling: boolean;
}

export interface CartridgeSettings {
  $schema: string;
  display: DisplaySettings;
  library: LibrarySettings;
  hardware: HardwareSettings;
}

/** Defaults from Analogue's sample; console defaults can vary by cartridge. */
export function createDefaultSettings(): CartridgeSettings {
  const bvm: CRTModeSettings = {
    horizontal_beam_convergence: 'professional',
    vertical_beam_convergence: 'professional',
    enable_edge_overshoot: false,
    enable_edge_hardness: 'soft',
    image_fit: 'original',
    image_size: 'fill',
  };

  return {
    $schema: SETTINGS_SCHEMA_URL,
    display: {
      odm: 'bvm',
      catalog: {
        bvm: { ...bvm },
        pvm: { ...bvm, enable_edge_overshoot: true },
        crt: { ...bvm, horizontal_beam_convergence: 'consumer', vertical_beam_convergence: 'consumer', enable_edge_overshoot: true },
        scanlines: { ...bvm, horizontal_beam_convergence: 'off', vertical_beam_convergence: 'off' },
        clean: {
          interpolation_alg: 'bc-spline',
          gamma_transfer_function: 'tube',
          sharpness: 'medium',
          image_fit: 'original',
          image_size: 'fill',
        },
      },
    },
    library: { cartridge_color: 'gray' },
    hardware: {
      disable_antialiasing: false,
      disable_deblur: false,
      disable_texture_filtering: false,
      enable_32_bit_color: false,
      force_original_hardware: false,
      force_progressive_output: true,
      overclock: 'auto',
      region: 'auto',
      virtual_expansion_pak: true,
      horizontal_upscaling: true,
    },
  };
}
