import { describe, expect, it } from 'vitest';
import { PRIMARY_NAVIGATION } from '@/lib/navigation';

describe('primary navigation', () => {
  it('keeps reasoning destinations separate from Settings', () => {
    expect(PRIMARY_NAVIGATION.map((item) => item.label)).toEqual(['Today', 'Ask', 'Context', 'Scope']);
    expect(PRIMARY_NAVIGATION.some((item) => item.label === 'You')).toBe(false);
    expect(PRIMARY_NAVIGATION.some((item) => item.label === 'Settings')).toBe(false);
  });
});
