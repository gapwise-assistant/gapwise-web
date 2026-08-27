export const BOUNDED_ID_MAX_LENGTH = 240;

const HASH_LENGTH = 16;

function hashIdentity(value: string): string {
  // Two independent 32-bit lanes provide a compact, deterministic suffix
  // without relying on runtime-specific hashing or randomness.
  let first = 0x811c9dc5;
  let second = 0x9e3779b9;

  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    first = Math.imul(first ^ code, 0x01000193);
    second = Math.imul(second ^ (code + index), 0x85ebca6b);
  }

  first = Math.imul(first ^ (first >>> 16), 0x85ebca6b) >>> 0;
  second = Math.imul(second ^ (second >>> 13), 0xc2b2ae35) >>> 0;
  return `${first.toString(16).padStart(8, '0')}${second.toString(16).padStart(8, '0')}`.slice(0, HASH_LENGTH);
}

function readablePart(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]/g, '_');
}

/**
 * Builds a readable, bounded ID while hashing the complete identity. Only
 * the readable portion is truncated, so identities that differ after the
 * visible prefix remain distinct.
 */
export function boundedId(namespace: string, identity: string, requestedMaxLength = BOUNDED_ID_MAX_LENGTH): string {
  const completeIdentity = `${namespace}\u0000${identity}`;
  const suffix = `_${hashIdentity(completeIdentity)}`;
  const readable = readablePart(`${namespace}_${identity}`);
  const maxLength = Math.max(HASH_LENGTH + 3, Math.min(BOUNDED_ID_MAX_LENGTH, Math.floor(requestedMaxLength)));
  const readableLimit = maxLength - suffix.length;
  const prefix = readable.slice(0, readableLimit).replace(/_+$/g, '') || 'id';
  return `${prefix}${suffix}`;
}
