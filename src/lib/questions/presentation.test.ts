import { describe, expect, it } from 'vitest';
import type { ClarityNode, Project } from '@/types/clarity';
import { normalizeQuestionGrammar, professionalQuestionText, questionEffectText, questionWhyText, resolveQuestionReferences } from '@/lib/questions/presentation';

const node = (id: string, type: ClarityNode['type'], text: string): ClarityNode => ({
  id,
  type,
  text,
  status: type === 'UNKNOWN' || type === 'DECISION' ? 'OPEN' : 'RESOLVED',
  confidence: 0.8,
  impact: 0.8,
  source_refs: [],
  created_by: 'agent',
  created_at: '2026-08-20T00:00:00Z',
  updated_at: '2026-08-20T00:00:00Z',
});

function project(nodes: ClarityNode[], edges: Project['edges'] = [], deadline?: string): Project {
  return {
    id: 'presentation-test',
    title: 'Test project',
    goal: 'Complete the scheduled work with confirmed requirements.',
    deadline,
    clarity_score: 0,
    nodes,
    edges,
    sources: [],
    history: [],
    created_at: '2026-08-20T00:00:00Z',
    updated_at: '2026-08-20T00:00:00Z',
  };
}

describe('question card presentation', () => {
  it('corrects first-person auxiliary grammar without changing the question meaning', () => {
    expect(normalizeQuestionGrammar('Has I booked one yet?')).toBe('Have I booked one yet?');
    expect(normalizeQuestionGrammar('Has the landlord confirmed the date, and I need more time?')).toBe('Has the landlord confirmed the date, and do I need more time?');
  });

  it('replaces a vague one with the closest source-grounded subject', () => {
    expect(resolveQuestionReferences(
      'Have I booked one yet?',
      'I booked the elevator reservation earlier, but I am unsure whether the booking is recorded.',
    )).toBe('Have I booked the elevator reservation yet?');
    expect(resolveQuestionReferences(
      'Have I booked one yet?',
      'The building requires elevator reservations for large moves, and I have not booked one yet.',
    )).toBe('Have I booked the elevator reservation yet?');
  });

  it('uses professional confirmation wording for an authority-backed question while preserving preferences', () => {
    expect(professionalQuestionText(
      'Do I need to change any regular settings before the scheduled event?',
      ['The responsible team has not confirmed the required settings before the scheduled event.'],
    )).toBe('What has been confirmed about whether I am required to change any regular settings before the scheduled event?');
    expect(professionalQuestionText(
      'Do I need to submit the form?',
      ['The responsible team confirmed the form requirements.'],
    )).toBe('What has been confirmed about whether I am required to submit the form?');
    expect(professionalQuestionText(
      'Do I need to replace my laptop?',
      ['The event team confirmed registration instructions.'],
    )).toBe('Do I need to replace my laptop?');
    expect(professionalQuestionText(
      'Do I want to change my regular settings before the scheduled event?',
      ['The responsible team has not confirmed the required preparation.'],
    )).toBe('Do I want to change my regular settings before the scheduled event?');
  });

  it('grounds Why in a real downstream decision', () => {
    const question = node('question', 'UNKNOWN', 'What requirements are currently confirmed?');
    const decision = node('decision', 'DECISION', 'Proceed with the scheduled work');
    const graph = project([question, decision], [{ id: 'edge', source: 'question', target: 'decision', type: 'blocks' }]);

    expect(questionWhyText(graph, question)).toContain('Proceed with the scheduled work');
  });

  it('states when impact is not connected and omits a circular synthetic decision', () => {
    const question = node('question', 'UNKNOWN', 'Do I need to change the current configuration?');
    const circular = node('decision', 'DECISION', 'Decide whether to change the current configuration based on confirmation');
    const graph = project([question, circular], [{ id: 'edge', source: 'question', target: 'decision', type: 'depends_on' }], '2026-09-10');

    expect(questionEffectText(graph, question)).toBe('No downstream decision or action is recorded yet.');
    expect(questionWhyText(graph, question)).toContain('before');
  });
});
