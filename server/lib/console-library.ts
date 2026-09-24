import { readFile } from 'fs/promises';
import path from 'path';

const ID_TABLE_OFFSET = 0x100;
const ID_TABLE_SIZE = 4096 * 4;

/** Read the active cartridge IDs from the console's library.db. */
export async function readConsoleLibraryIds(sdCardPath: string): Promise<Set<string>> {
  const file = await readFile(path.join(sdCardPath, 'Library', 'N64', 'library.db'));
  const identifier = file.subarray(1, 12).toString('ascii');
  const type = file.subarray(0x20, 0x33).toString('ascii');
  const version = file.readUInt32LE(0x40);
  if (
    file[0] !== 0x07 || identifier !== 'Analogue-Co' || type !== 'Analogue-3D.library' ||
    version !== 0x00010000 || file.length < ID_TABLE_OFFSET + ID_TABLE_SIZE
  ) {
    throw new Error('The SD card library.db is invalid or uses an unsupported format');
  }

  const ids = new Set<string>();
  for (let offset = ID_TABLE_OFFSET; offset < ID_TABLE_OFFSET + ID_TABLE_SIZE; offset += 4) {
    const id = file.readUInt32LE(offset);
    if (id !== 0xffffffff) ids.add(id.toString(16).padStart(8, '0'));
  }
  return ids;
}
