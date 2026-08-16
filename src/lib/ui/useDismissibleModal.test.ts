import { describe, expect, it } from 'vitest';
import { isEscapeKey, isOutsideModalTarget } from './useDismissibleModal';

describe('isEscapeKey', () => {
  it('only matches Escape', () => {
    expect(isEscapeKey({ key: 'Escape' })).toBe(true);
    expect(isEscapeKey({ key: 'Enter' })).toBe(false);
  });
});

describe('isOutsideModalTarget', () => {
  it('recognizes targets outside the modal panel', () => {
    const inside = {} as EventTarget;
    const outside = {} as EventTarget;
    const panel = { contains: (target: unknown) => target === inside } as unknown as Element;

    expect(isOutsideModalTarget(outside, panel)).toBe(true);
    expect(isOutsideModalTarget(inside, panel)).toBe(false);
  });

  it('does not dismiss when there is no mounted panel', () => {
    expect(isOutsideModalTarget({} as EventTarget, null)).toBe(false);
  });
});
