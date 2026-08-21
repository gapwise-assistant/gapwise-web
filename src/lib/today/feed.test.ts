import { describe, expect, it } from 'vitest';
import { buildTodayFeed, compactQuestionContext } from '@/lib/today/feed';
import { buildContextPack } from '@/lib/retrieval/contextPack';
import { createGoldenDemoProject, DEFAULT_USER_PROFILE } from '@/lib/demo/seed';
import { todayQuestionFromNode } from '@/lib/today/sections';
import type { AttentionCandidate } from '@/types/attention';

function candidate(project: ReturnType<typeof createGoldenDemoProject>, id: string, sourceNodeIds: string[], kind: AttentionCandidate['kind'] = 'gap'): AttentionCandidate {
  return {
    id,
    kind,
    title: 'Resolve the top clarity gap',
    reason: 'Blocks primary project goal execution',
    next_action: 'What is the real housing budget?',
    source_node_ids: sourceNodeIds,
    source_ids: [],
    context_pack: buildContextPack({ userId: 'demo-user', query: 'today', project, profile: DEFAULT_USER_PROFILE }),
    factors: {
      goal_alignment: 0.9,
      impact: 0.9,
      urgency: 0.8,
      actionability: 0.8,
      evidence_confidence: 0.6,
      unresolved_risk: 0.8,
      momentum: 0.7,
      estimated_effort: 0.2,
    },
    score: 0.8,
    status: 'active',
  };
}

describe('Today primary feed', () => {
  it('renders a highly ranked gap as one QUESTION and suppresses duplicate candidates', () => {
    const project = createGoldenDemoProject();
    const gap = {
      id: 'housing_budget',
      type: 'UNKNOWN' as const,
      text: 'What is the real housing budget?',
      status: 'OPEN' as const,
      confidence: 0.3,
      impact: 0.9,
      source_refs: [],
      created_by: 'agent' as const,
      created_at: '2026-08-14T10:00:00Z',
      updated_at: '2026-08-14T10:00:00Z',
    };
    project.nodes.push(gap);
    const question = todayQuestionFromNode(project, gap);
    const feed = buildTodayFeed([
      candidate(project, 'rec_gap_one', [gap.id]),
      candidate(project, 'rec_gap_duplicate', [gap.id]),
      candidate(project, 'rec_action', ['node_goal'], 'opportunity'),
    ], [question], project);

    expect(feed).toHaveLength(2);
    expect(feed[0]).toMatchObject({ itemType: 'QUESTION', title: 'What is the real housing budget?' });
    expect(feed[0].question?.id).toBe(question.id);
    expect(feed[1].itemType).toBe('DECISION');
  });

  it('maps calendar commitments to reminders without exposing scores', () => {
    const project = createGoldenDemoProject();
    const reminder = candidate(project, 'rec_calendar', [], 'commitment');
    const feed = buildTodayFeed([reminder], [], project);

    expect(feed[0].itemType).toBe('REMINDER');
    expect(feed[0].recommendation.score).toBeDefined();
  });

  it('does not turn a negative risk fact into a Today ACTION card', () => {
    const project = createGoldenDemoProject();
    project.nodes.push({
      id: 'risk_negative_vendor',
      type: 'RISK',
      text: 'The vendor has not demonstrated safe retry behavior.',
      status: 'OPEN',
      confidence: 0.4,
      impact: 0.95,
      source_refs: [],
      created_by: 'agent',
      created_at: '2026-08-11T10:00:00Z',
      updated_at: '2026-08-11T10:00:00Z',
    });
    const feed = buildTodayFeed([candidate(project, 'rec_negative_risk', ['risk_negative_vendor'], 'risk')], [], project);

    expect(feed).toEqual([]);
  });

  it('turns graph reasons into short natural question context', () => {
    const project = createGoldenDemoProject();
    const questionNode = project.nodes.find((node) => node.id === 'unknown_target_user')!;
    const question = todayQuestionFromNode(project, questionNode);
    const feedItem = buildTodayFeed([candidate(project, 'rec_question', [questionNode.id])], [question], project)[0];

    expect(compactQuestionContext(feedItem, project)).toBe('Your answer will shape the next project decision.');

    question.question = 'Does this primarily frontend role remain acceptable given your preference to avoid frontend-heavy roles?';
    expect(compactQuestionContext({ ...feedItem, question }, project)).toBe('Conflicts with your role preferences.');
  });
});
