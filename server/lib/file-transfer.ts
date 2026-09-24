/**
 * File Transfer Library with Progress Tracking
 *
 * Provides stream-based file operations with real-time progress callbacks.
 * Used for SD card sync operations where large file transfers need progress monitoring.
 */

import { statSync } from 'fs';
import { stat, readdir, mkdir } from 'fs/promises';
import path from 'path';

// =============================================================================
// Types
// =============================================================================

/**
 * Progress information for a single file transfer
 */
export interface FileProgress {
  /** Bytes written so far */
  bytesWritten: number;
  /** Total bytes to write */
  totalBytes: number;
  /** Percentage complete (0-100) */
  percentage: number;
  /** Time elapsed since transfer started */
  elapsedMs: number;
  /** Current transfer speed in bytes per second */
  bytesPerSecond: number;
  /** Estimated time remaining in milliseconds */
  estimatedTimeRemainingMs: number;
}

/**
 * Progress information for batch file transfers
 */
export interface BatchProgress {
  /** Current file index (1-based) */
  currentFile: number;
  /** Total number of files */
  totalFiles: number;
  /** Name of the file currently being transferred */
  currentFileName: string;
  /** Progress of the current file */
  fileProgress: FileProgress;
  /** Total bytes written across all files */
  overallBytesWritten: number;
  /** Total bytes to write across all files */
  overallTotalBytes: number;
  /** Overall percentage complete (0-100) */
  overallPercentage: number;
}

/**
 * Callback for single file progress updates
 */
export type ProgressCallback = (progress: FileProgress) => void;

/**
 * Callback for batch progress updates
 */
export type BatchProgressCallback = (progress: BatchProgress) => void;

// =============================================================================
// File Operations
// =============================================================================

// Default transfer settings based on chunk benchmark results
// 2MB chunks with fsync is the fastest option that allows accurate progress tracking
// (~784 KB/s vs ~360 KB/s for 64KB + fsync, only ~5% slower than 4MB no-fsync)
const DEFAULT_CHUNK_SIZE = 2 * 1024 * 1024; // 2MB
const DEFAULT_FSYNC_PER_CHUNK = true;

/**
 * Get transfer settings from environment or use defaults
 */
function getTransferSettings(): { chunkSize: number; fsyncPerChunk: boolean } {
  const chunkSize = process.env.TRANSFER_CHUNK_SIZE
    ? parseInt(process.env.TRANSFER_CHUNK_SIZE, 10)
    : DEFAULT_CHUNK_SIZE;

  const fsyncPerChunk = process.env.TRANSFER_FSYNC_PER_CHUNK
    ? process.env.TRANSFER_FSYNC_PER_CHUNK === 'true'
    : DEFAULT_FSYNC_PER_CHUNK;

  return { chunkSize, fsyncPerChunk };
}

/**
 * Copy a file with progress reporting.
 * Settings configurable via TRANSFER_CHUNK_SIZE and TRANSFER_FSYNC_PER_CHUNK env vars.
 * Defaults: 2MB chunks with fsync after each chunk.
 *
 * @param sourcePath - Path to source file
 * @param destPath - Path to destination file
 * @param onProgress - Callback for progress updates
 * @param throttleMs - Minimum ms between progress updates (default: 100)
 */
