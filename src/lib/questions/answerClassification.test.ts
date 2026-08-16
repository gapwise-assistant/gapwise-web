import { describe, expect, it } from 'vitest';
import { classifyAnswer } from '@/lib/questions/answerClassification';

describe('answer classification', () => {
  it('stores an apartment budget limit as a constraint', () => {
    const result = classifyAnswer(
      { type: 'UNKNOWN', text: 'What is your actual affordable monthly housing budget?' },
      "I don't want total housing-related costs above $1,750/month.",
    );

    expect(result).toEqual({
      type: 'CONSTRAINT',
      text: 'Housing-related costs should stay at or below $1,750/month.',
      supersedesOriginal: false,
    });
  });

  it('distinguishes preferences, choices, facts, and next actions', () => {
    expect(classifyAnswer({ type: 'UNKNOWN', text: 'Which style do you prefer?' }, 'I prefer the quieter apartment.').type).toBe('PREFERENCE');
    expect(classifyAnswer({ type: 'UNKNOWN', text: 'Which apartment should you choose?' }, 'I choose Apartment B.').type).toBe('DECISION');
    expect(classifyAnswer({ type: 'UNKNOWN', text: 'When is the appointment?' }, 'It is on Friday at 3pm.').type).toBe('KNOWN');
    expect(classifyAnswer({ type: 'UNKNOWN', text: 'What should happen next?' }, "I'll call the supplier tomorrow.").type).toBe('NEXT_ACTION');
  });

  it('marks a corrected assumption as superseding the old belief', () => {
    expect(classifyAnswer(
      { type: 'ASSUMPTION', text: 'Restaurants are the best target customer.' },
      'Actually, real-estate agents are the better target customer.',
    )).toMatchObject({ type: 'KNOWN', supersedesOriginal: true });
  });
});

