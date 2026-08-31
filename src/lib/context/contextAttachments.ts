import { StorageError } from '@/lib/storage/types';
import { ContextSource } from '@/types/clarity';

/**
 * Limits are deliberately conservative for the first multimodal Context
 * path.  They are enforced before Cloud Storage or Gemini work begins.
 */
export const CONTEXT_ATTACHMENT_MAX_BYTES = {
  text: 500_000,
  note: 500_000,
  pdf: 25 * 1024 * 1024,
  image: 12 * 1024 * 1024,
  voice: 25 * 1024 * 1024,
} satisfies Record<ContextSource['type'], number>;

const MIME_TYPES: Record<ContextSource['type'], readonly string[]> = {
  text: ['text/plain', 'text/markdown', 'text/x-markdown'],
  note: ['text/plain', 'text/markdown', 'text/x-markdown'],
  pdf: ['application/pdf'],
  image: ['image/jpeg', 'image/png', 'image/webp'],
  voice: ['audio/webm', 'audio/mpeg', 'audio/mp3', 'audio/mp4', 'audio/x-m4a', 'audio/wav', 'audio/x-wav', 'audio/wave'],
};

const EXTENSIONS: Record<ContextSource['type'], readonly string[]> = {
  text: ['.txt', '.md'],
  note: ['.txt', '.md'],
  pdf: ['.pdf'],
  image: ['.jpg', '.jpeg', '.png', '.webp'],
  voice: ['.webm', '.mp3', '.m4a', '.mp4', '.wav'],
};

export function defaultMimeTypeForSourceType(type: ContextSource['type']): string {
  switch (type) {
    case 'pdf': return 'application/pdf';
    case 'image': return 'image/png';
    case 'voice': return 'audio/webm';
    case 'text':
    case 'note':
      return 'text/plain';
  }
}

function normalizedMimeType(value: string | undefined): string | undefined {
  const normalized = value?.split(';', 1)[0]?.trim().toLowerCase();
  return normalized || undefined;
}

function extensionFor(filename: string): string {
  const lastPart = filename.trim().split(/[\\/]/).at(-1) ?? '';
  const dot = lastPart.lastIndexOf('.');
  return dot >= 0 ? lastPart.slice(dot).toLowerCase() : '';
}

function fail(message: string): never {
  throw new StorageError(message, 'VALIDATION_ERROR');
}

function hasPrefix(bytes: Buffer, prefix: number[]): boolean {
  return bytes.length >= prefix.length && prefix.every((value, index) => bytes[index] === value);
}

function assertPdf(bytes: Buffer): void {
  if (!bytes.subarray(0, 1024).toString('ascii').includes('%PDF-')) {
    fail('The uploaded file is not a readable PDF.');
  }
}

function readUInt24BE(bytes: Buffer, offset: number): number {
  return bytes[offset] * 0x10000 + bytes[offset + 1] * 0x100 + bytes[offset + 2];
}

function assertImageDimensions(width: number, height: number): void {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0 || width > 10_000 || height > 10_000) {
    fail('The uploaded image has invalid or unsupported dimensions.');
  }
}