export async function copyFileWithProgress(
  sourcePath: string,
  destPath: string,
  onProgress: ProgressCallback,
  throttleMs: number = 100
): Promise<void> {
  const { open, mkdir: mkdirAsync } = await import('fs/promises');

  const stats = statSync(sourcePath);
  const totalBytes = stats.size;

  // Ensure destination directory exists
  const destDir = path.dirname(destPath);
  await mkdirAsync(destDir, { recursive: true });

  // Get settings from environment or use defaults
  const { chunkSize, fsyncPerChunk } = getTransferSettings();

  const sourceHandle = await open(sourcePath, 'r');
  const destHandle = await open(destPath, 'w');

  let bytesWritten = 0;
  const startTime = Date.now();
  let lastProgressTime = 0;
  const buffer = Buffer.alloc(chunkSize);

  try {
    while (bytesWritten < totalBytes) {
      // Read chunk from source
      const { bytesRead } = await sourceHandle.read(buffer, 0, chunkSize, bytesWritten);
      if (bytesRead === 0) break;

      // Write chunk to destination
      const chunk = bytesRead < chunkSize ? buffer.subarray(0, bytesRead) : buffer;
      await destHandle.write(chunk, 0, bytesRead, bytesWritten);

      // Optionally sync to disk after each chunk (accurate progress but slower)
      if (fsyncPerChunk) {
        await destHandle.sync();
      }

      bytesWritten += bytesRead;

      // Emit progress (throttled)
      const now = Date.now();
      if (now - lastProgressTime >= throttleMs || bytesWritten >= totalBytes) {
        lastProgressTime = now;
        const elapsedMs = now - startTime;
        const bytesPerSecond = elapsedMs > 0 ? (bytesWritten / elapsedMs) * 1000 : 0;
        const remainingBytes = totalBytes - bytesWritten;
        const estimatedTimeRemainingMs = bytesPerSecond > 0
          ? (remainingBytes / bytesPerSecond) * 1000
          : 0;

        onProgress({
          bytesWritten,
          totalBytes,
          percentage: Math.min(100, (bytesWritten / totalBytes) * 100),
          elapsedMs,
          bytesPerSecond,
          estimatedTimeRemainingMs,
        });
      }
    }

    // Final sync if not syncing per chunk
    if (!fsyncPerChunk) {
      await destHandle.sync();
    }
  } finally {
    await sourceHandle.close();
    await destHandle.close();
  }
}

/**
 * File info for directory operations
 */
interface FileInfo {
  name: string;
  path: string;
  size: number;
  isDirectory: boolean;
}

/**
 * Get all files in a directory recursively with their sizes
 */
async function getFilesRecursive(dirPath: string, relativeTo: string = dirPath): Promise<FileInfo[]> {
  const files: FileInfo[] = [];
  const entries = await readdir(dirPath, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = path.join(dirPath, entry.name);
    const relativePath = path.relative(relativeTo, fullPath);

    if (entry.isDirectory()) {
      files.push({
        name: relativePath,
        path: fullPath,
        size: 0,
        isDirectory: true,
      });
      // Recurse into subdirectory
      const subFiles = await getFilesRecursive(fullPath, relativeTo);
      files.push(...subFiles);
    } else {
      const stats = await stat(fullPath);
      files.push({
        name: relativePath,
        path: fullPath,
        size: stats.size,
        isDirectory: false,
      });
    }
  }

  return files;
}

/**
 * Copy a directory recursively with progress reporting
 *
 * @param sourcePath - Path to source directory
 * @param destPath - Path to destination directory
 * @param onProgress - Callback for batch progress updates
 * @param throttleMs - Minimum ms between progress updates (default: 100)
 */
export async function copyDirWithProgress(
  sourcePath: string,
  destPath: string,
  onProgress: BatchProgressCallback,
  throttleMs: number = 100
): Promise<void> {
  // Get all files and calculate total size
  const allFiles = await getFilesRecursive(sourcePath);
  const files = allFiles.filter(f => !f.isDirectory);
  const directories = allFiles.filter(f => f.isDirectory);

  const totalFiles = files.length;
  const totalBytes = files.reduce((sum, f) => sum + f.size, 0);

  // Create all directories first
  await mkdir(destPath, { recursive: true });
  for (const dir of directories) {
    const destDir = path.join(destPath, dir.name);
    await mkdir(destDir, { recursive: true });
  }

  let completedBytes = 0;

  // Copy files with progress
  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    const destFile = path.join(destPath, file.name);
    const fileStartBytes = completedBytes;

    await copyFileWithProgress(
      file.path,
      destFile,
      (fileProgress) => {
        onProgress({
          currentFile: i + 1,
          totalFiles,
          currentFileName: file.name,
          fileProgress,
          overallBytesWritten: fileStartBytes + fileProgress.bytesWritten,
          overallTotalBytes: totalBytes,
          overallPercentage: totalBytes > 0
            ? ((fileStartBytes + fileProgress.bytesWritten) / totalBytes) * 100
            : 100,
        });
      },
      throttleMs
    );

    completedBytes += file.size;
  }
}

// =============================================================================
// Formatting Helpers
// =============================================================================

/**
 * Format bytes as human-readable string
 *
 * @example formatBytes(1536) => "1.5 KB"
 * @example formatBytes(1048576) => "1.0 MB"
 */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

