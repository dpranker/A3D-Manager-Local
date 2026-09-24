/**
 * How the SD card half of an operation went, for operations that save locally and
 * then copy to the card. The local half has already succeeded when this is returned.
 */
export type CardResult = 'ok' | 'skipped' | { error: string };

export function cardResultFrom(result: { success: boolean; error?: string } | null): CardResult {
  if (!result) return 'skipped';
  return result.success ? 'ok' : { error: result.error || 'Copying to the SD card failed' };
}
