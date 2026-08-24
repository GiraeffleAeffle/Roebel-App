import {
  closeSync,
  constants as fsConstants,
  fstatSync,
  lstatSync,
  openSync,
  readSync,
} from "node:fs";

export class StableFileError extends Error {}

function closeQuietly(descriptor) {
  try {
    closeSync(descriptor);
  } catch {
    // Preserve the validation result when cleanup of an invalid descriptor fails.
  }
}

function sameSnapshot(left, right) {
  return (
    left.dev === right.dev &&
    left.ino === right.ino &&
    left.size === right.size &&
    left.mtimeMs === right.mtimeMs &&
    left.ctimeMs === right.ctimeMs
  );
}

function openStableRegularFile(path, label, beforeOpenForTest) {
  let descriptor;
  try {
    const beforeOpen = lstatSync(path);
    if (!beforeOpen.isFile()) throw new StableFileError(`${label}_not_regular_file`);
    beforeOpenForTest?.();
    const noFollow = fsConstants.O_NOFOLLOW ?? 0;
    const nonBlock = fsConstants.O_NONBLOCK ?? 0;
    descriptor = openSync(path, fsConstants.O_RDONLY | noFollow | nonBlock);
    const afterOpen = fstatSync(descriptor);
    if (!afterOpen.isFile()) throw new StableFileError(`${label}_not_regular_file`);
    if (!sameSnapshot(beforeOpen, afterOpen)) throw new StableFileError(`${label}_changed`);
    return { descriptor, opened: afterOpen };
  } catch (error) {
    if (descriptor !== undefined) closeQuietly(descriptor);
    if (error instanceof StableFileError) throw error;
    throw new StableFileError(`${label}_invalid`);
  }
}

function assertStableAfterRead(path, descriptor, opened, label) {
  let afterRead;
  let finalPath;
  try {
    afterRead = fstatSync(descriptor);
    finalPath = lstatSync(path);
  } catch {
    throw new StableFileError(`${label}_changed`);
  }
  if (!afterRead.isFile() || !finalPath.isFile()) {
    throw new StableFileError(`${label}_not_regular_file`);
  }
  if (!sameSnapshot(opened, afterRead) || !sameSnapshot(opened, finalPath)) {
    throw new StableFileError(`${label}_changed`);
  }
}

export function readStableBoundedFile(path, maxBytes, label, beforeOpenForTest) {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1) {
    throw new StableFileError(`${label}_max_bytes_invalid`);
  }
  const { descriptor, opened } = openStableRegularFile(path, label, beforeOpenForTest);
  try {
    if (!Number.isSafeInteger(opened.size) || opened.size > maxBytes) {
      throw new StableFileError(`${label}_too_large`);
    }
    // Allocate only what the opened inode can contain, plus one byte to detect
    // growth. The caller's ceiling was checked before this allocation, so a
    // tiny file never reserves the configured maximum.
    const bytes = Buffer.allocUnsafe(opened.size + 1);
    let total = 0;
    while (total < bytes.length) {
      const count = readSync(descriptor, bytes, total, bytes.length - total, null);
      if (count === 0) break;
      total += count;
    }
    if (total > maxBytes) throw new StableFileError(`${label}_too_large`);
    assertStableAfterRead(path, descriptor, opened, label);
    if (total !== opened.size) throw new StableFileError(`${label}_changed`);
    return bytes.subarray(0, total);
  } finally {
    closeQuietly(descriptor);
  }
}

export function readStableFilePrefix(path, byteLength, label, beforeOpenForTest) {
  if (!Number.isSafeInteger(byteLength) || byteLength < 1) {
    throw new StableFileError(`${label}_byte_length_invalid`);
  }
  const { descriptor, opened } = openStableRegularFile(path, label, beforeOpenForTest);
  try {
    const bytes = Buffer.alloc(byteLength);
    const count = readSync(descriptor, bytes, 0, bytes.length, 0);
    assertStableAfterRead(path, descriptor, opened, label);
    return bytes.subarray(0, count);
  } finally {
    closeQuietly(descriptor);
  }
}