/**
 * Format milliseconds as human-readable time
 *
 * @example formatTime(500) => "500ms"
 * @example formatTime(5000) => "5.0s"
 * @example formatTime(90000) => "1m 30s"
 */
export function formatTime(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  const mins = Math.floor(ms / 60000);
  const secs = Math.round((ms % 60000) / 1000);
  return `${mins}m ${secs}s`;
}

/**
 * Format transfer speed as human-readable string
 *
 * @example formatSpeed(10485760) => "10.0 MB/s"
 */
export function formatSpeed(bytesPerSecond: number): string {
  return `${formatBytes(bytesPerSecond)}/s`;
}

/**
 * Create a text-based progress bar
 *
 * @example createProgressBar(50, 20) => "[██████████░░░░░░░░░░]"
 */
export function createProgressBar(percentage: number, width: number = 40): string {
  const filled = Math.round((percentage / 100) * width);
  const empty = width - filled;
  return `[${'█'.repeat(filled)}${'░'.repeat(empty)}]`;
}

/**
 * Options for benchmarking file copy with different settings
 */
export interface CopyBenchmarkOptions {
  /** Chunk size in bytes */
  chunkSize: number;
  /** Whether to fsync after each chunk (accurate progress on SD cards but slower) */
  fsyncPerChunk: boolean;
  /** Progress callback */
  onProgress?: ProgressCallback;
  /** Progress throttle in ms */
  throttleMs?: number;
}

/**
 * Copy a file with configurable chunk size and sync behavior.
 * Used for benchmarking different settings.
 */
export async function copyFileWithSettings(
  sourcePath: string,
  destPath: string,
  options: CopyBenchmarkOptions
): Promise<{ durationMs: number; bytesWritten: number; avgSpeed: number }> {
  const { open: openFile, mkdir: mkdirAsync } = await import('fs/promises');

  const stats = statSync(sourcePath);
  const totalBytes = stats.size;

  // Ensure destination directory exists
  const destDir = path.dirname(destPath);
  await mkdirAsync(destDir, { recursive: true });

  const { chunkSize, fsyncPerChunk, onProgress, throttleMs = 100 } = options;

  const sourceHandle = await openFile(sourcePath, 'r');
  const destHandle = await openFile(destPath, 'w');

  let bytesWritten = 0;
  const startTime = Date.now();
  let lastProgressTime = 0;
  const buffer = Buffer.alloc(chunkSize);

  try {
    while (bytesWritten < totalBytes) {
      // Read chunk from source
      const { bytesRead } = await sourceHandle.read(buffer, 0, chunkSize, bytesWritten);
      if (bytesRead === 0) break;

      // Write chunk to destination
      const chunk = bytesRead < chunkSize ? buffer.subarray(0, bytesRead) : buffer;
      await destHandle.write(chunk, 0, bytesRead, bytesWritten);

      // Optionally sync to disk
      if (fsyncPerChunk) {
        await destHandle.sync();
      }

      bytesWritten += bytesRead;

      // Emit progress (throttled)
      if (onProgress) {
        const now = Date.now();
        if (now - lastProgressTime >= throttleMs || bytesWritten >= totalBytes) {
          lastProgressTime = now;
          const elapsedMs = now - startTime;
          const bytesPerSecond = elapsedMs > 0 ? (bytesWritten / elapsedMs) * 1000 : 0;
          const remainingBytes = totalBytes - bytesWritten;
          const estimatedTimeRemainingMs = bytesPerSecond > 0
            ? (remainingBytes / bytesPerSecond) * 1000
            : 0;

          onProgress({
            bytesWritten,
            totalBytes,
            percentage: Math.min(100, (bytesWritten / totalBytes) * 100),
            elapsedMs,
            bytesPerSecond,
            estimatedTimeRemainingMs,
          });
        }
      }
    }

    // Final sync if not syncing per chunk
    if (!fsyncPerChunk) {
      await destHandle.sync();
    }

    const durationMs = Date.now() - startTime;
    const avgSpeed = durationMs > 0 ? (bytesWritten / durationMs) * 1000 : 0;

    return { durationMs, bytesWritten, avgSpeed };
  } finally {
    await sourceHandle.close();
    await destHandle.close();
  }
}
