import { describe, expect, it } from 'vitest';
import { graphQuestionIntent } from './answerIntent';

describe('graphQuestionIntent', () => {
  it('uses confirmation intent for an open assumption when no intent is supplied', () => {
    expect(graphQuestionIntent({ type: 'ASSUMPTION', status: 'OPEN' })).toBe('confirm');
  });

  it('keeps normal behavior for open unknowns and resolved assumptions', () => {
    expect(graphQuestionIntent({ type: 'UNKNOWN', status: 'OPEN' })).toBeUndefined();
    expect(graphQuestionIntent({ type: 'ASSUMPTION', status: 'RESOLVED' })).toBeUndefined();
  });

  it('preserves an explicitly requested correction intent', () => {
    expect(graphQuestionIntent({ type: 'ASSUMPTION', status: 'OPEN' }, 'correct')).toBe('correct');
  });
});
