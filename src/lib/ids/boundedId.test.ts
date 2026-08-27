import { describe, expect, it } from 'vitest';
import { BOUNDED_ID_MAX_LENGTH, boundedId } from '@/lib/ids/boundedId';

describe('boundedId', () => {
  it('keeps identities distinct when they differ only at the end', () => {
    const prefix = 'identity-'.repeat(40);
    const left = boundedId('source', `${prefix}a`);
    const right = boundedId('source', `${prefix}b`);

    expect(left).not.toBe(right);
    expect(left).toHaveLength(BOUNDED_ID_MAX_LENGTH);
    expect(right).toHaveLength(BOUNDED_ID_MAX_LENGTH);
  });

  it('is bounded and deterministic for long identities', () => {
    const identity = 'long identity/'.repeat(100);
    const first = boundedId('history', identity);

    expect(first.length).toBeLessThanOrEqual(BOUNDED_ID_MAX_LENGTH);
    expect(boundedId('history', identity)).toBe(first);
  });
});
