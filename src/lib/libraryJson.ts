/** Library editor labels; the model is shared with the server. */
import type { Accessory, LibraryRegion, VirtualAccessory } from '../../shared/library.js';
export * from '../../shared/library.js';

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