function pngDimensions(bytes: Buffer): [number, number] | null {
  if (!hasPrefix(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return null;
  if (bytes.length < 24 || bytes.subarray(12, 16).toString('ascii') !== 'IHDR') fail('The uploaded PNG is incomplete.');
  return [bytes.readUInt32BE(16), bytes.readUInt32BE(20)];
}

function jpegDimensions(bytes: Buffer): [number, number] | null {
  if (!hasPrefix(bytes, [0xff, 0xd8, 0xff])) return null;
  let offset = 2;
  while (offset + 9 < bytes.length) {
    if (bytes[offset] !== 0xff) {
      offset += 1;
      continue;
    }
    const marker = bytes[offset + 1];
    offset += 2;
    if (marker === 0xd8 || marker === 0xd9) continue;
    if (offset + 2 > bytes.length) break;
    const segmentLength = bytes.readUInt16BE(offset);
    if (segmentLength < 2 || offset + segmentLength > bytes.length) break;
    const isStartOfFrame = marker >= 0xc0 && marker <= 0xc3
      || marker >= 0xc5 && marker <= 0xc7
      || marker >= 0xc9 && marker <= 0xcb
      || marker >= 0xcd && marker <= 0xcf;
    if (isStartOfFrame && segmentLength >= 7) {
      return [bytes.readUInt16BE(offset + 5), bytes.readUInt16BE(offset + 3)];
    }
    offset += segmentLength;
  }
  fail('The uploaded JPEG is incomplete or unsupported.');
}

function webpDimensions(bytes: Buffer): [number, number] | null {
  if (!hasPrefix(bytes, [0x52, 0x49, 0x46, 0x46]) || bytes.subarray(8, 12).toString('ascii') !== 'WEBP') return null;
  const format = bytes.subarray(12, 16).toString('ascii');
  if (format === 'VP8X' && bytes.length >= 30) {
    const width = 1 + readUInt24BE(bytes, 24);
    const height = 1 + readUInt24BE(bytes, 27);
    return [width, height];
  }
  return [1, 1];
}

function assertImage(bytes: Buffer, mimeType: string): void {
  const dimensions = mimeType === 'image/png'
    ? pngDimensions(bytes)
    : mimeType === 'image/jpeg'
      ? jpegDimensions(bytes)
      : webpDimensions(bytes);
  if (!dimensions) fail('The uploaded image does not match its declared format.');
  assertImageDimensions(...dimensions);
}

function isMp3(bytes: Buffer): boolean {
  if (bytes.subarray(0, 3).toString('ascii') === 'ID3') return true;
  for (let index = 0; index + 1 < Math.min(bytes.length, 4096); index += 1) {
    if (bytes[index] === 0xff && (bytes[index + 1] & 0xe0) === 0xe0) return true;
  }
  return false;
}

function assertAudio(bytes: Buffer, mimeType: string): void {
  const valid = mimeType === 'audio/webm'
    ? hasPrefix(bytes, [0x1a, 0x45, 0xdf, 0xa3])
    : mimeType === 'audio/mpeg' || mimeType === 'audio/mp3'
      ? isMp3(bytes)
      : mimeType === 'audio/wav' || mimeType === 'audio/x-wav' || mimeType === 'audio/wave'
        ? hasPrefix(bytes, [0x52, 0x49, 0x46, 0x46]) && bytes.subarray(8, 12).toString('ascii') === 'WAVE'
        : bytes.length >= 12 && bytes.subarray(4, 8).toString('ascii') === 'ftyp';
  if (!valid) fail('The uploaded audio does not match its declared format.');
}

function assertSignature(type: ContextSource['type'], mimeType: string, bytes: Buffer): void {
  if (type === 'pdf') assertPdf(bytes);
  if (type === 'image') assertImage(bytes, mimeType);
  if (type === 'voice') assertAudio(bytes, mimeType);
  const resemblesBinaryAttachment = hasPrefix(bytes, [0x25, 0x50, 0x44, 0x46, 0x2d])
    || hasPrefix(bytes, [0x89, 0x50, 0x4e, 0x47])
    || hasPrefix(bytes, [0xff, 0xd8, 0xff])
    || hasPrefix(bytes, [0x52, 0x49, 0x46, 0x46])
    || hasPrefix(bytes, [0x1a, 0x45, 0xdf, 0xa3])
    || bytes.subarray(0, 3).toString('ascii') === 'ID3';
  if ((type === 'text' || type === 'note') && (bytes.includes(0) || resemblesBinaryAttachment)) {
    fail('The uploaded text file contains binary data.');
  }
}

export interface ValidatedContextAttachment {
  mimeType: string;
  extension: string;
  sizeBytes: number;
}

/**
 * Server-authoritative validation for user-provided attachments. The browser
 * accept attribute is only a convenience and is intentionally not trusted.
 */
export function validateContextAttachment(input: {
  type: ContextSource['type'];
  filename: string;
  mimeType?: string;
  bytes: Buffer;
}): ValidatedContextAttachment {
  const filename = input.filename.trim();
  if (!filename) fail('A filename is required for the uploaded context.');
  if (!input.bytes.length) fail('The uploaded context file is empty.');

  const extension = extensionFor(filename);
  const declaredMimeType = normalizedMimeType(input.mimeType);
  const mimeType = declaredMimeType ?? (extension === '.pdf'
    ? 'application/pdf'
    : input.type === 'image' && extension === '.png'
      ? 'image/png'
      : input.type === 'image' && (extension === '.jpg' || extension === '.jpeg')
        ? 'image/jpeg'
        : input.type === 'image' && extension === '.webp'
          ? 'image/webp'
          : input.type === 'voice' && extension === '.mp3'
            ? 'audio/mpeg'
            : input.type === 'voice' && (extension === '.m4a' || extension === '.mp4')
              ? 'audio/mp4'
              : input.type === 'voice' && extension === '.wav'
                ? 'audio/wav'
                : input.type === 'voice' && extension === '.webm'
                  ? 'audio/webm'
                  : 'text/plain');

  if (!MIME_TYPES[input.type].includes(mimeType)) {
    fail(`The uploaded ${input.type} file uses an unsupported MIME type.`);
  }
  if (!EXTENSIONS[input.type].includes(extension)) {
    fail(`The uploaded ${input.type} file uses an unsupported filename extension.`);
  }
  if (input.bytes.length > CONTEXT_ATTACHMENT_MAX_BYTES[input.type]) {
    fail(`The uploaded ${input.type} file is larger than the supported limit.`);
  }

  assertSignature(input.type, mimeType, input.bytes);
  return { mimeType, extension, sizeBytes: input.bytes.length };
}

export function supportedContextAttachmentMimes(type: ContextSource['type']): readonly string[] {
  return MIME_TYPES[type];
}
