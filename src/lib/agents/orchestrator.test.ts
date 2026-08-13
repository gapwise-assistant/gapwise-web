import { describe, expect, it } from 'vitest';
import { createGoldenDemoProject, DEFAULT_USER_PROFILE } from '@/lib/demo/seed';
import { runGapswiseOrchestrator } from '@/lib/agents/orchestrator';
import { runGapAgent } from '@/lib/agents/gapAgent';
import { partnerAgentOutputSchema, validateStructuredOutput } from '@/lib/agents/schemas';

describe('Gapswise milestone 2 agent architecture', () => {
  it('produces a validated structured four-agent trace', () => {
    const result = runGapswiseOrchestrator({
      userId: 'demo-user',
      input: 'I need to decide the target persona before the demo.',
      project: createGoldenDemoProject(),
      profile: DEFAULT_USER_PROFILE,
    });

    expect(result.trace.agentEvents.map((event) => event.agentName)).toEqual([
      'Context Agent',
      'Gap Agent',
      'Attention Agent',
      'Partner Agent',
    ]);
    expect(result.partner.mode).toBe('ask_question');
    expect(result.partner.question).toBeTruthy();
  });

  it('does not ask a question when retrieved context likely answers the top gap', () => {
    const project = createGoldenDemoProject();
    project.sources.push({
      id: 'src_persona_answer',
      filename: 'persona-decision.txt',
      type: 'text',
      content:
        'The primary target persona and 4-minute demo scenario for Gapswise is a hackathon builder under deadline pressure.',
      extracted_at: '2026-08-10T12:00:00Z',
      derived_node_ids: ['unknown_target_user'],
    });

    const result = runGapAgent(project);

    expect(result.selectedGapNodeId).toBe('unknown_target_user');
    expect(result.retrievalAnswered).toBe(true);
    expect(result.question).toBeNull();
  });

  it('selects the highest-priority gap deterministically from multiple candidates', () => {
    const project = createGoldenDemoProject();
    const first = runGapAgent(project);
    const second = runGapAgent(project);

    expect(first.selectedGapNodeId).toBe('unknown_target_user');
    expect(second).toEqual(first);
  });

  it('rejects malformed structured model output', () => {
    expect(() =>
      validateStructuredOutput(partnerAgentOutputSchema, {
        mode: 'ask_question',
        message: 'Question without nullable fields is malformed.',
      })
    ).toThrow();
  });

  it('partner output asks exactly one question by default', () => {
    const result = runGapswiseOrchestrator({
      userId: 'demo-user',
      input: 'What should I decide next?',
      project: createGoldenDemoProject(),
      profile: DEFAULT_USER_PROFILE,
    });

    expect(result.partner.mode).toBe('ask_question');
    expect(result.partner.question?.split('?').filter(Boolean)).toHaveLength(1);
  });
});
